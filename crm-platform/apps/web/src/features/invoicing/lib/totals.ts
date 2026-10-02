import { calculateDocument, formatRate, parseRate, TaxMathError, type LineInput } from '@crm/tax';
import { computeInvoice, type InvoiceIssue, type InvoiceWireContent } from '@crm/contracts';

/**
 * Live totals of an invoice form. THIS FILE DOES NOT DO MONEY MATH: it only resolves what the form holds into the wire shape of
 * `computeInvoice` (@crm/contracts, the very rule the API prices with) and, for lines whose tax is made of several parts (India's
 * CGST + SGST, Canada's GST + QST, whatever the tax engine decides in auto mode), into the `@crm/tax` engine's `calculateDocument`
 * (what the API calls for those lines too). Whatever the server answers after a save is the truth; this is the preview.
 */

/** One tax of a line: `CGST 9%`, `VAT 20%`. `code` groups the tax summary. */
export interface TaxItem {
  code: string;
  name: string;
  /** Percent as a decimal string ("9", "9.975"). */
  rate: string;
  compound?: boolean;
}

/** The tax a line carries: nothing (null), one named rate, or several parts. */
export interface LineTax {
  /** The printed name of the rate ("GST 18%"). */
  name: string | null;
  inclusive: boolean;
  items: TaxItem[];
}

export interface PricingLine {
  /** Decimal strings, as the wire carries them. */
  qty: string;
  unitPrice: string;
  discount: { kind: 'percent' | 'amount'; value: string } | null;
  tax: LineTax | null;
}

export interface PricingInput {
  currency: string;
  discount: { kind: 'percent' | 'amount'; value: string } | null;
  shipping: string | null;
  lines: PricingLine[];
  /** The buyer accounts for the tax: none is charged (the server drops it the same way). */
  reverseCharge?: boolean;
}

/** One row of the tax summary. */
export interface TaxRow {
  name: string;
  ratePercent: string;
  inclusive: boolean;
  /** The taxable amount, tax excluded. */
  baseMinor: number;
  taxMinor: number;
}

export interface LineView {
  grossMinor: number;
  discountMinor: number;
  /** What the line shows as its amount: gross less its own discount. */
  netMinor: number;
  taxMinor: number;
  totalMinor: number;
}

export interface TotalsView {
  currency: string;
  subtotalMinor: number;
  discountMinor: number;
  shippingMinor: number;
  taxMinor: number;
  /** The part of the tax added on top of the prices; an inclusive tax is already inside them. */
  taxAddedMinor: number;
  /** The tax already inside inclusive prices. */
  includedTaxMinor: number;
  totalMinor: number;
  taxRows: TaxRow[];
  lines: LineView[];
}

export type PricingResult =
  | { ok: true; totals: TotalsView; issues: [] }
  | { ok: false; totals: TotalsView; issues: InvoiceIssue[] };

export const emptyTotals = (currency: string): TotalsView => ({
  currency,
  subtotalMinor: 0,
  discountMinor: 0,
  shippingMinor: 0,
  taxMinor: 0,
  taxAddedMinor: 0,
  includedTaxMinor: 0,
  totalMinor: 0,
  taxRows: [],
  lines: [],
});

/** "GST 18%" and "CGST 9%" print once with their percent, whichever way the name was written. */
export function taxLabel(name: string | null | undefined, ratePercent: string): string {
  const pct = `${ratePercent}%`;
  const n = (name ?? '').trim();
  if (!n) return pct;
  return n.includes(pct) ? n : `${n} ${pct}`;
}

/** Percent strings of the parts of a tax, summed exactly ("9" + "9" = "18"). */
export function sumPercent(items: readonly TaxItem[]): string {
  let ppm = 0n;
  for (const t of items) ppm += parseRate(t.rate) ?? 0n;
  return formatRate(ppm);
}

/** True when `computeInvoice` (one percent per line, at most 2 decimals, no compounding) cannot hold the line's tax as it is. */
const needsEngine = (tax: LineTax | null): boolean => {
  if (!tax) return false;
  if (tax.items.length > 1) return true;
  const only = tax.items[0];
  return !!only && (!!only.compound || (only.rate.split('.')[1] ?? '').length > 2);
};

const n = (v: bigint): number => Number(v);

/** Prices the form. Reads like the server does: `computeInvoice` for the figures it can hold, `calculateDocument` for the rest. */
export function priceInvoice(input: PricingInput): PricingResult {
  const currency = input.currency.trim().toUpperCase();
  const taxOf = (l: PricingLine): LineTax | null => (input.reverseCharge ? null : l.tax);
  const complex = input.lines.some((l) => needsEngine(taxOf(l)));

  const wire: InvoiceWireContent = {
    currency,
    discount: input.discount,
    shipping: input.shipping,
    lines: input.lines.map((l) => {
      const tax = taxOf(l);
      const simple = tax && !needsEngine(tax) ? tax.items[0] : undefined;
      return {
        qty: l.qty,
        unitPrice: l.unitPrice,
        discount: l.discount,
        taxRate: simple ? simple.rate : '0',
        taxInclusive: tax?.inclusive ?? false,
        taxName: simple ? simple.code : (tax?.name ?? null),
      };
    }),
  };
  const priced = computeInvoice(wire);
  if (!priced.ok) return { ok: false, totals: emptyTotals(currency), issues: priced.issues };
  const v = priced.value;

  if (!complex) {
    const r = v.result;
    return {
      ok: true,
      issues: [],
      totals: {
        currency,
        subtotalMinor: n(r.subtotalMinor),
        discountMinor: n(r.discountMinor),
        shippingMinor: n(r.shippingMinor),
        taxMinor: n(r.taxMinor),
        taxAddedMinor: n(r.taxAddedMinor),
        includedTaxMinor: n(r.taxMinor - r.taxAddedMinor),
        totalMinor: n(r.totalMinor),
        taxRows: r.taxGroups.map((g) => ({
          name: g.name,
          ratePercent: formatRate(BigInt(g.rateBp) * 100n),
          inclusive: g.inclusive,
          baseMinor: n(g.baseMinor),
          taxMinor: n(g.taxMinor),
        })),
        lines: v.lines.map(({ result: x }) => ({
          grossMinor: n(x.grossMinor),
          discountMinor: n(x.discountMinor),
          netMinor: n(x.netMinor),
          taxMinor: n(x.taxMinor),
          totalMinor: n(x.totalMinor),
        })),
      },
    };
  }

  // Some line carries several taxes: the engine prices the document from the same parsed figures `computeInvoice` validated.
  try {
    const lines: LineInput[] = v.lines.map(({ input: p }, i) => {
      const tax = taxOf(input.lines[i]!);
      return {
        kind: 'item',
        qtyScaled: p.qtyScaled,
        unitPriceMinor: p.unitPriceMinor,
        discount: toEngineDiscount(p.discount),
        taxInclusive: tax?.inclusive ?? false,
        taxes: (tax?.items ?? []).map((t) => ({
          code: t.code,
          name: t.name,
          rate: t.rate,
          ...(t.compound ? { compound: true } : {}),
        })),
      };
    });
    if (v.shippingMinor > 0n) lines.push({ kind: 'shipping', unitPriceMinor: v.shippingMinor });
    const r = calculateDocument({ currency, discount: toEngineDiscount(v.discount), lines });
    return {
      ok: true,
      issues: [],
      totals: {
        currency,
        subtotalMinor: n(r.subtotalMinor),
        discountMinor: n(r.discountMinor),
        shippingMinor: n(v.shippingMinor),
        taxMinor: n(r.taxMinor),
        taxAddedMinor: n(r.taxAddedMinor),
        includedTaxMinor: n(r.taxMinor - r.taxAddedMinor),
        totalMinor: n(r.totalMinor),
        taxRows: r.taxSummary.map((g) => ({
          name: g.name,
          ratePercent: g.ratePercent,
          inclusive: g.inclusive,
          baseMinor: n(g.baseMinor),
          taxMinor: n(g.taxMinor),
        })),
        lines: v.lines.map((_, i) => {
          const x = r.lines[i]!;
          return {
            grossMinor: n(x.grossMinor),
            discountMinor: n(x.discountMinor),
            netMinor: n(x.netMinor),
            taxMinor: n(x.taxMinor),
            totalMinor: n(x.totalMinor),
          };
        }),
      },
    };
  } catch (err) {
    if (err instanceof TaxMathError) {
      return { ok: false, totals: emptyTotals(currency), issues: [{ path: err.path, message: err.message }] };
    }
    throw err;
  }
}

function toEngineDiscount(d: { kind: 'none' | 'percent' | 'amount'; value: bigint }) {
  if (d.kind === 'percent') return { kind: 'percent' as const, percent: formatRate(d.value * 100n) };
  if (d.kind === 'amount') return { kind: 'amount' as const, minor: d.value };
  return { kind: 'none' as const };
}

/** A quantity as printed: up to 2 decimals, zeros trimmed. */
export function qtyText(qty: string, locale: string): string {
  const v = Number(qty.replace(',', '.'));
  if (!Number.isFinite(v)) return qty;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(v);
}
