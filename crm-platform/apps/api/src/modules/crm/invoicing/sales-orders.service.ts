import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  currencyExponent,
  formatPercent,
  formatQty,
  minorToMajor,
  parseQty,
  type CancelOrderInput,
  type CreateSalesOrderInput,
  type FulfilOrderInput,
  type FulfilmentStatus,
  type InvoiceFromOrderInput,
  type InvoicingStatus,
  type ListSalesOrdersQuery,
  type PageResponse,
  type RecordScope,
  type SalesOrderCounts,
  type SalesOrderResponse,
  type SalesOrderSummary,
  type UpdateSalesOrderInput,
} from '@crm/contracts';
import { divRound } from '@crm/tax';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { AppError } from '../../../common/errors/app-error';
import { buildPage } from '../../../common/pagination/cursor';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { resolveTimezone, todayIn } from '../deals/deal-calendar';
import {
  priceInvoice,
  simpleTax,
  type LineSpec,
  type PricedInvoice,
  type TaxSpec,
} from './invoice-content';
import { addDays, formatNumber, seriesKey } from './invoice-rules';
import { InvoiceSettingsService, numberingOf } from './invoice-settings.service';
import { toInvoiceSummary } from './invoices.mapper';
import { InvoicesRepository } from './invoices.repository';
import { InvoicesService } from './invoices.service';
import {
  SalesOrdersRepository,
  orderScopeCondition,
  type SalesOrderItemInsert,
  type SalesOrderItemRow,
  type SalesOrderRow,
} from './sales-orders.repository';

export const SALES_ORDER_MODULE = 'sales-orders';

/** What the invoice an order is billed into says, when the billing is not a person's "Invoice" click. */
export interface InvoiceRowOptions {
  docType?: 'tax_invoice' | 'receipt' | 'proforma';
  source?: string;
  buyerAddress?: string | null;
  meta?: Record<string, unknown>;
}

const major = (m: bigint, c: string) => minorToMajor(m, c);
const bad = (
  code: string,
  message: string,
  status: HttpStatus,
  details?: Array<{ path: string; message: string }>,
) => new AppError(code as never, message, status, details);
const trimPercent = (p: string) => (p.includes('.') ? p.replace(/0+$/, '').replace(/\.$/, '') : p);
const qtyOf = (v: string): bigint => parseQty(v) ?? 0n;

export function invoicingStatusOf(
  r: Pick<SalesOrderRow, 'qtyTotal' | 'qtyInvoiced'>,
): InvoicingStatus {
  const t = qtyOf(r.qtyTotal);
  const i = qtyOf(r.qtyInvoiced);
  return i === 0n ? 'not_invoiced' : i >= t ? 'invoiced' : 'partially_invoiced';
}
export function fulfilmentStatusOf(
  r: Pick<SalesOrderRow, 'qtyTotal' | 'qtyFulfilled'>,
): FulfilmentStatus {
  const t = qtyOf(r.qtyTotal);
  const f = qtyOf(r.qtyFulfilled);
  return f === 0n ? 'unfulfilled' : f >= t ? 'fulfilled' : 'partially_fulfilled';
}

function toSummary(r: SalesOrderRow): SalesOrderSummary {
  return {
    id: r.uuid,
    number: r.number,
    status: r.status,
    invoicingStatus: invoicingStatusOf(r),
    fulfilmentStatus: fulfilmentStatusOf(r),
    buyerName: r.buyerName,
    contact: r.contactUuid ? { id: r.contactUuid, name: r.contactName } : null,
    deal: r.dealUuid ? { id: r.dealUuid, title: r.dealTitle ?? '' } : null,
    quote: r.quoteUuid
      ? { id: r.quoteUuid, number: r.quoteNumber ?? '', kind: r.quoteKind ?? 'proposal' }
      : null,
    owner: r.ownerUuid ? { id: r.ownerUuid, name: r.ownerName ?? '' } : null,
    currency: r.currency,
    total: major(r.totalMinor, r.currency),
    totalMinor: r.totalMinor.toString(),
    expectedDate: r.expectedDate,
    reference: r.reference,
    invoiceCount: r.invoiceCount,
    rowVersion: r.rowVersion,
    createdAt: r.createdAt.toISOString(),
  };
}

/** The tax a stored order line carries, as a snapshot a new invoice line can be priced under. */
export function taxSpecOfItem(i: SalesOrderItemRow): TaxSpec | null {
  const hasTax =
    i.taxName !== null || (i.taxItems?.length ?? 0) > 0 || Number(i.taxRatePercent) > 0;
  if (!hasTax) return null;
  const items = i.taxItems?.length
    ? i.taxItems.map((t) => ({ code: t.code, name: t.name, ratePercent: t.ratePercent }))
    : [
        {
          code: i.taxName ?? 'Tax',
          name: i.taxName ?? 'Tax',
          ratePercent: trimPercent(i.taxRatePercent),
        },
      ];
  return {
    rateId: i.taxRateId,
    name: i.taxName,
    type: i.taxType,
    inclusive: i.taxInclusive,
    items,
  };
}

/**
 * Sales orders: estimate/proposal (accepted) -> order -> one or more invoices -> fulfilment. Everything that moves a quantity (an
 * invoice made, an invoice voided or deleted, a delivery recorded) runs with the order's lines locked, and the database refuses a
 * quantity above what was ordered, so two people billing the same line at once cannot bill it twice.
 */
@Injectable()
export class SalesOrdersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: SalesOrdersRepository,
    private readonly invoices: InvoicesService,
    private readonly invoicesRepo: InvoicesRepository,
    private readonly settings: InvoiceSettingsService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly crypto: CryptoService,
  ) {}

  // --- reads ---------------------------------------------------------------------------------------------------------------------

  async list(
    query: ListSalesOrdersQuery,
    scope: RecordScope,
  ): Promise<PageResponse<SalesOrderSummary>> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rows = await this.repo.list(
        tx,
        ctx.orgId,
        query,
        orderScopeCondition(ctx.orgId, scope, ctx.userId),
      );
      const page = buildPage(rows, query.limit);
      return { data: page.items.map(toSummary), page: page.page };
    });
  }

  async counts(scope: RecordScope): Promise<SalesOrderCounts> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rows = await this.repo.counts(
        tx,
        ctx.orgId,
        orderScopeCondition(ctx.orgId, scope, ctx.userId),
      );
      const out: SalesOrderCounts = {
        all: 0,
        draft: 0,
        confirmed: 0,
        cancelled: 0,
        closed: 0,
        toInvoice: 0,
        toFulfil: 0,
        openValue: [],
      };
      const open = new Map<string, bigint>();
      for (const r of rows) {
        out.all += r.count;
        (out as unknown as Record<string, number>)[r.status] =
          ((out as unknown as Record<string, number>)[r.status] ?? 0) + r.count;
        out.toInvoice += r.toInvoice;
        out.toFulfil += r.toFulfil;
        if (r.status === 'confirmed') open.set(r.currency, (open.get(r.currency) ?? 0n) + r.total);
      }
      out.openValue = [...open.entries()].map(([currency, total]) => ({
        currency,
        amount: major(total, currency),
      }));
      return out;
    });
  }

  async get(uuid: string, scope: RecordScope): Promise<SalesOrderResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) =>
      this.toResponse(tx, ctx.orgId, await this.load(tx, uuid, scope)),
    );
  }

  // --- writes --------------------------------------------------------------------------------------------------------------------

  async create(input: CreateSalesOrderInput, scope: RecordScope): Promise<SalesOrderResponse> {
    const ctx = RequestContextStore.require();
    void scope;
    return this.db.tx(async (tx) => {
      const profile = await this.settings.load(tx, ctx.orgId);
      const tz = resolveTimezone(profile.timezone);
      let quote = null as Awaited<ReturnType<SalesOrdersRepository['quote']>> | null;
      if (input.quoteId) {
        quote = (await this.repo.quote(tx, ctx.orgId, input.quoteId)) ?? null;
        if (!quote) throw AppError.notFound('Proposal or estimate', input.quoteId);
        // the offer keeps its buyer and notes encrypted at rest; the order stores them like an invoice does
        quote = {
          ...quote,
          buyerName: this.open(quote.buyerName),
          buyerEmail: this.open(quote.buyerEmail),
          buyerPhone: this.open(quote.buyerPhone),
          notes: this.open(quote.notes),
        };
        if (quote.status !== 'accepted')
          throw bad(
            ERROR_CODES.SO_QUOTE_NOT_ACCEPTED,
            'Only an accepted proposal or estimate can become a sales order',
            HttpStatus.CONFLICT,
          );
        const taken = await tx.execute(
          sql`SELECT 1 FROM sales_orders WHERE org_id = ${ctx.orgId} AND quote_id = ${quote.id} AND status <> 'cancelled'`,
        );
        if (taken.rows.length > 0)
          throw bad(
            ERROR_CODES.SO_QUOTE_TAKEN,
            'This offer already has a sales order',
            HttpStatus.CONFLICT,
          );
      }
      const currency = quote?.currency ?? input.currency ?? profile.currency;
      const specs = quote
        ? specsFromQuote(quote)
        : await this.invoices.specsFromLines(tx, ctx.orgId, input.lines ?? [], profile);
      const shipping = input.shipping ?? null;
      const priced = priceInvoice({
        currency,
        specs,
        discount: null,
        shipping,
        reverseCharge: false,
      });

      const links = await this.invoices.resolveLinks(
        tx,
        ctx.orgId,
        { contactId: input.contactId, companyId: input.companyId, dealId: input.dealId },
        true,
      );
      const contactId =
        links.contactId !== undefined ? links.contactId : (quote?.contactId ?? null);
      const contact = contactId
        ? await this.invoicesRepo.resolveContactById(tx, ctx.orgId, contactId)
        : null;
      const buyerName = (input.buyerName ?? quote?.buyerName ?? contact?.name ?? '').trim();
      if (!buyerName)
        throw AppError.validation('An order needs a buyer: give a name or link a contact', [
          { path: 'buyerName', message: 'required' },
        ]);

      const date = todayIn(tz);
      const numbering = numberingOf(profile.row);
      const series = seriesKey('sales_order', numbering, date);
      const seq = await this.invoicesRepo.allocateSeq(tx, ctx.orgId, series);
      const number = formatNumber('sales_order', numbering, date, seq);
      const id = await this.repo.insert(tx, ctx.orgId, {
        series,
        seq,
        number,
        quoteId: quote?.id ?? null,
        contactId,
        companyId: links.companyId !== undefined ? links.companyId : (quote?.companyId ?? null),
        dealId: links.dealId !== undefined ? links.dealId : (quote?.dealId ?? null),
        ownerId: await this.invoices.resolveOwner(
          tx,
          ctx.orgId,
          input.ownerId,
          quote?.ownerId ?? ctx.userId,
        ),
        createdBy: ctx.userId,
        buyerName,
        buyerEmail: input.buyerEmail ?? quote?.buyerEmail ?? contact?.email ?? null,
        buyerPhone: input.buyerPhone ?? quote?.buyerPhone ?? contact?.phone ?? null,
        currency,
        currencyExponent: currencyExponent(currency),
        reference: input.reference ?? quote?.number ?? null,
        expectedDate: input.expectedDate ?? null,
        notes: input.notes ?? quote?.notes ?? null,
        terms: input.terms ?? quote?.terms ?? profile.row.terms,
      });
      await this.repo.replaceItems(tx, ctx.orgId, id, itemsOf(specs, priced, currency));
      await this.repo.updateHeader(tx, ctx.orgId, id, null, { totals: totalsOf(priced) });
      const row = (await this.repo.findById(tx, ctx.orgId, id))!;
      await this.audit.record(tx, {
        module: SALES_ORDER_MODULE,
        recordId: id,
        action: 'insert',
        delta: {
          number: { old: null, new: number },
          total: { old: null, new: major(row.totalMinor, currency) },
          quote: { old: null, new: row.quoteUuid },
        },
      });
      await this.emit(tx, 'sales_order.created', row);
      return this.toResponse(tx, ctx.orgId, row);
    });
  }

  /**
   * A CONFIRMED order made by the system from an order that was placed in a commerce channel (a store, a WhatsApp cart), inside the
   * caller's transaction: a person did not type it, so there is no owner, no quote and no draft stage worth keeping. The lines arrive
   * priced by the channel; the engine only totals them. Raises `sales_order.created` and `sales_order.confirmed` like any order.
   */
  async createExternalIn(
    tx: Tx,
    orgId: number,
    v: {
      specs: LineSpec[];
      currency: string;
      shipping: string | null;
      contactId: number | null;
      buyer: { name: string | null; email: string | null; phone: string | null };
      reference: string;
      notes: string | null;
    },
  ): Promise<SalesOrderRow> {
    const profile = await this.settings.load(tx, orgId);
    const tz = resolveTimezone(profile.timezone);
    const priced = priceInvoice({
      currency: v.currency,
      specs: v.specs,
      discount: null,
      shipping: v.shipping,
      reverseCharge: false,
    });
    const contact = v.contactId
      ? await this.invoicesRepo.resolveContactById(tx, orgId, v.contactId)
      : null;
    const date = todayIn(tz);
    const numbering = numberingOf(profile.row);
    const series = seriesKey('sales_order', numbering, date);
    const seq = await this.invoicesRepo.allocateSeq(tx, orgId, series);
    const number = formatNumber('sales_order', numbering, date, seq);
    const id = await this.repo.insert(tx, orgId, {
      series,
      seq,
      number,
      quoteId: null,
      contactId: contact?.id ?? null,
      companyId: contact?.companyId ?? null,
      dealId: null,
      ownerId: null,
      createdBy: null,
      buyerName: (v.buyer.name?.trim() || contact?.name || v.buyer.phone || 'Customer').slice(
        0,
        255,
      ),
      buyerEmail: v.buyer.email,
      buyerPhone: v.buyer.phone,
      currency: v.currency,
      currencyExponent: currencyExponent(v.currency),
      reference: v.reference,
      expectedDate: null,
      notes: v.notes,
      terms: profile.row.terms,
    });
    await this.repo.replaceItems(tx, orgId, id, itemsOf(v.specs, priced, v.currency));
    await this.repo.updateHeader(tx, orgId, id, null, { totals: totalsOf(priced) });
    const created = (await this.repo.findById(tx, orgId, id))!;
    await this.audit.record(tx, {
      module: SALES_ORDER_MODULE,
      recordId: id,
      action: 'insert',
      delta: {
        number: { old: null, new: number },
        total: { old: null, new: major(created.totalMinor, v.currency) },
        reference: { old: null, new: v.reference },
      },
    });
    await this.emit(tx, 'sales_order.created', created, { source: 'store' });
    await this.repo.updateHeader(tx, orgId, id, null, { status: 'confirmed', confirmedAt: true });
    const confirmed = (await this.repo.findById(tx, orgId, id))!;
    await this.audit.record(tx, {
      module: SALES_ORDER_MODULE,
      recordId: id,
      action: 'update',
      delta: { status: { old: 'draft', new: 'confirmed' } },
    });
    await this.emit(tx, 'sales_order.confirmed', confirmed, { source: 'store' });
    return confirmed;
  }

  /**
   * Cancels the sales order of a channel order that was cancelled there, inside the caller's transaction. Refuses (returns false, writes
   * nothing) when the order is already cancelled or an invoice made from it is still live: a billed order is cancelled by voiding its
   * invoice first, as for a person.
   */
  async cancelExternalIn(
    tx: Tx,
    orgId: number,
    salesOrderId: number,
    reason: string,
  ): Promise<boolean> {
    const row = await this.repo.findById(tx, orgId, salesOrderId);
    if (!row || row.status === 'cancelled') return false;
    const live = (await this.repo.invoices(tx, orgId, row.id)).filter((i) => i.status !== 'void');
    if (live.length > 0) return false;
    await this.repo.updateHeader(tx, orgId, row.id, null, {
      status: 'cancelled',
      cancelled: reason,
    });
    const after = (await this.repo.findById(tx, orgId, row.id))!;
    await this.audit.record(tx, {
      module: SALES_ORDER_MODULE,
      recordId: row.id,
      action: 'update',
      delta: { status: { old: row.status, new: 'cancelled' }, reason: { old: null, new: reason } },
    });
    await this.emit(tx, 'sales_order.cancelled', after, { reason, source: 'store' });
    return true;
  }

  async update(
    uuid: string,
    input: UpdateSalesOrderInput,
    scope: RecordScope,
  ): Promise<SalesOrderResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.load(tx, uuid, scope, true);
      if (input.rowVersion !== row.rowVersion) throw AppError.rowVersionConflict('Sales order');
      if (row.status !== 'draft')
        throw bad(ERROR_CODES.SO_NOT_DRAFT, 'Only a draft order is edited', HttpStatus.CONFLICT);
      const patch: Parameters<SalesOrdersRepository['updateHeader']>[4] = {};
      const delta: Record<string, { old: unknown; new: unknown }> = {};
      const simple = [
        'buyerName',
        'buyerEmail',
        'buyerPhone',
        'reference',
        'expectedDate',
        'notes',
        'terms',
      ] as const;
      for (const k of simple) {
        if (input[k] !== undefined && (input[k] ?? null) !== (row[k] ?? null)) {
          (patch as Record<string, unknown>)[k] = input[k] ?? null;
          delta[k] = { old: row[k] !== null, new: input[k] != null };
        }
      }
      if (
        input.contactId !== undefined ||
        input.companyId !== undefined ||
        input.dealId !== undefined
      ) {
        const links = await this.invoices.resolveLinks(tx, ctx.orgId, input, false);
        Object.assign(patch, links);
        delta.links = { old: true, new: true };
      }
      if (input.ownerId !== undefined)
        patch.ownerId = await this.invoices.resolveOwner(tx, ctx.orgId, input.ownerId, null);
      if (input.lines !== undefined || input.shipping !== undefined) {
        const profile = await this.settings.load(tx, ctx.orgId);
        const specs =
          input.lines !== undefined
            ? await this.invoices.specsFromLines(tx, ctx.orgId, input.lines, profile)
            : specsFromItems(await this.repo.items(tx, ctx.orgId, row.id), row.currency);
        const shipping =
          input.shipping !== undefined
            ? (input.shipping ?? null)
            : row.shippingMinor > 0n
              ? major(row.shippingMinor, row.currency)
              : null;
        const priced = priceInvoice({
          currency: row.currency,
          specs,
          discount: null,
          shipping,
          reverseCharge: false,
        });
        await this.repo.replaceItems(tx, ctx.orgId, row.id, itemsOf(specs, priced, row.currency));
        patch.totals = totalsOf(priced);
        delta.total = {
          old: major(row.totalMinor, row.currency),
          new: major(priced.totals.totalMinor, row.currency),
        };
      }
      const ok = await this.repo.updateHeader(tx, ctx.orgId, row.id, input.rowVersion, patch);
      if (!ok) throw AppError.rowVersionConflict('Sales order');
      const after = (await this.repo.findById(tx, ctx.orgId, row.id))!;
      if (Object.keys(delta).length > 0)
        await this.audit.record(tx, {
          module: SALES_ORDER_MODULE,
          recordId: row.id,
          action: 'update',
          delta,
        });
      await this.emit(tx, 'sales_order.updated', after);
      return this.toResponse(tx, ctx.orgId, after);
    });
  }

  async confirm(uuid: string, scope: RecordScope): Promise<SalesOrderResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.load(tx, uuid, scope, true);
      if (row.status === 'cancelled')
        throw bad(ERROR_CODES.SO_CANCELLED, 'The order is cancelled', HttpStatus.CONFLICT);
      if (row.status !== 'draft')
        throw bad(ERROR_CODES.SO_NOT_DRAFT, 'The order is already confirmed', HttpStatus.CONFLICT);
      await this.repo.updateHeader(tx, ctx.orgId, row.id, null, {
        status: 'confirmed',
        confirmedAt: true,
      });
      const after = (await this.repo.findById(tx, ctx.orgId, row.id))!;
      await this.audit.record(tx, {
        module: SALES_ORDER_MODULE,
        recordId: row.id,
        action: 'update',
        delta: { status: { old: 'draft', new: 'confirmed' } },
      });
      await this.emit(tx, 'sales_order.confirmed', after);
      return this.toResponse(tx, ctx.orgId, after);
    });
  }

  async cancel(
    uuid: string,
    input: CancelOrderInput,
    scope: RecordScope,
  ): Promise<SalesOrderResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.load(tx, uuid, scope, true);
      if (row.status === 'cancelled')
        throw bad(ERROR_CODES.SO_CANCELLED, 'The order is already cancelled', HttpStatus.CONFLICT);
      const live = (await this.repo.invoices(tx, ctx.orgId, row.id)).filter(
        (i) => i.status !== 'void',
      );
      if (live.length > 0)
        throw bad(
          ERROR_CODES.SO_HAS_INVOICES,
          'An invoice made from this order is still live: void or delete it first',
          HttpStatus.CONFLICT,
          live.map((i) => ({ path: 'invoices', message: i.number ?? i.uuid })),
        );
      await this.repo.updateHeader(tx, ctx.orgId, row.id, null, {
        status: 'cancelled',
        cancelled: input.reason,
      });
      const after = (await this.repo.findById(tx, ctx.orgId, row.id))!;
      await this.audit.record(tx, {
        module: SALES_ORDER_MODULE,
        recordId: row.id,
        action: 'update',
        delta: {
          status: { old: row.status, new: 'cancelled' },
          reason: { old: null, new: input.reason },
        },
      });
      await this.emit(tx, 'sales_order.cancelled', after, { reason: input.reason });
      return this.toResponse(tx, ctx.orgId, after);
    });
  }

  async remove(uuid: string, scope: RecordScope): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const row = await this.load(tx, uuid, scope, true);
      if (row.status !== 'draft')
        throw bad(
          ERROR_CODES.SO_NOT_DRAFT,
          'Only a draft order is deleted: cancel a confirmed one',
          HttpStatus.CONFLICT,
        );
      await this.audit.record(tx, {
        module: SALES_ORDER_MODULE,
        recordId: row.id,
        action: 'delete',
        delta: { number: { old: row.number, new: null } },
      });
      await this.emit(tx, 'sales_order.deleted', row);
      await this.repo.delete(tx, ctx.orgId, row.id);
    });
  }

  /**
   * Bills part (or all) of an order: a DRAFT invoice (or an issued one with `issue: true`) holding exactly the quantities named, at
   * the order's prices and taxes. Shipping goes on the first invoice. The quantities billed move on the order in the same
   * transaction, with the lines locked.
   */
  async invoice(uuid: string, input: InvoiceFromOrderInput, scope: RecordScope) {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.load(tx, uuid, scope, true);
      const { order, invoice } = await this.invoiceRowIn(tx, ctx.orgId, ctx.userId, row, input);
      return { order, invoice };
    });
  }

  /**
   * The body of `invoice`, inside the caller's transaction and with the order row already locked (`FOR UPDATE`): the storefront's
   * order bridge bills a store order through it as the system actor. `opts` only changes what the DRAFT says (its document type, source,
   * buyer address and meta); the order's quantities, shipping and progress move exactly as for a person.
   */
  async invoiceRowIn(
    tx: Tx,
    orgId: number,
    userId: number | null,
    row: SalesOrderRow,
    input: InvoiceFromOrderInput,
    opts: InvoiceRowOptions = {},
  ) {
    this.assertConfirmed(row);
    const items = await this.repo.items(tx, orgId, row.id, true);
    const byUuid = new Map(items.map((i) => [i.uuid, i]));
    const picks: Array<{ item: SalesOrderItemRow; qty: bigint }> = [];
    if (input.all) {
      for (const item of items) {
        const left = qtyOf(item.qty) - qtyOf(item.qtyInvoiced);
        if (left > 0n) picks.push({ item, qty: left });
      }
    } else {
      for (const [k, l] of (input.lines ?? []).entries()) {
        const item = byUuid.get(l.lineId);
        if (!item)
          throw bad(
            ERROR_CODES.SO_QUANTITY_EXCEEDS,
            'That line is not on the order',
            HttpStatus.UNPROCESSABLE_ENTITY,
            [{ path: `lines.${k}.lineId`, message: 'not a line of this order' }],
          );
        const left = qtyOf(item.qty) - qtyOf(item.qtyInvoiced);
        const want = l.qty === undefined ? left : qtyOf(l.qty);
        if (want <= 0n || want > left)
          throw bad(
            ERROR_CODES.SO_QUANTITY_EXCEEDS,
            `At most ${formatQty(left)} of "${item.description}" is left to invoice`,
            HttpStatus.UNPROCESSABLE_ENTITY,
            [{ path: `lines.${k}.qty`, message: `at most ${formatQty(left)}` }],
          );
        const dup = picks.find((p) => p.item.id === item.id);
        if (dup) dup.qty += want;
        else picks.push({ item, qty: want });
        const p = picks.find((x) => x.item.id === item.id)!;
        if (p.qty > left)
          throw bad(
            ERROR_CODES.SO_QUANTITY_EXCEEDS,
            `At most ${formatQty(left)} of "${item.description}" is left to invoice`,
            HttpStatus.UNPROCESSABLE_ENTITY,
            [{ path: `lines.${k}.qty`, message: `at most ${formatQty(left)}` }],
          );
      }
    }
    const withShipping = input.includeShipping && !row.shippingInvoiced && row.shippingMinor > 0n;
    if (picks.length === 0 && !withShipping)
      throw bad(
        ERROR_CODES.SO_NOTHING_TO_INVOICE,
        'Everything on this order is already invoiced',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );

    const specs: LineSpec[] = picks.map(({ item, qty }) => {
      const total = qtyOf(item.qty);
      const left = total - qtyOf(item.qtyInvoiced);
      let discount: LineSpec['discount'] = null;
      if (item.discountKind === 'percent')
        discount = { kind: 'percent', value: formatPercent(item.discountValue) };
      else if (item.discountKind === 'amount') {
        const remaining = item.discountMinor - item.discountInvoicedMinor;
        const share =
          qty === left ? remaining : divRound(item.discountMinor * qty, total, 'half_up');
        discount =
          share > 0n
            ? {
                kind: 'amount',
                value: major(share > remaining ? remaining : share, row.currency),
              }
            : null;
      }
      return {
        description: item.description,
        sku: item.sku,
        hsnSac: item.hsnSac,
        qty: formatQty(qty),
        unitPrice: major(item.unitPriceMinor, row.currency),
        discount,
        tax: taxSpecOfItem(item),
      };
    });
    if (specs.length === 0)
      throw bad(
        ERROR_CODES.SO_NOTHING_TO_INVOICE,
        'Nothing left to invoice except shipping: name the lines or include them',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );

    const profile = await this.settings.load(tx, orgId);
    const tz = resolveTimezone(profile.timezone);
    const issueDate = input.issueDate ?? null;
    let dueDate = input.dueDate ?? null;
    if (!dueDate && input.paymentTermsDays != null)
      dueDate = addDays(issueDate ?? todayIn(tz), input.paymentTermsDays);
    let inv = await this.invoices.createDraftIn(tx, orgId, userId, {
      source: opts.source ?? 'sales_order',
      docType: opts.docType ?? 'tax_invoice',
      currency: row.currency,
      buyer: {
        name: row.buyerName,
        email: row.buyerEmail,
        phone: row.buyerPhone,
        address: opts.buyerAddress ?? null,
        taxId: null,
        country: null,
      },
      contactId: row.contactId,
      companyId: row.companyId,
      dealId: row.dealId,
      quoteId: null,
      ownerId: row.ownerId,
      taxRegime: profile.row.defaultTaxRegime,
      placeOfSupply: null,
      reverseCharge: false,
      issueDate,
      dueDate,
      reference: row.reference ?? row.number,
      notes: row.notes,
      terms: row.terms ?? profile.row.terms,
      legalNotes: null,
      discount: null,
      shipping: withShipping ? major(row.shippingMinor, row.currency) : null,
      lines: specs,
      metaJson: { salesOrder: row.number, salesOrderId: row.uuid, ...(opts.meta ?? {}) },
    });
    const invLines = await this.invoicesRepo.lines(tx, orgId, inv.id);
    await this.repo.linkInvoice(
      tx,
      orgId,
      inv.id,
      row.id,
      picks.map((p) => p.item.id),
    );
    for (const [i, p] of picks.entries()) {
      await this.repo.addProgress(tx, orgId, p.item.id, {
        invoiced: formatQty(p.qty),
        discountInvoicedMinor: invLines[i]?.discountMinor ?? 0n,
      });
    }
    if (withShipping)
      await this.repo.updateHeader(tx, orgId, row.id, null, { shippingInvoiced: true });
    if (input.issue)
      inv = await this.invoices.issueIn(tx, orgId, userId, inv, {
        issueDate: input.issueDate ?? undefined,
        dueDate: input.dueDate ?? undefined,
        paymentTermsDays: input.paymentTermsDays ?? undefined,
      });
    await this.repo.syncStatus(tx, orgId, row.id);
    const after = (await this.repo.findById(tx, orgId, row.id))!;
    await this.audit.record(tx, {
      module: SALES_ORDER_MODULE,
      recordId: row.id,
      action: 'update',
      delta: {
        invoiced: { old: row.qtyInvoiced, new: after.qtyInvoiced },
        invoice: { old: null, new: inv.uuid },
      },
    });
    await this.emit(tx, 'sales_order.invoiced', after, {
      invoiceId: inv.uuid,
      invoiceNumber: inv.number,
    });
    const zone = await this.invoices.zone(tx, orgId);
    const fresh = (await this.invoicesRepo.findById(tx, orgId, inv.id, zone))!;
    return {
      order: await this.toResponse(tx, orgId, after),
      invoice: toInvoiceSummary(fresh),
      /** The invoice row itself (internal id, number, status), for a caller that links it. */
      invoiceRow: fresh,
    };
  }

  /** Records a delivery: quantities fulfilled, never above what was ordered. */
  async fulfil(
    uuid: string,
    input: FulfilOrderInput,
    scope: RecordScope,
  ): Promise<SalesOrderResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.load(tx, uuid, scope, true);
      this.assertConfirmed(row);
      const items = await this.repo.items(tx, ctx.orgId, row.id, true);
      const byUuid = new Map(items.map((i) => [i.uuid, i]));
      const moves = new Map<number, bigint>();
      if (input.all) {
        for (const i of items) {
          const left = qtyOf(i.qty) - qtyOf(i.qtyFulfilled);
          if (left > 0n) moves.set(i.id, left);
        }
      } else {
        for (const [k, l] of (input.lines ?? []).entries()) {
          const item = byUuid.get(l.lineId);
          if (!item)
            throw bad(
              ERROR_CODES.SO_QUANTITY_EXCEEDS,
              'That line is not on the order',
              HttpStatus.UNPROCESSABLE_ENTITY,
              [{ path: `lines.${k}.lineId`, message: 'not a line of this order' }],
            );
          const want = (moves.get(item.id) ?? 0n) + qtyOf(l.qty);
          const left = qtyOf(item.qty) - qtyOf(item.qtyFulfilled);
          if (want <= 0n || want > left)
            throw bad(
              ERROR_CODES.SO_QUANTITY_EXCEEDS,
              `At most ${formatQty(left)} of "${item.description}" is left to deliver`,
              HttpStatus.UNPROCESSABLE_ENTITY,
              [{ path: `lines.${k}.qty`, message: `at most ${formatQty(left)}` }],
            );
          moves.set(item.id, want);
        }
      }
      if (moves.size === 0)
        throw bad(
          ERROR_CODES.SO_NOTHING_TO_INVOICE,
          'Everything is already delivered',
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      for (const [id, q] of moves)
        await this.repo.addProgress(tx, ctx.orgId, id, { fulfilled: formatQty(q) });
      await this.repo.syncStatus(tx, ctx.orgId, row.id);
      const after = (await this.repo.findById(tx, ctx.orgId, row.id))!;
      await this.audit.record(tx, {
        module: SALES_ORDER_MODULE,
        recordId: row.id,
        action: 'update',
        delta: { fulfilled: { old: row.qtyFulfilled, new: after.qtyFulfilled } },
      });
      await this.emit(tx, 'sales_order.fulfilled', after, { note: input.note ?? null });
      return this.toResponse(tx, ctx.orgId, after);
    });
  }

  // --- helpers -------------------------------------------------------------------------------------------------------------------

  private open(cipher: string | null): string | null {
    if (!cipher) return null;
    try {
      return this.crypto.decrypt(cipher);
    } catch {
      return null;
    }
  }

  private assertConfirmed(row: SalesOrderRow): void {
    if (row.status === 'cancelled')
      throw bad(ERROR_CODES.SO_CANCELLED, 'The order is cancelled', HttpStatus.CONFLICT);
    if (row.status === 'draft')
      throw bad(ERROR_CODES.SO_NOT_CONFIRMED, 'Confirm the order first', HttpStatus.CONFLICT);
  }

  private async load(
    tx: Tx,
    uuid: string,
    scope: RecordScope,
    forUpdate = false,
  ): Promise<SalesOrderRow> {
    const ctx = RequestContextStore.require();
    const row = await this.repo.findByUuid(tx, ctx.orgId, uuid, forUpdate);
    if (!row) throw AppError.notFound('Sales order', uuid);
    if (
      scope !== 'all' &&
      !(await this.repo.visible(
        tx,
        ctx.orgId,
        row.id,
        orderScopeCondition(ctx.orgId, scope, ctx.userId),
      ))
    )
      throw AppError.notFound('Sales order', uuid);
    return row;
  }

  private emit(
    tx: Tx,
    eventType: string,
    row: SalesOrderRow,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    return this.outbox.emit(tx, {
      aggregateModule: SALES_ORDER_MODULE,
      aggregateId: row.id,
      eventType,
      payload: {
        uuid: row.uuid,
        number: row.number,
        status: row.status,
        currency: row.currency,
        total: major(row.totalMinor, row.currency),
        contactId: row.contactUuid,
        dealId: row.dealUuid,
        quoteId: row.quoteUuid,
        invoicingStatus: invoicingStatusOf(row),
        fulfilmentStatus: fulfilmentStatusOf(row),
        ...extra,
      },
    });
  }

  private async toResponse(tx: Tx, orgId: number, row: SalesOrderRow): Promise<SalesOrderResponse> {
    const [items, invoices] = await Promise.all([
      this.repo.items(tx, orgId, row.id),
      this.repo.invoices(tx, orgId, row.id),
    ]);
    const c = row.currency;
    const discount = items.reduce((a, i) => a + i.discountMinor, 0n);
    const gross = items.reduce((a, i) => a + i.subtotalMinor, 0n);
    return {
      ...toSummary(row),
      buyer: { name: row.buyerName, email: row.buyerEmail, phone: row.buyerPhone },
      amounts: {
        subtotal: major(gross, c),
        discount: major(discount, c),
        shipping: major(row.shippingMinor, c),
        tax: major(row.taxMinor, c),
        total: major(row.totalMinor, c),
      },
      shippingInvoiced: row.shippingInvoiced,
      notes: row.notes,
      terms: row.terms,
      lines: items.map((i) => {
        const left = qtyOf(i.qty) - qtyOf(i.qtyInvoiced);
        const net = i.subtotalMinor - i.discountMinor;
        return {
          id: i.uuid,
          position: i.position,
          description: i.description,
          sku: i.sku,
          hsnSac: i.hsnSac,
          qty: formatQty(qtyOf(i.qty)),
          qtyInvoiced: formatQty(qtyOf(i.qtyInvoiced)),
          qtyFulfilled: formatQty(qtyOf(i.qtyFulfilled)),
          qtyToInvoice: formatQty(left > 0n ? left : 0n),
          unitPrice: major(i.unitPriceMinor, c),
          taxName: i.taxName,
          taxRate: trimPercent(i.taxRatePercent),
          taxInclusive: i.taxInclusive,
          amounts: {
            net: major(i.taxInclusive ? net - i.taxMinor : net, c),
            tax: major(i.taxMinor, c),
            total: major(i.totalMinor, c),
          },
        };
      }),
      invoices: invoices.map((i) => ({
        id: i.uuid,
        number: i.number,
        status: i.status === 'void' ? 'void' : i.status === 'draft' ? 'draft' : i.paymentStatus,
        total: major(i.totalMinor, i.currency),
      })),
      confirmedAt: row.confirmedAt ? row.confirmedAt.toISOString() : null,
      cancelledAt: row.cancelledAt ? row.cancelledAt.toISOString() : null,
      cancelReason: row.cancelReason,
    };
  }
}

/** An accepted offer's lines as invoice-line specs; the document discount is folded into the lines in proportion to their net amounts. */
export function specsFromQuote(
  q: NonNullable<Awaited<ReturnType<SalesOrdersRepository['quote']>>>,
): LineSpec[] {
  const nets = q.items.map((i) => i.netMinor);
  const totalNet = nets.reduce((a, b) => a + b, 0n);
  const shares = nets.map(() => 0n);
  if (q.discountMinor > 0n && totalNet > 0n) {
    let given = 0n;
    let last = -1;
    nets.forEach((n, k) => {
      if (n > 0n) last = k;
    });
    nets.forEach((n, k) => {
      if (k === last) shares[k] = q.discountMinor - given;
      else {
        shares[k] = divRound(q.discountMinor * n, totalNet, 'half_up');
        given += shares[k]!;
      }
    });
  }
  return q.items.map((i, k) => {
    const bp = i.taxRateBp ?? q.taxRateBp;
    const tax: TaxSpec | null =
      bp > 0 ? simpleTax(null, 'Tax', null, formatPercent(bp), false) : null;
    let discount: LineSpec['discount'] = null;
    if (shares[k]! > 0n || i.discountKind !== 'none') {
      // line discount in minor units = gross - net, plus its share of the document discount
      const lineDiscount = i.grossMinor - i.netMinor + shares[k]!;
      discount =
        lineDiscount > 0n
          ? { kind: 'amount', value: minorToMajor(lineDiscount, q.currency) }
          : null;
    }
    return {
      description: i.description,
      sku: null,
      hsnSac: null,
      qty: i.qty,
      unitPrice: minorToMajor(i.unitPriceMinor, q.currency),
      discount,
      tax,
    };
  });
}

function specsFromItems(items: SalesOrderItemRow[], currency: string): LineSpec[] {
  return items.map((i) => ({
    description: i.description,
    sku: i.sku,
    hsnSac: i.hsnSac,
    qty: i.qty,
    unitPrice: minorToMajor(i.unitPriceMinor, currency),
    discount:
      i.discountKind === 'percent'
        ? { kind: 'percent', value: formatPercent(i.discountValue) }
        : i.discountKind === 'amount'
          ? { kind: 'amount', value: minorToMajor(i.discountValue, currency) }
          : null,
    tax: taxSpecOfItem(i),
  }));
}

function totalsOf(p: PricedInvoice) {
  const t = p.totals;
  // the engine's subtotal is already net of line discounts, and an order has no document discount (total = subtotal + tax added + shipping)
  return {
    subtotalMinor: t.subtotalMinor,
    shippingMinor: t.shippingMinor,
    taxMinor: t.taxMinor,
    taxAddedMinor: t.taxAddedMinor,
    totalMinor: t.totalMinor,
  };
}

function itemsOf(
  specs: LineSpec[],
  priced: PricedInvoice,
  currency: string,
): SalesOrderItemInsert[] {
  return priced.lines.map((l, i) => ({
    position: i,
    description: l.description,
    sku: l.sku,
    hsnSac: l.hsnSac,
    qty: l.qty,
    unitPriceMinor: l.unitPriceMinor,
    discountKind: l.discountKind,
    discountValue: l.discountValue,
    taxRateId: l.taxRateId,
    taxName: l.taxName,
    taxType: l.taxType,
    taxInclusive: l.taxInclusive,
    taxItems: specs[i]?.tax?.items ?? null,
    taxRatePercent: l.taxRatePercent,
    subtotalMinor: l.grossMinor,
    discountMinor: l.discountMinor,
    taxMinor: l.taxMinor,
    totalMinor: l.totalMinor,
    currency,
  }));
}
