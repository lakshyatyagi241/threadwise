import {
  CREDIT_NOTE_REASONS,
  CREDIT_NOTE_SETTLEMENTS,
  computeInvoice,
  formatPercent,
  formatQty,
  minorToMajor,
  parseMajor,
  parseQty,
  type CreateCreditNoteInput,
  type CreditNoteLineInput,
  type CreditNoteReason,
  type CreditNoteResponse,
  type CreditNoteSettlement,
  type CreditNoteStatus,
  type InvoiceLineResponse,
  type TaxRateResponse,
  type UpdateCreditNoteInput,
} from '@crm/contracts';

/**
 * Credit notes on the client: the list's filters, what a row offers, the form behind the builder, the payload it sends and a live
 * ESTIMATE of the credit. The estimate follows the server's rule (the credited part of a line is the amount the buyer was charged
 * for it, net of discounts, in proportion to the quantity; the last part takes what is left; then the line's own tax) but the
 * server's figures are the truth once saved. Money is bigint minor units here; quantities are bigint x 10^4. No floats.
 */

export { CREDIT_NOTE_REASONS, CREDIT_NOTE_SETTLEMENTS };

/** The reasons in the order the form offers them (a test keeps this list equal to the contracts' list). */
export const CREDIT_REASON_ORDER: readonly CreditNoteReason[] = [
  'return',
  'price_adjustment',
  'billing_error',
  'cancellation',
  'goodwill',
  'other',
];

// --- list: tabs, filters, query --------------------------------------------------------------------------------------------------

export const CREDIT_TABS = ['all', 'draft', 'issued', 'void'] as const;
export type CreditTab = (typeof CREDIT_TABS)[number];

export interface CreditFilters {
  tab: CreditTab;
  q: string;
  invoiceId: string;
  contactId: string;
}

export const DEFAULT_CREDIT_FILTERS: CreditFilters = {
  tab: 'all',
  q: '',
  invoiceId: '',
  contactId: '',
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseCreditFilters(search: { get(name: string): string | null }): CreditFilters {
  const tab = search.get('tab');
  const invoiceId = search.get('invoice') ?? '';
  const contactId = search.get('contact') ?? '';
  return {
    tab: (CREDIT_TABS as readonly string[]).includes(tab ?? '') ? (tab as CreditTab) : 'all',
    q: (search.get('q') ?? '').slice(0, 100),
    invoiceId: UUID.test(invoiceId) ? invoiceId : '',
    contactId: UUID.test(contactId) ? contactId : '',
  };
}

/** The address query for a set of filters (defaults are left out). */
export function creditFiltersToSearch(f: CreditFilters): string {
  const p = new URLSearchParams();
  if (f.tab !== 'all') p.set('tab', f.tab);
  if (f.q.trim()) p.set('q', f.q.trim());
  if (f.invoiceId) p.set('invoice', f.invoiceId);
  if (f.contactId) p.set('contact', f.contactId);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const hasActiveCreditFilter = (f: CreditFilters): boolean =>
  !!(f.q.trim() || f.invoiceId || f.contactId);

/** The API query of the list (the tab is the `status` filter). */
export function creditListQuery(f: CreditFilters): Record<string, string | undefined> {
  return {
    status: f.tab === 'all' ? undefined : f.tab,
    q: f.q.trim() || undefined,
    invoiceId: f.invoiceId || undefined,
    contactId: f.contactId || undefined,
  };
}

// --- what a credit note offers ---------------------------------------------------------------------------------------------------

export type CreditNoteAction = 'view' | 'edit' | 'issue' | 'void' | 'delete' | 'pdf' | 'print';

export interface CreditNoteCan {
  createCreditNote: boolean;
  issueCreditNote: boolean;
  voidCreditNote: boolean;
  deleteCreditNote: boolean;
}

/**
 * Draft: edit, issue, delete. Issued: void, unless cash was returned for it (CN_HAS_REFUND: the refund stands in the payment
 * ledger). Void: read only. A draft has no number yet, so it has no PDF.
 */
export function creditNoteActions(
  n: { status: CreditNoteStatus; refundedMinor: number },
  can: CreditNoteCan,
): Set<CreditNoteAction> {
  const out = new Set<CreditNoteAction>(['view', 'print']);
  if (n.status !== 'draft') out.add('pdf');
  if (n.status === 'draft') {
    if (can.createCreditNote) out.add('edit');
    if (can.issueCreditNote) out.add('issue');
    if (can.deleteCreditNote) out.add('delete');
  }
  if (n.status === 'issued' && can.voidCreditNote && n.refundedMinor <= 0) out.add('void');
  return out;
}

/** Error codes the credit note screens can meet (each has `invoicing.errors.codes.<code>` in the messages). */
export const CREDIT_NOTE_ERROR_CODES = [
  'CN_EXCEEDS_INVOICE',
  'CN_NOT_DRAFT',
  'CN_ALREADY_VOID',
  'CN_HAS_REFUND',
  'CN_NOTHING_TO_CREDIT',
  'CN_LINE_INVALID',
  'INV_NOT_ISSUED',
] as const;

// --- money helpers ---------------------------------------------------------------------------------------------------------------

/** A major-units string from the API ("12.50") as bigint minor units; 0 when absent. */
export const big = (v: string | null | undefined, currency: string): bigint =>
  v ? (parseMajor(v, currency) ?? 0n) : 0n;

/** round-half-up of n / d for n >= 0, d > 0 (the server's rounding). */
export const divRound = (n: bigint, d: bigint): bigint => (2n * n + d) / (2n * d);

/** What a person typed in an amount box ("12", "12,50") as a decimal string for the API, or null when it is not an amount above 0. */
export function normalizeAmount(text: string, currency: string): string | null {
  const s = text.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d{1,12}(\.\d{1,4})?$/.test(s)) return null;
  const minor = parseMajor(s, currency);
  return minor !== null && minor > 0n ? s : null;
}

/** Whole minor units as a safe number for display (every amount is below 10^15). */
export const num = (n: bigint): number => Number(n);

// --- what is still creditable on an invoice's lines ------------------------------------------------------------------------------

export interface CreditedPart {
  qtyScaled: bigint;
  amountMinor: bigint;
}

/**
 * What the ISSUED credit notes already took from each invoice line (draft and void ones count for nothing, like the server). Pass
 * `exceptId` while editing a draft so it does not count against itself (a draft is never counted anyway; kept for clarity).
 */
export function creditedByLine(
  notes: ReadonlyArray<Pick<CreditNoteResponse, 'id' | 'status' | 'lines' | 'currency'>>,
  exceptId?: string,
): Map<string, CreditedPart> {
  const out = new Map<string, CreditedPart>();
  for (const n of notes) {
    if (n.status !== 'issued' || n.id === exceptId) continue;
    for (const l of n.lines) {
      if (!l.invoiceLineId) continue;
      const prev = out.get(l.invoiceLineId) ?? { qtyScaled: 0n, amountMinor: 0n };
      out.set(l.invoiceLineId, {
        qtyScaled: prev.qtyScaled + (parseQty(l.qty) ?? 0n),
        amountMinor: prev.amountMinor + big(l.amounts.net, n.currency),
      });
    }
  }
  return out;
}

export interface LineRemaining {
  /** The line's quantity, and what is left of it. */
  fullQtyScaled: bigint;
  qtyScaled: bigint;
  /** What the buyer was charged for the whole line (net of its discounts and its share of the document discount), and what is left. */
  taxableMinor: bigint;
  amountMinor: bigint;
  /** Nothing left to credit on this line. */
  done: boolean;
}

export function lineRemaining(
  line: Pick<InvoiceLineResponse, 'qty' | 'amounts'>,
  credited: CreditedPart | undefined,
  currency: string,
): LineRemaining {
  const fullQtyScaled = parseQty(line.qty) ?? 0n;
  const taxableMinor =
    big(line.amounts.gross, currency) -
    big(line.amounts.discount, currency) -
    big(line.amounts.docDiscountShare, currency);
  const qtyScaled = fullQtyScaled - (credited?.qtyScaled ?? 0n);
  const amountMinor = taxableMinor - (credited?.amountMinor ?? 0n);
  return {
    fullQtyScaled,
    qtyScaled,
    taxableMinor,
    amountMinor,
    done: qtyScaled <= 0n || amountMinor <= 0n,
  };
}

/** The credit for `q` of a line: in proportion to the quantity; the whole remaining quantity takes whatever is left of the line. */
export function creditAmount(r: LineRemaining, q: bigint): bigint {
  if (q >= r.qtyScaled) return r.amountMinor;
  const a = divRound(r.taxableMinor * q, r.fullQtyScaled);
  return a > r.amountMinor ? r.amountMinor : a;
}

export type QtyCheck =
  { ok: true; qtyScaled: bigint; qty: string } | { ok: false; reason: 'invalid' | 'exceeds' };

/** A quantity a person typed against what is left; empty means all of it. Decimal strings with 4 decimals, no floats. */
export function checkCreditQty(text: string, remainingScaled: bigint): QtyCheck {
  const s = text.trim().replace(',', '.');
  if (s === '') return { ok: true, qtyScaled: remainingScaled, qty: formatQty(remainingScaled) };
  const q = parseQty(s);
  if (q === null || q <= 0n) return { ok: false, reason: 'invalid' };
  if (q > remainingScaled) return { ok: false, reason: 'exceeds' };
  return { ok: true, qtyScaled: q, qty: formatQty(q) };
}

/** A quantity for display: "4", "1.5" (trailing zeros dropped). */
export const qtyText = (scaled: bigint): string => formatQty(scaled);

// --- the form --------------------------------------------------------------------------------------------------------------------

export type CreditMode = 'full' | 'lines';

export interface LineChoice {
  checked: boolean;
  /** Quantity to credit; empty = the whole remaining quantity. */
  qty: string;
}

export interface FreeLine {
  key: string;
  description: string;
  /** Amount before tax, as typed. */
  amount: string;
  /** A tax rate id of the workspace; empty = no tax. */
  taxRateId: string;
}

export interface CreditForm {
  invoiceId: string | null;
  reason: CreditNoteReason;
  note: string;
  settlement: CreditNoteSettlement;
  /** YYYY-MM-DD; empty = the day it is issued. */
  issueDate: string;
  mode: CreditMode;
  /** By invoice line id. */
  choices: Record<string, LineChoice>;
  free: FreeLine[];
}

export const emptyForm = (invoiceId: string | null = null): CreditForm => ({
  invoiceId,
  reason: 'return',
  note: '',
  settlement: 'balance',
  issueDate: '',
  mode: 'full',
  choices: {},
  free: [],
});

let freeSeq = 0;
export const newFreeLine = (): FreeLine => ({
  key: `free-${++freeSeq}`,
  description: '',
  amount: '',
  taxRateId: '',
});

/** Invoice facts the builder needs (from `GET /invoices/:id`, in wire strings). */
export interface InvoiceFacts {
  id: string;
  currency: string;
  lines: readonly InvoiceLineResponse[];
  /** total less what issued credit notes already took, in minor units. */
  creditableMinor: bigint;
  shippingMinor: bigint;
}

export const invoiceFactsOf = (inv: {
  id: string;
  currency: string;
  lines: readonly InvoiceLineResponse[];
  amountsMinor: { total: string; credited: string; shipping: string };
}): InvoiceFacts => ({
  id: inv.id,
  currency: inv.currency,
  lines: inv.lines,
  creditableMinor: BigInt(inv.amountsMinor.total) - BigInt(inv.amountsMinor.credited),
  shippingMinor: BigInt(inv.amountsMinor.shipping),
});

/** The form of an existing draft, for editing it. */
export function formFromCreditNote(
  n: CreditNoteResponse,
  inv: InvoiceFacts,
  taxRates: readonly TaxRateResponse[],
): CreditForm {
  const base: CreditForm = {
    ...emptyForm(n.invoice.id),
    reason: n.reason,
    note: n.note ?? '',
    settlement: n.settlement,
    issueDate: n.issueDate ?? '',
  };
  // A draft that credits everything that is still creditable was most likely made with "credit the whole remaining invoice".
  if (BigInt(n.totalMinor) === inv.creditableMinor && inv.creditableMinor > 0n)
    return { ...base, mode: 'full' };
  const choices: Record<string, LineChoice> = {};
  const free: FreeLine[] = [];
  for (const l of n.lines) {
    if (l.invoiceLineId) choices[l.invoiceLineId] = { checked: true, qty: l.qty };
    else {
      const rate = taxRates.find(
        (r) => r.name === l.taxName && Number(r.rate) === Number(l.taxRate),
      );
      free.push({
        ...newFreeLine(),
        description: l.description,
        amount: l.amounts.net,
        taxRateId: rate?.id ?? '',
      });
    }
  }
  return { ...base, mode: 'lines', choices, free };
}

// --- problems with the form ------------------------------------------------------------------------------------------------------

export type FormProblem =
  | 'noInvoice'
  | 'nothing'
  | 'qtyInvalid'
  | 'qtyExceeds'
  | 'descriptionRequired'
  | 'amountInvalid'
  | 'noteTooLong';

/** Keys: `invoice`, `lines`, `note`, `qty:<invoiceLineId>`, `free:<key>:description`, `free:<key>:amount`. */
export function formProblems(
  form: CreditForm,
  inv: InvoiceFacts | null,
  credited: ReadonlyMap<string, CreditedPart>,
): Record<string, FormProblem> {
  const out: Record<string, FormProblem> = {};
  if (!form.invoiceId || !inv) {
    out.invoice = 'noInvoice';
    return out;
  }
  if (form.note.trim().length > 2000) out.note = 'noteTooLong';
  if (form.mode === 'full') {
    if (inv.creditableMinor <= 0n) out.lines = 'nothing';
    return out;
  }
  let any = false;
  for (const l of inv.lines) {
    const c = form.choices[l.id];
    if (!c?.checked) continue;
    any = true;
    const r = lineRemaining(l, credited.get(l.id), inv.currency);
    const q = checkCreditQty(c.qty, r.qtyScaled);
    if (r.done) out[`qty:${l.id}`] = 'qtyExceeds';
    else if (!q.ok) out[`qty:${l.id}`] = q.reason === 'invalid' ? 'qtyInvalid' : 'qtyExceeds';
  }
  for (const f of form.free) {
    const touched = f.description.trim() || f.amount.trim();
    if (!touched) continue; // an empty row is ignored, not an error
    any = true;
    if (!f.description.trim()) out[`free:${f.key}:description`] = 'descriptionRequired';
    if (normalizeAmount(f.amount, inv.currency) === null)
      out[`free:${f.key}:amount`] = 'amountInvalid';
  }
  if (!any) out.lines = 'nothing';
  return out;
}

// --- the payload -----------------------------------------------------------------------------------------------------------------

/** The `lines` the API takes for the form's per-line mode (rows left empty are dropped). */
export function lineInputs(
  form: CreditForm,
  inv: InvoiceFacts,
  credited: ReadonlyMap<string, CreditedPart>,
): CreditNoteLineInput[] {
  const out: CreditNoteLineInput[] = [];
  for (const l of inv.lines) {
    const c = form.choices[l.id];
    if (!c?.checked) continue;
    const r = lineRemaining(l, credited.get(l.id), inv.currency);
    const q = checkCreditQty(c.qty, r.qtyScaled);
    out.push({ invoiceLineId: l.id, qty: q.ok ? q.qty : c.qty.trim() });
  }
  for (const f of form.free) {
    const amount = normalizeAmount(f.amount, inv.currency);
    if (!f.description.trim() && !f.amount.trim()) continue;
    out.push({
      description: f.description.trim(),
      amount: amount ?? f.amount.trim(),
      taxRateId: f.taxRateId || null,
    });
  }
  return out;
}

export function buildCreatePayload(
  form: CreditForm,
  inv: InvoiceFacts,
  credited: ReadonlyMap<string, CreditedPart>,
): Partial<CreateCreditNoteInput> & Pick<CreateCreditNoteInput, 'invoiceId' | 'reason'> {
  const full = form.mode === 'full';
  return {
    invoiceId: inv.id,
    reason: form.reason,
    note: form.note.trim() || null,
    settlement: form.settlement,
    issueDate: form.issueDate || null,
    full,
    ...(full ? {} : { lines: lineInputs(form, inv, credited) }),
  };
}

export function buildUpdatePayload(
  form: CreditForm,
  inv: InvoiceFacts,
  credited: ReadonlyMap<string, CreditedPart>,
): Omit<UpdateCreditNoteInput, 'rowVersion'> {
  const full = form.mode === 'full';
  return {
    reason: form.reason,
    note: form.note.trim() || null,
    settlement: form.settlement,
    issueDate: form.issueDate || null,
    full,
    ...(full ? {} : { lines: lineInputs(form, inv, credited) }),
  };
}

// --- the live estimate -----------------------------------------------------------------------------------------------------------

export interface EstimateLine {
  key: string;
  description: string;
  /** Free-form line, or part of an invoice line. */
  invoiceLineId: string | null;
  qtyScaled: bigint;
  netMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
  taxLabel: string | null;
}

export interface EstimateTaxRow {
  name: string;
  /** Percent, "18" or "7.5". */
  rate: string;
  inclusive: boolean;
  baseMinor: bigint;
  taxMinor: bigint;
}

export interface Estimate {
  lines: EstimateLine[];
  taxSummary: EstimateTaxRow[];
  subtotalMinor: bigint;
  taxMinor: bigint;
  taxAddedMinor: bigint;
  totalMinor: bigint;
  /** The invoice's creditable amount; the total can never exceed it (CN_EXCEEDS_INVOICE). */
  creditableMinor: bigint;
  exceeds: boolean;
}

interface Spec {
  key: string;
  description: string;
  invoiceLineId: string | null;
  qtyScaled: bigint;
  amountMinor: bigint;
  taxRate: string;
  taxInclusive: boolean;
  taxName: string | null;
}

/**
 * The credit as the server will most likely price it: `computeInvoice` (the pricing rule shared with the API) over one line per
 * credited part (quantity 1 at the credited amount, the invoice line's own tax). Rows with a problem are left out here; the form
 * shows those problems. `hasIssuedNote` says shipping is already credited (it goes with the first credit note only).
 */
export function estimateCredit(
  form: CreditForm,
  inv: InvoiceFacts,
  credited: ReadonlyMap<string, CreditedPart>,
  taxRates: readonly TaxRateResponse[],
  hasIssuedNote: boolean,
): Estimate {
  const specs: Spec[] = [];
  const fromLine = (l: InvoiceLineResponse, q: bigint, r: LineRemaining) => {
    specs.push({
      key: l.id,
      description: `${l.description} (credit)`,
      invoiceLineId: l.id,
      qtyScaled: q,
      amountMinor: creditAmount(r, q),
      taxRate: l.taxRate,
      taxInclusive: l.taxInclusive,
      taxName: l.taxName,
    });
  };

  if (form.mode === 'full') {
    for (const l of inv.lines) {
      const r = lineRemaining(l, credited.get(l.id), inv.currency);
      if (!r.done) fromLine(l, r.qtyScaled, r);
    }
    if (inv.shippingMinor > 0n && !hasIssuedNote)
      specs.push({
        key: 'shipping',
        description: 'Shipping (credit)',
        invoiceLineId: null,
        qtyScaled: 10_000n,
        amountMinor: inv.shippingMinor,
        taxRate: '0',
        taxInclusive: false,
        taxName: null,
      });
  } else {
    for (const l of inv.lines) {
      const c = form.choices[l.id];
      if (!c?.checked) continue;
      const r = lineRemaining(l, credited.get(l.id), inv.currency);
      if (r.done) continue;
      const q = checkCreditQty(c.qty, r.qtyScaled);
      if (q.ok) fromLine(l, q.qtyScaled, r);
    }
    for (const f of form.free) {
      const amount = normalizeAmount(f.amount, inv.currency);
      if (!f.description.trim() || amount === null) continue;
      const rate = f.taxRateId ? taxRates.find((r) => r.id === f.taxRateId) : undefined;
      specs.push({
        key: f.key,
        description: f.description.trim(),
        invoiceLineId: null,
        qtyScaled: 10_000n,
        amountMinor: parseMajor(amount, inv.currency) ?? 0n,
        taxRate: rate?.rate ?? '0',
        taxInclusive: rate?.inclusive ?? false,
        taxName: rate?.name ?? null,
      });
    }
  }

  const empty: Estimate = {
    lines: [],
    taxSummary: [],
    subtotalMinor: 0n,
    taxMinor: 0n,
    taxAddedMinor: 0n,
    totalMinor: 0n,
    creditableMinor: inv.creditableMinor,
    exceeds: false,
  };
  if (specs.length === 0) return empty;

  const priced = computeInvoice({
    currency: inv.currency,
    lines: specs.map((s) => ({
      qty: '1',
      unitPrice: minorToMajor(s.amountMinor, inv.currency),
      taxRate: s.taxRate,
      taxInclusive: s.taxInclusive,
      taxName: s.taxName,
    })),
  });
  if (!priced.ok) return empty;
  const { result } = priced.value;
  return {
    lines: specs.map((s, i) => ({
      key: s.key,
      description: s.description,
      invoiceLineId: s.invoiceLineId,
      qtyScaled: s.qtyScaled,
      netMinor: result.lines[i]!.netMinor,
      taxMinor: result.lines[i]!.taxMinor,
      totalMinor: result.lines[i]!.totalMinor,
      taxLabel:
        s.taxRate !== '0' && Number(s.taxRate) > 0
          ? `${s.taxName ?? ''} ${s.taxRate}%`.trim()
          : null,
    })),
    taxSummary: result.taxGroups.map((g) => ({
      name: g.name,
      rate: formatPercent(g.rateBp),
      inclusive: g.inclusive,
      baseMinor: g.baseMinor,
      taxMinor: g.taxMinor,
    })),
    subtotalMinor: result.subtotalMinor,
    taxMinor: result.taxMinor,
    taxAddedMinor: result.taxAddedMinor,
    totalMinor: result.totalMinor,
    creditableMinor: inv.creditableMinor,
    exceeds: result.totalMinor > inv.creditableMinor,
  };
}

/** The unit price of a saved credit line: the API's `unitPrice` holds the credited AMOUNT, so the price of one unit is net / qty. */
export function creditLineUnitMinor(net: string, qty: string, currency: string): bigint {
  const n = big(net, currency);
  const q = parseQty(qty) ?? 0n;
  if (q <= 0n) return n;
  return divRound(n * 10_000n, q);
}

/** The label of a tax summary row: "VAT 18%" (inclusive rows say so in the screen). */
export const taxRowLabel = (name: string, rate: string): string => `${name || 'Tax'} ${rate}%`;

/** Statuses a person picks an invoice from when crediting it (the API credits issued invoices only). */
export const CREDITABLE_INVOICE_STATUSES = 'issued,partially_paid,overdue,paid';

// --- what happens to the money ---------------------------------------------------------------------------------------------------

export interface MoneyEffect {
  /** What the buyer owes on the invoice before and after this credit note. */
  balanceBeforeMinor: bigint;
  balanceAfterMinor: bigint;
  /** Of the credit: returned to the buyer in cash through the payment ledger (settlement `refund`), and applied to the invoice. */
  refundMinor: bigint;
  appliedMinor: bigint;
}

/**
 * The same rule as issuing: with `refund`, the cash the invoice would hold above what is still owed after the credit is returned
 * (never more than the credit itself); with `balance`, nothing is paid out and the credit only lowers what is owed. An estimate
 * until the server issues the credit note.
 */
export function moneyEffect(a: {
  totalMinor: bigint;
  creditedMinor: bigint;
  paidMinor: bigint;
  creditMinor: bigint;
  settlement: CreditNoteSettlement;
}): MoneyEffect {
  const open = (owed: bigint) => (owed - a.paidMinor > 0n ? owed - a.paidMinor : 0n);
  const owedBefore = a.totalMinor - a.creditedMinor;
  const owedAfter = owedBefore - a.creditMinor;
  let refundMinor = 0n;
  if (a.settlement === 'refund') {
    refundMinor = a.paidMinor - owedAfter;
    if (refundMinor > a.creditMinor) refundMinor = a.creditMinor;
    if (refundMinor < 0n) refundMinor = 0n;
  }
  return {
    balanceBeforeMinor: open(owedBefore),
    balanceAfterMinor: open(owedAfter),
    refundMinor,
    appliedMinor: a.creditMinor - refundMinor,
  };
}
