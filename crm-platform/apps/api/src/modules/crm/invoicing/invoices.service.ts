import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  currencyExponent,
  formatPercent,
  minorToMajor,
  type CreateInvoiceInput,
  type InvoiceCountsQuery,
  type InvoiceCountsResponse,
  type InvoiceEventsQuery,
  type InvoiceEventsResponse,
  type InvoiceResponse,
  type InvoiceSummary,
  type IssueInvoiceInput,
  type LinkedInvoicesQuery,
  type LinkedInvoicesResponse,
  type ListInvoicesQuery,
  type PageResponse,
  type PublicLinkInput,
  type RecordScope,
  type SendInvoiceInput,
  type UpdateInvoiceInput,
  type VoidInvoiceInput,
  type WireDiscount,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { AppError } from '../../../common/errors/app-error';
import { buildPage, encodeCursor } from '../../../common/pagination/cursor';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { assertContactScope, ContactsRepository } from '../contacts';
// Not the deals barrel: it re-exports services that import this module's neighbours (a cycle leaves a constructor parameter undefined).
import { resolveTimezone, todayIn } from '../deals/deal-calendar';
import { DealsRepository } from '../deals/deals.repository';
import { DealsService } from '../deals/deals.service';
import { resolveAutoTax, type AutoTaxExplanation } from './invoice-auto-tax';
import {
  priceInvoice,
  simpleTax,
  specsFromRows,
  trimPercent,
  type LineSpec,
  type PricedInvoice,
  type TaxSpec,
} from './invoice-content';
import {
  addDays,
  formatNumber,
  hashPublicToken,
  newPublicToken,
  resolveDueDate,
  seriesKey,
} from './invoice-rules';
import {
  InvoiceSettingsService,
  numberingOf,
  type LoadedProfile,
} from './invoice-settings.service';
import { invoiceEventPayload, toInvoiceResponse, toInvoiceSummary } from './invoices.mapper';
import {
  InvoicesRepository,
  invoiceScopeCondition,
  type InvoiceInsert,
  type InvoiceRow,
} from './invoices.repository';
import { PlanUsageService } from '../../plans-subscriptions-trials';
import { SalesOrdersRepository } from './sales-orders.repository';
import { TaxRatesRepository, type TaxRateRow } from './tax-rates.repository';

export const INVOICE_MODULE = 'invoices';

const FROZEN_AFTER_ISSUE = [
  'docType',
  'buyerName',
  'buyerTaxId',
  'buyerCountry',
  'currency',
  'taxRegime',
  'placeOfSupply',
  'reverseCharge',
  'issueDate',
  'discount',
  'shipping',
  'legalNotes',
  'lines',
] as const;

/** Everything a draft is made from, with the references already resolved to internal ids. */
export interface DraftSpec {
  source: string;
  docType: 'tax_invoice' | 'proforma' | 'receipt';
  currency: string;
  buyer: {
    name: string | null;
    email: string | null;
    phone: string | null;
    address: string | null;
    taxId: string | null;
    country: string | null;
  };
  contactId: number | null;
  companyId: number | null;
  dealId: number | null;
  quoteId: number | null;
  ownerId: number | null;
  taxRegime: string;
  placeOfSupply: string | null;
  reverseCharge: boolean;
  issueDate: string | null;
  dueDate: string | null;
  reference: string | null;
  notes: string | null;
  terms: string | null;
  legalNotes: string | null;
  discount: WireDiscount | null;
  shipping: string | null;
  lines: LineSpec[];
  /** How the lines were taxed: `rates` (picked) or `auto` (decided by the tax engine, with its reasons in the invoice's meta). */
  taxMode?: 'rates' | 'auto';
  explanation?: AutoTaxExplanation | null;
  supplyType?: 'goods' | 'services' | 'digital';
  metaJson?: Record<string, unknown> | null;
}

const bad = (
  code: string,
  message: string,
  status: HttpStatus,
  details?: Array<{ path: string; message: string }>,
) => new AppError(code as never, message, status, details);

/** A tax rate row as a line carries it: its taxes (a compound rate keeps its parts) and its inclusive flag, as a snapshot. */
export function taxSpecOfRate(rate: TaxRateRow): TaxSpec {
  if (rate.components?.length) {
    return {
      rateId: rate.id,
      name: rate.name,
      type: rate.taxType,
      inclusive: rate.inclusive,
      items: rate.components.map((c) => ({
        code: c.type,
        name: `${c.type} ${trimPercent(c.ratePercent)}%`,
        ratePercent: c.ratePercent,
      })),
    };
  }
  return simpleTax(rate.id, rate.name, rate.taxType, rate.ratePercent, rate.inclusive);
}

/**
 * Invoices (TW-INV-001..031). One transaction per operation: the row lock, the write, the audit row, the timeline entry and the
 * outbox event commit together or not at all.
 *
 * What differs from Reference (all in the inventory's "Port decisions"): a draft stage; the number is allocated when the invoice is
 * ISSUED, in the same transaction, from a locked per-series counter; an issued invoice is frozen (the database enforces it);
 * overdue is derived from the due date; void exists; the public link is hashed, expirable and revocable; CRM links are real
 * columns; the record scope applies to every read and write.
 */
@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: InvoicesRepository,
    private readonly taxRates: TaxRatesRepository,
    private readonly settings: InvoiceSettingsService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly rbac: RbacService,
    private readonly contacts: ContactsRepository,
    private readonly dealsRepo: DealsRepository,
    private readonly deals: DealsService,
    private readonly orders: SalesOrdersRepository,
    private readonly planUsage: PlanUsageService,
  ) {}

  // --- reads -------------------------------------------------------------------------------------------------------------------

  async list(query: ListInvoicesQuery, scope: RecordScope): Promise<PageResponse<InvoiceSummary>> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const tz = await this.zone(tx, ctx.orgId);
      const rows = await this.repo.list(
        tx,
        ctx.orgId,
        ctx.userId,
        query,
        invoiceScopeCondition(ctx.orgId, scope, ctx.userId),
        tz,
      );
      const page = buildPage(rows, query.limit);
      return { data: page.items.map(toInvoiceSummary), page: page.page };
    });
  }

  async counts(query: InvoiceCountsQuery, scope: RecordScope): Promise<InvoiceCountsResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const tz = await this.zone(tx, ctx.orgId);
      const scopeSql = invoiceScopeCondition(ctx.orgId, scope, ctx.userId);
      const c = await this.repo.counts(tx, ctx.orgId, ctx.userId, query, scopeSql, tz);
      const balances = await this.repo.openBalances(tx, ctx.orgId, ctx.userId, query, scopeSql, tz);
      return {
        ...c,
        outstanding: balances
          .filter((b) => b.outstanding > 0n)
          .map((b) => ({ currency: b.currency, amount: minorToMajor(b.outstanding, b.currency) })),
        overdueAmount: balances
          .filter((b) => b.overdue > 0n)
          .map((b) => ({ currency: b.currency, amount: minorToMajor(b.overdue, b.currency) })),
      };
    });
  }

  async get(uuid: string, scope: RecordScope): Promise<InvoiceResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const tz = await this.zone(tx, ctx.orgId);
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid, tz);
      if (!row) throw AppError.notFound('Invoice', uuid);
      await this.assertScope(tx, scope, row);
      return this.toResponse(tx, row);
    });
  }

  /** A contact's invoices with the money rolled up (the contact page's tab). Needs record.contacts.read on the contact. */
  async forContact(
    contactUuid: string,
    query: LinkedInvoicesQuery,
    scope: RecordScope,
  ): Promise<LinkedInvoicesResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const contact = await this.contacts.resolveContactRef(tx, ctx.orgId, contactUuid);
      if (!contact) throw AppError.notFound('Contact', contactUuid);
      const read = this.rbac.can(ctx.grants!, 'record.contacts.read');
      if (!read.allowed) throw AppError.forbidden('record.contacts.read');
      await assertContactScope(
        tx,
        this.contacts,
        ctx.orgId,
        read.scope,
        ctx.userId!,
        contact.ownerId,
      );
      return this.linked(tx, { contactId: contact.id, contactUuid }, query, scope);
    });
  }

  /** A deal's invoices with the money rolled up (the deal drawer's tab). Needs record.deals.read on the deal. */
  async forDeal(
    dealUuid: string,
    query: LinkedInvoicesQuery,
    scope: RecordScope,
  ): Promise<LinkedInvoicesResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const deal = await this.dealsRepo.findByUuid(tx, ctx.orgId, dealUuid);
      if (!deal) throw AppError.notFound('Deal', dealUuid);
      const read = this.rbac.can(ctx.grants!, 'record.deals.read');
      if (!read.allowed) throw AppError.forbidden('record.deals.read');
      await this.deals.assertScope(tx, read.scope, deal.ownerId);
      return this.linked(tx, { dealId: deal.id, dealUuid }, query, scope);
    });
  }

  async events(
    uuid: string,
    query: InvoiceEventsQuery,
    scope: RecordScope,
  ): Promise<InvoiceEventsResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const tz = await this.zone(tx, ctx.orgId);
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid, tz);
      if (!row) throw AppError.notFound('Invoice', uuid);
      await this.assertScope(tx, scope, row);
      const rows = await this.repo.events(tx, ctx.orgId, row.id, query);
      const hasMore = rows.length > query.limit;
      const items = hasMore ? rows.slice(0, query.limit) : rows;
      const last = items[items.length - 1];
      return {
        data: items.map((e) => ({
          id: String(e.id),
          type: e.event,
          detail: e.detail,
          actor: {
            kind: e.actorKind,
            user: e.actorUuid ? { id: e.actorUuid, name: e.actorName ?? '' } : null,
          },
          meta: e.meta,
          at: e.createdAt.toISOString(),
        })),
        page: {
          nextCursor:
            hasMore && last
              ? encodeCursor({
                  createdAt: last.createdAt,
                  id: last.id,
                  createdAtIso: last.createdAtIso,
                })
              : null,
          hasMore,
          limit: query.limit,
        },
      };
    });
  }

  // --- writes ------------------------------------------------------------------------------------------------------------------

  async create(input: CreateInvoiceInput): Promise<InvoiceResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const spec = await this.specFromInput(tx, ctx.orgId, ctx.userId, input);
      const row = await this.createDraftIn(tx, ctx.orgId, ctx.userId, spec);
      return this.toResponse(tx, row);
    });
  }

  /**
   * Writes a draft inside the caller's transaction (the conversion port and the recurring runner call this too): the invoice, its
   * priced lines and tax summary, the audit row, the timeline entry and `invoice.created`.
   */
  async createDraftIn(
    tx: Tx,
    orgId: number,
    actorUserId: number | null,
    spec: DraftSpec,
  ): Promise<InvoiceRow> {
    // The plan's `invoices_monthly` allowance. Every new invoice row passes here: manual create, duplicate, order/quote conversion and the
    // recurring runner (which records a refusal as a failed run instead of throwing).
    await this.planUsage.assertCanAdd(orgId, 'invoices_monthly');
    const profile = await this.settings.load(tx, orgId);
    const priced = priceInvoice({
      currency: spec.currency,
      specs: spec.lines,
      discount: spec.discount,
      shipping: spec.shipping,
      reverseCharge: spec.reverseCharge,
    });
    const id = await this.repo.insert(tx, orgId, this.insertOf(spec, priced, actorUserId));
    await this.repo.replaceLines(tx, orgId, id, priced.lines, priced.summary);
    const tz = resolveTimezone(profile.timezone);
    const row = (await this.repo.findById(tx, orgId, id, tz))!;
    await this.audit.record(tx, {
      module: INVOICE_MODULE,
      recordId: id,
      action: 'insert',
      delta: {
        docType: { old: null, new: row.docType },
        currency: { old: null, new: row.currency },
        total: { old: null, new: minorToMajor(row.totalMinor, row.currency) },
        contact: { old: null, new: row.contactUuid },
        source: { old: null, new: row.source },
      },
    });
    await this.repo.log(tx, orgId, id, {
      event: 'created',
      actorKind: actorUserId ? 'user' : 'system',
      actorUserId,
      meta: { source: row.source },
    });
    await this.outbox.emit(tx, {
      aggregateModule: INVOICE_MODULE,
      aggregateId: id,
      eventType: 'invoice.created',
      payload: invoiceEventPayload(row),
    });
    return row;
  }

  async update(
    uuid: string,
    input: UpdateInvoiceInput,
    scope: RecordScope,
  ): Promise<InvoiceResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.lockForWrite(tx, uuid, scope);
      if (input.rowVersion !== row.rowVersion) throw AppError.rowVersionConflict('Invoice');
      if (row.storedStatus === 'void')
        throw bad(
          ERROR_CODES.INV_ALREADY_VOID,
          'A void invoice cannot be edited',
          HttpStatus.CONFLICT,
        );

      if (row.storedStatus !== 'draft') {
        const touched = FROZEN_AFTER_ISSUE.filter((k) => input[k] !== undefined);
        if (touched.length > 0) {
          throw bad(
            ERROR_CODES.INV_NOT_DRAFT,
            'An issued invoice is frozen: only its due date, notes, terms, reference, owner, links and contact details can change',
            HttpStatus.CONFLICT,
            touched.map((p) => ({ path: p, message: 'frozen after issue' })),
          );
        }
      }

      if (
        input.lines !== undefined &&
        (await this.orders.orderOfInvoice(tx, ctx.orgId, row.id)) !== null
      )
        throw bad(
          ERROR_CODES.INV_ORDER_LINKED,
          'The lines of an invoice made from a sales order are fixed: void or delete it and invoice the order again',
          HttpStatus.CONFLICT,
          [{ path: 'lines', message: 'linked to a sales order' }],
        );
      const profile = await this.settings.load(tx, ctx.orgId);
      const patch: Parameters<InvoicesRepository['update']>[4] = {};
      const delta: Record<string, { old: unknown; new: unknown }> = {};
      const set = <K extends keyof typeof patch>(
        k: K,
        v: (typeof patch)[K],
        label: string,
        old: unknown,
        next: unknown,
      ) => {
        patch[k] = v;
        delta[label] = { old, new: next };
      };

      if (input.docType !== undefined && input.docType !== row.docType)
        set('docType', input.docType, 'docType', row.docType, input.docType);
      for (const [key, col, cur] of [
        ['buyerName', 'buyerName', row.buyerName],
        ['buyerEmail', 'buyerEmail', row.buyerEmail],
        ['buyerPhone', 'buyerPhone', row.buyerPhone],
        ['buyerAddress', 'buyerAddress', row.buyerAddress],
        ['buyerTaxId', 'buyerTaxId', row.buyerTaxId],
        ['buyerCountry', 'buyerCountry', row.buyerCountry],
        ['placeOfSupply', 'placeOfSupply', row.placeOfSupply],
        ['reference', 'reference', row.reference],
        ['notes', 'notes', row.notes],
        ['terms', 'terms', row.terms],
        ['legalNotes', 'legalNotes', row.legalNotes],
      ] as const) {
        const v = input[key];
        if (v !== undefined && (v ?? null) !== cur) {
          if (key === 'buyerName' && !(v ?? '').trim())
            throw AppError.validation('An invoice needs a buyer name', [
              { path: 'buyerName', message: 'required' },
            ]);
          set(
            col,
            v ?? null,
            key,
            key === 'notes' || key === 'terms' ? cur !== null : cur,
            key === 'notes' || key === 'terms' ? v !== null : (v ?? null),
          );
        }
      }
      if (input.taxRegime !== undefined && input.taxRegime !== row.taxRegime)
        set('taxRegime', input.taxRegime, 'taxRegime', row.taxRegime, input.taxRegime);

      // owner and links
      if (input.ownerId !== undefined) {
        const owner = await this.resolveOwner(tx, ctx.orgId, input.ownerId, null);
        if (owner !== row.ownerId)
          set('ownerId', owner, 'owner', row.ownerUuid, input.ownerId ?? null);
      }
      if (
        input.contactId !== undefined ||
        input.companyId !== undefined ||
        input.dealId !== undefined
      ) {
        const links = await this.resolveLinks(tx, ctx.orgId, input, false);
        for (const [k, key, cur] of [
          ['contactId', 'contact', row.contactId],
          ['companyId', 'company', row.companyId],
          ['dealId', 'deal', row.dealId],
        ] as const) {
          if (links[k] !== undefined && links[k] !== cur) {
            set(k, links[k] ?? null, key, cur !== null, links[k] !== null);
          }
        }
      }

      // dates
      if (input.issueDate !== undefined)
        set(
          'issueDate',
          input.issueDate ?? null,
          'issueDate',
          row.issueDate,
          input.issueDate ?? null,
        );
      let due: string | null | undefined = input.dueDate;
      if (due === undefined && input.paymentTermsDays != null) {
        due = addDays(
          input.issueDate ?? row.issueDate ?? todayIn(resolveTimezone(profile.timezone)),
          input.paymentTermsDays,
        );
      }
      if (due !== undefined && (due ?? null) !== row.dueDate) {
        const issue = (patch.issueDate !== undefined ? patch.issueDate : row.issueDate) ?? null;
        if (due && issue && due < issue)
          throw AppError.validation('The due date is before the issue date', [
            { path: 'dueDate', message: 'before the issue date' },
          ]);
        set('dueDate', due ?? null, 'dueDate', row.dueDate, due ?? null);
      }

      // content: lines, currency, discount, shipping, reverse charge (draft only: the freeze check above guarantees it)
      const rowMeta = row.metaJson ?? {};
      const autoNow = (input.taxMode ?? (rowMeta.taxMode === 'auto' ? 'auto' : 'rates')) === 'auto';
      const contentTouched =
        input.lines !== undefined ||
        input.currency !== undefined ||
        input.discount !== undefined ||
        input.shipping !== undefined ||
        input.reverseCharge !== undefined ||
        input.taxMode !== undefined ||
        input.supplyType !== undefined ||
        (autoNow &&
          (input.buyerCountry !== undefined ||
            input.placeOfSupply !== undefined ||
            input.buyerTaxId !== undefined));
      let priced: PricedInvoice | null = null;
      let explanation: AutoTaxExplanation | null = null;
      if (contentTouched) {
        if (
          input.currency !== undefined &&
          input.currency !== row.currency &&
          input.lines === undefined
        )
          throw AppError.validation('Changing the currency needs the lines to be sent again', [
            { path: 'lines', message: 'required with a new currency' },
          ]);
        const currency = input.currency ?? row.currency;
        let reverseCharge = input.reverseCharge ?? row.reverseCharge;
        let lines: LineSpec[];
        if (autoNow) {
          const supplyType =
            input.supplyType ??
            (rowMeta.supplyType as 'goods' | 'services' | 'digital' | undefined) ??
            'goods';
          const auto = await this.autoOrRates(
            tx,
            ctx.orgId,
            profile,
            'auto',
            supplyType,
            input.lines ??
              ((await this.repo.lines(tx, ctx.orgId, row.id)).map((l) => ({
                description: l.description,
                sku: l.sku,
                hsnSac: l.hsnSac,
                qty: l.qty,
                unitPrice: minorToMajor(l.unitPriceMinor, row.currency),
                discount: undefined,
                taxRateId: null,
              })) as CreateInvoiceInput['lines']),
            {
              buyerCountry:
                input.buyerCountry !== undefined ? (input.buyerCountry ?? null) : row.buyerCountry,
              placeOfSupply:
                input.placeOfSupply !== undefined
                  ? (input.placeOfSupply ?? null)
                  : row.placeOfSupply,
              buyerTaxId:
                input.buyerTaxId !== undefined ? (input.buyerTaxId ?? null) : row.buyerTaxId,
              date:
                (patch.issueDate !== undefined ? patch.issueDate : row.issueDate) ??
                todayIn(resolveTimezone(profile.timezone)),
              reverseCharge,
              legalNotes:
                input.legalNotes !== undefined ? (input.legalNotes ?? null) : row.legalNotes,
            },
          );
          lines = auto.lines;
          explanation = auto.explanation;
          reverseCharge = auto.reverseCharge;
          if (auto.legalNotes !== row.legalNotes && input.legalNotes === undefined) {
            patch.legalNotes = auto.legalNotes;
            delta.legalNotes = { old: row.legalNotes !== null, new: auto.legalNotes !== null };
          }
          patch.metaJson = { ...rowMeta, taxMode: 'auto', supplyType, taxResolution: explanation };
          // an auto invoice keeps each line's own discount when only the buyer or the place changed: rebuild from the stored rows
          if (input.lines === undefined) {
            const stored = specsFromRows(
              await this.repo.lines(tx, ctx.orgId, row.id),
              row.currency,
            );
            lines = lines.map((l, i) => ({
              ...l,
              discount: stored[i]!.discount,
              sku: stored[i]!.sku,
            }));
          }
        } else if (input.lines !== undefined) {
          lines = await this.specsFromLines(tx, ctx.orgId, input.lines, profile);
          if (input.taxMode === 'rates')
            patch.metaJson = { ...rowMeta, taxMode: 'rates', taxResolution: null };
        } else {
          lines = specsFromRows(await this.repo.lines(tx, ctx.orgId, row.id), row.currency);
        }
        const discount: WireDiscount | null =
          input.discount !== undefined
            ? (input.discount ?? null)
            : row.discountKind === 'percent'
              ? { kind: 'percent', value: formatPercent(row.discountValue) }
              : row.discountKind === 'amount'
                ? { kind: 'amount', value: minorToMajor(row.discountValue, row.currency) }
                : null;
        const shipping =
          input.shipping !== undefined
            ? (input.shipping ?? null)
            : row.shippingMinor > 0n
              ? minorToMajor(row.shippingMinor, row.currency)
              : null;
        priced = priceInvoice({ currency, specs: lines, discount, shipping, reverseCharge });
        Object.assign(patch, this.totalsPatch(priced, currency));
        patch.reverseCharge = reverseCharge;
        delta.total = {
          old: minorToMajor(row.totalMinor, row.currency),
          new: minorToMajor(priced.totals.totalMinor, currency),
        };
        if (currency !== row.currency) delta.currency = { old: row.currency, new: currency };
        if (input.lines !== undefined) delta.lines = { old: null, new: input.lines.length };
      }

      if (Object.keys(patch).length === 0) return this.toResponse(tx, row);
      const ok = await this.repo.update(tx, ctx.orgId, row.id, input.rowVersion, patch);
      if (!ok) throw AppError.rowVersionConflict('Invoice');
      if (priced) await this.repo.replaceLines(tx, ctx.orgId, row.id, priced.lines, priced.summary);

      const after = (await this.repo.findById(
        tx,
        ctx.orgId,
        row.id,
        resolveTimezone(profile.timezone),
      ))!;
      await this.audit.record(tx, {
        module: INVOICE_MODULE,
        recordId: row.id,
        action: 'update',
        delta,
      });
      await this.repo.log(tx, ctx.orgId, row.id, {
        event: 'edited',
        actorKind: 'user',
        actorUserId: ctx.userId,
        meta: { changed: Object.keys(delta) },
      });
      await this.outbox.emit(tx, {
        aggregateModule: INVOICE_MODULE,
        aggregateId: row.id,
        eventType: 'invoice.updated',
        payload: { ...invoiceEventPayload(after), changed: Object.keys(delta) },
      });
      return this.toResponse(tx, after);
    });
  }

  /** Draft -> issued: due date, number, public link, frozen seller block, all in one transaction. */
  async issue(
    uuid: string,
    input: IssueInvoiceInput,
    scope: RecordScope,
  ): Promise<InvoiceResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.lockForWrite(tx, uuid, scope);
      if (input.rowVersion !== undefined && input.rowVersion !== row.rowVersion)
        throw AppError.rowVersionConflict('Invoice');
      const issued = await this.issueIn(tx, ctx.orgId, ctx.userId, row, input);
      return this.toResponse(tx, issued);
    });
  }

  async issueIn(
    tx: Tx,
    orgId: number,
    actorUserId: number | null,
    row: InvoiceRow,
    input: Pick<IssueInvoiceInput, 'issueDate' | 'dueDate' | 'paymentTermsDays'> = {},
  ): Promise<InvoiceRow> {
    if (row.storedStatus === 'void')
      throw bad(
        ERROR_CODES.INV_ALREADY_VOID,
        'A void invoice cannot be issued',
        HttpStatus.CONFLICT,
      );
    if (row.storedStatus !== 'draft')
      throw bad(ERROR_CODES.INV_NOT_DRAFT, 'The invoice is already issued', HttpStatus.CONFLICT);
    const lines = await this.repo.lines(tx, orgId, row.id);
    if (lines.length === 0)
      throw AppError.validation('An invoice needs at least one line', [
        { path: 'lines', message: 'required' },
      ]);

    const profile = await this.settings.load(tx, orgId, true);
    const tz = resolveTimezone(profile.timezone);
    const issueDate = input.issueDate ?? row.issueDate ?? todayIn(tz);
    // An explicit due date (now or on the draft) is kept; otherwise the terms count from the issue date.
    const dueDate = resolveDueDate({
      issueDate,
      dueDate: input.dueDate ?? (input.paymentTermsDays != null ? null : row.dueDate),
      termsDays: input.paymentTermsDays ?? null,
      defaultDueDays: profile.row.dueDays,
    });

    const numbering = numberingOf(profile.row);
    const series = seriesKey(row.docType, numbering, issueDate);
    // The counter row is locked until this transaction ends: two issuers cannot share a number, a rollback gives it back.
    const seq = await this.repo.allocateSeq(tx, orgId, series);
    const number = formatNumber(row.docType, numbering, issueDate, seq);
    const token = newPublicToken();
    const zero = row.totalMinor === 0n;
    await this.repo.markIssued(tx, orgId, row.id, {
      series,
      number,
      seq,
      issueDate,
      dueDate,
      tokenHash: hashPublicToken(token),
      tokenCipher: this.crypto.encrypt(token),
      sellerSnapshot: this.sellerSnapshot(profile),
      paidAtNow: zero,
    });
    const after = (await this.repo.findById(tx, orgId, row.id, tz))!;
    await this.audit.record(tx, {
      module: INVOICE_MODULE,
      recordId: row.id,
      action: 'update',
      delta: {
        status: { old: 'draft', new: 'issued' },
        number: { old: null, new: number },
        dueDate: { old: row.dueDate, new: dueDate },
      },
    });
    await this.repo.log(tx, orgId, row.id, {
      event: 'issued',
      detail: number,
      actorKind: actorUserId ? 'user' : 'system',
      actorUserId,
    });
    await this.outbox.emit(tx, {
      aggregateModule: INVOICE_MODULE,
      aggregateId: row.id,
      eventType: 'invoice.issued',
      payload: invoiceEventPayload(after),
    });
    if (zero) {
      // Nothing to collect: it is paid the moment it exists.
      await this.repo.log(tx, orgId, row.id, {
        event: 'paid',
        actorKind: 'system',
        detail: 'no balance',
      });
      await this.outbox.emit(tx, {
        aggregateModule: INVOICE_MODULE,
        aggregateId: row.id,
        eventType: 'invoice.paid',
        payload: invoiceEventPayload(after),
      });
    }
    return after;
  }

  /** Marks the invoice as sent over a channel and raises the event a delivery adapter consumes (no delivery happens here). */
  async send(uuid: string, input: SendInvoiceInput, scope: RecordScope): Promise<InvoiceResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.lockForWrite(tx, uuid, scope);
      if (row.storedStatus !== 'issued')
        throw bad(
          ERROR_CODES.INV_NOT_ISSUED,
          'Only an issued invoice can be sent',
          HttpStatus.CONFLICT,
        );
      if (input.channel === 'email' && !row.buyerEmail)
        throw bad(
          ERROR_CODES.INV_NO_RECIPIENT,
          'The invoice has no buyer email',
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'buyerEmail', message: 'required to send by email' }],
        );
      if (input.channel === 'whatsapp' && !row.buyerPhone)
        throw bad(
          ERROR_CODES.INV_NO_RECIPIENT,
          'The invoice has no buyer phone',
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'buyerPhone', message: 'required to send on WhatsApp' }],
        );
      await this.repo.markSent(tx, ctx.orgId, row.id, input.channel);
      const after = (await this.repo.findById(
        tx,
        ctx.orgId,
        row.id,
        await this.zone(tx, ctx.orgId),
      ))!;
      await this.audit.record(tx, {
        module: INVOICE_MODULE,
        recordId: row.id,
        action: 'update',
        delta: { sentVia: { old: row.deliveryChannel, new: input.channel } },
      });
      await this.repo.log(tx, ctx.orgId, row.id, {
        event: 'sent',
        detail: input.channel,
        actorKind: 'user',
        actorUserId: ctx.userId,
      });
      // The event carries ids and the channel only. A delivery consumer reads the link through the service; the token never sits in the outbox.
      await this.outbox.emit(tx, {
        aggregateModule: INVOICE_MODULE,
        aggregateId: row.id,
        eventType: 'invoice.sent',
        payload: {
          ...invoiceEventPayload(after),
          channel: input.channel,
          message: input.message ?? null,
        },
      });
      return this.toResponse(tx, after);
    });
  }

  async void(uuid: string, input: VoidInvoiceInput, scope: RecordScope): Promise<InvoiceResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.lockForWrite(tx, uuid, scope);
      if (input.rowVersion !== undefined && input.rowVersion !== row.rowVersion)
        throw AppError.rowVersionConflict('Invoice');
      if (row.storedStatus === 'void')
        throw bad(ERROR_CODES.INV_ALREADY_VOID, 'The invoice is already void', HttpStatus.CONFLICT);
      if (row.storedStatus === 'draft')
        throw bad(
          ERROR_CODES.INV_NOT_ISSUED,
          'A draft is deleted, not voided',
          HttpStatus.CONFLICT,
        );
      if (row.paidMinor > 0n)
        throw bad(
          ERROR_CODES.INV_HAS_PAYMENTS,
          'The invoice has received payments: refund them before voiding it',
          HttpStatus.CONFLICT,
          [{ path: 'paid', message: minorToMajor(row.paidMinor, row.currency) }],
        );
      if (row.creditedMinor > 0n)
        throw bad(
          ERROR_CODES.INV_HAS_CREDITS,
          'The invoice has credit notes: void them before voiding the invoice',
          HttpStatus.CONFLICT,
          [{ path: 'credited', message: minorToMajor(row.creditedMinor, row.currency) }],
        );
      await this.repo.markVoid(tx, ctx.orgId, row.id, ctx.userId, input.reason);
      await this.releaseOrder(tx, ctx.orgId, row.id);
      await this.repo.expireAttempts(tx, ctx.orgId, row.id);
      const after = (await this.repo.findById(
        tx,
        ctx.orgId,
        row.id,
        await this.zone(tx, ctx.orgId),
      ))!;
      await this.audit.record(tx, {
        module: INVOICE_MODULE,
        recordId: row.id,
        action: 'update',
        delta: {
          status: { old: row.storedStatus, new: 'void' },
          voidReason: { old: null, new: input.reason },
        },
      });
      await this.repo.log(tx, ctx.orgId, row.id, {
        event: 'voided',
        detail: input.reason,
        actorKind: 'user',
        actorUserId: ctx.userId,
      });
      await this.outbox.emit(tx, {
        aggregateModule: INVOICE_MODULE,
        aggregateId: row.id,
        eventType: 'invoice.voided',
        payload: { ...invoiceEventPayload(after), reason: input.reason },
      });
      return this.toResponse(tx, after);
    });
  }

  async remove(uuid: string, scope: RecordScope): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const row = await this.lockForWrite(tx, uuid, scope);
      if (row.storedStatus !== 'draft')
        throw bad(
          ERROR_CODES.INV_NOT_DELETABLE,
          'Only a draft is deleted: an issued invoice keeps its number and is voided instead',
          HttpStatus.CONFLICT,
        );
      await this.audit.record(tx, {
        module: INVOICE_MODULE,
        recordId: row.id,
        action: 'delete',
        delta: {
          total: { old: minorToMajor(row.totalMinor, row.currency), new: null },
          buyer: { old: row.buyerName, new: null },
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: INVOICE_MODULE,
        aggregateId: row.id,
        eventType: 'invoice.deleted',
        payload: invoiceEventPayload(row),
      });
      await this.releaseOrder(tx, ctx.orgId, row.id);
      await this.repo.deleteDraft(tx, ctx.orgId, row.id);
    });
  }

  /** An invoice made from a sales order gives its billed quantities back when it is voided or deleted. */
  private async releaseOrder(tx: Tx, orgId: number, invoiceId: number): Promise<void> {
    const { orderId } = await this.orders.releaseInvoice(tx, orgId, invoiceId);
    if (orderId !== null) await this.orders.syncStatus(tx, orgId, orderId);
  }

  /** A new draft with the same buyer and lines (repriced from the stored snapshots); no number, no dates, no quote or order link. */
  async duplicate(uuid: string, scope: RecordScope): Promise<InvoiceResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid, await this.zone(tx, ctx.orgId));
      if (!row) throw AppError.notFound('Invoice', uuid);
      await this.assertScope(tx, scope, row);
      const specs = specsFromRows(await this.repo.lines(tx, ctx.orgId, row.id), row.currency);
      const copy = await this.createDraftIn(tx, ctx.orgId, ctx.userId, {
        source: 'manual',
        docType: row.docType,
        currency: row.currency,
        buyer: {
          name: row.buyerName,
          email: row.buyerEmail,
          phone: row.buyerPhone,
          address: row.buyerAddress,
          taxId: row.buyerTaxId,
          country: row.buyerCountry,
        },
        contactId: row.contactId,
        companyId: row.companyId,
        dealId: row.dealId,
        quoteId: null,
        ownerId: ctx.userId,
        taxRegime: row.taxRegime,
        placeOfSupply: row.placeOfSupply,
        reverseCharge: row.reverseCharge,
        issueDate: null,
        dueDate: null,
        reference: row.reference,
        notes: row.notes,
        terms: row.terms,
        legalNotes: row.legalNotes,
        discount:
          row.discountKind === 'percent'
            ? { kind: 'percent', value: formatPercent(row.discountValue) }
            : row.discountKind === 'amount'
              ? { kind: 'amount', value: minorToMajor(row.discountValue, row.currency) }
              : null,
        shipping: row.shippingMinor > 0n ? minorToMajor(row.shippingMinor, row.currency) : null,
        lines: specs,
        metaJson: { duplicatedFrom: row.uuid },
      });
      return this.toResponse(tx, copy);
    });
  }

  /** A new public link; the old one stops working at once. */
  async regenerateLink(
    uuid: string,
    input: PublicLinkInput,
    scope: RecordScope,
  ): Promise<InvoiceResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.lockForWrite(tx, uuid, scope);
      if (row.storedStatus === 'draft')
        throw bad(
          ERROR_CODES.INV_NOT_ISSUED,
          'A draft has no public link until it is issued',
          HttpStatus.CONFLICT,
        );
      const token = newPublicToken();
      await this.repo.setLink(tx, ctx.orgId, row.id, {
        hash: hashPublicToken(token),
        cipher: this.crypto.encrypt(token),
        expiresAt: input.expiresInDays
          ? new Date(Date.now() + input.expiresInDays * 86_400_000)
          : null,
      });
      await this.audit.record(tx, {
        module: INVOICE_MODULE,
        recordId: row.id,
        action: 'update',
        delta: { publicLink: { old: 'active', new: 'regenerated' } },
      });
      await this.repo.log(tx, ctx.orgId, row.id, {
        event: 'link_regenerated',
        actorKind: 'user',
        actorUserId: ctx.userId,
      });
      return this.toResponse(
        tx,
        (await this.repo.findById(tx, ctx.orgId, row.id, await this.zone(tx, ctx.orgId)))!,
      );
    });
  }

  async revokeLink(uuid: string, scope: RecordScope): Promise<InvoiceResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.lockForWrite(tx, uuid, scope);
      if (row.storedStatus === 'draft')
        throw bad(
          ERROR_CODES.INV_NOT_ISSUED,
          'A draft has no public link until it is issued',
          HttpStatus.CONFLICT,
        );
      await this.repo.setLink(tx, ctx.orgId, row.id, { revoke: true });
      await this.audit.record(tx, {
        module: INVOICE_MODULE,
        recordId: row.id,
        action: 'update',
        delta: { publicLink: { old: 'active', new: 'revoked' } },
      });
      await this.repo.log(tx, ctx.orgId, row.id, {
        event: 'link_revoked',
        actorKind: 'user',
        actorUserId: ctx.userId,
      });
      return this.toResponse(
        tx,
        (await this.repo.findById(tx, ctx.orgId, row.id, await this.zone(tx, ctx.orgId)))!,
      );
    });
  }

  // --- building a draft ---------------------------------------------------------------------------------------------------------

  async specFromInput(
    tx: Tx,
    orgId: number,
    actorUserId: number | null,
    input: CreateInvoiceInput,
    extra: Partial<Pick<DraftSpec, 'source' | 'quoteId' | 'metaJson'>> = {},
  ): Promise<DraftSpec> {
    const profile = await this.settings.load(tx, orgId);
    const links = await this.resolveLinks(tx, orgId, input, true);
    const contact = links.contactId
      ? await this.repo.resolveContactById(tx, orgId, links.contactId)
      : null;
    const buyerName = (input.buyerName ?? contact?.name ?? '').trim();
    if (!buyerName)
      throw AppError.validation('An invoice needs a buyer: give a name or link a contact', [
        { path: 'buyerName', message: 'required' },
      ]);
    const tz = resolveTimezone(profile.timezone);
    const issueDate = input.issueDate ?? null;
    let dueDate = input.dueDate ?? null;
    if (!dueDate && input.paymentTermsDays != null)
      dueDate = addDays(issueDate ?? todayIn(tz), input.paymentTermsDays);
    if (dueDate && issueDate && dueDate < issueDate)
      throw AppError.validation('The due date is before the issue date', [
        { path: 'dueDate', message: 'before the issue date' },
      ]);
    return {
      source: extra.source ?? 'manual',
      docType: input.docType ?? 'tax_invoice',
      currency: input.currency ?? profile.currency,
      buyer: {
        name: buyerName,
        email: input.buyerEmail ?? contact?.email ?? null,
        phone: input.buyerPhone ?? contact?.phone ?? null,
        address: input.buyerAddress ?? null,
        taxId: input.buyerTaxId ?? null,
        country: input.buyerCountry ?? null,
      },
      contactId: links.contactId ?? null,
      companyId: links.companyId ?? null,
      dealId: links.dealId ?? null,
      quoteId: extra.quoteId ?? null,
      ownerId: await this.resolveOwner(tx, orgId, input.ownerId, actorUserId),
      taxRegime: input.taxRegime ?? profile.row.defaultTaxRegime,
      placeOfSupply: input.placeOfSupply ?? null,
      issueDate,
      dueDate,
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      terms: input.terms ?? profile.row.terms,
      discount: input.discount ?? null,
      shipping: input.shipping ?? null,
      ...(await this.autoOrRates(
        tx,
        orgId,
        profile,
        input.taxMode ?? 'rates',
        input.supplyType ?? 'goods',
        input.lines,
        {
          buyerCountry: input.buyerCountry ?? null,
          placeOfSupply: input.placeOfSupply ?? null,
          buyerTaxId: input.buyerTaxId ?? null,
          date: issueDate ?? todayIn(tz),
          reverseCharge: input.reverseCharge ?? false,
          legalNotes: input.legalNotes ?? null,
        },
      )),
      metaJson: extra.metaJson ?? null,
    };
  }

  /**
   * Prices the lines under `rates` (each line names its tax rate, or takes the workspace default) or `auto` (the tax engine decides
   * from the profile's country and the buyer: see invoice-auto-tax.ts). Returns the line specs and, for `auto`, the explanation,
   * the reverse-charge decision and the wording the document must print.
   */
  async autoOrRates(
    tx: Tx,
    orgId: number,
    profile: LoadedProfile,
    mode: 'rates' | 'auto',
    supplyType: 'goods' | 'services' | 'digital',
    lines: CreateInvoiceInput['lines'],
    ctx: {
      buyerCountry: string | null;
      placeOfSupply: string | null;
      buyerTaxId: string | null;
      date: string;
      reverseCharge: boolean;
      legalNotes: string | null;
    },
  ): Promise<{
    lines: LineSpec[];
    taxMode: 'rates' | 'auto';
    explanation: AutoTaxExplanation | null;
    supplyType: typeof supplyType;
    reverseCharge: boolean;
    legalNotes: string | null;
  }> {
    const rateSpecs = await this.specsFromLines(tx, orgId, lines, profile);
    if (mode !== 'auto') {
      return {
        lines: rateSpecs,
        taxMode: 'rates',
        explanation: null,
        supplyType,
        reverseCharge: ctx.reverseCharge,
        legalNotes: ctx.legalNotes,
      };
    }
    const { specs, explanation } = resolveAutoTax(
      {
        sellerCountry: profile.row.sellerCountry,
        sellerState: profile.row.sellerState,
        sellerTaxId: profile.row.sellerTaxId,
        buyerCountry: ctx.buyerCountry,
        placeOfSupply: ctx.placeOfSupply,
        buyerTaxId: ctx.buyerTaxId,
        supplyType,
        date: ctx.date,
      },
      rateSpecs.map((l, i) => ({
        hsnSac: l.hsnSac,
        // an explicit slab on the line (its tax rate id) is honoured as the line's rate
        ratePercent: lines[i]!.taxRateId
          ? l.tax?.items.length === 1
            ? l.tax.items[0]!.ratePercent
            : null
          : null,
      })),
    );
    const notes = explanation.documentNotes.join('\n');
    return {
      lines: rateSpecs.map((l, i) => ({ ...l, tax: specs[i] ?? null })),
      taxMode: 'auto',
      explanation,
      supplyType,
      reverseCharge: ctx.reverseCharge || explanation.reverseCharge,
      legalNotes: ctx.legalNotes ?? (notes || null),
    };
  }

  /**
   * Resolves each line's tax rate: ABSENT is the workspace default (none when there is none), `null` is no tax, a uuid is that rate
   * (404 when it is not in the workspace, 422 when it is inactive or outside its effective window).
   */
  async specsFromLines(
    tx: Tx,
    orgId: number,
    lines: CreateInvoiceInput['lines'],
    profile: LoadedProfile,
  ): Promise<LineSpec[]> {
    const today = todayIn(resolveTimezone(profile.timezone));
    let defaultRate: TaxRateRow | undefined;
    let defaultLoaded = false;
    const cache = new Map<string, TaxRateRow>();
    const out: LineSpec[] = [];
    for (const [i, l] of lines.entries()) {
      let rate: TaxRateRow | undefined;
      if (l.taxRateId === undefined) {
        if (!defaultLoaded) {
          defaultRate = await this.taxRates.findDefault(tx, orgId);
          defaultLoaded = true;
        }
        rate = defaultRate;
      } else if (l.taxRateId !== null) {
        rate = cache.get(l.taxRateId);
        if (!rate) {
          rate = await this.taxRates.findByUuid(tx, orgId, l.taxRateId);
          if (!rate) throw AppError.notFound('Tax rate', l.taxRateId);
          cache.set(l.taxRateId, rate);
        }
        const inWindow =
          rate.isActive &&
          (!rate.effectiveFrom || rate.effectiveFrom <= today) &&
          (!rate.effectiveTo || rate.effectiveTo >= today);
        if (!inWindow)
          throw bad(
            ERROR_CODES.INV_TAX_RATE_INVALID,
            `The tax rate "${rate.name}" cannot be used today`,
            HttpStatus.UNPROCESSABLE_ENTITY,
            [{ path: `lines.${i}.taxRateId`, message: 'inactive or outside its effective dates' }],
          );
      }
      const tax: TaxSpec | null = rate ? taxSpecOfRate(rate) : null;
      out.push({
        description: l.description,
        sku: l.sku ?? null,
        hsnSac: l.hsnSac ?? rate?.defaultHsnSac ?? null,
        qty: l.qty,
        unitPrice: l.unitPrice,
        discount: l.discount ?? null,
        tax,
      });
    }
    return out;
  }

  private insertOf(
    spec: DraftSpec,
    priced: PricedInvoice,
    actorUserId: number | null,
  ): InvoiceInsert {
    const t = priced.totals;
    const meta: Record<string, unknown> = { ...(spec.metaJson ?? {}) };
    if (spec.taxMode === 'auto') {
      meta.taxMode = 'auto';
      meta.supplyType = spec.supplyType ?? 'goods';
      if (spec.explanation) meta.taxResolution = spec.explanation;
    }
    return {
      userId: actorUserId,
      ownerId: spec.ownerId,
      source: spec.source,
      docType: spec.docType,
      currency: t.currency,
      currencyExponent: currencyExponent(t.currency),
      subtotalMinor: t.subtotalMinor,
      discountMinor: t.discountMinor,
      shippingMinor: t.shippingMinor,
      taxMinor: t.taxMinor,
      taxAddedMinor: t.taxAddedMinor,
      totalMinor: t.totalMinor,
      taxInclusive: t.taxInclusive,
      discountKind: t.discountKind,
      discountValue: t.discountValue,
      buyerName: spec.buyer.name,
      buyerEmail: spec.buyer.email,
      buyerPhone: spec.buyer.phone,
      buyerAddress: spec.buyer.address,
      buyerTaxId: spec.buyer.taxId,
      buyerCountry: spec.buyer.country,
      taxRegime: spec.taxRegime,
      placeOfSupply: spec.placeOfSupply,
      reverseCharge: spec.reverseCharge,
      legalNotes: spec.legalNotes,
      contactId: spec.contactId,
      companyId: spec.companyId,
      dealId: spec.dealId,
      quoteId: spec.quoteId,
      reference: spec.reference,
      notes: spec.notes,
      terms: spec.terms,
      issueDate: spec.issueDate,
      dueDate: spec.dueDate,
      metaJson: Object.keys(meta).length > 0 ? meta : null,
    };
  }

  private totalsPatch(priced: PricedInvoice, currency: string) {
    const t = priced.totals;
    return {
      currency,
      currencyExponent: currencyExponent(currency),
      subtotalMinor: t.subtotalMinor,
      discountMinor: t.discountMinor,
      shippingMinor: t.shippingMinor,
      taxMinor: t.taxMinor,
      taxAddedMinor: t.taxAddedMinor,
      totalMinor: t.totalMinor,
      taxInclusive: t.taxInclusive,
      discountKind: t.discountKind,
      discountValue: t.discountValue,
    };
  }

  // --- references ---------------------------------------------------------------------------------------------------------------

  /** `undefined` -> the caller (when `fallback` is given); `null` -> nobody; a uuid -> an ACTIVE member (422 otherwise). */
  async resolveOwner(
    tx: Tx,
    orgId: number,
    ownerUuid: string | null | undefined,
    fallback: number | null,
  ): Promise<number | null> {
    if (ownerUuid === undefined) return fallback;
    if (ownerUuid === null) return null;
    const u = await this.repo.resolveActiveUser(tx, orgId, ownerUuid);
    if (!u)
      throw bad(
        ERROR_CODES.INV_OWNER_INVALID,
        'The owner is not an active member of this workspace',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'ownerId', message: 'not an active member' }],
      );
    return u.id;
  }

  /**
   * The contact, company and deal of an invoice, as internal ids. A record that is not in the workspace is 404. On create, a deal
   * brings its contact and company unless they are named, and a contact brings its company.
   */
  async resolveLinks(
    tx: Tx,
    orgId: number,
    input: { contactId?: string | null; companyId?: string | null; dealId?: string | null },
    fillFromParents: boolean,
  ): Promise<{ contactId?: number | null; companyId?: number | null; dealId?: number | null }> {
    const out: { contactId?: number | null; companyId?: number | null; dealId?: number | null } =
      {};
    let dealContact: number | null = null;
    let dealCompany: number | null = null;
    if (input.dealId !== undefined) {
      if (input.dealId === null) out.dealId = null;
      else {
        const d = await this.repo.resolveDeal(tx, orgId, input.dealId);
        if (!d) throw AppError.notFound('Deal', input.dealId);
        out.dealId = d.id;
        dealContact = d.contactId;
        dealCompany = d.companyId;
      }
    }
    let contactCompany: number | null = null;
    if (input.contactId !== undefined) {
      if (input.contactId === null) out.contactId = null;
      else {
        const c = await this.repo.resolveContact(tx, orgId, input.contactId);
        if (!c) throw AppError.notFound('Contact', input.contactId);
        out.contactId = c.id;
        contactCompany = c.companyId;
      }
    }
    if (input.companyId !== undefined) {
      if (input.companyId === null) out.companyId = null;
      else {
        const co = await this.repo.resolveCompany(tx, orgId, input.companyId);
        if (!co) throw AppError.notFound('Company', input.companyId);
        out.companyId = co.id;
      }
    }
    if (fillFromParents) {
      if (out.contactId === undefined && dealContact !== null) out.contactId = dealContact;
      if (out.companyId === undefined) {
        const c = dealCompany ?? contactCompany;
        if (c !== null) out.companyId = c;
      }
    }
    return out;
  }

  // --- helpers ------------------------------------------------------------------------------------------------------------------

  private sellerSnapshot(p: LoadedProfile): Record<string, unknown> {
    const r = p.row;
    // The branding and the wording are frozen with the seller block, so a later change of logo or footer never alters what a
    // buyer was shown (Reference read them live when the PDF was first rendered).
    return {
      name: r.sellerName ?? p.orgName,
      address: r.sellerAddress,
      country: r.sellerCountry,
      state: r.sellerState,
      taxId: r.sellerTaxId,
      registrationNo: r.sellerRegNo,
      phone: r.sellerPhone,
      email: r.supportEmail,
      extra: r.sellerExtra,
      bankDetails: r.bankDetails,
      paymentInstructions: r.paymentInstructions,
      logoUrl: r.logoPath,
      brandColor: r.brandColor,
      footerNote: r.footerNote,
      invoiceTitle: r.invoiceTitle,
    };
  }

  private async linked(
    tx: Tx,
    link: { contactId?: number; contactUuid?: string; dealId?: number; dealUuid?: string },
    query: LinkedInvoicesQuery,
    scope: RecordScope,
  ): Promise<LinkedInvoicesResponse> {
    const ctx = RequestContextStore.require();
    const tz = await this.zone(tx, ctx.orgId);
    const rows = await this.repo.list(
      tx,
      ctx.orgId,
      ctx.userId,
      {
        limit: query.limit,
        cursor: query.cursor,
        order: 'desc',
        status: query.status,
        contactId: link.contactUuid,
        dealId: link.dealUuid,
      },
      invoiceScopeCondition(ctx.orgId, scope, ctx.userId),
      tz,
      // Drafts are not money yet: the rollup counts issued invoices; the list still shows drafts to the people who may see them.
    );
    const page = buildPage(rows, query.limit);
    const roll = await this.repo.rollup(tx, ctx.orgId, link, tz);
    const pick = (f: 'invoiced' | 'paid' | 'outstanding' | 'overdue') =>
      roll
        .filter((r) => r[f] > 0n)
        .map((r) => ({ currency: r.currency, amount: minorToMajor(r[f], r.currency) }));
    return {
      data: page.items.map(toInvoiceSummary),
      page: page.page,
      totals: {
        invoiced: pick('invoiced'),
        paid: pick('paid'),
        outstanding: pick('outstanding'),
        overdue: pick('overdue'),
      },
    };
  }

  private async toResponse(tx: Tx, row: InvoiceRow): Promise<InvoiceResponse> {
    const ctx = RequestContextStore.require();
    const [lines, summary] = await Promise.all([
      this.repo.lines(tx, ctx.orgId, row.id),
      this.repo.taxSummary(tx, ctx.orgId, row.id),
    ]);
    return toInvoiceResponse(row, lines, summary, this.readToken(row));
  }

  /** The link's token for staff (decrypted); a value this process cannot read yields no link rather than a failed list. */
  readToken(row: InvoiceRow): string | null {
    if (!row.publicTokenCipher) return null;
    try {
      return this.crypto.decrypt(row.publicTokenCipher);
    } catch (err) {
      this.logger.warn({ err, invoice: row.uuid }, 'could not decrypt the public link');
      return null;
    }
  }

  async lockForWrite(tx: Tx, uuid: string, scope: RecordScope): Promise<InvoiceRow> {
    const ctx = RequestContextStore.require();
    const row = await this.repo.findByUuid(
      tx,
      ctx.orgId,
      uuid,
      await this.zone(tx, ctx.orgId),
      true,
    );
    if (!row) throw AppError.notFound('Invoice', uuid);
    await this.assertScope(tx, scope, row);
    return row;
  }

  /** Not-found, never forbidden: an invoice outside the caller's scope is not revealed to exist. */
  async assertScope(tx: Tx, scope: RecordScope, row: InvoiceRow): Promise<void> {
    const ctx = RequestContextStore.require();
    if (scope === 'all') return;
    const actor = ctx.userId;
    if (!actor) throw AppError.notFound('Invoice');
    if (row.ownerId === actor || row.createdById === actor) return;
    if (scope === 'team') {
      for (const other of [row.ownerId, row.createdById]) {
        if (other !== null && (await this.repo.isInActorTeam(tx, ctx.orgId, actor, other))) return;
      }
    }
    throw AppError.notFound('Invoice');
  }

  async zone(tx: Tx, orgId: number): Promise<string> {
    return resolveTimezone((await this.repo.orgSettings(tx, orgId)).timezone);
  }
}
