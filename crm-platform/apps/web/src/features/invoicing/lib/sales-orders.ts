import {
  formatQty,
  minorToMajor,
  parseMajor,
  parseQty,
  type CreateSalesOrderInput,
  type FulfilOrderInput,
  type FulfilmentStatus,
  type InvoiceFromOrderInput,
  type InvoicingStatus,
  type SalesOrderCounts,
  type SalesOrderResponse,
  type SalesOrderStatus,
  type TaxRateResponse,
  type UpdateSalesOrderInput,
} from '@crm/contracts';
import {
  TAX_NONE,
  TAX_SNAPSHOT,
  decimalOf,
  emptyLine,
  isBlankLine,
  lineProblems,
  lineTaxOf,
  linesToInput,
  newKey,
  type DraftLine,
} from './builder';
import { isDay } from './dates';
import { priceInvoice, type PricingResult } from './totals';

/**
 * Sales orders on the client: the list's tabs and filters, quantity math, what a row offers, the form behind the builder and the
 * payloads it sends. Quantities are bigint x 10^4 (the API keeps four decimals); no float ever touches a quantity or an amount.
 */

// --- list: tabs, quick filters, query ------------------------------------------------------------------------------------------

export const SO_TABS = ['all', 'draft', 'confirmed', 'cancelled', 'closed'] as const;
export type SalesOrderTab = (typeof SO_TABS)[number];

/** "To invoice" (confirmed, something still unbilled) and "To fulfil" (confirmed, something still undelivered). */
export const SO_QUICK = ['', 'toInvoice', 'toFulfil'] as const;
export type SalesOrderQuick = (typeof SO_QUICK)[number];

export interface SalesOrderFilters {
  tab: SalesOrderTab;
  quick: SalesOrderQuick;
  q: string;
  contactId: string;
}

export const DEFAULT_SO_FILTERS: SalesOrderFilters = { tab: 'all', quick: '', q: '', contactId: '' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseSalesOrderFilters(search: { get(name: string): string | null }): SalesOrderFilters {
  const tab = search.get('tab') ?? '';
  const quick = search.get('quick') ?? '';
  const contact = search.get('contact') ?? '';
  return {
    tab: (SO_TABS as readonly string[]).includes(tab) ? (tab as SalesOrderTab) : 'all',
    quick: (SO_QUICK as readonly string[]).includes(quick) ? (quick as SalesOrderQuick) : '',
    q: (search.get('q') ?? '').slice(0, 100),
    contactId: UUID.test(contact) ? contact : '',
  };
}

/** The address query for a set of filters (defaults are left out). */
export function salesOrderFiltersToSearch(f: SalesOrderFilters): string {
  const p = new URLSearchParams();
  if (f.tab !== 'all') p.set('tab', f.tab);
  if (f.quick) p.set('quick', f.quick);
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.contactId) p.set('contact', f.contactId);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const hasActiveSalesOrderFilter = (f: SalesOrderFilters): boolean => !!(f.q.trim() || f.quick || f.contactId);

/**
 * The `GET /sales-orders` query. A quick filter means "a confirmed order with something left", so it pins the status to
 * `confirmed` (the same rule the counts use) whatever the tab says: the two never disagree about what "To invoice" counts.
 */
export function salesOrderListQuery(f: SalesOrderFilters): Record<string, string | undefined> {
  const query: Record<string, string | undefined> = {
    q: f.q.trim() || undefined,
    contactId: f.contactId || undefined,
  };
  if (f.quick) {
    query.status = 'confirmed';
    if (f.quick === 'toInvoice') query.invoicingStatus = 'not_invoiced,partially_invoiced';
    else query.fulfilmentStatus = 'unfulfilled,partially_fulfilled';
  } else if (f.tab !== 'all') query.status = f.tab;
  return query;
}

/** The count a tab (or quick filter) shows, from `GET /sales-orders/counts`. */
export function salesOrderTabCount(counts: SalesOrderCounts | undefined, tab: SalesOrderTab | 'toInvoice' | 'toFulfil'): number | undefined {
  return counts ? counts[tab] : undefined;
}

// --- quantities ------------------------------------------------------------------------------------------------------------------

export const QTY_SCALE = 10_000n;

/** A quantity string ("4", "1.5") as scaled bigint; 0 for anything unreadable. */
export const qtyOf = (s: string | null | undefined): bigint => (s ? (parseQty(s) ?? 0n) : 0n);
/** A scaled quantity for display: "4", "1.5". */
export const qtyText = (scaled: bigint): string => formatQty(scaled);

/** Whole percent (0..100) of `done` out of `total`, rounded DOWN so a bar never claims "done" before it is. */
export function progressPercent(done: bigint, total: bigint): number {
  if (total <= 0n || done <= 0n) return 0;
  if (done >= total) return 100;
  return Number((done * 100n) / total);
}

export interface LineFacts {
  ordered: bigint;
  invoiced: bigint;
  fulfilled: bigint;
  /** Ordered and not yet billed. */
  toInvoice: bigint;
  /** Ordered and not yet delivered. */
  toFulfil: bigint;
  invoicedPct: number;
  fulfilledPct: number;
}

type QtyLine = Pick<SalesOrderResponse['lines'][number], 'qty' | 'qtyInvoiced' | 'qtyFulfilled'>;

const nonNeg = (n: bigint): bigint => (n > 0n ? n : 0n);

export function lineFacts(line: QtyLine): LineFacts {
  const ordered = qtyOf(line.qty);
  const invoiced = qtyOf(line.qtyInvoiced);
  const fulfilled = qtyOf(line.qtyFulfilled);
  return {
    ordered,
    invoiced,
    fulfilled,
    toInvoice: nonNeg(ordered - invoiced),
    toFulfil: nonNeg(ordered - fulfilled),
    invoicedPct: progressPercent(invoiced, ordered),
    fulfilledPct: progressPercent(fulfilled, ordered),
  };
}

/** All lines together (quantities of different items add up: it is a progress figure, not a quantity of anything). */
export function orderFacts(lines: readonly QtyLine[]): LineFacts {
  const sum = lines.map(lineFacts).reduce(
    (a, l) => ({ ordered: a.ordered + l.ordered, invoiced: a.invoiced + l.invoiced, fulfilled: a.fulfilled + l.fulfilled }),
    { ordered: 0n, invoiced: 0n, fulfilled: 0n },
  );
  return {
    ...sum,
    toInvoice: nonNeg(sum.ordered - sum.invoiced),
    toFulfil: nonNeg(sum.ordered - sum.fulfilled),
    invoicedPct: progressPercent(sum.invoiced, sum.ordered),
    fulfilledPct: progressPercent(sum.fulfilled, sum.ordered),
  };
}

export type QtyCheck =
  | { ok: true; scaled: bigint; qty: string }
  | { ok: false; reason: 'invalid' | 'exceeds' };

/**
 * A quantity typed against what is left. Empty and 0 mean "none of this line" (scaled 0): the line is left out of the request.
 * More than `max`, or more than four decimals, is refused (the server refuses the same with SO_QUANTITY_EXCEEDS).
 */
export function checkQty(text: string, max: bigint): QtyCheck {
  const s = text.trim().replace(',', '.');
  if (s === '') return { ok: true, scaled: 0n, qty: '0' };
  const q = parseQty(s);
  if (q === null) return { ok: false, reason: 'invalid' };
  if (q > max) return { ok: false, reason: 'exceeds' };
  return { ok: true, scaled: q, qty: formatQty(q) };
}

// --- what a row offers -----------------------------------------------------------------------------------------------------------

export type SalesOrderAction = 'open' | 'edit' | 'confirm' | 'invoice' | 'fulfil' | 'cancel' | 'delete';

export interface SalesOrderCan {
  updateSalesOrder: boolean;
  invoiceSalesOrder: boolean;
  deleteSalesOrder: boolean;
}

interface OrderStateFacts {
  status: SalesOrderStatus;
  invoicingStatus: InvoicingStatus;
  fulfilmentStatus: FulfilmentStatus;
}

/**
 * What an order offers. A draft is edited, confirmed or deleted; a confirmed one is invoiced and delivered while something is
 * left, and cancelled while no live invoice stands (the server says so with SO_HAS_INVOICES); cancelled and closed are final.
 */
export function salesOrderActions(o: OrderStateFacts, can: SalesOrderCan): Set<SalesOrderAction> {
  const out = new Set<SalesOrderAction>(['open']);
  if (o.status === 'draft') {
    if (can.updateSalesOrder) {
      out.add('edit');
      out.add('confirm');
    }
    if (can.deleteSalesOrder) out.add('delete');
  }
  if (o.status === 'confirmed') {
    if (can.invoiceSalesOrder && o.invoicingStatus !== 'invoiced') out.add('invoice');
    if (can.updateSalesOrder) {
      if (o.fulfilmentStatus !== 'fulfilled') out.add('fulfil');
      out.add('cancel');
    }
  }
  return out;
}

export type ChipTone = 'neutral' | 'info' | 'warning' | 'success' | 'danger';

export const orderStatusTone = (s: SalesOrderStatus): ChipTone =>
  s === 'draft' ? 'neutral' : s === 'confirmed' ? 'info' : s === 'closed' ? 'success' : 'danger';
export const invoicingTone = (s: InvoicingStatus): ChipTone =>
  s === 'invoiced' ? 'success' : s === 'partially_invoiced' ? 'warning' : 'neutral';
export const fulfilmentTone = (s: FulfilmentStatus): ChipTone =>
  s === 'fulfilled' ? 'success' : s === 'partially_fulfilled' ? 'warning' : 'neutral';

/** A linked invoice's status as the order sends it (`draft`, `void`, or its payment state) as an invoice status chip value. */
export function linkedInvoiceStatus(s: string): 'draft' | 'issued' | 'partially_paid' | 'paid' | 'void' {
  if (s === 'draft' || s === 'void' || s === 'paid' || s === 'partially_paid') return s;
  return 'issued';
}

/** Where the person goes after an invoice was made from the order: an issued one opens, a draft opens for editing. */
export const invoiceTarget = (invoice: { id: string; status: string }): string =>
  invoice.status === 'draft' ? `/invoices/${invoice.id}/edit` : `/invoices/${invoice.id}`;

/** An order's quote lives with proposals or estimates; its number says which (`EST-0001`). The page can refine it by asking. */
export const quoteHrefGuess = (quote: { id: string; number: string }): string =>
  `${/^EST/i.test(quote.number) ? '/estimates' : '/proposals'}/${quote.id}`;

/** The page of the offer an order or invoice came from: its `kind` says proposal or estimate (the number is only a fallback guess). */
export const quoteHref = (quote: { id: string; number: string; kind?: 'proposal' | 'estimate' }): string =>
  quote.kind ? `${quote.kind === 'estimate' ? '/estimates' : '/proposals'}/${quote.id}` : quoteHrefGuess(quote);

// --- invoice and delivery payloads -----------------------------------------------------------------------------------------------

export type QtyMode = 'all' | 'lines';

export interface InvoiceForm {
  mode: QtyMode;
  /** Typed quantity by line id (a line missing here defaults to everything left). */
  qty: Record<string, string>;
  issueDate: string;
  dueDate: string;
  /** Payment terms in days as text, `''` = leave it to the workspace default. */
  termsDays: string;
  issue: boolean;
  includeShipping: boolean;
}

export const emptyInvoiceForm = (shippingPending: boolean): InvoiceForm => ({
  mode: 'all',
  qty: {},
  issueDate: '',
  dueDate: '',
  termsDays: '',
  issue: false,
  includeShipping: shippingPending,
});

export type DeliveryProblem = 'nothing' | 'qtyInvalid' | 'qtyExceeds' | 'issueDateInvalid' | 'dueDateInvalid' | 'dueBeforeIssue' | 'noteTooLong';

export interface LineQtyProblems {
  /** By line id. */
  lines: Record<string, 'qtyInvalid' | 'qtyExceeds'>;
  /** Form-level problems. */
  form: DeliveryProblem[];
}

type LeftOf = (l: SalesOrderResponse['lines'][number]) => bigint;
const invoiceLeft: LeftOf = (l) => lineFacts(l).toInvoice;
const fulfilLeft: LeftOf = (l) => lineFacts(l).toFulfil;

/** The quantity the dialog proposes for a line: everything that is left. */
export const defaultQty = (l: SalesOrderResponse['lines'][number], kind: 'invoice' | 'fulfil'): string =>
  qtyText((kind === 'invoice' ? invoiceLeft : fulfilLeft)(l));

/** Per-line quantities the person chose (a line they did not touch means all that is left). */
function chosen(
  lines: readonly SalesOrderResponse['lines'][number][],
  typed: Record<string, string>,
  left: LeftOf,
  kind: 'invoice' | 'fulfil',
): { picks: Array<{ lineId: string; qty: string }>; problems: LineQtyProblems['lines'] } {
  const picks: Array<{ lineId: string; qty: string }> = [];
  const problems: LineQtyProblems['lines'] = {};
  for (const l of lines) {
    const max = left(l);
    if (max <= 0n) continue;
    const text = typed[l.id] ?? defaultQty(l, kind);
    const c = checkQty(text, max);
    if (!c.ok) problems[l.id] = c.reason === 'invalid' ? 'qtyInvalid' : 'qtyExceeds';
    else if (c.scaled > 0n) picks.push({ lineId: l.id, qty: c.qty });
  }
  return { picks, problems };
}

export function invoiceFormProblems(form: InvoiceForm, lines: readonly SalesOrderResponse['lines'][number][]): LineQtyProblems {
  const out: LineQtyProblems = { lines: {}, form: [] };
  if (form.mode === 'lines') {
    const c = chosen(lines, form.qty, invoiceLeft, 'invoice');
    out.lines = c.problems;
    if (Object.keys(c.problems).length === 0 && c.picks.length === 0) out.form.push('nothing');
  } else if (lines.every((l) => invoiceLeft(l) <= 0n)) out.form.push('nothing');
  if (form.issueDate.trim() !== '' && !isDay(form.issueDate)) out.form.push('issueDateInvalid');
  if (form.dueDate.trim() !== '') {
    if (!isDay(form.dueDate)) out.form.push('dueDateInvalid');
    else if (isDay(form.issueDate) && form.dueDate < form.issueDate) out.form.push('dueBeforeIssue');
  }
  return out;
}

export const hasInvoiceProblems = (p: LineQtyProblems): boolean => p.form.length > 0 || Object.keys(p.lines).length > 0;

/** The `POST /sales-orders/:id/invoice` body. `all: true` bills every unbilled quantity; otherwise only the lines named. */
export function buildInvoicePayload(
  form: InvoiceForm,
  lines: readonly SalesOrderResponse['lines'][number][],
  opts: { shippingPending: boolean },
): InvoiceFromOrderInput {
  const base = {
    issue: form.issue,
    includeShipping: opts.shippingPending ? form.includeShipping : false,
    ...(form.issueDate.trim() ? { issueDate: form.issueDate.trim() } : {}),
    ...(form.dueDate.trim()
      ? { dueDate: form.dueDate.trim() }
      : form.termsDays.trim() !== '' && /^\d{1,3}$/.test(form.termsDays.trim())
        ? { paymentTermsDays: Number(form.termsDays.trim()) }
        : {}),
  };
  if (form.mode === 'all') return { ...base, all: true };
  return { ...base, all: false, lines: chosen(lines, form.qty, invoiceLeft, 'invoice').picks };
}

export interface FulfilForm {
  mode: QtyMode;
  qty: Record<string, string>;
  note: string;
}
export const emptyFulfilForm = (): FulfilForm => ({ mode: 'all', qty: {}, note: '' });
export const FULFIL_NOTE_MAX = 500;

export function fulfilFormProblems(form: FulfilForm, lines: readonly SalesOrderResponse['lines'][number][]): LineQtyProblems {
  const out: LineQtyProblems = { lines: {}, form: [] };
  if (form.mode === 'lines') {
    const c = chosen(lines, form.qty, fulfilLeft, 'fulfil');
    out.lines = c.problems;
    if (Object.keys(c.problems).length === 0 && c.picks.length === 0) out.form.push('nothing');
  } else if (lines.every((l) => fulfilLeft(l) <= 0n)) out.form.push('nothing');
  if (form.note.trim().length > FULFIL_NOTE_MAX) out.form.push('noteTooLong');
  return out;
}

export function buildFulfilPayload(form: FulfilForm, lines: readonly SalesOrderResponse['lines'][number][]): FulfilOrderInput {
  const note = form.note.trim();
  const base = note ? { note } : {};
  if (form.mode === 'all') return { ...base, all: true };
  return { ...base, all: false, lines: chosen(lines, form.qty, fulfilLeft, 'fulfil').picks.map((p) => ({ lineId: p.lineId, qty: p.qty })) };
}

// --- the builder's form ----------------------------------------------------------------------------------------------------------

export interface OrderDraft {
  /** An accepted proposal or estimate the order starts from; its lines, currency and buyer come with it. */
  quoteId: string | null;
  contactId: string | null;
  contactLabel: string;
  dealId: string | null;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  currency: string;
  reference: string;
  expectedDate: string;
  /** Typed in major units, `''` for none. */
  shipping: string;
  notes: string;
  terms: string;
  lines: DraftLine[];
}

export const emptyOrderDraft = (currency: string, terms = ''): OrderDraft => ({
  quoteId: null,
  contactId: null,
  contactLabel: '',
  dealId: null,
  buyerName: '',
  buyerEmail: '',
  buyerPhone: '',
  currency,
  reference: '',
  expectedDate: '',
  shipping: '',
  notes: '',
  terms,
  lines: [emptyLine()],
});

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const trimPercent = (p: string): string => (p.includes('.') ? p.replace(/0+$/, '').replace(/\.$/, '') : p);

/** Half-up division of non-negative bigints (the pricing rounds quantity x price the same way). */
const divRound = (n: bigint, d: bigint): bigint => (2n * n + d) / (2n * d);

/**
 * A saved line as an editable one. The order's line carries no tax-rate id and no discount, only the result: a tax is matched to
 * a current rate by name, percent and inclusivity (else it is kept as a "removed rate" the person re-picks), and a discount is
 * recovered as the amount that lies between quantity x price and the line's net. Nothing is sent back unless the person edits lines.
 */
export function draftLineOf(l: SalesOrderResponse['lines'][number], currency: string, rates: readonly TaxRateResponse[]): DraftLine {
  const rate = trimPercent(l.taxRate);
  const taxed = rate !== '0' && rate !== '' ? true : !!l.taxName;
  const match =
    rates.find((r) => r.isActive && r.inclusive === l.taxInclusive && trimPercent(r.rate) === rate && r.name === l.taxName) ??
    rates.find((r) => r.isActive && r.inclusive === l.taxInclusive && trimPercent(r.rate) === rate);
  const unit = parseMajor(l.unitPrice, currency);
  const net = parseMajor(l.amounts.net, currency);
  const tax = parseMajor(l.amounts.tax, currency);
  let discount = '';
  if (unit !== null && net !== null && tax !== null) {
    const gross = divRound(qtyOf(l.qty) * unit, QTY_SCALE);
    const after = net + (l.taxInclusive ? tax : 0n);
    if (gross > after) discount = minorToMajor(gross - after, currency);
  }
  return {
    key: newKey(),
    description: l.description,
    sku: l.sku ?? '',
    hsnSac: l.hsnSac ?? '',
    qty: qtyText(qtyOf(l.qty)),
    price: l.unitPrice,
    discountKind: 'amount',
    discount,
    taxRateId: !taxed ? TAX_NONE : match ? match.id : TAX_SNAPSHOT,
    taxSnapshot: taxed && !match ? { name: l.taxName ?? '', rate, inclusive: l.taxInclusive, components: null } : null,
  };
}

export function draftOfOrder(o: SalesOrderResponse, rates: readonly TaxRateResponse[]): OrderDraft {
  const shipping = parseMajor(o.amounts.shipping, o.currency) ?? 0n;
  return {
    quoteId: o.quote?.id ?? null,
    contactId: o.contact?.id ?? null,
    contactLabel: o.contact?.name ?? '',
    dealId: o.deal?.id ?? null,
    buyerName: o.buyer.name ?? '',
    buyerEmail: o.buyer.email ?? '',
    buyerPhone: o.buyer.phone ?? '',
    currency: o.currency,
    reference: o.reference ?? '',
    expectedDate: o.expectedDate ?? '',
    shipping: shipping > 0n ? o.amounts.shipping : '',
    notes: o.notes ?? '',
    terms: o.terms ?? '',
    lines: o.lines.length > 0 ? o.lines.map((l) => draftLineOf(l, o.currency, rates)) : [emptyLine()],
  };
}

export type OrderProblem =
  | 'buyerRequired'
  | 'emailInvalid'
  | 'currencyInvalid'
  | 'expectedDateInvalid'
  | 'shippingInvalid'
  | 'noLines'
  | 'referenceTooLong';

export interface OrderProblems {
  fields: Partial<Record<'buyer' | 'email' | 'currency' | 'expectedDate' | 'shipping' | 'reference', OrderProblem>>;
  /** By line index of the draft: `lines.<i>.<field>` -> problem code (line problem codes of the invoice builder). */
  lines: Record<string, string>;
  list?: OrderProblem;
}

export const hasOrderProblems = (p: OrderProblems): boolean =>
  Object.keys(p.fields).length > 0 || Object.keys(p.lines).length > 0 || !!p.list;

export interface ValidateOrderOptions {
  /** The seller's country asks for an HSN/SAC on every line. */
  requireHsn?: boolean;
  /** A new order (not an edit of a saved draft). */
  creating: boolean;
  /** Editing: the person changed the lines (untouched saved lines are not re-sent, so they are not re-checked). */
  linesTouched?: boolean;
}

export function validateOrderDraft(d: OrderDraft, opts: ValidateOrderOptions): OrderProblems {
  const out: OrderProblems = { fields: {}, lines: {} };
  const fromQuote = opts.creating && d.quoteId !== null;
  if (!fromQuote && !d.contactId && d.buyerName.trim() === '') out.fields.buyer = 'buyerRequired';
  if (d.buyerEmail.trim() !== '' && !EMAIL.test(d.buyerEmail.trim())) out.fields.email = 'emailInvalid';
  if (opts.creating && !fromQuote && !/^[A-Za-z]{3}$/.test(d.currency.trim())) out.fields.currency = 'currencyInvalid';
  if (d.expectedDate.trim() !== '' && !isDay(d.expectedDate.trim())) out.fields.expectedDate = 'expectedDateInvalid';
  if (d.shipping.trim() !== '' && decimalOf(d.shipping) === null) out.fields.shipping = 'shippingInvalid';
  if (d.reference.trim().length > 191) out.fields.reference = 'referenceTooLong';
  if (opts.creating ? !fromQuote : !!opts.linesTouched) {
    const used = d.lines.map((l, i) => [l, i] as const).filter(([l]) => !isBlankLine(l));
    if (used.length === 0) out.list = 'noLines';
    for (const [l, i] of used) {
      for (const [field, problem] of Object.entries(lineProblems(l, d.currency, { requireHsn: opts.requireHsn }))) out.lines[`lines.${i}.${field}`] = problem;
    }
  }
  return out;
}

const orNull = (s: string): string | null => (s.trim() === '' ? null : s.trim());
const orUndef = (s: string): string | undefined => (s.trim() === '' ? undefined : s.trim());

/** `POST /sales-orders`. From an accepted offer the lines, currency and buyer come from the offer; typed values refine them. */
export function buildCreateInput(d: OrderDraft, rates: readonly TaxRateResponse[]): CreateSalesOrderInput {
  const shipping = d.shipping.trim() === '' ? undefined : (decimalOf(d.shipping) ?? d.shipping.trim());
  const common = {
    contactId: d.contactId ?? undefined,
    dealId: d.dealId ?? undefined,
    buyerName: orUndef(d.buyerName),
    buyerEmail: orUndef(d.buyerEmail),
    buyerPhone: orUndef(d.buyerPhone),
    reference: orUndef(d.reference),
    expectedDate: orUndef(d.expectedDate),
    shipping,
    notes: orUndef(d.notes),
    terms: orUndef(d.terms),
  };
  const body: CreateSalesOrderInput = d.quoteId
    ? { ...common, quoteId: d.quoteId }
    : { ...common, currency: d.currency.trim().toUpperCase(), lines: linesToInput(d.lines, d.currency, rates) };
  return Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined)) as CreateSalesOrderInput;
}

const sameLines = (a: readonly DraftLine[], b: readonly DraftLine[]): boolean =>
  a.length === b.length &&
  a.every((l, i) => {
    const o = b[i]!;
    return (
      l.description === o.description &&
      l.sku === o.sku &&
      l.hsnSac === o.hsnSac &&
      l.qty === o.qty &&
      l.price === o.price &&
      l.discountKind === o.discountKind &&
      l.discount === o.discount &&
      l.taxRateId === o.taxRateId
    );
  });

export const linesChanged = (draft: OrderDraft, initial: OrderDraft): boolean => !sameLines(draft.lines, initial.lines);

/**
 * `PATCH /sales-orders/:id` (without `rowVersion`: the service adds it). Every header field is sent so a cleared box clears it;
 * lines and shipping only when the person changed them (the saved lines are never re-sent from their lossy edit form).
 */
export function buildUpdateInput(
  d: OrderDraft,
  initial: OrderDraft,
  rates: readonly TaxRateResponse[],
): Omit<UpdateSalesOrderInput, 'rowVersion'> {
  const out: Omit<UpdateSalesOrderInput, 'rowVersion'> = {
    contactId: d.contactId,
    dealId: d.dealId,
    buyerName: orNull(d.buyerName),
    buyerEmail: orNull(d.buyerEmail),
    buyerPhone: orNull(d.buyerPhone),
    reference: orNull(d.reference),
    expectedDate: orNull(d.expectedDate),
    notes: orNull(d.notes),
    terms: orNull(d.terms),
  };
  if (d.shipping.trim() !== initial.shipping.trim()) out.shipping = d.shipping.trim() === '' ? null : (decimalOf(d.shipping) ?? d.shipping.trim());
  if (linesChanged(d, initial)) out.lines = linesToInput(d.lines, d.currency, rates);
  return out;
}

export const isSameOrderDraft = (a: OrderDraft, b: OrderDraft): boolean =>
  a.quoteId === b.quoteId &&
  a.contactId === b.contactId &&
  a.dealId === b.dealId &&
  a.buyerName === b.buyerName &&
  a.buyerEmail === b.buyerEmail &&
  a.buyerPhone === b.buyerPhone &&
  a.currency === b.currency &&
  a.reference === b.reference &&
  a.expectedDate === b.expectedDate &&
  a.shipping === b.shipping &&
  a.notes === b.notes &&
  a.terms === b.terms &&
  sameLines(a.lines, b.lines);

/** Live pricing of the builder's lines (same rule the server prices with); an unreadable form prices as nothing. */
export function priceOrderDraft(d: OrderDraft, rates: readonly TaxRateResponse[]): PricingResult | null {
  const used = d.lines.filter((l) => !isBlankLine(l));
  if (used.length === 0 || !/^[A-Za-z]{3}$/.test(d.currency.trim())) return null;
  return priceInvoice({
    currency: d.currency,
    discount: null,
    shipping: d.shipping.trim() === '' ? null : (decimalOf(d.shipping) ?? '0'),
    lines: used.map((l) => {
      const kind = l.discountKind;
      const v = decimalOf(l.discount, kind === 'percent' ? 2 : 4, kind === 'percent' ? 3 : 12);
      return {
        qty: decimalOf(l.qty, 4, 8) ?? l.qty.trim(),
        unitPrice: decimalOf(l.price) ?? '0',
        discount: v !== null && Number(v) > 0 ? { kind, value: v } : null,
        tax: lineTaxOf(l, rates),
      };
    }),
  });
}

/** Per-line amounts (minor units) for the editor, aligned with the draft's line indexes (blank lines get null). */
export function lineAmountsOf(d: OrderDraft, pricing: PricingResult | null): Array<number | null> {
  let k = 0;
  return d.lines.map((l) => (isBlankLine(l) ? null : (pricing?.totals.lines[k++]?.netMinor ?? null)));
}

// --- the picker of accepted offers -----------------------------------------------------------------------------------------------

/** An order made from an accepted offer, found again after SO_QUOTE_TAKEN: the live one (not cancelled) for that offer. */
export function liveOrderForQuote<T extends { quote: { id: string } | null; status: SalesOrderStatus }>(orders: readonly T[], quoteId: string): T | undefined {
  return orders.find((o) => o.quote?.id === quoteId && o.status !== 'cancelled');
}

/** Every error code a sales-order call can answer with; each has its own sentence in `invoicing.errors.codes`. */
export const SALES_ORDER_ERROR_CODES = [
  'SO_NOT_DRAFT',
  'SO_NOT_CONFIRMED',
  'SO_CANCELLED',
  'SO_QUOTE_NOT_ACCEPTED',
  'SO_QUOTE_TAKEN',
  'SO_QUANTITY_EXCEEDS',
  'SO_NOTHING_TO_INVOICE',
  'SO_HAS_INVOICES',
] as const;

/** The values behind run-time message keys (`salesOrders.invoicingStatus.<v>` and friends), so a test can check each has a text. */
export const SALES_ORDER_LABELS = {
  invoicing: ['not_invoiced', 'partially_invoiced', 'invoiced'],
  fulfilment: ['unfulfilled', 'partially_fulfilled', 'fulfilled'],
  quoteKinds: ['proposal', 'estimate'],
} as const;
