import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import {
  ERROR_CODES,
  currencyExponent,
  minorToMajor,
  parseScaled,
  type PublicInvoice,
  type PublicPayInput,
  type PublicPayResponse,
  type RecordScope,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import type { Env } from '../../../config/env.schema';
import { DatabaseService } from '../../../infra/db/database.service';
import { REDIS_CLIENT } from '../../../infra/redis/redis.module';
import { incrWithTtl } from '../../../infra/redis/incr-with-ttl';
import {
  INVOICE_PAYMENT_GATEWAYS,
  type InvoicePaymentGateways,
} from '../../../infra/providers/invoice-payments/invoice-payment-gateway.port';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import {
  GatewayLinkService,
  WorkspaceGatewayResolver,
  supportsPaymentLinks,
  type ResolvedGateway,
} from '../../checkout-orders-merchant-payments';
import { resolveTimezone } from '../deals/deal-calendar';
import { buildPublicInvoice } from './invoice-document';
import { invoiceReference } from './invoice-gateway-settler';
import { renderInvoiceHtml, renderInvoicePdf } from './invoice-render';
import { hashPublicToken, isPlausibleToken } from './invoice-rules';
import { InvoiceSettingsRepository } from './invoice-settings.repository';
import { invoiceEventPayload } from './invoices.mapper';
import { InvoicesRepository, type InvoiceRow } from './invoices.repository';
import { InvoicesService } from './invoices.service';
import { PaymentsRepository } from './payments.repository';

/** Public routes are rate limited per client address: 120 reads a minute (the budget Reference gave its public pages), 20 pay attempts. */
export const PUBLIC_READ_PER_MINUTE = 120;
export const PUBLIC_PAY_PER_MINUTE = 20;
export const WEBHOOK_PER_MINUTE = 300;

@Injectable()
export class PublicRateLimiter {
  private readonly logger = new Logger(PublicRateLimiter.name);

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /** Throws 429 over the limit. Fails open when Redis is down: a cache outage must not take buyers' invoices offline. */
  async hit(scope: string, key: string, max: number): Promise<void> {
    const bucket = Math.floor(Date.now() / 60_000);
    const redisKey = `invoicing:rl:${scope}:${key}:${bucket}`;
    let count = 0;
    try {
      count = await incrWithTtl(this.redis, redisKey, 120);
    } catch (err) {
      this.logger.warn({ err }, 'public rate limit failed open');
      return;
    }
    if (count > max) {
      throw new AppError(
        ERROR_CODES.RATE_LIMITED,
        'Too many requests',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }
}

/** The tenant a public token points at: the only cross-tenant read an unauthenticated request makes, done by a SECURITY DEFINER function. */
export interface ResolvedLink {
  orgId: number;
  invoiceId: number;
}

/** An attempt opened on the shared gateway, waiting for its hosted link (made outside the transaction that opened it). */
interface SharedPayStart {
  shared: ResolvedGateway;
  attemptId: string;
  amountMinor: bigint;
  currency: string;
  number: string;
  base: Omit<PublicPayResponse, 'kind' | 'attemptId' | 'url'>;
}

/**
 * The buyer's side of an invoice (TW-INV-016/017, TW-PAY-015, D-15). The unguessable token is the only capability: it is resolved
 * by its SHA-256 through a database function (no privileged() on an HTTP path), then every further read and write runs as that
 * tenant. A view never changes anything but its own counters; the PDF never triggers a send (Reference's did).
 */
@Injectable()
export class InvoicePublicService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: InvoicesRepository,
    private readonly invoices: InvoicesService,
    private readonly paymentsRepo: PaymentsRepository,
    private readonly settingsRepo: InvoiceSettingsRepository,
    private readonly outbox: OutboxService,
    private readonly sharedGateways: WorkspaceGatewayResolver,
    private readonly links: GatewayLinkService,
    private readonly config: ConfigService<Env, true>,
    @Inject(INVOICE_PAYMENT_GATEWAYS) private readonly gateways: InvoicePaymentGateways,
  ) {}

  /**
   * The workspace's shared payment gateway (Settings > Payments, the one the store checkout uses), when it can make a hosted link a
   * buyer pays on. It is the FIRST choice for an invoice; the generic signed-webhook connection (`hmac_generic`, Settings >
   * Invoicing) stays as the fallback for a workspace that has not configured the shared one.
   */
  private async sharedLinkGateway(tx: Tx, orgId: number): Promise<ResolvedGateway | null> {
    const gateway = await this.sharedGateways.resolve(orgId, null, { tx });
    return gateway && supportsPaymentLinks(gateway.slug) ? gateway : null;
  }

  /** Token -> (org, invoice). An unplausible or unknown token is the same plain 404. */
  async resolve(token: string): Promise<ResolvedLink> {
    if (!isPlausibleToken(token)) throw AppError.notFound('Invoice');
    const res = await this.db.primary.execute(
      sql`SELECT org_id, invoice_id FROM invoice_by_public_token(${hashPublicToken(token)})`,
    );
    const r = res.rows[0] as { org_id: number | string; invoice_id: number | string } | undefined;
    if (!r) throw AppError.notFound('Invoice');
    return { orgId: Number(r.org_id), invoiceId: Number(r.invoice_id) };
  }

  /** Runs `fn` as the tenant of the link, with a context the audit and outbox helpers can read. */
  private inTenant<T>(
    link: ResolvedLink,
    ip: string | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    const base = RequestContextStore.peek();
    return RequestContextStore.run(
      {
        requestId: base?.requestId ?? 'public',
        orgId: link.orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
        ip,
        userAgent: base?.userAgent,
      },
      fn,
    );
  }

  private liveOrThrow(row: InvoiceRow): void {
    if (
      row.tokenRevokedAt !== null ||
      (row.tokenExpiresAt !== null && row.tokenExpiresAt <= new Date())
    ) {
      throw new AppError(
        ERROR_CODES.INV_LINK_UNAVAILABLE,
        'This invoice link is no longer available',
        HttpStatus.GONE,
      );
    }
  }

  private async load(tx: Tx, link: ResolvedLink): Promise<{ row: InvoiceRow; doc: PublicInvoice }> {
    const tz = await this.invoices.zone(tx, link.orgId);
    const row = await this.repo.findById(tx, link.orgId, link.invoiceId, tz);
    if (!row || row.storedStatus === 'draft') throw AppError.notFound('Invoice');
    this.liveOrThrow(row);
    const [lines, taxSummary, payments, conn, shared] = await Promise.all([
      this.repo.lines(tx, link.orgId, row.id),
      this.repo.taxSummary(tx, link.orgId, row.id),
      this.paymentsRepo.forInvoice(tx, link.orgId, row.id),
      this.settingsRepo.connection(tx, link.orgId, 'hmac_generic'),
      this.sharedLinkGateway(tx, link.orgId),
    ]);
    return {
      row,
      doc: buildPublicInvoice({
        row,
        lines,
        taxSummary,
        payments,
        online: conn?.enabled === true || shared !== null,
      }),
    };
  }

  /** The JSON the web page renders. Counts the view (the first one raises `invoice.viewed`). */
  async view(token: string, ip: string | undefined): Promise<PublicInvoice> {
    const link = await this.resolve(token);
    return this.inTenant(link, ip, () =>
      this.db.tx(async (tx) => {
        const { row, doc } = await this.load(tx, link);
        const first = await this.repo.recordView(tx, link.orgId, row.id);
        if (first) {
          await this.repo.log(tx, link.orgId, row.id, { event: 'viewed', actorKind: 'buyer' });
          await this.outbox.emit(tx, {
            aggregateModule: 'invoices',
            aggregateId: row.id,
            eventType: 'invoice.viewed',
            payload: invoiceEventPayload(row),
          });
        }
        return doc;
      }),
    );
  }

  /** The document for the printable page and the PDF: a read, no counters, no events. */
  private async document(token: string, ip: string | undefined): Promise<PublicInvoice> {
    const link = await this.resolve(token);
    return this.inTenant(link, ip, () => this.db.tx(async (tx) => (await this.load(tx, link)).doc));
  }

  async printHtml(token: string, ip: string | undefined): Promise<string> {
    return renderInvoiceHtml(await this.document(token, ip));
  }

  async pdf(token: string, ip: string | undefined): Promise<{ bytes: Buffer; filename: string }> {
    const doc = await this.document(token, ip);
    return { bytes: renderInvoicePdf(doc), filename: `${doc.number}.pdf` };
  }

  /**
   * "Pay now". The workspace's shared gateway is tried first: an ATTEMPT is opened (its uuid, as `INV-<uuid>`, is the reference the
   * provider echoes back to the gateway's own webhook) and a hosted link is made on that gateway. Failing that, an online generic
   * connection opens an attempt as before; failing that, the buyer gets the bank-transfer instructions. Whatever the path the page is
   * display-only: only a verified webhook (or a person recording the transfer) ever marks money received.
   */
  async pay(
    token: string,
    input: PublicPayInput,
    ip: string | undefined,
  ): Promise<PublicPayResponse> {
    const link = await this.resolve(token);
    const started = await this.inTenant(link, ip, () =>
      this.db.tx(async (tx): Promise<PublicPayResponse | SharedPayStart> => {
        const tz = await this.invoices.zone(tx, link.orgId);
        const row = await this.repo.findById(tx, link.orgId, link.invoiceId, tz, true);
        if (!row || row.storedStatus === 'draft') throw AppError.notFound('Invoice');
        this.liveOrThrow(row);
        const balance =
          row.totalMinor > row.paidMinor + row.creditedMinor
            ? row.totalMinor - row.paidMinor - row.creditedMinor
            : 0n;
        if (row.storedStatus !== 'issued' || balance <= 0n)
          throw new AppError(
            ERROR_CODES.PAY_NOTHING_TO_PAY,
            'There is nothing left to pay on this invoice',
            HttpStatus.CONFLICT,
          );

        let amount = balance;
        if (input.amount !== undefined) {
          const parsed = parseScaled(input.amount, currencyExponent(row.currency));
          if (parsed === null || parsed <= 0n || parsed > balance)
            throw AppError.validation('The amount must be above 0 and at most the balance', [
              { path: 'amount', message: `at most ${minorToMajor(balance, row.currency)}` },
            ]);
          amount = parsed;
        }

        const snap = row.sellerSnapshot ?? {};
        const instructions =
          typeof snap.paymentInstructions === 'string'
            ? (snap.paymentInstructions as string)
            : null;
        const details = (snap.bankDetails as Record<string, string> | null) ?? null;
        const conn = await this.settingsRepo.connection(tx, link.orgId, 'hmac_generic');
        const base = {
          amount: minorToMajor(amount, row.currency),
          currency: row.currency,
          details,
          instructions,
          note: 'This page does not confirm payment. The invoice is marked paid only when the payment is received and verified.',
        };

        // The shared gateway first. The provider call is made AFTER this transaction (it can take seconds and the invoice row is
        // locked here); the attempt row comes first so its uuid is the reference the provider echoes back.
        const shared = await this.sharedLinkGateway(tx, link.orgId);
        if (shared) {
          const ins = await tx.execute(sql`
            INSERT INTO invoice_payment_attempts (org_id, invoice_id, connection_id, provider, amount_minor, currency, expires_at)
            VALUES (${link.orgId}, ${row.id}, NULL, ${shared.slug}, ${amount.toString()}::bigint, ${row.currency}, now() + interval '7 days')
            RETURNING uuid
          `);
          const attemptId = (ins.rows[0] as { uuid: string }).uuid;
          await this.repo.log(tx, link.orgId, row.id, {
            event: 'pay_attempt',
            detail: base.amount,
            actorKind: 'buyer',
            meta: { attempt: attemptId, provider: shared.slug },
          });
          return {
            shared,
            attemptId,
            amountMinor: amount,
            currency: row.currency,
            number: row.number ?? '',
            base,
          };
        }

        if (conn?.enabled) {
          const gw = this.gateways.get('hmac_generic')!;
          const ins = await tx.execute(sql`
            INSERT INTO invoice_payment_attempts (org_id, invoice_id, connection_id, provider, amount_minor, currency, expires_at)
            VALUES (${link.orgId}, ${row.id}, ${conn.id}, 'hmac_generic', ${amount.toString()}::bigint, ${row.currency}, now() + interval '7 days')
            RETURNING uuid
          `);
          const attemptId = (ins.rows[0] as { uuid: string }).uuid;
          const out = await gw.createCheckout({
            attemptId,
            amountMinor: amount,
            currency: row.currency,
            invoiceNumber: row.number ?? '',
            description: `Invoice ${row.number}`,
          });
          await this.repo.log(tx, link.orgId, row.id, {
            event: 'pay_attempt',
            detail: base.amount,
            actorKind: 'buyer',
            meta: { attempt: attemptId, provider: 'hmac_generic' },
          });
          return {
            kind: out.kind === 'redirect' ? 'redirect' : 'instructions',
            attemptId,
            url: out.url ?? null,
            ...base,
          };
        }
        if (instructions || details) {
          return { kind: 'instructions', attemptId: null, url: null, ...base };
        }
        return { kind: 'unavailable', attemptId: null, url: null, ...base };
      }),
    );
    if (!('shared' in started)) return started;
    return this.finishSharedPay(link, token, ip, started);
  }

  /**
   * Makes the hosted link on the shared gateway for an attempt that is already open, outside any transaction, and records the answer.
   * When the provider gives no link the attempt is closed as failed and the buyer still gets the bank-transfer instructions (or
   * "unavailable" when there are none): a gateway outage is never a dead end.
   */
  private async finishSharedPay(
    link: ResolvedLink,
    token: string,
    ip: string | undefined,
    s: SharedPayStart,
  ): Promise<PublicPayResponse> {
    const minted = await this.links.mint(s.shared, {
      reference: invoiceReference(s.attemptId),
      amountMinor: s.amountMinor,
      currency: s.currency,
      description: `Invoice ${s.number}`,
      callbackUrl: `${this.config.get('WEB_APP_URL', { infer: true })}/i/${token}`,
      notes: { invoice_attempt: s.attemptId, workspace_id: String(link.orgId) },
    });
    await this.inTenant(link, ip, () =>
      this.db.tx(async (tx) => {
        if (minted) {
          await tx.execute(sql`
            UPDATE invoice_payment_attempts SET checkout_url = ${minted.url}, external_id = ${minted.id}
            WHERE org_id = ${link.orgId} AND uuid = ${s.attemptId}::uuid AND status = 'pending'
          `);
        } else {
          await tx.execute(sql`
            UPDATE invoice_payment_attempts SET status = 'failed'
            WHERE org_id = ${link.orgId} AND uuid = ${s.attemptId}::uuid AND status = 'pending'
          `);
        }
      }),
    );
    if (minted) {
      return { kind: 'redirect', attemptId: s.attemptId, url: minted.url, ...s.base };
    }
    return s.base.instructions || s.base.details
      ? { kind: 'instructions', attemptId: null, url: null, ...s.base }
      : { kind: 'unavailable', attemptId: null, url: null, ...s.base };
  }

  /** Staff view of the document (an authenticated PDF download). */
  async documentForStaff(uuid: string, scope: RecordScope): Promise<PublicInvoice> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const tz = resolveTimezone((await this.repo.orgSettings(tx, ctx.orgId)).timezone);
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid, tz);
      if (!row) throw AppError.notFound('Invoice', uuid);
      await this.invoices.assertScope(tx, scope, row);
      const [lines, taxSummary, payments, conn, shared] = await Promise.all([
        this.repo.lines(tx, ctx.orgId, row.id),
        this.repo.taxSummary(tx, ctx.orgId, row.id),
        this.paymentsRepo.forInvoice(tx, ctx.orgId, row.id),
        this.settingsRepo.connection(tx, ctx.orgId, 'hmac_generic'),
        this.sharedLinkGateway(tx, ctx.orgId),
      ]);
      return buildPublicInvoice({
        row,
        lines,
        taxSummary,
        payments,
        online: conn?.enabled === true || shared !== null,
      });
    });
  }
}
