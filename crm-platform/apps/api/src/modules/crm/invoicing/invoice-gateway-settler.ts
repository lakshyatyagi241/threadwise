import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import {
  GatewayPaymentRegistry,
  type GatewayPaymentContext,
  type GatewayPaymentOutcome,
  type GatewayPaymentSettler,
} from '../../checkout-orders-merchant-payments';
import { InvoicesRepository } from './invoices.repository';
import { InvoicesService } from './invoices.service';
import { PaymentsService } from './payments.service';

/** The reference an invoice payment attempt carries at the shared gateway: `INV-<attempt uuid>`. */
export const INVOICE_REFERENCE_PREFIX = 'INV-';
export const invoiceReference = (attemptUuid: string): string =>
  `${INVOICE_REFERENCE_PREFIX}${attemptUuid}`;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The attempt uuid inside a reference, or null when it is not one of ours. */
export function attemptFromReference(reference: string): string | null {
  if (!reference.startsWith(INVOICE_REFERENCE_PREFIX)) return null;
  const id = reference.slice(INVOICE_REFERENCE_PREFIX.length);
  return UUID.test(id) ? id.toLowerCase() : null;
}

/**
 * Settles an invoice payment attempt made on the SHARED workspace gateway: the gateway module verified the notification with the
 * gateway's own secret and routed the reference here by its `INV-` prefix. The same rules as the generic connection's webhook
 * (`InvoiceGatewayWebhookService`): the attempt is looked up inside this organization only, amount and currency must equal the
 * attempt (and a provider that states no amount is refused: this is the books), money that really arrived is recorded even when the
 * invoice was settled another way meanwhile (the excess shows as a credit), and a replay changes nothing.
 */
@Injectable()
export class InvoiceGatewaySettler implements GatewayPaymentSettler, OnModuleInit {
  readonly prefix = INVOICE_REFERENCE_PREFIX;
  private readonly logger = new Logger(InvoiceGatewaySettler.name);

  constructor(
    private readonly registry: GatewayPaymentRegistry,
    private readonly invoices: InvoicesService,
    private readonly invoicesRepo: InvoicesRepository,
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async settle(ctx: GatewayPaymentContext): Promise<GatewayPaymentOutcome> {
    const { tx, orgId, payment } = ctx;
    const uuid = attemptFromReference(ctx.reference);
    if (!uuid) return { outcome: 'rejected:bad_reference' };

    const found = await tx.execute(sql`
      SELECT id, invoice_id, amount_minor::text, currency, status, provider FROM invoice_payment_attempts
      WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid FOR UPDATE`);
    const attempt = found.rows[0] as
      | {
          id: number | string;
          invoice_id: number | string;
          amount_minor: string;
          currency: string;
          status: string;
          provider: string;
        }
      | undefined;
    // Only an attempt made on THIS gateway: a notification of one gateway cannot settle another's attempt.
    if (!attempt || attempt.provider !== ctx.gateway.slug)
      return { outcome: 'rejected:attempt_unknown' };
    if (attempt.status === 'succeeded') return { outcome: 'duplicate' };
    const attemptId = Number(attempt.id);
    const invoiceId = Number(attempt.invoice_id);

    if (
      payment.amountMinor === undefined ||
      payment.amountMinor !== BigInt(attempt.amount_minor) ||
      (payment.currency !== undefined && payment.currency.toUpperCase() !== attempt.currency)
    ) {
      await this.rejected(tx, orgId, attemptId, invoiceId, 'amount_or_currency_mismatch', ctx);
      return { outcome: 'rejected:amount_mismatch' };
    }

    const tz = await this.invoices.zone(tx, orgId);
    const inv = await this.invoicesRepo.findById(tx, orgId, invoiceId, tz, true);
    if (!inv || inv.storedStatus !== 'issued') {
      await this.rejected(tx, orgId, attemptId, invoiceId, 'invoice_not_payable', ctx);
      return { outcome: 'rejected:invoice_not_payable' };
    }

    const { payment: recorded } = await this.payments.recordIn(tx, orgId, null, inv, {
      amountMinor: payment.amountMinor,
      currency: attempt.currency,
      method: 'gateway',
      source: 'gateway',
      paidAt: new Date(),
      reference: payment.gatewayPaymentId ?? null,
      note: null,
      allowOverpayment: true,
      gatewayPaymentId: payment.gatewayPaymentId ?? null,
      attemptId,
      metaJson: { gateway: ctx.gateway.slug },
    });
    const paymentRow = recorded
      ? await tx.execute(
          sql`SELECT id FROM payments WHERE org_id = ${orgId} AND uuid = ${recorded.uuid}::uuid`,
        )
      : null;
    await tx.execute(sql`
      UPDATE invoice_payment_attempts
      SET status = 'succeeded',
          payment_id = ${paymentRow ? Number((paymentRow.rows[0] as { id: number | string }).id) : null}
      WHERE org_id = ${orgId} AND id = ${attemptId}`);
    return { outcome: 'applied' };
  }

  /** A verified notification that cannot be applied: kept on the audit trail and raised so a person can look at it. */
  private async rejected(
    tx: GatewayPaymentContext['tx'],
    orgId: number,
    attemptId: number,
    invoiceId: number,
    reason: string,
    ctx: GatewayPaymentContext,
  ): Promise<void> {
    this.logger.warn(
      { attemptId, reason, gateway: ctx.gateway.slug },
      'shared gateway payment rejected',
    );
    await this.audit.record(tx, {
      module: 'invoice-gateway',
      recordId: attemptId,
      action: 'insert',
      delta: { rejected: { old: null, new: reason } },
    });
    await this.invoicesRepo.log(tx, orgId, invoiceId, {
      event: 'pay_attempt',
      detail: `rejected: ${reason}`,
      actorKind: 'gateway',
      meta: { gateway: ctx.gateway.slug },
    });
    await this.outbox.emit(tx, {
      aggregateModule: 'invoices',
      aggregateId: invoiceId,
      eventType: 'payment.rejected',
      payload: {
        reason,
        gateway: ctx.gateway.slug,
        amount: ctx.payment.amountMinor?.toString() ?? null,
        currency: ctx.payment.currency ?? null,
      },
    });
  }
}
