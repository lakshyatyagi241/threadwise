import type { DocInput, Ref, SalesDoc } from '../api/schemas';
import { normalizePhone } from './format';
import { bpToInput, minorToInput, parseMajor, parsePercentToBp } from './money';
import {
  computeTotals,
  normalizeQty,
  QTY_MAX,
  type DocDiscount,
  type LineInput,
  type Totals,
} from './totals';

/**
 * The builder's form state and the pure rules around it: rows, validation, conversion to and from a document. Fields hold what
 * the person typed (strings); numbers are read from them only here, with the same parsers the totals use.
 */
export const TITLE_MAX = 255;
export const DESCRIPTION_MAX = 500;
export const NOTES_MAX = 5000;
export const TERMS_MAX = 10000;
export const MAX_LINES = 200;

export type DiscountKind = 'percent' | 'amount';

export interface DraftLine {
  /** Stable React key; not sent to the server. */
  key: string;
  description: string;
  qty: string;
  /** Unit price in major units ("12.50"). */
  unit: string;
  /** What the discount box holds: a percentage or an amount. */
  discountKind: DiscountKind;
  /** "" for none. */
  discount: string;
  /** Percent; "" takes the document's tax rate. */
  tax: string;
}

export interface Draft {
  title: string;
  contact: Ref | null;
  deal: Ref | null;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  currency: string;
  lines: DraftLine[];
  /** Default tax rate in percent ("" = no tax). */
  taxRate: string;
  discountKind: DiscountKind;
  discountValue: string;
  notes: string;
  terms: string;
  /** `YYYY-MM-DD` or "". */
  validUntil: string;
}

let seq = 0;
export const newKey = (): string => `l${Date.now().toString(36)}${(seq++).toString(36)}`;

export const blankLine = (): DraftLine => ({
  key: newKey(),
  description: '',
  qty: '1',
  unit: '',
  discountKind: 'percent',
  discount: '',
  tax: '',
});

export function emptyDraft(currency: string, init: Partial<Draft> = {}): Draft {
  return {
    title: '',
    contact: null,
    deal: null,
    buyerName: '',
    buyerEmail: '',
    buyerPhone: '',
    currency,
    lines: [blankLine()],
    taxRate: '',
    discountKind: 'percent',
    discountValue: '',
    notes: '',
    terms: '',
    validUntil: '',
    ...init,
  };
}

const pctInput = (bp: number) => (bp > 0 ? bpToInput(bp) : '');

function discountFields(d: DocDiscount, currency: string): { kind: DiscountKind; value: string } {
  if (!d) return { kind: 'percent', value: '' };
  return d.kind === 'percent'
    ? { kind: 'percent', value: pctInput(d.bp) }
    : { kind: 'amount', value: d.minor > 0 ? minorToInput(d.minor, currency) : '' };
}

export function draftFromDoc(doc: SalesDoc): Draft {
  const docDiscount = discountFields(doc.discount, doc.currency);
  return {
    title: doc.title,
    contact: doc.contact,
    deal: doc.deal,
    buyerName: doc.buyer.name,
    buyerEmail: doc.buyer.email,
    buyerPhone: doc.buyer.phone,
    currency: doc.currency,
    lines: doc.items.length
      ? doc.items.map((i) => {
          const d = discountFields(i.discount, doc.currency);
          return {
            key: newKey(),
            description: i.description,
            qty: i.qty,
            unit: minorToInput(i.unitPriceMinor, doc.currency),
            discountKind: d.kind,
            discount: d.value,
            tax: i.taxRateBp === null ? '' : bpToInput(i.taxRateBp),
          };
        })
      : [blankLine()],
    taxRate: pctInput(doc.defaultTaxBp),
    discountKind: docDiscount.kind,
    discountValue: docDiscount.value,
    notes: doc.notes,
    terms: doc.terms,
    validUntil: doc.validUntil ?? '',
  };
}

/** A row nobody touched: no description and no price. Dropped on save, never an error. */
export const isBlankLine = (l: DraftLine): boolean =>
  l.description.trim() === '' && l.unit.trim() === '';

const bpOrZero = (text: string): number => parsePercentToBp(text) ?? 0;

/** A discount box read as the form's discount (null for empty, zero or unreadable). */
export function readDiscount(kind: DiscountKind, value: string, currency: string): DocDiscount {
  if (value.trim() === '') return null;
  if (kind === 'percent') {
    const bp = parsePercentToBp(value);
    return bp && bp > 0 ? { kind: 'percent', bp } : null;
  }
  const minor = parseMajor(value, currency);
  return minor && minor > 0 ? { kind: 'amount', minor } : null;
}

export const docDiscountOf = (d: Draft): DocDiscount =>
  readDiscount(d.discountKind, d.discountValue, d.currency);

/** The rows that count (blank ones are left out), as the totals read them. */
export function lineInputs(d: Draft): LineInput[] {
  return d.lines
    .filter((l) => !isBlankLine(l))
    .map((l) => ({
      qty: l.qty,
      unitPriceMinor: parseMajor(l.unit, d.currency) ?? 0,
      discount: readDiscount(l.discountKind, l.discount, d.currency),
      taxBp: l.tax.trim() === '' ? null : bpOrZero(l.tax),
    }));
}

export function draftTotals(d: Draft): Totals {
  return computeTotals({
    lines: lineInputs(d),
    discount: docDiscountOf(d),
    defaultTaxBp: bpOrZero(d.taxRate),
  });
}

// --- validation --------------------------------------------------------------------------------------------------------

export type DraftProblem =
  | 'noItems'
  | 'tooLarge'
  | 'descriptionRequired'
  | 'descriptionTooLong'
  | 'qtyInvalid'
  | 'priceInvalid'
  | 'discountInvalid'
  | 'taxInvalid'
  | 'docDiscountInvalid'
  | 'docTaxInvalid'
  | 'emailInvalid'
  | 'phoneInvalid'
  | 'titleTooLong'
  | 'notesTooLong'
  | 'termsTooLong'
  | 'dateInvalid';

export interface DraftErrors {
  fields: Partial<
    Record<
      'title' | 'email' | 'phone' | 'validUntil' | 'notes' | 'terms' | 'docDiscount' | 'docTax',
      DraftProblem
    >
  >;
  /** Problems per row key, by field. */
  lines: Record<
    string,
    Partial<Record<'description' | 'qty' | 'unit' | 'discount' | 'tax', DraftProblem>>
  >;
  /** The document as a whole (no rows, an amount too large). */
  form: DraftProblem | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const isDate = (v: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

export const hasErrors = (e: DraftErrors): boolean =>
  e.form !== null || Object.keys(e.fields).length > 0 || Object.keys(e.lines).length > 0;

const percentOk = (text: string) => {
  const bp = parsePercentToBp(text);
  return bp !== null && Number(text.trim().replace(',', '.')) <= 100;
};

export function validateDraft(d: Draft): DraftErrors {
  const out: DraftErrors = { fields: {}, lines: {}, form: null };
  if (d.title.length > TITLE_MAX) out.fields.title = 'titleTooLong';
  if (d.buyerEmail.trim() && !EMAIL.test(d.buyerEmail.trim())) out.fields.email = 'emailInvalid';
  if (d.buyerPhone.trim() && normalizePhone(d.buyerPhone) === null)
    out.fields.phone = 'phoneInvalid';
  if (d.validUntil && !isDate(d.validUntil)) out.fields.validUntil = 'dateInvalid';
  if (d.notes.length > NOTES_MAX) out.fields.notes = 'notesTooLong';
  if (d.terms.length > TERMS_MAX) out.fields.terms = 'termsTooLong';
  if (d.taxRate.trim() && !percentOk(d.taxRate)) out.fields.docTax = 'docTaxInvalid';
  if (d.discountValue.trim()) {
    const ok =
      d.discountKind === 'percent'
        ? percentOk(d.discountValue)
        : parseMajor(d.discountValue, d.currency) !== null;
    if (!ok) out.fields.docDiscount = 'docDiscountInvalid';
  }

  const rows = d.lines.filter((l) => !isBlankLine(l));
  if (rows.length === 0) out.form = 'noItems';
  for (const l of rows) {
    const p: DraftErrors['lines'][string] = {};
    if (l.description.trim() === '') p.description = 'descriptionRequired';
    else if (l.description.trim().length > DESCRIPTION_MAX) p.description = 'descriptionTooLong';
    const qty = l.qty.trim();
    if (!/^\d{1,8}([.,]\d{0,4})?$/.test(qty) || Number(qty.replace(',', '.')) > QTY_MAX)
      p.qty = 'qtyInvalid';
    if (parseMajor(l.unit, d.currency) === null) p.unit = 'priceInvalid';
    if (l.discount.trim()) {
      const ok =
        l.discountKind === 'percent'
          ? percentOk(l.discount)
          : parseMajor(l.discount, d.currency) !== null;
      if (!ok) p.discount = 'discountInvalid';
    }
    if (l.tax.trim() && !percentOk(l.tax)) p.tax = 'taxInvalid';
    if (Object.keys(p).length) out.lines[l.key] = p;
  }
  if (!out.form && Object.keys(out.lines).length === 0 && draftTotals(d).overflow)
    out.form = 'tooLarge';
  return out;
}

/** The request body for a valid draft. Blank rows are left out. */
export function draftToInput(d: Draft): DocInput {
  const tax = bpOrZero(d.taxRate);
  return {
    title: d.title.trim(),
    contactId: d.contact?.id ?? null,
    dealId: d.deal?.id ?? null,
    buyer: {
      name: d.buyerName.trim(),
      email: d.buyerEmail.trim(),
      phone: normalizePhone(d.buyerPhone) ?? '',
    },
    currency: d.currency,
    items: d.lines
      .filter((l) => !isBlankLine(l))
      .map((l) => ({
        description: l.description.trim(),
        qty: normalizeQty(l.qty),
        unitPriceMinor: parseMajor(l.unit, d.currency) ?? 0,
        discount: readDiscount(l.discountKind, l.discount, d.currency),
        taxRateBp: l.tax.trim() === '' ? null : bpOrZero(l.tax),
      })),
    defaultTaxBp: tax,
    discount: docDiscountOf(d),
    notes: d.notes.trim(),
    terms: d.terms.trim(),
    validUntil: d.validUntil || null,
  };
}

/** True when the form differs from the saved one (so leaving would lose something). */
export function isDirty(a: Draft, b: Draft): boolean {
  const strip = (d: Draft) => ({
    ...d,
    lines: d.lines.filter((l) => !isBlankLine(l)).map(({ key: _key, ...l }) => l),
  });
  return JSON.stringify(strip(a)) !== JSON.stringify(strip(b));
}

// --- rows --------------------------------------------------------------------------------------------------------------

/** Moves a row to a new position (clamped). Returns a copy of the same order when nothing moves. */
export function moveLine<T>(lines: readonly T[], from: number, to: number): T[] {
  const target = Math.min(lines.length - 1, Math.max(0, to));
  if (from < 0 || from >= lines.length || from === target) return [...lines];
  const next = [...lines];
  const [row] = next.splice(from, 1);
  next.splice(target, 0, row!);
  return next;
}

/** Removes a row; the last row is never removed, it is cleared instead (the form always has a row to type in). */
export function removeLine(lines: readonly DraftLine[], key: string): DraftLine[] {
  const next = lines.filter((l) => l.key !== key);
  return next.length ? next : [blankLine()];
}

export function duplicateLine(lines: readonly DraftLine[], key: string): DraftLine[] {
  const at = lines.findIndex((l) => l.key === key);
  if (at < 0 || lines.length >= MAX_LINES) return [...lines];
  const next = [...lines];
  next.splice(at + 1, 0, { ...lines[at]!, key: newKey() });
  return next;
}

export function addLine(lines: readonly DraftLine[]): DraftLine[] {
  return lines.length >= MAX_LINES ? [...lines] : [...lines, blankLine()];
}

/** `YYYY-MM-DD` that is `days` after `today`. */
export function addDays(today: string, days: number): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
