import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  currencyExponent,
  invoiceGatewayEventSchema,
  parseScaled,
  type InvoiceGatewayEvent,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import {
  INVOICE_PAYMENT_GATEWAYS,
  type InvoicePaymentGateways,
  type WebhookHeaders,
} from '../../../infra/providers/invoice-payments/invoice-payment-gateway.port';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { InvoicesRepository } from './invoices.repository';
import { InvoicesService } from './invoices.service';
import { PublicRateLimiter, WEBHOOK_PER_MINUTE } from './invoice-public.service';
import { PaymentsService } from './payments.service';

export type WebhookOutcome = 'applied' | 'duplicate' | 'ignored' | 'rejected';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Inbound "payment succeeded / failed" events for invoices (WD-PAY-009, D-18, the webhook-handler skill). In this order:
 *
 *   1. the endpoint id in the URL resolves to a connection and its secret (a database function; nothing about invoices is read);
 *   2. the signature is verified over the RAW body BEFORE anything else is looked up. No connection, a disabled one, no secret,
 *      a bad or stale signature are all the same 401: the endpoint does not say which, so it is no oracle for a probe;
 *   3. only then is the body parsed, and the event id recorded once (a redelivery is recognised and does nothing);
 *   4. the reference is looked up INSIDE the verified tenant (the attempt must belong to this connection's organization), and its
 *      amount and currency are compared with what the attempt asked for: a signed event for another amount is rejected, recorded
 *      and raised as `payment.rejected`, never applied;
 *   5. the payment goes through the same ledger code a person uses, with the provider's payment id as its idempotency key.
 *
 * A transient failure (the database) throws, so the provider retries; a business rejection answers 200 (a retry cannot fix it).
 */
@Injectable()
export class InvoiceGatewayWebhookService {
  private readonly logger = new Logger(InvoiceGatewayWebhookService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly limiter: PublicRateLimiter,
    private readonly invoicesRepo: InvoicesRepository,
    private readonly invoices: InvoicesService,
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(INVOICE_PAYMENT_GATEWAYS) private readonly gateways: InvoicePaymentGateways,
  ) {}

  private unauthorized(): AppError {
    return new AppError(ERROR_CODES.PAY_SIGNATURE_INVALID, 'Invalid signature', HttpStatus.UNAUTHORIZED);
  }

  async handle(
    endpointId: string,
    rawBody: Buffer | undefined,
    headers: WebhookHeaders,
    ip: string | undefined,
  ): Promise<{ status: WebhookOutcome }> {
    await this.limiter.hit('webhook', `${endpointId.slice(0, 36)}:${ip ?? 'unknown'}`, WEBHOOK_PER_MINUTE);
    if (!UUID.test(endpointId) || !rawBody || rawBody.length === 0 || rawBody.length > 256_000)
      throw this.unauthorized();

    const res = await this.db.primary.execute(
      sql`SELECT org_id, connection_id, provider, secret_cipher, enabled FROM invoice_gateway_by_endpoint(${endpointId}::uuid)`,
    );
    const c = res.rows[0] as
      | { org_id: number | string; connection_id: number | string; provider: string; secret_cipher: string | null; enabled: boolean }
      | undefined;
    const gateway = c ? this.gateways.get(c.provider) : undefined;
    // Fail closed: nothing to verify against means nothing is accepted.
    if (!c || !c.enabled || !c.secret_cipher || !gateway) throw this.unauthorized();
    let secret: string;
    try {
      secret = this.crypto.decrypt(c.secret_cipher);
    } catch (err) {
      this.logger.error({ err, connection: c.connection_id }, 'could not decrypt the webhook secret');
      throw this.unauthorized();
    }
    if (!gateway.verifyWebhookSignature(rawBody, headers, secret)) throw this.unauthorized();

    // From here the sender is authenticated; its payload is still data.
    let event: InvoiceGatewayEvent;
    try {
      const parsed = invoiceGatewayEventSchema.safeParse(JSON.parse(rawBody.toString('utf8')));
      if (!parsed.success)
        throw new AppError(
          ERROR_CODES.VALIDATION_FAILED,
          'Invalid event',
          HttpStatus.BAD_REQUEST,
          parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        );
      event = parsed.data;
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'The body is not valid JSON', HttpStatus.BAD_REQUEST);
    }

    const orgId = Number(c.org_id);
    const connectionId = Number(c.connection_id);
    const base = RequestContextStore.peek();
    return RequestContextStore.run(
      {
        requestId: base?.requestId ?? 'webhook',
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
        ip,
        userAgent: base?.userAgent,
      },
      () => this.db.tx((tx) => this.apply(tx, orgId, connectionId, event)),
    );
  }

  private async apply(
    tx: Tx,
    orgId: number,
    connectionId: number,
    event: InvoiceGatewayEvent,
  ): Promise<{ status: WebhookOutcome }> {
    // The event id is recorded first, in this transaction: a redelivery hits the unique key and does nothing, and a failure below
    // rolls the row back so the provider's retry is processed.
    const ins = await tx.execute(sql`
      INSERT INTO invoice_gateway_events (org_id, connection_id, event_id, event_type, outcome)
      VALUES (${orgId}, ${connectionId}, ${event.id}, ${event.type}, 'ignored')
      ON CONFLICT (org_id, connection_id, event_id) DO NOTHING RETURNING id
    `);
    const eventRowId = (ins.rows[0] as { id: number | string } | undefined)?.id;
    if (eventRowId === undefined) return { status: 'duplicate' };
    const settle = async (outcome: 'applied' | 'ignored' | 'rejected', detail: string | null, attemptId: number | null) => {
      await tx.execute(sql`
        UPDATE invoice_gateway_events SET outcome = ${outcome}, detail = ${detail}, attempt_id = ${attemptId}
        WHERE org_id = ${orgId} AND id = ${Number(eventRowId)}
      `);
      return { status: outcome } as { status: WebhookOutcome };
    };

    // The reference is looked up inside THIS organization and THIS connection: an attempt of another tenant is simply unknown.
    const a = await tx.execute(sql`
      SELECT id, invoice_id, amount_minor::text, currency, status FROM invoice_payment_attempts
      WHERE org_id = ${orgId} AND connection_id = ${connectionId} AND uuid = ${event.data.reference}::uuid FOR UPDATE
    `);
    const attempt = a.rows[0] as
      | { id: number | string; invoice_id: number | string; amount_minor: string; currency: string; status: string }
      | undefined;
    if (!attempt) return settle('ignored', 'unknown_reference', null);
    const attemptId = Number(attempt.id);

    if (event.type === 'payment.failed') {
      await tx.execute(sql`
        UPDATE invoice_payment_attempts SET status = 'failed' WHERE org_id = ${orgId} AND id = ${attemptId} AND status = 'pending'
      `);
      return settle('applied', 'payment_failed', attemptId);
    }

    // Amount and currency come from the attempt we created, never from the event alone.
    const paid = parseScaled(event.data.amount, currencyExponent(attempt.currency));
    if (event.data.currency.toUpperCase() !== attempt.currency || paid === null || paid !== BigInt(attempt.amount_minor)) {
      await this.rejected(tx, orgId, event, attemptId, Number(attempt.invoice_id), 'amount_or_currency_mismatch');
      return settle('rejected', 'amount_or_currency_mismatch', attemptId);
    }

    const tz = await this.invoices.zone(tx, orgId);
    const inv = await this.invoicesRepo.findById(tx, orgId, Number(attempt.invoice_id), tz, true);
    if (!inv || inv.storedStatus !== 'issued') {
      await this.rejected(tx, orgId, event, attemptId, Number(attempt.invoice_id), 'invoice_not_payable');
      return settle('rejected', 'invoice_not_payable', attemptId);
    }
    // Money that really arrived is recorded even if the invoice was settled another way meanwhile (the excess shows as a credit):
    // refusing it would lose track of it.
    const { payment } = await this.payments.recordIn(tx, orgId, null, inv, {
      amountMinor: paid,
      currency: attempt.currency,
      method: 'gateway',
      source: 'gateway',
      paidAt: new Date(),
      reference: event.data.paymentId,
      note: null,
      allowOverpayment: true,
      gatewayPaymentId: event.data.paymentId,
      attemptId,
      metaJson: { eventId: event.id },
    });
    await tx.execute(sql`
      UPDATE invoice_payment_attempts SET status = 'succeeded', payment_id = ${payment ? (await this.paymentId(tx, orgId, payment.uuid)) : null}
      WHERE org_id = ${orgId} AND id = ${attemptId}
    `);
    return settle('applied', payment ? null : 'already_recorded', attemptId);
  }

  private async paymentId(tx: Tx, orgId: number, uuid: string): Promise<number> {
    const r = await tx.execute(sql`SELECT id FROM payments WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`);
    return Number((r.rows[0] as { id: number | string }).id);
  }

  /** A verified event that cannot be applied: it is kept on the event ledger and raised so a person can look at it. */
  private async rejected(
    tx: Tx,
    orgId: number,
    event: InvoiceGatewayEvent,
    attemptId: number,
    invoiceId: number,
    reason: string,
  ): Promise<void> {
    await this.audit.record(tx, {
      module: 'invoice-gateway',
      recordId: attemptId,
      action: 'insert',
      delta: { rejected: { old: null, new: reason }, event: { old: null, new: event.id } },
    });
    await this.invoicesRepo.log(tx, orgId, invoiceId, {
      event: 'pay_attempt',
      detail: `rejected: ${reason}`,
      actorKind: 'gateway',
      meta: { event: event.id },
    });
    await this.outbox.emit(tx, {
      aggregateModule: 'invoices',
      aggregateId: invoiceId,
      eventType: 'payment.rejected',
      payload: { eventId: event.id, reason, amount: event.data.amount, currency: event.data.currency },
    });
  }
}
