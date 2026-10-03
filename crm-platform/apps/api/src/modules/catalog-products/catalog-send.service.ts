import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  CATALOG_SEND_MAX_RECIPIENTS,
  ERROR_CODES,
  type SendCatalogInput,
  type SendCatalogResponse,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import {
  BAILEYS_CATALOG_BRIDGE,
  CATALOG_PROVIDER,
  CatalogProviderError,
  type BaileysCard,
  type BaileysCatalogBridge,
  type CatalogBinding,
  type CatalogProvider,
  type SentMessage,
} from '../../infra/providers/catalog-products/catalog-provider.port';
import { AuditService } from '../../kernel/audit/audit.service';
import {
  AUDIENCE_DIRECTORY,
  CONVERSATION_MIRROR,
  SENDER_DIRECTORY,
  SHOP_DIRECTORY,
  type AudienceDirectory,
  type CatalogSenderRow,
  type ConversationMirror,
  type SenderDirectory,
  type ShopDirectory,
} from './_shims/tokens';
import { CatalogBindings } from './catalog-bindings';
import {
  buildMpmSections,
  defaultCatalogLinkText,
  effectiveAvailability,
  mergeRecipients,
  ownedInSubmittedOrder,
  parseManualNumbers,
  retailerIdOf,
} from './catalog-rules';
import { CatalogSendsRepository } from './catalog-sends.repository';
import { CatalogsRepository, type CatalogRow } from './catalogs.repository';
import { ProductsRepository, type ProductRow } from './products.repository';

export const CATALOG_SEND_MODULE = 'catalog_sends';
const CONCURRENCY = 5;
const ERRORS_SHOWN = 10;

const text = (v: string | null | undefined): string | null => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

interface Attempt {
  to: string;
  ok: boolean;
  error: string | null;
}

interface Plan {
  recipients: string[];
  products: ProductRow[];
  catalog: CatalogRow | undefined;
  binding: CatalogBinding | undefined;
  device: CatalogSenderRow | undefined;
  shopUrl: string | null;
}

/**
 * Sending a catalog message to up to 500 numbers (WD-CAT-014, 015): a single product card, a product list, or a catalog link.
 *
 * Precedence, as WaDesk: a workspace with a Meta catalog ALWAYS sends through Meta (Meta Cloud or 360dialog), whatever sender
 * was picked; only a workspace with none sends a carousel (or the shop link) through the Node bridge. Every attempt is one row
 * of the send log, written in the transaction of its audit row after the provider answered.
 *
 * What differs from WaDesk (parity file): a workspace with a Meta catalog needs no `devices` row (WaDesk refused a WABA-only
 * workspace), a link send without a shop fails before anything is sent, products keep the order they were picked in, up to 5
 * recipients are sent at a time, and the inbox mirror and the plan-first billing wait on their domains.
 */
@Injectable()
export class CatalogSendService {
  private readonly logger = new Logger(CatalogSendService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly catalogs: CatalogsRepository,
    private readonly products: ProductsRepository,
    private readonly sends: CatalogSendsRepository,
    private readonly bindings: CatalogBindings,
    private readonly audit: AuditService,
    @Inject(CATALOG_PROVIDER) private readonly provider: CatalogProvider,
    @Inject(BAILEYS_CATALOG_BRIDGE) private readonly bridge: BaileysCatalogBridge,
    @Inject(SENDER_DIRECTORY) private readonly senders: SenderDirectory,
    @Inject(AUDIENCE_DIRECTORY) private readonly audience: AudienceDirectory,
    @Inject(SHOP_DIRECTORY) private readonly shops: ShopDirectory,
    @Inject(CONVERSATION_MIRROR) private readonly mirror: ConversationMirror,
  ) {}

  async send(input: SendCatalogInput): Promise<SendCatalogResponse> {
    const ctx = RequestContextStore.require();
    const plan = await this.plan(ctx.orgId, input);

    const names = plan.products.map((p) => p.name);
    const uuids = plan.products.map((p) => p.uuid);
    const attempts: Attempt[] = new Array<Attempt>(plan.recipients.length);
    let next = 0;
    const worker = async () => {
      for (let i = next++; i < plan.recipients.length; i = next++) {
        const to = plan.recipients[i]!;
        let sent: SentMessage | null = null;
        let error: string | null = null;
        try {
          sent = await this.deliver(plan, input, to);
        } catch (err) {
          error = this.reason(err);
          if (!(err instanceof CatalogProviderError)) {
            this.logger.error({ orgId: ctx.orgId, err: error }, 'catalog send failed unexpectedly');
          }
        }
        await this.record(ctx.orgId, ctx.userId, input, to, { uuids, names }, sent ? null : error);
        if (sent) {
          await this.mirror.mirrorCatalogSend({
            orgId: ctx.orgId,
            recipientDigits: to,
            userId: ctx.userId,
            mode: input.mode,
            body: text(input.body),
            provider: plan.catalog ? 'meta' : 'baileys',
            messageId: sent.messageId,
            products: plan.products.map((p) => ({
              id: p.id,
              name: p.name,
              imageUrl: p.imageUrl,
              priceMinor: p.priceMinor,
              currency: p.currencyCode,
              retailerId: retailerIdOf(p),
            })),
          });
        }
        attempts[i] = { to, ok: sent !== null, error };
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, plan.recipients.length) }, worker),
    );

    const sent = attempts.filter((a) => a.ok).length;
    return {
      ok: sent > 0,
      sent,
      failed: attempts.length - sent,
      total: attempts.length,
      errors: attempts
        .filter((a) => !a.ok)
        .slice(0, ERRORS_SHOWN)
        .map((a) => `${a.to}: ${a.error ?? 'unknown'}`),
    };
  }

  /** Everything decided before the first message: recipients, products, the engine and what it needs. */
  private async plan(orgId: number, input: SendCatalogInput): Promise<Plan> {
    return this.db.tx(async (tx) => {
      const recipients = mergeRecipients(
        parseManualNumbers(input.manualNumbers),
        await this.audience.phonesOfContacts(tx, orgId, input.contactIds),
        await this.audience.phonesOfGroups(tx, orgId, input.groupIds),
      );
      if (recipients.length === 0) {
        throw new AppError(
          ERROR_CODES.CAT_NO_RECIPIENTS,
          'Pick at least one contact, group, or paste a number.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      if (recipients.length > CATALOG_SEND_MAX_RECIPIENTS) {
        throw new AppError(
          ERROR_CODES.CAT_TOO_MANY_RECIPIENTS,
          `Maximum ${CATALOG_SEND_MAX_RECIPIENTS} recipients per send. Split into smaller batches.`,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      // A stale or foreign id is silently dropped; the order the operator picked is kept.
      const found = await this.products.findByUuids(tx, orgId, input.productIds, {
        activeOnly: true,
      });
      const products = ownedInSubmittedOrder(input.productIds, found);
      if (input.mode !== 'link' && products.length === 0) {
        throw new AppError(
          ERROR_CODES.CAT_NO_PRODUCTS,
          'Pick at least one product first.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }

      const catalog = await this.catalogs.first(tx, orgId);
      if (catalog) {
        return {
          recipients,
          products,
          catalog,
          binding: this.bindings.of(catalog),
          device: undefined,
          shopUrl: null,
        };
      }

      const device = await this.senders.baileysDevice(tx, orgId, input.sender);
      if (!device || !device.phone) {
        throw new AppError(
          ERROR_CODES.CAT_NO_SENDER,
          device
            ? 'Sending device has no phone number.'
            : 'No connected device. Pair one at /devices first.',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      let shopUrl: string | null = null;
      if (input.mode === 'link') {
        shopUrl = (await this.shops.list(tx, orgId))[0]?.publicUrl ?? null;
        if (!shopUrl) {
          throw new AppError(
            ERROR_CODES.CAT_NO_SHOP,
            'No storefront set up. Create one in Connect > Store first.',
            HttpStatus.UNPROCESSABLE_ENTITY,
          );
        }
      }
      return { recipients, products, catalog: undefined, binding: undefined, device, shopUrl };
    });
  }

  private deliver(plan: Plan, input: SendCatalogInput, to: string): Promise<SentMessage> {
    const body = text(input.body);
    const header = text(input.header);
    const footer = text(input.footer);
    if (plan.binding)
      return this.viaMeta(plan.binding, plan.products, input.mode, to, { body, header, footer });
    return this.viaBridge(plan, input.mode, to, { body, header, footer });
  }

  private viaMeta(
    binding: CatalogBinding,
    products: readonly ProductRow[],
    mode: SendCatalogInput['mode'],
    to: string,
    t: { body: string | null; header: string | null; footer: string | null },
  ): Promise<SentMessage> {
    if (mode === 'spm') {
      // One card: extra products are ignored for a single-product message.
      return this.provider.sendSPM(binding, to, retailerIdOf(products[0]!), t.body, t.footer);
    }
    if (mode === 'mpm') {
      return this.provider.sendMPM(
        binding,
        to,
        t.header ?? 'Our catalog',
        t.body ?? 'Tap a product to learn more',
        buildMpmSections(
          products.map((p) => ({ retailerId: retailerIdOf(p), category: p.category })),
        ),
        t.footer,
      );
    }
    return this.provider.sendCatalogLink(
      binding,
      to,
      t.body ?? defaultCatalogLinkText(binding.phoneNumberId, to),
    );
  }

  private viaBridge(
    plan: Plan,
    mode: SendCatalogInput['mode'],
    to: string,
    t: { body: string | null; header: string | null; footer: string | null },
  ): Promise<SentMessage> {
    const senderPhone = plan.device!.phone!;
    if (mode === 'link') {
      return this.bridge.sendText({
        senderPhone,
        to,
        text: `${t.body ?? 'Browse our shop:'}\n${plan.shopUrl}`.trim(),
      });
    }
    // SPM sends the first product only, like Meta's single-product card.
    const chosen = mode === 'spm' ? plan.products.slice(0, 1) : plan.products;
    const cards: BaileysCard[] = chosen.map((p) => ({
      retailer_id: retailerIdOf(p),
      id: p.uuid,
      name: p.name,
      description: p.description,
      image_url: p.imageUrl,
      price: p.priceMinor / 100,
      currency: p.currencyCode,
      category: p.category,
      availability: effectiveAvailability(p),
      url: p.productUrl,
    }));
    return this.bridge.sendCarousel({
      senderPhone,
      to,
      cards,
      headerText: t.header ?? 'Our catalog',
      bodyText: t.body ?? 'Tap a product to learn more',
      footerText: t.footer ?? '',
    });
  }

  /** What the operator reads next to a number: the provider's own message. */
  private reason(err: unknown): string {
    if (err instanceof CatalogProviderError) return err.message;
    if (err instanceof AppError) return err.message;
    return err instanceof Error ? err.message : 'unknown';
  }

  /** One row of the send log and its audit row, together. */
  private async record(
    orgId: number,
    userId: number | null,
    input: SendCatalogInput,
    to: string,
    p: { uuids: string[]; names: string[] },
    error: string | null,
  ): Promise<void> {
    await this.db.tx(async (tx) => {
      const id = await this.sends.insert(tx, orgId, {
        userId,
        recipient: to,
        mode: input.mode,
        header: text(input.header),
        body: text(input.body),
        footer: text(input.footer),
        productIds: p.uuids,
        productNames: p.names,
        status: error === null ? 'sent' : 'failed',
        error: error === null ? null : error.slice(0, 500),
      });
      await this.audit.record(tx, {
        module: CATALOG_SEND_MODULE,
        recordId: id,
        action: 'insert',
        // The audit trail names the recipient by its last four digits; the full number lives in the send log itself.
        delta: {
          recipient: { old: null, new: `***${to.slice(-4)}` },
          mode: { old: null, new: input.mode },
          status: { old: null, new: error === null ? 'sent' : 'failed' },
        },
      });
    });
  }
}
