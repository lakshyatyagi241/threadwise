import { Inject, Injectable, Logger } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { DatabaseService } from '../../infra/db/database.service';
import { WOOCOMMERCE, type WooFactory } from '../../infra/providers/ecom/ecom.port';
import {
  COMMERCE_SENDER,
  ECOM_TEMPLATES,
  type CommerceSender,
  type EcomTemplates,
} from './_shims/tokens';
import { CodRepository } from './cod.repository';
import {
  codRisk,
  readCodReply,
  shopifyContext,
  shopifyRecipient,
  wooContext,
  wooRecipient,
  type StoreFacts,
} from './event-rules';
import { EventMessageService } from './event-message.service';
import { EventsRepository } from './events.repository';
import { MirrorRepository } from './mirror.repository';
import type { StoreKind } from './mirror-rules';
import { StoresRepository } from './stores.repository';

type Json = Record<string, unknown>;
const digits = (v: string | null): string => (v ?? '').replace(/\D/g, '');

export interface RiskResult {
  score: number;
  level: 'high' | 'medium' | 'low';
  reasons: string[];
}

/**
 * Cash-on-delivery double confirmation (TW-ECOM-016, 030): on a COD order the customer is asked to confirm and a pending row is
 * kept; their later Yes or No reply settles it, flips the mirrored order (and, for WooCommerce, the real one) and is answered.
 * A customer who never replies stays pending, so the merchant can hold the shipment.
 */
@Injectable()
export class CodService {
  private readonly logger = new Logger(CodService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly stores: StoresRepository,
    private readonly events: EventsRepository,
    private readonly message: EventMessageService,
    private readonly cod: CodRepository,
    private readonly mirror: MirrorRepository,
    @Inject(ECOM_TEMPLATES) private readonly templates: EcomTemplates,
    @Inject(COMMERCE_SENDER) private readonly sender: CommerceSender,
    @Inject(WOOCOMMERCE) private readonly woo: WooFactory,
  ) {}

  /** The WooCommerce risk score for an order, from the workspace's own mirrored orders. */
  async risk(orgId: number, data: Json): Promise<RiskResult> {
    const billing = (
      typeof data.billing === 'object' && data.billing !== null ? data.billing : {}
    ) as Json;
    const phone = digits(wooRecipient(data));
    const history = await this.db.txAs({ orgId }, (tx) =>
      this.mirror.wooHistory(tx, orgId, phone, String(data.id ?? '')),
    );
    return codRisk({
      priorCount: history.count,
      priorCancelled: history.cancelled,
      priorFulfilled: history.fulfilled,
      total: Number(data.total ?? 0) || 0,
      average: history.average,
      hasEmail: typeof billing.email === 'string' && billing.email !== '',
      hasPhone: phone !== '',
    });
  }

  /** Asks the customer to confirm (when the `cod/confirm` automation is on with a template) and opens the pending row. */
  async confirm(orgId: number, kind: StoreKind, storeId: number, data: Json): Promise<void> {
    const cfg = await this.message.config(orgId, kind, storeId, 'cod/confirm');
    if (!cfg) return;
    const phone = digits(kind === 'shopify' ? shopifyRecipient(data) : wooRecipient(data));
    if (phone === '') return;
    const loaded = await this.db.txAs({ orgId }, async (tx) => ({
      store: await this.stores.storeById(tx, orgId, kind, storeId),
      template: cfg.templateId
        ? await this.templates.sendable(tx, orgId, cfg.templateId)
        : undefined,
    }));
    if (!loaded.store || !loaded.template) return;
    const { store, template } = loaded;
    const facts: StoreFacts = {
      storeName: store.storeName,
      storeUrl: store.storeUrl,
      currency: 'shopCurrency' in store ? store.shopCurrency : store.storeCurrency,
    };
    // The confirmation always uses the default order variables (name, order, total); the automation's own variable list does not apply.
    const ctx = kind === 'shopify' ? shopifyContext(facts, data) : wooContext(facts, data);
    const orderName = ctx.vars.order_name ?? '';

    let error: string | null = null;
    let response: unknown = null;
    try {
      const out = await this.sender.send(orgId, {
        to: phone,
        template,
        ctx,
        reference: `ecom-cod-${kind}-${storeId}-${String(data.id ?? '')}`,
      });
      response = { to: phone, id: out.providerMessageId };
    } catch (err) {
      error = err instanceof Error ? err.message : 'The message was not sent.';
      this.logger.warn({ orgId, kind, storeId, err }, 'COD confirmation not sent');
    }

    await this.db.txAs({ orgId }, async (tx) => {
      await this.cod.open(tx, orgId, kind, storeId, {
        storeOrderId: String(data.id ?? ''),
        orderName,
        phone,
      });
      const log = await this.events.log(tx, orgId, kind, storeId, {
        eventType: 'cod/confirm',
        status: error === null ? 'sent' : 'failed',
        recipient: phone,
        payload: { order: orderName },
        error,
      });
      if (response !== null)
        await this.events.setLog(tx, orgId, kind, log, { status: 'sent', response });
    });
  }

  /**
   * A customer's message. When the number has a pending confirmation and the text reads yes or no, the order is flipped and the
   * customer answered. True when this message was taken (the caller can skip its generic reply).
   */
  async handleReply(
    orgId: number,
    kind: StoreKind,
    rawPhone: string,
    text: string,
  ): Promise<boolean> {
    const phone = digits(rawPhone);
    if (phone === '') return false;
    const reply = readCodReply(text);
    if (reply === null) return false;
    const pending = await this.db.txAs({ orgId }, (tx) =>
      this.cod.newestPending(tx, orgId, kind, phone),
    );
    if (!pending) return false;

    const result = reply === 'yes' ? 'confirmed' : 'cancelled';
    const settled = await this.db.txAs({ orgId }, (tx) =>
      this.cod.settle(tx, orgId, kind, pending.id, result),
    );
    // Another reply settled it between the read and here: that one answered the customer.
    if (!settled) return false;

    if (pending.storeOrderId) {
      await this.flipRemote(orgId, kind, pending.storeId, pending.storeOrderId, reply === 'yes');
      await this.db
        .txAs({ orgId }, (tx) =>
          this.mirror.setOrderStatus(tx, orgId, kind, pending.storeOrderId!, result),
        )
        .catch((err: unknown) => this.logger.debug({ err }, 'COD mirror status update failed'));
    }
    await this.db.txAs({ orgId }, (tx) =>
      this.events.log(tx, orgId, kind, pending.storeId, {
        eventType: 'cod/reply',
        status: 'processed',
        recipient: phone,
        payload: { order: pending.orderName, reply: text, result },
      }),
    );
    const body =
      reply === 'yes'
        ? `Thank you! Your COD order ${pending.orderName} is confirmed. We'll ship it shortly.`
        : `Your COD order ${pending.orderName} has been cancelled. Reply if this was a mistake.`;
    await this.sender
      .sendText(orgId, { to: phone, body, reference: `ecom-cod-ack-${kind}-${pending.id}` })
      .catch((err: unknown) => this.logger.debug({ err }, 'COD acknowledgement not sent'));
    return true;
  }

  /** WooCommerce only: the real order goes to processing (yes) or cancelled (no). Best effort, as Reference. */
  private async flipRemote(
    orgId: number,
    kind: StoreKind,
    storeId: number,
    storeOrderId: string,
    yes: boolean,
  ): Promise<void> {
    if (kind !== 'woocommerce') return;
    try {
      const row = await this.db.txAs({ orgId }, (tx) => this.stores.wooById(tx, orgId, storeId));
      if (!row || row.consumerKey === '') return;
      await this.woo
        .store(
          row.storeUrl,
          this.crypto.decrypt(row.consumerKey),
          this.crypto.decrypt(row.consumerSecret),
        )
        .updateOrder(storeOrderId, { status: yes ? 'processing' : 'cancelled' });
    } catch (err) {
      this.logger.debug({ err }, 'COD remote status flip failed');
    }
  }
}
