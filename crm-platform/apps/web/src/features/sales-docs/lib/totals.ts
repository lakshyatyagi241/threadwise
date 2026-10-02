import {
  NO_DISCOUNT,
  QTY_SCALE as QTY_DECIMALS,
  SalesDocMathError,
  calculateSalesDoc,
  type DiscountSpec,
} from '@crm/contracts';

/**
 * The money of a sales document on the client. There is NO rounding rule here: `calculateSalesDoc` from `@crm/contracts` is the
 * one pricing function (the API prices every saved document with it), so the live preview and the saved total cannot differ by
 * a minor unit. This module only adapts what the form holds (strings the person typed, numbers in minor units) to it and groups
 * the answer for display.
 *
 * The rule, from the contract: every product or ratio is rounded to a whole minor unit, half away from zero, where it is made:
 * line gross = round(qty x price); line discount (percent: round, amount: capped at the gross); the document discount is
 * rounded the same way and spread over the lines by net value (largest remainder); each line's tax is round(taxable x rate);
 * tax is added on top. Quantities have up to 4 decimals.
 */

export const QTY_SCALE = 10n ** BigInt(QTY_DECIMALS);
/** Longest quantity accepted, in whole units. */
export const QTY_MAX = 99_999_999;

/** A discount as the form holds it: a percentage in basis points, or an amount in minor units. */
export type DocDiscount =
  { kind: 'percent'; bp: number } | { kind: 'amount'; minor: number } | null;

export interface LineInput {
  /** Decimal string, up to 4 decimals ("2", "0.5", "1.25"); anything unreadable counts as 0. */
  qty: string;
  unitPriceMinor: number;
  discount: DocDiscount;
  /** Tax rate of this line in basis points; null takes `defaultTaxBp`. */
  taxBp: number | null;
}

export interface TotalsInput {
  lines: readonly LineInput[];
  discount: DocDiscount;
  defaultTaxBp: number;
}

export interface LineTotals {
  grossMinor: number;
  discountMinor: number;
  netMinor: number;
  taxBp: number;
  taxMinor: number;
}

export interface TaxGroup {
  rateBp: number;
  /** Net amount of the lines at this rate after their share of the document discount. */
  baseMinor: number;
  taxMinor: number;
}

export interface Totals {
  lines: LineTotals[];
  subtotalMinor: number;
  discountMinor: number;
  taxGroups: TaxGroup[];
  taxMinor: number;
  totalMinor: number;
  /** An amount is too large to price (the server refuses it too); every figure is 0 then. */
  overflow: boolean;
}

/** `"2.5"` -> 25000n (x10000); extra decimals round half up; unreadable or negative -> 0n. */
export function parseQty(text: string): bigint {
  const m = /^(\d{1,9})(?:\.(\d*))?$/.exec(text.trim().replace(',', '.'));
  if (!m) return 0n;
  const frac = m[2] ?? '';
  let v = BigInt(m[1]! + frac.slice(0, 4).padEnd(4, '0'));
  if (frac.length > 4 && frac.charCodeAt(4) >= 53) v += 1n;
  return v;
}

/** A scaled quantity as the shortest decimal string (25000n -> "2.5", 10000n -> "1"). */
export function formatQty(scaled: bigint): string {
  const s = scaled.toString().padStart(5, '0');
  const frac = s.slice(-4).replace(/0+$/, '');
  return frac ? `${s.slice(0, -4)}.${frac}` : s.slice(0, -4);
}

/** What a person typed as a quantity, as the shortest exact decimal string ("2,50" -> "2.5"). */
export const normalizeQty = (text: string): string => formatQty(parseQty(text));

const clampBp = (bp: number) =>
  Math.min(10_000, Math.max(0, Math.round(Number.isFinite(bp) ? bp : 0)));
const clampMinor = (n: number) => (Number.isFinite(n) && n > 0 ? BigInt(Math.round(n)) : 0n);

function specOf(d: DocDiscount): DiscountSpec {
  if (!d) return NO_DISCOUNT;
  if (d.kind === 'percent') {
    const bp = clampBp(d.bp);
    return bp === 0 ? NO_DISCOUNT : { kind: 'percent', value: BigInt(bp) };
  }
  const minor = clampMinor(d.minor);
  return minor === 0n ? NO_DISCOUNT : { kind: 'amount', value: minor };
}

const ZERO: Totals = {
  lines: [],
  subtotalMinor: 0,
  discountMinor: 0,
  taxGroups: [],
  taxMinor: 0,
  totalMinor: 0,
  overflow: false,
};

export function computeTotals(input: TotalsInput): Totals {
  const defaultTax = clampBp(input.defaultTaxBp);
  let r: ReturnType<typeof calculateSalesDoc>;
  try {
    r = calculateSalesDoc({
      defaultTaxRateBp: defaultTax,
      discount: specOf(input.discount),
      lines: input.lines.map((l) => ({
        qtyScaled: parseQty(l.qty),
        unitPriceMinor: clampMinor(l.unitPriceMinor),
        discount: specOf(l.discount),
        taxRateBp: l.taxBp === null ? null : clampBp(l.taxBp),
      })),
    });
  } catch (e) {
    if (e instanceof SalesDocMathError) {
      return {
        ...ZERO,
        overflow: true,
        lines: input.lines.map((l) => ({
          grossMinor: 0,
          discountMinor: 0,
          netMinor: 0,
          taxBp: l.taxBp ?? defaultTax,
          taxMinor: 0,
        })),
      };
    }
    throw e;
  }

  // one group per tax rate, in the order the rates first appear
  const groups = new Map<number, TaxGroup>();
  for (const l of r.lines) {
    const g = groups.get(l.taxRateBp) ?? { rateBp: l.taxRateBp, baseMinor: 0, taxMinor: 0 };
    g.baseMinor += Number(l.netMinor - l.sharedDiscountMinor);
    g.taxMinor += Number(l.taxMinor);
    groups.set(l.taxRateBp, g);
  }

  return {
    lines: r.lines.map((l) => ({
      grossMinor: Number(l.grossMinor),
      discountMinor: Number(l.discountMinor),
      netMinor: Number(l.netMinor),
      taxBp: l.taxRateBp,
      taxMinor: Number(l.taxMinor),
    })),
    subtotalMinor: Number(r.subtotalMinor),
    discountMinor: Number(r.discountMinor),
    taxGroups: [...groups.values()].filter((g) => g.taxMinor > 0),
    taxMinor: Number(r.taxMinor),
    totalMinor: Number(r.totalMinor),
    overflow: false,
  };
}
