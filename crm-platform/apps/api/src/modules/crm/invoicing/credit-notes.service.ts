import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  currencyExponent,
  formatPercent,
  formatQty,
  minorToMajor,
  parseMajor,
  parseQty,
  type CreateCreditNoteInput,
  type CreditNoteResponse,
  type CreditNoteSummary,
  type IssueCreditNoteInput,
  type ListCreditNotesQuery,
  type PageResponse,
  type PublicInvoice,
  type RecordScope,
  type UpdateCreditNoteInput,
  type VoidCreditNoteInput,
} from '@crm/contracts';
import { divRound } from '@crm/tax';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { buildPage } from '../../../common/pagination/cursor';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { resolveTimezone, todayIn } from '../deals/deal-calendar';
import { priceInvoice, specsFromRows, type LineSpec } from './invoice-content';
import { formatNumber, seriesKey } from './invoice-rules';
import { InvoiceSettingsService, numberingOf } from './invoice-settings.service';
import { toSeller } from './invoices.mapper';
import { InvoicesRepository, type InvoiceLineRow, type InvoiceRow } from './invoices.repository';
import { InvoicesService, taxSpecOfRate } from './invoices.service';
import {
  CreditNotesRepository,
  creditNoteScopeCondition,
  type CreditNoteItemInsert,
  type CreditNoteItemRow,
  type CreditNoteRow,
} from './credit-notes.repository';
import { PaymentsService } from './payments.service';
import { TaxRatesRepository } from './tax-rates.repository';

export const CREDIT_NOTE_MODULE = 'credit-notes';

const major = (m: bigint, c: string) => minorToMajor(m, c);
const bad = (code: string, message: string, status: HttpStatus, details?: Array<{ path: string; message: string }>) =>
  new AppError(code as never, message, status, details);

export function toCreditNoteSummary(r: CreditNoteRow): CreditNoteSummary {
  return {
    id: r.uuid,
    number: r.number,
    status: r.status,
    reason: r.reason,
    settlement: r.settlement,
    invoice: { id: r.invoiceUuid, number: r.invoiceNumber },
    buyerName: r.buyerName,
    currency: r.currency,
    total: major(r.totalMinor, r.currency),
    totalMinor: r.totalMinor.toString(),
    applied: major(r.totalMinor - r.refundedMinor, r.currency),
    refunded: major(r.refundedMinor, r.currency),
    issueDate: r.issueDate,
    rowVersion: r.rowVersion,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * Credit notes (owner direction). Everything that moves money happens in one transaction with the invoice row locked: the number
 * from the credit-note series, the cash refunds through the payment ledger, the note's own status, and (by trigger) the invoice's
 * credited amount and payment status. See migration 20261008100200 for what the database enforces on top.
 */
@Injectable()
export class CreditNotesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: CreditNotesRepository,
    private readonly invoicesRepo: InvoicesRepository,
    private readonly invoices: InvoicesService,
    private readonly settings: InvoiceSettingsService,
    private readonly payments: PaymentsService,
    private readonly taxRates: TaxRatesRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  // --- reads ---------------------------------------------------------------------------------------------------------------------

  async list(query: ListCreditNotesQuery, scope: RecordScope): Promise<PageResponse<CreditNoteSummary>> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rows = await this.repo.list(tx, ctx.orgId, query, creditNoteScopeCondition(ctx.orgId, scope, ctx.userId));
      const page = buildPage(rows, query.limit);
      return { data: page.items.map(toCreditNoteSummary), page: page.page };
    });
  }

  async get(uuid: string, scope: RecordScope): Promise<CreditNoteResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Credit note', uuid);
      await this.assertScope(tx, scope, row);
      return this.toResponse(tx, row);
    });
  }

  /** The credit note as the printable document (the PDF and the page share it). */
  async document(uuid: string, scope: RecordScope): Promise<PublicInvoice> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!row) throw AppError.notFound('Credit note', uuid);
      await this.assertScope(tx, scope, row);
      const inv = (await this.invoicesRepo.findById(tx, ctx.orgId, row.invoiceId, await this.invoices.zone(tx, ctx.orgId)))!;
      const items = await this.repo.items(tx, ctx.orgId, row.id);
      return this.toDocument(row, items, inv);
    });
  }

  // --- writes --------------------------------------------------------------------------------------------------------------------

  async create(input: CreateCreditNoteInput, scope: RecordScope): Promise<CreditNoteResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const tz = await this.invoices.zone(tx, ctx.orgId);
      const inv = await this.invoicesRepo.findByUuid(tx, ctx.orgId, input.invoiceId, tz, true);
      if (!inv) throw AppError.notFound('Invoice', input.invoiceId);
      await this.invoices.assertScope(tx, scope, inv);
      if (inv.storedStatus !== 'issued')
        throw bad(ERROR_CODES.INV_NOT_ISSUED, 'A credit note needs an issued invoice', HttpStatus.CONFLICT);
      const built = await this.build(tx, ctx.orgId, inv, input);
      const id = await this.repo.insert(tx, ctx.orgId, {
        invoiceId: inv.id,
        reason: input.reason,
        note: input.note ?? null,
        settlement: input.settlement,
        currency: inv.currency,
        currencyExponent: inv.currencyExponent,
        ...built.totals,
        issueDate: input.issueDate ?? null,
        createdBy: ctx.userId,
      });
      await this.repo.replaceItems(tx, ctx.orgId, id, built.items);
      const row = (await this.repo.findById(tx, ctx.orgId, id))!;
      await this.audit.record(tx, {
        module: CREDIT_NOTE_MODULE,
        recordId: id,
        action: 'insert',
        delta: {
          invoice: { old: null, new: inv.uuid },
          total: { old: null, new: major(row.totalMinor, row.currency) },
          reason: { old: null, new: row.reason },
        },
      });
      await this.invoicesRepo.log(tx, ctx.orgId, inv.id, { event: 'credit_note_issued', detail: 'draft credit note created', actorKind: 'user', actorUserId: ctx.userId, meta: { creditNote: row.uuid, draft: true } });
      await this.emit(tx, 'credit_note.created', row);
      return this.toResponse(tx, row);
    });
  }

  async update(uuid: string, input: UpdateCreditNoteInput, scope: RecordScope): Promise<CreditNoteResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.lock(tx, uuid, scope);
      if (input.rowVersion !== row.rowVersion) throw AppError.rowVersionConflict('Credit note');
      if (row.status !== 'draft') throw bad(ERROR_CODES.CN_NOT_DRAFT, 'Only a draft credit note is edited', HttpStatus.CONFLICT);
      const inv = (await this.invoicesRepo.findById(tx, ctx.orgId, row.invoiceId, await this.invoices.zone(tx, ctx.orgId), true))!;
      const patch: Parameters<CreditNotesRepository['updateDraft']>[4] = {};
      const delta: Record<string, { old: unknown; new: unknown }> = {};
      if (input.reason !== undefined && input.reason !== row.reason) {
        patch.reason = input.reason;
        delta.reason = { old: row.reason, new: input.reason };
      }
      if (input.note !== undefined && (input.note ?? null) !== row.note) {
        patch.note = input.note ?? null;
        delta.note = { old: row.note !== null, new: input.note != null };
      }
      if (input.settlement !== undefined && input.settlement !== row.settlement) {
        patch.settlement = input.settlement;
        delta.settlement = { old: row.settlement, new: input.settlement };
      }
      if (input.issueDate !== undefined) patch.issueDate = input.issueDate ?? null;
      let items: CreditNoteItemInsert[] | null = null;
      if (input.lines !== undefined || input.full !== undefined) {
        const built = await this.build(tx, ctx.orgId, inv, { full: input.full ?? false, lines: input.lines }, row.id);
        Object.assign(patch, built.totals);
        items = built.items;
        delta.total = { old: major(row.totalMinor, row.currency), new: major(built.totals.totalMinor, row.currency) };
      }
      const ok = await this.repo.updateDraft(tx, ctx.orgId, row.id, input.rowVersion, patch);
      if (!ok) throw AppError.rowVersionConflict('Credit note');
      if (items) await this.repo.replaceItems(tx, ctx.orgId, row.id, items);
      const after = (await this.repo.findById(tx, ctx.orgId, row.id))!;
      if (Object.keys(delta).length > 0)
        await this.audit.record(tx, { module: CREDIT_NOTE_MODULE, recordId: row.id, action: 'update', delta });
      await this.emit(tx, 'credit_note.updated', after);
      return this.toResponse(tx, after);
    });
  }

  /**
   * Draft -> issued. In this order, inside one transaction with the invoice locked: check the cap, take the number, return cash
   * through the ledger when the settlement is `refund` and the invoice is over-paid by the credit, then flip the note (the database
   * re-checks the cap and recomputes the invoice's credited amount and payment status).
   */
  async issue(uuid: string, input: IssueCreditNoteInput, scope: RecordScope): Promise<CreditNoteResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const tz = await this.invoices.zone(tx, ctx.orgId);
      const pre = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!pre) throw AppError.notFound('Credit note', uuid);
      // Lock order: invoice first, then the credit note (the database triggers take them in the same order).
      const inv = (await this.invoicesRepo.findById(tx, ctx.orgId, pre.invoiceId, tz, true))!;
      const row = await this.lock(tx, uuid, scope);
      if (input.rowVersion !== undefined && input.rowVersion !== row.rowVersion) throw AppError.rowVersionConflict('Credit note');
      if (row.status === 'void') throw bad(ERROR_CODES.CN_ALREADY_VOID, 'A void credit note cannot be issued', HttpStatus.CONFLICT);
      if (row.status !== 'draft') throw bad(ERROR_CODES.CN_NOT_DRAFT, 'The credit note is already issued', HttpStatus.CONFLICT);
      if (inv.storedStatus !== 'issued')
        throw bad(ERROR_CODES.INV_NOT_ISSUED, 'A credit note needs an issued invoice', HttpStatus.CONFLICT);
      if (row.totalMinor <= 0n)
        throw bad(ERROR_CODES.CN_NOTHING_TO_CREDIT, 'The credit note has nothing to credit', HttpStatus.UNPROCESSABLE_ENTITY);
      const creditable = inv.totalMinor - inv.creditedMinor;
      if (row.totalMinor > creditable) throw this.exceeds(creditable, inv.currency);

      const profile = await this.settings.load(tx, ctx.orgId);
      const numbering = numberingOf(profile.row);
      const issueDate = row.issueDate ?? todayIn(resolveTimezone(profile.timezone));
      const series = seriesKey('credit_note', numbering, issueDate);
      const seq = await this.invoicesRepo.allocateSeq(tx, ctx.orgId, series);
      const number = formatNumber('credit_note', numbering, issueDate, seq);

      // Cash settlement: what the invoice would hold above what is now owed is returned, newest payment first.
      let refunded = 0n;
      if (row.settlement === 'refund') {
        const owedAfter = inv.totalMinor - inv.creditedMinor - row.totalMinor;
        let toReturn = inv.paidMinor - owedAfter;
        if (toReturn > row.totalMinor) toReturn = row.totalMinor;
        for (const p of toReturn > 0n ? await this.repo.refundablePayments(tx, ctx.orgId, inv.id) : []) {
          if (toReturn <= 0n) break;
          const take = p.refundableMinor < toReturn ? p.refundableMinor : toReturn;
          const payment = (await this.payments.findPayment(tx, ctx.orgId, p.id))!;
          await this.payments.refundIn(tx, ctx.orgId, ctx.userId, payment, take, { reason: `Credit note ${number}`, creditNote: number });
          refunded += take;
          toReturn -= take;
        }
      }
      await this.repo.markIssued(tx, ctx.orgId, row.id, { series, number, seq, issueDate, refundedMinor: refunded });
      const after = (await this.repo.findById(tx, ctx.orgId, row.id))!;
      const invAfter = (await this.invoicesRepo.findById(tx, ctx.orgId, inv.id, tz))!;
      await this.audit.record(tx, {
        module: CREDIT_NOTE_MODULE,
        recordId: row.id,
        action: 'update',
        delta: { status: { old: 'draft', new: 'issued' }, number: { old: null, new: number }, refunded: { old: '0', new: major(refunded, row.currency) } },
      });
      await this.invoicesRepo.log(tx, ctx.orgId, inv.id, {
        event: 'credit_note_issued',
        detail: `${number}: ${major(row.totalMinor, row.currency)} ${row.currency}`,
        actorKind: 'user',
        actorUserId: ctx.userId,
        meta: { creditNote: row.uuid, number, refunded: refunded.toString() },
      });
      await this.emit(tx, 'credit_note.issued', after, { refundedMinor: refunded.toString(), invoicePaymentStatus: invAfter.paymentStatus });
      if (inv.paymentStatus !== 'paid' && invAfter.paymentStatus === 'paid') {
        await this.invoicesRepo.log(tx, ctx.orgId, inv.id, { event: 'paid', detail: `settled by ${number}`, actorKind: 'system' });
        await this.outbox.emit(tx, {
          aggregateModule: 'invoices',
          aggregateId: inv.id,
          eventType: 'invoice.paid',
          payload: { uuid: inv.uuid, number: inv.number, currency: inv.currency, settledBy: number },
        });
      }
      return this.toResponse(tx, after);
    });
  }

  async void(uuid: string, input: VoidCreditNoteInput, scope: RecordScope): Promise<CreditNoteResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const pre = await this.repo.findByUuid(tx, ctx.orgId, uuid);
      if (!pre) throw AppError.notFound('Credit note', uuid);
      await this.invoicesRepo.findById(tx, ctx.orgId, pre.invoiceId, await this.invoices.zone(tx, ctx.orgId), true);
      const row = await this.lock(tx, uuid, scope);
      if (row.status === 'void') throw bad(ERROR_CODES.CN_ALREADY_VOID, 'The credit note is already void', HttpStatus.CONFLICT);
      if (row.status === 'draft') throw bad(ERROR_CODES.CN_NOT_DRAFT, 'A draft credit note is deleted, not voided', HttpStatus.CONFLICT);
      if (row.refundedMinor > 0n)
        throw bad(
          ERROR_CODES.CN_HAS_REFUND,
          'Cash was returned for this credit note: the refund stands in the payment ledger, so it cannot be voided',
          HttpStatus.CONFLICT,
          [{ path: 'refunded', message: major(row.refundedMinor, row.currency) }],
        );
      await this.repo.markVoid(tx, ctx.orgId, row.id, input.reason);
      const after = (await this.repo.findById(tx, ctx.orgId, row.id))!;
      await this.audit.record(tx, {
        module: CREDIT_NOTE_MODULE,
        recordId: row.id,
        action: 'update',
        delta: { status: { old: 'issued', new: 'void' }, voidReason: { old: null, new: input.reason } },
      });
      await this.invoicesRepo.log(tx, ctx.orgId, row.invoiceId, { event: 'credit_note_issued', detail: `${row.number} voided: ${input.reason}`, actorKind: 'user', actorUserId: ctx.userId, meta: { creditNote: row.uuid, voided: true } });
      await this.emit(tx, 'credit_note.voided', after, { reason: input.reason });
      return this.toResponse(tx, after);
    });
  }

  async remove(uuid: string, scope: RecordScope): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const row = await this.lock(tx, uuid, scope);
      if (row.status !== 'draft') throw bad(ERROR_CODES.CN_NOT_DRAFT, 'Only a draft credit note is deleted', HttpStatus.CONFLICT);
      await this.audit.record(tx, {
        module: CREDIT_NOTE_MODULE,
        recordId: row.id,
        action: 'delete',
        delta: { total: { old: major(row.totalMinor, row.currency), new: null } },
      });
      await this.emit(tx, 'credit_note.deleted', row);
      await this.repo.delete(tx, ctx.orgId, row.id);
    });
  }

  // --- building the lines -----------------------------------------------------------------------------------------------------------

  /**
   * Prices a credit note against an invoice. Credited lines take the amount the buyer was actually charged for them (net of the
   * line discount and its share of the document discount) in proportion to the quantity credited, with the original line's tax
   * snapshot; the LAST part of a line takes whatever is left of it exactly, so credits can never add up to more (or less) than the
   * line. Free-form lines (a goodwill credit) are an amount and an optional tax rate.
   */
  private async build(
    tx: Tx,
    orgId: number,
    inv: InvoiceRow,
    input: { full?: boolean; lines?: CreateCreditNoteInput['lines'] },
    exceptNoteId?: number,
  ): Promise<{
    items: CreditNoteItemInsert[];
    totals: {
      subtotalMinor: bigint;
      taxMinor: bigint;
      taxAddedMinor: bigint;
      totalMinor: bigint;
      taxSummary: unknown[];
    };
  }> {
    const invLines = await this.invoicesRepo.lines(tx, orgId, inv.id);
    const byUuid = new Map(invLines.map((l) => [l.uuid, l]));
    const credited = await this.repo.creditedPerLine(tx, orgId, inv.id, exceptNoteId);
    const specs: LineSpec[] = [];
    const metas: Array<{ invoiceItemId: number | null; qty: string }> = [];
    const fixed = specsFromRows(invLines, inv.currency);

    const taxable = (l: InvoiceLineRow) => l.grossMinor - l.discountMinor - l.docDiscountShareMinor;
    const take = (l: InvoiceLineRow, i: number, qtyWanted: string | undefined, path: string) => {
      const lineQty = parseQty(l.qty) ?? 0n;
      const done = credited.get(l.id);
      const doneQty = done ? (parseQty(done.qty) ?? 0n) : 0n;
      const remainingQty = lineQty - doneQty;
      const remainingAmount = taxable(l) - (done?.amountMinor ?? 0n);
      if (remainingQty <= 0n || remainingAmount <= 0n)
        throw bad(ERROR_CODES.CN_NOTHING_TO_CREDIT, `Nothing is left to credit on "${l.description}"`, HttpStatus.UNPROCESSABLE_ENTITY, [{ path, message: 'fully credited' }]);
      const q = qtyWanted === undefined ? remainingQty : parseQty(qtyWanted);
      if (q === null || q <= 0n || q > remainingQty)
        throw bad(ERROR_CODES.CN_LINE_INVALID, `At most ${formatQty(remainingQty)} of "${l.description}" can still be credited`, HttpStatus.UNPROCESSABLE_ENTITY, [
          { path: `${path}.qty`, message: `at most ${formatQty(remainingQty)}` },
        ]);
      const amount = q === remainingQty ? remainingAmount : divRound(taxable(l) * q, lineQty, 'half_up');
      const base = fixed[i]!;
      specs.push({
        description: `${l.description} (credit)`,
        sku: base.sku,
        hsnSac: base.hsnSac,
        qty: '1',
        unitPrice: minorToMajor(amount > remainingAmount ? remainingAmount : amount, inv.currency),
        discount: null,
        tax: base.tax,
      });
      metas.push({ invoiceItemId: l.id, qty: formatQty(q) });
    };

    if (input.full) {
      invLines.forEach((l, i) => {
        const done = credited.get(l.id);
        const left = (parseQty(l.qty) ?? 0n) - (done ? (parseQty(done.qty) ?? 0n) : 0n);
        if (left > 0n && taxable(l) - (done?.amountMinor ?? 0n) > 0n) take(l, i, undefined, `lines.${i}`);
      });
      if (inv.shippingMinor > 0n && !(await this.repo.hasIssued(tx, orgId, inv.id))) {
        specs.push({ description: 'Shipping (credit)', sku: null, hsnSac: null, qty: '1', unitPrice: minorToMajor(inv.shippingMinor, inv.currency), discount: null, tax: null });
        metas.push({ invoiceItemId: null, qty: '1' });
      }
    } else {
      for (const [k, l] of (input.lines ?? []).entries()) {
        if (l.invoiceLineId) {
          const line = byUuid.get(l.invoiceLineId);
          if (!line) throw bad(ERROR_CODES.CN_LINE_INVALID, 'That line is not on the invoice', HttpStatus.UNPROCESSABLE_ENTITY, [{ path: `lines.${k}.invoiceLineId`, message: 'not a line of this invoice' }]);
          take(line, invLines.indexOf(line), l.qty, `lines.${k}`);
        } else {
          const amount = parseMajor(l.amount!, inv.currency);
          if (amount === null || amount <= 0n)
            throw bad(ERROR_CODES.CN_LINE_INVALID, `An amount is above 0 with at most ${currencyExponent(inv.currency)} decimals`, HttpStatus.UNPROCESSABLE_ENTITY, [{ path: `lines.${k}.amount`, message: 'invalid' }]);
          let tax = null;
          if (l.taxRateId) {
            const rate = await this.taxRates.findByUuid(tx, orgId, l.taxRateId);
            if (!rate) throw AppError.notFound('Tax rate', l.taxRateId);
            tax = taxSpecOfRate(rate);
          }
          specs.push({ description: l.description!, sku: null, hsnSac: null, qty: '1', unitPrice: l.amount!, discount: null, tax });
          metas.push({ invoiceItemId: null, qty: '1' });
        }
      }
    }
    if (specs.length === 0)
      throw bad(ERROR_CODES.CN_NOTHING_TO_CREDIT, 'Nothing to credit: name lines, or send full: true', HttpStatus.UNPROCESSABLE_ENTITY, [{ path: 'lines', message: 'required' }]);

    const priced = priceInvoice({ currency: inv.currency, specs, discount: null, shipping: null, reverseCharge: inv.reverseCharge });
    const t = priced.totals;
    const creditable = inv.totalMinor - inv.creditedMinor;
    if (t.totalMinor > creditable) throw this.exceeds(creditable, inv.currency);
    return {
      items: priced.lines.map((l, i) => ({
        position: i,
        invoiceItemId: metas[i]!.invoiceItemId,
        description: l.description,
        hsnSac: l.hsnSac,
        qty: metas[i]!.qty,
        amountMinor: l.grossMinor,
        taxName: l.taxName,
        taxType: l.taxType,
        taxRatePercent: l.taxRatePercent,
        taxInclusive: l.taxInclusive,
        taxMinor: l.taxMinor,
        totalMinor: l.totalMinor,
        taxComponents: l.taxComponents,
        currency: inv.currency,
      })),
      totals: {
        subtotalMinor: t.subtotalMinor,
        taxMinor: t.taxMinor,
        taxAddedMinor: t.taxAddedMinor,
        totalMinor: t.totalMinor,
        taxSummary: priced.summary.map((g) => ({
          name: g.name,
          type: g.taxType,
          ratePercent: g.ratePercent,
          inclusive: g.inclusive,
          baseMinor: g.baseMinor.toString(),
          taxMinor: g.taxMinor.toString(),
        })),
      },
    };
  }

  private exceeds(creditable: bigint, currency: string): AppError {
    return bad(
      ERROR_CODES.CN_EXCEEDS_INVOICE,
      `Credit notes cannot add up to more than the invoice: ${major(creditable, currency)} ${currency} can still be credited`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      [{ path: 'total', message: `creditable ${major(creditable, currency)}` }],
    );
  }

  // --- helpers ---------------------------------------------------------------------------------------------------------------------

  private emit(tx: Tx, eventType: string, row: CreditNoteRow, extra: Record<string, unknown> = {}): Promise<void> {
    return this.outbox.emit(tx, {
      aggregateModule: CREDIT_NOTE_MODULE,
      aggregateId: row.id,
      eventType,
      payload: {
        uuid: row.uuid,
        number: row.number,
        status: row.status,
        invoiceId: row.invoiceUuid,
        invoiceNumber: row.invoiceNumber,
        currency: row.currency,
        total: major(row.totalMinor, row.currency),
        reason: row.reason,
        settlement: row.settlement,
        ...extra,
      },
    });
  }

  private async lock(tx: Tx, uuid: string, scope: RecordScope): Promise<CreditNoteRow> {
    const ctx = RequestContextStore.require();
    const row = await this.repo.findByUuid(tx, ctx.orgId, uuid, true);
    if (!row) throw AppError.notFound('Credit note', uuid);
    await this.assertScope(tx, scope, row);
    return row;
  }

  private async assertScope(tx: Tx, scope: RecordScope, row: CreditNoteRow): Promise<void> {
    const ctx = RequestContextStore.require();
    const inv = await this.invoicesRepo.findById(tx, ctx.orgId, row.invoiceId, await this.invoices.zone(tx, ctx.orgId));
    if (!inv) throw AppError.notFound('Credit note');
    try {
      await this.invoices.assertScope(tx, scope, inv);
    } catch {
      throw AppError.notFound('Credit note');
    }
  }

  private async toResponse(tx: Tx, row: CreditNoteRow): Promise<CreditNoteResponse> {
    const ctx = RequestContextStore.require();
    const [items, inv] = await Promise.all([
      this.repo.items(tx, ctx.orgId, row.id),
      this.invoicesRepo.findById(tx, ctx.orgId, row.invoiceId, await this.invoices.zone(tx, ctx.orgId)),
    ]);
    const c = row.currency;
    const settled = inv!.paidMinor + inv!.creditedMinor;
    return {
      ...toCreditNoteSummary(row),
      note: row.note,
      seller: toSeller(inv!.sellerSnapshot),
      lines: items.map((l) => ({
        id: l.uuid,
        position: l.position,
        invoiceLineId: l.invoiceItemUuid,
        description: l.description,
        hsnSac: l.hsnSac,
        qty: l.qty.replace(/\.?0+$/, '') || '0',
        unitPrice: major(l.amountMinor, c),
        taxName: l.taxName,
        taxRate: l.taxRatePercent.includes('.') ? l.taxRatePercent.replace(/0+$/, '').replace(/\.$/, '') : l.taxRatePercent,
        taxInclusive: l.taxInclusive,
        amounts: {
          net: major(l.taxInclusive ? l.amountMinor - l.taxMinor : l.amountMinor, c),
          tax: major(l.taxMinor, c),
          total: major(l.totalMinor, c),
        },
      })),
      taxSummary: (row.taxSummary ?? []).map((g) => ({
        name: g.name,
        type: (g.type as never) ?? null,
        rate: g.ratePercent.includes('.') ? g.ratePercent.replace(/0+$/, '').replace(/\.$/, '') : g.ratePercent,
        inclusive: g.inclusive,
        base: major(BigInt(g.baseMinor), c),
        tax: major(BigInt(g.taxMinor), c),
        components: null,
      })),
      amounts: {
        subtotal: major(row.subtotalMinor, c),
        tax: major(row.taxMinor, c),
        taxAdded: major(row.taxAddedMinor, c),
        total: major(row.totalMinor, c),
      },
      invoiceAmounts: {
        subtotal: major(inv!.subtotalMinor, c),
        discount: major(inv!.discountMinor, c),
        shipping: major(inv!.shippingMinor, c),
        tax: major(inv!.taxMinor, c),
        taxAdded: major(inv!.taxAddedMinor, c),
        total: major(inv!.totalMinor, c),
        paid: major(inv!.paidMinor, c),
        refunded: major(inv!.refundedMinor, c),
        balance: major(inv!.totalMinor > settled ? inv!.totalMinor - settled : 0n, c),
        credit: major(settled > inv!.totalMinor ? settled - inv!.totalMinor : 0n, c),
        credited: major(inv!.creditedMinor, c),
      },
      voidReason: row.voidReason,
      voidedAt: row.voidedAt ? row.voidedAt.toISOString() : null,
    };
  }

  private toDocument(row: CreditNoteRow, items: CreditNoteItemRow[], inv: InvoiceRow): PublicInvoice {
    const c = row.currency;
    const seller = toSeller(inv.sellerSnapshot) ?? {
      name: null, address: null, country: null, state: null, taxId: null, registrationNo: null, phone: null, email: null, extra: [], bankDetails: null,
    };
    const snap = inv.sellerSnapshot ?? {};
    const str = (k: string): string | null => (typeof snap[k] === 'string' && snap[k] !== '' ? (snap[k] as string) : null);
    const trim = (p: string) => (p.includes('.') ? p.replace(/0+$/, '').replace(/\.$/, '') : p);
    return {
      number: row.number ?? 'DRAFT',
      docType: 'tax_invoice',
      status: row.status === 'issued' ? 'issued' : row.status,
      currency: c,
      currencyExponent: row.currencyExponent,
      issueDate: row.issueDate ?? row.createdAt.toISOString().slice(0, 10),
      dueDate: null,
      seller,
      buyer: { name: inv.buyerName, address: inv.buyerAddress, taxId: inv.buyerTaxId },
      reference: `Against invoice ${inv.number ?? ''}`.trim(),
      lines: items.map((l) => ({
        position: l.position,
        description: l.description,
        sku: null,
        hsnSac: l.hsnSac,
        qty: l.qty.replace(/\.?0+$/, '') || '0',
        unitPrice: major(l.amountMinor, c),
        discount: null,
        taxName: l.taxName,
        taxType: null,
        taxRate: trim(l.taxRatePercent),
        taxInclusive: l.taxInclusive,
        taxComponents: null,
        amounts: { gross: major(l.amountMinor, c), discount: '0', net: major(l.amountMinor, c), docDiscountShare: '0', tax: major(l.taxMinor, c), total: major(l.totalMinor, c) },
      })) as PublicInvoice['lines'],
      taxSummary: (row.taxSummary ?? []).map((g) => ({
        name: g.name, type: null, rate: trim(g.ratePercent), inclusive: g.inclusive, base: major(BigInt(g.baseMinor), c), tax: major(BigInt(g.taxMinor), c), components: null,
      })),
      amounts: {
        subtotal: major(row.subtotalMinor, c), discount: major(0n, c), shipping: major(0n, c), tax: major(row.taxMinor, c), taxAdded: major(row.taxAddedMinor, c),
        total: major(row.totalMinor, c), paid: major(0n, c), refunded: major(row.refundedMinor, c), balance: major(0n, c), credit: major(0n, c), credited: major(0n, c),
      },
      reverseCharge: inv.reverseCharge,
      legalNotes: inv.legalNotes,
      notes: row.note,
      terms: null,
      footerNote: str('footerNote'),
      title: 'Credit Note',
      brandColor: str('brandColor'),
      logoUrl: str('logoUrl'),
      payments: [],
      payable: false,
      paymentOptions: { bankTransfer: null, online: false },
      voidedAt: row.voidedAt ? row.voidedAt.toISOString() : null,
      voidReason: row.voidReason,
    };
  }
}

void formatPercent;
