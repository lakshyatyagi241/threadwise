import { HttpStatus, Injectable } from '@nestjs/common';
import {
  AGING_BUCKETS,
  ERROR_CODES,
  minorToMajor,
  parseScaled,
  currencyExponent,
  type AgingQuery,
  type AgingResponse,
  type ListPaymentsQuery,
  type OutstandingQuery,
  type OutstandingResponse,
  type PaymentOutcome,
  type PaymentPageResponse,
  type PaymentReceipt,
  type PaymentResponse,
  type PaymentSummaryQuery,
  type PaymentSummaryResponse,
  type RecordPaymentInput,
  type RecordScope,
  type RefundPaymentInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { buildPage } from '../../../common/pagination/cursor';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { resolveTimezone, todayIn } from '../deals/deal-calendar';
import { decidePayment, formatNumber, seriesKey } from './invoice-rules';
import { InvoiceSettingsService, numberingOf } from './invoice-settings.service';
import { invoiceEventPayload, toSeller } from './invoices.mapper';
import { InvoicesRepository, invoiceScopeCondition, type InvoiceRow } from './invoices.repository';
import { InvoicesService } from './invoices.service';
import {
  PaymentsRepository,
  paymentScopeCondition,
  type PaymentInsert,
  type PaymentRow,
} from './payments.repository';

export const PAYMENT_MODULE = 'payments';

const major = (minor: bigint, currency: string) => minorToMajor(minor, currency);

export function toPaymentResponse(r: PaymentRow): PaymentResponse {
  const refunded = r.kind === 'payment' ? r.refundedMinor : 0n;
  const refundable = r.kind === 'payment' ? r.amountMinor - r.refundedMinor : 0n;
  return {
    id: r.uuid,
    kind: r.kind,
    amount: major(r.amountMinor, r.currency),
    amountMinor: r.amountMinor.toString(),
    currency: r.currency,
    method: r.method,
    source: r.source,
    paidAt: r.paidAt.toISOString(),
    reference: r.reference,
    note: r.note,
    receiptNumber: r.receiptNumber,
    invoice: r.invoiceUuid ? { id: r.invoiceUuid, number: r.invoiceNumber } : null,
    contact: r.contactUuid ? { id: r.contactUuid, name: r.contactName } : null,
    refundOf: r.refundOfUuid ? { id: r.refundOfUuid, receiptNumber: r.refundOfReceipt } : null,
    refunded: major(refunded, r.currency),
    refundable: major(refundable, r.currency),
    recordedBy: r.recordedByUuid ? { id: r.recordedByUuid, name: r.recordedByName ?? '' } : null,
    createdAt: r.createdAt.toISOString(),
  };
}

const bad = (code: string, message: string, status: HttpStatus, details?: Array<{ path: string; message: string }>) =>
  new AppError(code as never, message, status, details);

/** What recording a payment needs, with the amount already in minor units. */
export interface RecordInput {
  amountMinor: bigint;
  currency: string | undefined;
  method: PaymentInsert['method'];
  source: PaymentInsert['source'];
  paidAt: Date | { date: string };
  reference: string | null;
  note: string | null;
  allowOverpayment: boolean;
  gatewayPaymentId?: string | null;
  attemptId?: number | null;
  metaJson?: Record<string, unknown> | null;
}

/**
 * The payment ledger (TW-PAY-002/003/015). Append-only: a payment is recorded, a refund is a negative entry that names it, and the
 * database keeps the invoice's paid amount and status in step with the ledger in the same transaction. This service decides policy
 * (over-payment, currency, dates) and writes the audit row, the timeline entry and the outbox events beside each entry.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: PaymentsRepository,
    private readonly invoicesRepo: InvoicesRepository,
    private readonly invoices: InvoicesService,
    private readonly settings: InvoiceSettingsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // --- reads -------------------------------------------------------------------------------------------------------------------

  async list(query: ListPaymentsQuery, scope: RecordScope): Promise<PaymentPageResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const tz = await this.invoices.zone(tx, ctx.orgId);
      const rows = await this.repo.list(tx, ctx.orgId, query, paymentScopeCondition(ctx.orgId, scope, ctx.userId), tz);
      const page = buildPage(rows, query.limit);
      return { data: page.items.map(toPaymentResponse), page: page.page };
    });
  }

  async get(uuid: string, scope: RecordScope): Promise<PaymentResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Payment', uuid);
      await this.assertPaymentScope(tx, scope, row);
      return toPaymentResponse(row);
    });
  }

  /** The payments of one invoice, oldest first (the invoice detail's ledger). */
  async forInvoice(invoiceUuid: string, scope: RecordScope): Promise<{ data: PaymentResponse[] }> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const inv = await this.invoicesRepo.findByUuid(tx, ctx.orgId, invoiceUuid, await this.invoices.zone(tx, ctx.orgId));
      if (!inv) throw AppError.notFound('Invoice', invoiceUuid);
      await this.invoices.assertScope(tx, scope, inv);
      return { data: (await this.repo.forInvoice(tx, ctx.orgId, inv.id)).map(toPaymentResponse) };
    });
  }

  async receipt(uuid: string, scope: RecordScope): Promise<PaymentReceipt> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const p = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!p) throw AppError.notFound('Payment', uuid);
      await this.assertPaymentScope(tx, scope, p);
      const inv = p.invoiceId
        ? await this.invoicesRepo.findById(tx, ctx.orgId, p.invoiceId, await this.invoices.zone(tx, ctx.orgId))
        : undefined;
      const profile = await this.settings.load(tx, ctx.orgId);
      const seller = toSeller(inv?.sellerSnapshot ?? null);
      return {
        receiptNumber: p.receiptNumber,
        kind: p.kind,
        amount: major(p.amountMinor, p.currency),
        currency: p.currency,
        method: p.method,
        paidAt: p.paidAt.toISOString(),
        reference: p.reference,
        seller: {
          name: seller?.name ?? profile.row.sellerName ?? profile.orgName,
          address: seller?.address ?? profile.row.sellerAddress,
          taxId: seller?.taxId ?? profile.row.sellerTaxId,
        },
        buyerName: inv?.buyerName ?? p.contactName,
        invoice: {
          number: inv?.number ?? null,
          total: inv ? major(inv.totalMinor, inv.currency) : '0',
          paid: inv ? major(inv.paidMinor, inv.currency) : '0',
          balance: inv ? major(inv.totalMinor > inv.paidMinor + inv.creditedMinor ? inv.totalMinor - inv.paidMinor - inv.creditedMinor : 0n, inv.currency) : '0',
        },
      };
    });
  }

  // --- writes ------------------------------------------------------------------------------------------------------------------

  /** Records money received against an issued invoice (a person, by hand). */
  async record(invoiceUuid: string, input: RecordPaymentInput, scope: RecordScope): Promise<PaymentOutcome> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const tz = await this.invoices.zone(tx, ctx.orgId);
      const inv = await this.invoices.lockForWrite(tx, invoiceUuid, scope);
      const exp = currencyExponent(input.currency ?? inv.currency);
      const amountMinor = parseScaled(input.amount, exp);
      if (amountMinor === null || amountMinor <= 0n)
        throw bad(ERROR_CODES.INV_AMOUNT_INVALID, `An amount is above 0 with at most ${exp} decimals in ${input.currency ?? inv.currency}`, HttpStatus.UNPROCESSABLE_ENTITY, [
          { path: 'amount', message: 'invalid' },
        ]);
      const paidAt = await this.resolvePaidAt(tx, input.paidAt, tz);
      const { payment, invoice } = await this.recordIn(tx, ctx.orgId, ctx.userId, inv, {
        amountMinor,
        currency: input.currency,
        method: input.method,
        source: 'manual',
        paidAt,
        reference: input.reference ?? null,
        note: input.note ?? null,
        allowOverpayment: input.allowOverpayment,
      });
      return this.outcome(payment!, invoice);
    });
  }

  /**
   * The ledger write, inside the caller's transaction and with the invoice row already locked: policy checks, the receipt number,
   * the entry, then the audit row, the timeline entry and the events. `payment` is undefined when a gateway payment id was
   * recorded before (the idempotent replay): nothing is written then.
   */
  async recordIn(
    tx: Tx,
    orgId: number,
    actorUserId: number | null,
    inv: InvoiceRow,
    v: RecordInput,
  ): Promise<{ payment: PaymentRow | undefined; invoice: InvoiceRow }> {
    if (inv.storedStatus !== 'issued')
      throw bad(
        ERROR_CODES.INV_NOT_ISSUED,
        inv.storedStatus === 'void' ? 'A void invoice cannot be paid' : 'Only an issued invoice can be paid',
        HttpStatus.CONFLICT,
      );
    if (v.currency && v.currency !== inv.currency)
      throw bad(
        ERROR_CODES.PAY_CURRENCY_MISMATCH,
        `The payment is in ${v.currency} but the invoice is in ${inv.currency}`,
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'currency', message: `must be ${inv.currency}` }],
      );
    const balance = inv.totalMinor - inv.paidMinor - inv.creditedMinor;
    const decision = decidePayment(balance, v.amountMinor, v.allowOverpayment);
    if (!decision.ok)
      throw bad(
        ERROR_CODES.PAY_OVERPAYMENT,
        `The payment is more than the open balance of ${major(decision.balanceMinor, inv.currency)} ${inv.currency}`,
        HttpStatus.UNPROCESSABLE_ENTITY,
        [
          { path: 'amount', message: `above the balance ${major(decision.balanceMinor, inv.currency)}` },
          { path: 'allowOverpayment', message: 'send true to record the excess as a credit' },
        ],
      );

    const profile = await this.settings.load(tx, orgId);
    const tz = resolveTimezone(profile.timezone);
    const numbering = numberingOf(profile.row);
    const dateForNumber = todayIn(tz);
    const receiptSeries = seriesKey('receipt', numbering, dateForNumber);

    const insert: PaymentInsert = {
      invoiceId: inv.id,
      kind: 'payment',
      amountMinor: v.amountMinor,
      currency: inv.currency,
      method: v.method,
      source: v.source,
      paidAt: v.paidAt instanceof Date ? v.paidAt : { date: v.paidAt.date, tz },
      reference: v.reference,
      note: v.note,
      receiptNumber: null,
      refundOfId: null,
      gatewayPaymentId: v.gatewayPaymentId ?? null,
      attemptId: v.attemptId ?? null,
      recordedBy: actorUserId,
      metaJson: { ...(v.metaJson ?? {}), ...(decision.creditMinor > 0n ? { overpaymentMinor: decision.creditMinor.toString() } : {}) },
    };
    // A replayed gateway payment id is recognised BEFORE a receipt number is spent on it.
    if (v.gatewayPaymentId && (await this.repo.gatewayPaymentExists(tx, orgId, v.source, v.gatewayPaymentId))) {
      return { payment: undefined, invoice: (await this.invoicesRepo.findById(tx, orgId, inv.id, tz))! };
    }
    // The receipt number is allocated before the insert and inside this transaction.
    const seq = await this.invoicesRepo.allocateSeq(tx, orgId, receiptSeries);
    insert.receiptNumber = formatNumber('receipt', numbering, dateForNumber, seq);
    const id = await this.repo.insert(tx, orgId, insert);
    if (id === undefined) {
      return { payment: undefined, invoice: (await this.invoicesRepo.findById(tx, orgId, inv.id, tz))! };
    }
    const payment = (await this.repo.findById(tx, orgId, id))!;
    const after = (await this.invoicesRepo.findById(tx, orgId, inv.id, tz))!;

    await this.audit.record(tx, {
      module: PAYMENT_MODULE,
      recordId: id,
      action: 'insert',
      delta: {
        amount: { old: null, new: major(payment.amountMinor, payment.currency) },
        currency: { old: null, new: payment.currency },
        method: { old: null, new: payment.method },
        invoice: { old: null, new: inv.uuid },
      },
    });
    await this.invoicesRepo.log(tx, orgId, inv.id, {
      event: 'payment_recorded',
      detail: `${major(payment.amountMinor, payment.currency)} ${payment.currency} by ${payment.method}`,
      actorKind: v.source === 'manual' ? 'user' : v.source === 'gateway' ? 'gateway' : 'system',
      actorUserId,
      meta: { payment: payment.uuid, receipt: payment.receiptNumber },
    });
    await this.outbox.emit(tx, {
      aggregateModule: PAYMENT_MODULE,
      aggregateId: id,
      eventType: 'payment.recorded',
      payload: this.paymentPayload(payment, after),
    });
    await this.emitStatusChange(tx, orgId, inv, after, actorUserId);
    return { payment, invoice: after };
  }

  /** A refund: a negative entry that names the payment it returns. Idempotent through the Idempotency-Key on the route. */
  async refund(paymentUuid: string, input: RefundPaymentInput, scope: RecordScope): Promise<PaymentOutcome> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const tz = await this.invoices.zone(tx, ctx.orgId);
      const p = await this.repo.findByUuid(tx, ctx.orgId, paymentUuid);
      if (!p) throw AppError.notFound('Payment', paymentUuid);
      await this.assertPaymentScope(tx, scope, p);
      if (p.kind !== 'payment')
        throw bad(ERROR_CODES.PAY_NOT_REFUNDABLE, 'Only a payment can be refunded', HttpStatus.CONFLICT);
      // Lock order is always invoice first, payment second (the database trigger takes them in that order too).
      if (p.invoiceUuid) await this.invoicesRepo.findByUuid(tx, ctx.orgId, p.invoiceUuid, tz, true);
      const fresh = (await this.repo.findById(tx, ctx.orgId, p.id))!;
      const refundable = fresh.amountMinor - fresh.refundedMinor;
      const exp = currencyExponent(fresh.currency);
      let amountMinor = refundable;
      if (input.amount !== undefined) {
        const parsed = parseScaled(input.amount, exp);
        if (parsed === null || parsed <= 0n)
          throw bad(ERROR_CODES.INV_AMOUNT_INVALID, `An amount is above 0 with at most ${exp} decimals`, HttpStatus.UNPROCESSABLE_ENTITY, [
            { path: 'amount', message: 'invalid' },
          ]);
        amountMinor = parsed;
      }
      if (amountMinor <= 0n || amountMinor > refundable)
        throw bad(
          ERROR_CODES.PAY_REFUND_EXCEEDS,
          `At most ${major(refundable, fresh.currency)} ${fresh.currency} can still be refunded on this payment`,
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'amount', message: `refundable ${major(refundable, fresh.currency)}` }],
        );

      const paidAt = input.paidAt ? await this.resolvePaidAt(tx, input.paidAt, tz) : new Date();
      const { refund, invoice: after } = await this.refundIn(tx, ctx.orgId, ctx.userId, fresh, amountMinor, {
        reason: input.reason ?? null,
        paidAt,
      });
      return this.outcome(refund, after, fresh);
    });
  }

  /** A ledger entry by internal id (the credit-note settlement refunds payments it found itself). */
  findPayment(tx: Tx, orgId: number, id: number): Promise<PaymentRow | undefined> {
    return this.repo.findById(tx, orgId, id);
  }

  /**
   * The refund write, inside the caller's transaction (a person's refund and a credit note's cash settlement share it): a negative
   * ledger entry that names the payment, with its receipt number, the audit row, the timeline entry and `payment.refunded`. The
   * caller has locked the invoice and checked the amount against what is left of the payment.
   */
  async refundIn(
    tx: Tx,
    orgId: number,
    actorUserId: number | null,
    payment: PaymentRow,
    amountMinor: bigint,
    opts: { reason: string | null; paidAt?: Date | { date: string }; creditNote?: string },
  ): Promise<{ refund: PaymentRow; invoice: InvoiceRow | undefined }> {
    const tz = await this.invoices.zone(tx, orgId);
    const profile = await this.settings.load(tx, orgId);
    const numbering = numberingOf(profile.row);
    const date = todayIn(tz);
    const seq = await this.invoicesRepo.allocateSeq(tx, orgId, seriesKey('receipt', numbering, date));
    const paidAt = opts.paidAt ?? new Date();
    const id = await this.repo.insert(tx, orgId, {
      invoiceId: payment.invoiceId,
      kind: 'refund',
      amountMinor: -amountMinor,
      currency: payment.currency,
      method: payment.method,
      source: 'manual',
      paidAt: paidAt instanceof Date ? paidAt : { date: paidAt.date, tz },
      reference: opts.creditNote ?? null,
      note: opts.reason,
      receiptNumber: formatNumber('receipt', numbering, date, seq),
      refundOfId: payment.id,
      gatewayPaymentId: null,
      attemptId: null,
      recordedBy: actorUserId,
      metaJson: opts.creditNote ? { creditNote: opts.creditNote } : null,
    });
    const refund = (await this.repo.findById(tx, orgId, id!))!;
    const after = payment.invoiceId ? await this.invoicesRepo.findById(tx, orgId, payment.invoiceId, tz) : undefined;
    await this.audit.record(tx, {
      module: PAYMENT_MODULE,
      recordId: refund.id,
      action: 'insert',
      delta: {
        amount: { old: null, new: major(refund.amountMinor, refund.currency) },
        refundOf: { old: null, new: payment.uuid },
        reason: { old: null, new: opts.reason },
      },
    });
    if (after) {
      await this.invoicesRepo.log(tx, orgId, after.id, {
        event: 'payment_refunded',
        detail: `${major(-refund.amountMinor, refund.currency)} ${refund.currency}${opts.reason ? `: ${opts.reason}` : ''}`,
        actorKind: actorUserId ? 'user' : 'system',
        actorUserId,
        meta: { refund: refund.uuid, payment: payment.uuid },
      });
    }
    await this.outbox.emit(tx, {
      aggregateModule: PAYMENT_MODULE,
      aggregateId: refund.id,
      eventType: 'payment.refunded',
      payload: { ...this.paymentPayload(refund, after), reason: opts.reason, refundOf: payment.uuid },
    });
    return { refund, invoice: after };
  }

  /** `invoice.paid` / `invoice.partially_paid` when a ledger entry moved the payment status. */
  private async emitStatusChange(
    tx: Tx,
    orgId: number,
    before: InvoiceRow,
    after: InvoiceRow,
    actorUserId: number | null,
  ): Promise<void> {
    if (before.paymentStatus === after.paymentStatus) return;
    const eventType =
      after.paymentStatus === 'paid'
        ? 'invoice.paid'
        : after.paymentStatus === 'partially_paid' && before.paymentStatus === 'unpaid'
          ? 'invoice.partially_paid'
          : null;
    if (!eventType) return;
    await this.invoicesRepo.log(tx, orgId, after.id, {
      event: eventType === 'invoice.paid' ? 'paid' : 'partially_paid',
      actorKind: actorUserId ? 'user' : 'system',
      actorUserId,
    });
    await this.outbox.emit(tx, {
      aggregateModule: 'invoices',
      aggregateId: after.id,
      eventType,
      payload: invoiceEventPayload(after),
    });
  }

  // --- reports -----------------------------------------------------------------------------------------------------------------

  async summary(query: PaymentSummaryQuery, scope: RecordScope): Promise<PaymentSummaryResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const tz = await this.invoices.zone(tx, ctx.orgId);
      const s = await this.repo.summary(
        tx,
        ctx.orgId,
        query.days,
        paymentScopeCondition(ctx.orgId, scope, ctx.userId),
        invoiceScopeCondition(ctx.orgId, scope, ctx.userId),
        tz,
      );
      const money = (r: { currency: string; amount: bigint }) => ({ currency: r.currency, amount: major(r.amount, r.currency) });
      return {
        days: query.days,
        collected: s.collected.map(money),
        refunded: s.refunded.map(money),
        outstanding: s.outstanding.map((r) => ({ ...money(r), invoices: r.invoices })),
        overdue: s.overdue.map((r) => ({ ...money(r), invoices: r.invoices })),
      };
    });
  }

  async aging(query: AgingQuery, scope: RecordScope): Promise<AgingResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const tz = await this.invoices.zone(tx, ctx.orgId);
      const rows = await this.repo.aging(
        tx,
        ctx.orgId,
        { contactUuid: query.contactId, currency: query.currency },
        invoiceScopeCondition(ctx.orgId, scope, ctx.userId),
        tz,
      );
      const byCurrency = new Map<string, typeof rows>();
      for (const r of rows) byCurrency.set(r.currency, [...(byCurrency.get(r.currency) ?? []), r]);
      return {
        asOf: todayIn(tz),
        currencies: [...byCurrency.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([currency, list]) => ({
            currency,
            total: major(list.reduce((a, r) => a + r.amount, 0n), currency),
            invoices: list.reduce((a, r) => a + r.invoices, 0),
            buckets: AGING_BUCKETS.map((bucket) => {
              const r = list.find((x) => x.bucket === bucket);
              return { bucket, amount: major(r?.amount ?? 0n, currency), invoices: r?.invoices ?? 0 };
            }),
          })),
      };
    });
  }

  async outstanding(query: OutstandingQuery, scope: RecordScope): Promise<OutstandingResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const tz = await this.invoices.zone(tx, ctx.orgId);
      const rows = await this.repo.outstanding(tx, ctx.orgId, query, invoiceScopeCondition(ctx.orgId, scope, ctx.userId), tz);
      const hasMore = rows.length > query.limit;
      const items = hasMore ? rows.slice(0, query.limit) : rows;
      const last = items[items.length - 1];
      return {
        data: items.map((r) => ({
          contact: r.contactUuid ? { id: r.contactUuid, name: r.contactName } : null,
          currency: r.currency,
          outstanding: major(r.outstanding, r.currency),
          overdue: major(r.overdue, r.currency),
          invoices: r.invoices,
          oldestDueDate: r.oldestDue,
        })),
        page: {
          nextCursor:
            hasMore && last
              ? Buffer.from(`${last.currency}|${last.outstanding}|${last.contactId ?? 0}`, 'utf8').toString('base64url')
              : null,
          hasMore,
          limit: query.limit,
        },
      };
    });
  }

  // --- helpers -----------------------------------------------------------------------------------------------------------------

  /** A date means that calendar day in the workspace zone; a timestamp is itself. Neither may be in the future. */
  private async resolvePaidAt(
    tx: Tx,
    when: string | undefined,
    tz: string,
  ): Promise<Date | { date: string }> {
    if (!when) return new Date();
    if (/^\d{4}-\d{2}-\d{2}$/.test(when)) {
      if (when > todayIn(tz))
        throw bad(ERROR_CODES.PAY_FUTURE_DATE, 'A payment cannot be dated in the future', HttpStatus.UNPROCESSABLE_ENTITY, [
          { path: 'paidAt', message: 'in the future' },
        ]);
      return { date: when };
    }
    const d = new Date(when);
    if (d.getTime() > Date.now() + 5 * 60_000)
      throw bad(ERROR_CODES.PAY_FUTURE_DATE, 'A payment cannot be dated in the future', HttpStatus.UNPROCESSABLE_ENTITY, [
        { path: 'paidAt', message: 'in the future' },
      ]);
    void tx;
    return d;
  }

  private outcome(payment: PaymentRow, invoice: InvoiceRow | undefined, _parent?: PaymentRow): PaymentOutcome {
    const bal = invoice && invoice.totalMinor > invoice.paidMinor + invoice.creditedMinor ? invoice.totalMinor - invoice.paidMinor - invoice.creditedMinor : 0n;
    const credit = invoice && invoice.paidMinor + invoice.creditedMinor > invoice.totalMinor ? invoice.paidMinor + invoice.creditedMinor - invoice.totalMinor : 0n;
    return {
      payment: toPaymentResponse(payment),
      invoice: invoice
        ? {
            id: invoice.uuid,
            number: invoice.number,
            status: invoice.status,
            paymentStatus: invoice.paymentStatus,
            currency: invoice.currency,
            total: major(invoice.totalMinor, invoice.currency),
            paid: major(invoice.paidMinor, invoice.currency),
            balance: major(bal, invoice.currency),
            credit: major(credit, invoice.currency),
          }
        : {
            id: '',
            number: null,
            status: 'issued',
            paymentStatus: 'paid',
            currency: payment.currency,
            total: '0',
            paid: '0',
            balance: '0',
            credit: '0',
          },
    };
  }

  private paymentPayload(p: PaymentRow, inv: InvoiceRow | undefined): Record<string, unknown> {
    return {
      uuid: p.uuid,
      kind: p.kind,
      amount: major(p.amountMinor, p.currency),
      currency: p.currency,
      method: p.method,
      source: p.source,
      receiptNumber: p.receiptNumber,
      invoiceId: p.invoiceUuid,
      invoiceNumber: p.invoiceNumber,
      contactId: p.contactUuid,
      invoicePaymentStatus: inv?.paymentStatus ?? null,
      invoiceBalance: inv ? major(inv.totalMinor > inv.paidMinor + inv.creditedMinor ? inv.totalMinor - inv.paidMinor - inv.creditedMinor : 0n, inv.currency) : null,
    };
  }

  /** The payment's people are its invoice's: same scope rule as the invoice (an unlinked payment needs `all` or being its recorder). */
  private async assertPaymentScope(tx: Tx, scope: RecordScope, p: PaymentRow): Promise<void> {
    const ctx = RequestContextStore.require();
    if (scope === 'all') return;
    if (p.recordedById !== null && p.recordedById === ctx.userId) return;
    if (p.invoiceId) {
      const inv = await this.invoicesRepo.findById(tx, ctx.orgId, p.invoiceId, await this.invoices.zone(tx, ctx.orgId));
      if (inv) {
        try {
          await this.invoices.assertScope(tx, scope, inv);
          return;
        } catch {
          /* fall through to not found */
        }
      }
    }
    throw AppError.notFound('Payment');
  }
}
