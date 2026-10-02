import { bpToPercent, calculateDocument, TaxMathError, type DiscountInput } from '@crm/tax';
import { currencyExponent } from '../deals-pipelines/money';

/**
 * The money math of proposals and estimates (TW-PROP-006, D-03, D-10): ONE pure function that the API uses to price a document and the
 * web form uses for its live preview, so what the buyer is shown is what is saved to the minor unit.
 *
 * Everything is `bigint`; no float is involved at any step.
 *
 * THE ROUNDING RULE (the only one): every amount that comes out of a product or a ratio is rounded to a whole minor unit of the
 * document's currency, half away from zero, at the step where it is produced. All amounts are non-negative, so that is "half up".
 * Sums are exact sums of already-rounded amounts. The steps, in order:
 *
 *   1. line gross      = round(qty x unit price)                  (qty has up to 4 decimals)
 *   2. line discount   = percent: round(gross x p)   |  amount: min(a, gross)
 *   3. line net        = gross - line discount
 *   4. subtotal        = sum of line nets
 *   5. document discount = percent: round(subtotal x p) | amount: min(a, subtotal)
 *   6. the document discount is spread over the lines in proportion to their nets (largest remainder, ties to the earlier line),
 *      so the shares add back to the discount exactly and a mixed-rate document taxes each line on what it really costs
 *   7. line tax        = round((line net - its discount share) x line rate)   (a line without a rate uses the document's rate)
 *   8. tax             = sum of line taxes
 *   9. total           = subtotal - document discount + tax          (tax is added on top: prices are tax-exclusive)
 *
 * Currencies carry their own number of decimals (ISO 4217: 0 for JPY, 3 for KWD), taken from `currencyExponent`.
 */

export const QTY_SCALE = 4;
export const RATE_SCALE = 2; // percent with two decimals -> basis points
export const SALES_DOC_MAX_LINES = 200;
/** No single amount may reach 10^15 minor units (a document total must stay well inside a JS safe integer and a bigint column). */
export const SALES_DOC_MAX_MINOR = 1_000_000_000_000_000n;

export const DISCOUNT_KINDS = ['none', 'percent', 'amount'] as const;
export type DiscountKind = (typeof DISCOUNT_KINDS)[number];

/** `percent`: `value` is basis points (1250 = 12.5%); `amount`: `value` is minor units; `none`: 0. */
export interface DiscountSpec {
  kind: DiscountKind;
  value: bigint;
}
export const NO_DISCOUNT: DiscountSpec = { kind: 'none', value: 0n };

export interface CalcLineInput {
  /** Quantity x 10^4. */
  qtyScaled: bigint;
  unitPriceMinor: bigint;
  discount: DiscountSpec;
  /** Basis points; null follows the document's default rate. */
  taxRateBp: number | null;
}

export interface CalcInput {
  defaultTaxRateBp: number;
  discount: DiscountSpec;
  lines: CalcLineInput[];
}

export interface CalcLineResult {
  grossMinor: bigint;
  discountMinor: bigint;
  netMinor: bigint;
  /** The part of the document discount this line carries (already out of the base the tax is computed on). */
  sharedDiscountMinor: bigint;
  taxRateBp: number;
  taxMinor: bigint;
}

export interface CalcResult {
  lines: CalcLineResult[];
  subtotalMinor: bigint;
  /** The document-level discount (line discounts are inside `subtotalMinor`'s lines, not in here). */
  discountMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
}

/** Thrown by `calculateSalesDoc` when an amount cannot be represented; `computeSalesDoc` turns it into an issue. */
export class SalesDocMathError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = 'SalesDocMathError';
  }
}

/** round-half-up of n / d for n >= 0, d > 0. */
export function divRound(n: bigint, d: bigint): bigint {
  return (2n * n + d) / (2n * d);
}

/** A `DiscountSpec` (basis points / minor units) as the `@crm/tax` engine takes it. */
export function toTaxDiscount(d: DiscountSpec): DiscountInput {
  if (d.kind === 'percent') return { kind: 'percent', percent: bpToPercent(d.value) };
  if (d.kind === 'amount') return { kind: 'amount', minor: d.value };
  return { kind: 'none' };
}

/** Spreads `total` over `weights` by largest remainder; the shares add back to `total` exactly. */
export function allocateProportionally(total: bigint, weights: bigint[]): bigint[] {
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (total === 0n || sum === 0n) return weights.map(() => 0n);
  const base = weights.map((w) => (total * w) / sum);
  const rem = weights.map((w) => (total * w) % sum);
  let left = total - base.reduce((a, b) => a + b, 0n);
  const order = weights
    .map((_, i) => i)
    .sort((a, b) => (rem[b]! > rem[a]! ? 1 : rem[b]! < rem[a]! ? -1 : a - b));
  for (const i of order) {
    if (left === 0n) break;
    if (rem[i]! > 0n) {
      base[i] = base[i]! + 1n;
      left -= 1n;
    }
  }
  return base;
}

/**
 * Delegates to `@crm/tax` (the single totals implementation; docs/tax-engine.md). The rule above is exactly the engine's
 * `per_line` / `half_up` mode with tax-exclusive prices: a differential test against the previous in-file implementation agreed
 * on 30,000 random documents. This wrapper only converts basis points and `DiscountSpec` to the engine's input.
 */
export function calculateSalesDoc(input: CalcInput): CalcResult {
  try {
    const r = calculateDocument({
      currency: 'USD', // the engine's math is exponent-free (minor units in, minor units out)
      discount: toTaxDiscount(input.discount),
      lines: input.lines.map((l) => {
        const bp = l.taxRateBp ?? input.defaultTaxRateBp;
        return {
          qtyScaled: l.qtyScaled,
          unitPriceMinor: l.unitPriceMinor,
          discount: toTaxDiscount(l.discount),
          taxes: bp > 0 ? [{ code: 'TAX', name: 'Tax', rate: bpToPercent(bp) }] : [],
        };
      }),
    });
    if (r.subtotalMinor >= SALES_DOC_MAX_MINOR)
      throw new SalesDocMathError('lines', 'amount is too large');
    return {
      lines: r.lines.map((l, i) => ({
        grossMinor: l.grossMinor,
        discountMinor: l.discountMinor,
        netMinor: l.netMinor,
        sharedDiscountMinor: l.sharedDiscountMinor,
        taxRateBp: input.lines[i]!.taxRateBp ?? input.defaultTaxRateBp,
        taxMinor: l.taxMinor,
      })),
      subtotalMinor: r.subtotalMinor,
      discountMinor: r.discountMinor,
      taxMinor: r.taxMinor,
      totalMinor: r.totalMinor,
    };
  } catch (err) {
    if (err instanceof TaxMathError) throw new SalesDocMathError(err.path, err.message);
    throw err;
  }
}

// --- wire parsing and formatting -------------------------------------------------------------------------------------------

/** `"12.5"` at scale 4 -> 125000n. Null when malformed or when it carries a non-zero digit past the scale. Exact. */
export function parseScaled(value: string, scale: number): bigint | null {
  const m = /^(\d{1,15})(?:\.(\d+))?$/.exec(value.trim());
  if (!m) return null;
  const frac = m[2] ?? '';
  if (frac.length > scale && /[1-9]/.test(frac.slice(scale))) return null;
  return BigInt(m[1]! + (frac + '0'.repeat(scale)).slice(0, scale));
}

/** 125000n at scale 4 -> "12.5" (trailing zeros dropped). */
export function formatScaled(n: bigint, scale: number): string {
  const s = n.toString().padStart(scale + 1, '0');
  const whole = s.slice(0, s.length - scale);
  const frac = s.slice(s.length - scale).replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : whole;
}

export const parseQty = (v: string): bigint | null => parseScaled(v, QTY_SCALE);
export const formatQty = (n: bigint): string => formatScaled(n, QTY_SCALE);
/** "18.5" -> 1850 basis points. */
export const parsePercentBp = (v: string): number | null => {
  const n = parseScaled(v, RATE_SCALE);
  return n === null ? null : Number(n);
};
export const formatPercent = (bp: number | bigint): string => formatScaled(BigInt(bp), RATE_SCALE);
/** Major units to minor units in the currency's own exponent, exact. */
export const parseMajor = (v: string, currency: string): bigint | null =>
  parseScaled(v, currencyExponent(currency));

export interface WireDiscount {
  kind: 'percent' | 'amount';
  value: string;
}
export interface WireLine {
  description?: string;
  qty: string;
  unitPrice: string;
  discount?: WireDiscount | null;
  taxRate?: string | null;
}
export interface WireContent {
  currency: string;
  /** Percent, "0" when absent. */
  taxRate?: string | null;
  discount?: WireDiscount | null;
  lines: WireLine[];
}

export interface SalesDocIssue {
  path: string;
  message: string;
}

export interface ComputedSalesDoc {
  currency: string;
  exponent: number;
  defaultTaxRateBp: number;
  discount: DiscountSpec;
  lines: Array<{ input: CalcLineInput; result: CalcLineResult }>;
  subtotalMinor: bigint;
  discountMinor: bigint;
  taxMinor: bigint;
  totalMinor: bigint;
}

function parseDiscount(
  d: WireDiscount | null | undefined,
  currency: string,
  path: string,
  issues: SalesDocIssue[],
): DiscountSpec {
  if (!d) return NO_DISCOUNT;
  if (d.kind === 'percent') {
    const bp = parsePercentBp(d.value);
    if (bp === null || bp > 10_000) {
      issues.push({
        path,
        message: 'a percent discount is between 0 and 100 with at most 2 decimals',
      });
      return NO_DISCOUNT;
    }
    return bp === 0 ? NO_DISCOUNT : { kind: 'percent', value: BigInt(bp) };
  }
  const minor = parseMajor(d.value, currency);
  if (minor === null) {
    issues.push({
      path,
      message: `an amount has at most ${currencyExponent(currency)} decimals in ${currency}`,
    });
    return NO_DISCOUNT;
  }
  return minor === 0n ? NO_DISCOUNT : { kind: 'amount', value: minor };
}

/**
 * Prices a document from what a client sends. Returns the parsed lines with their results, or every problem found (each with the
 * path of the offending field) so a form can show them inline and the API can answer 422 with the same list.
 */
export function computeSalesDoc(
  content: WireContent,
): { ok: true; value: ComputedSalesDoc } | { ok: false; issues: SalesDocIssue[] } {
  const issues: SalesDocIssue[] = [];
  const currency = content.currency.toUpperCase();
  const exponent = currencyExponent(currency);
  const defaultBp = parsePercentBp(content.taxRate ?? '0');
  if (defaultBp === null || defaultBp > 10_000) {
    issues.push({
      path: 'taxRate',
      message: 'a tax rate is between 0 and 100 with at most 2 decimals',
    });
  }
  const discount = parseDiscount(content.discount, currency, 'discount', issues);

  const inputs: CalcLineInput[] = [];
  content.lines.forEach((l, i) => {
    const qty = parseQty(l.qty);
    if (qty === null)
      issues.push({ path: `lines.${i}.qty`, message: 'a quantity has at most 4 decimals' });
    const unit = parseMajor(l.unitPrice, currency);
    if (unit === null) {
      issues.push({
        path: `lines.${i}.unitPrice`,
        message: `a price has at most ${exponent} decimals in ${currency}`,
      });
    }
    let bp: number | null = null;
    if (l.taxRate !== undefined && l.taxRate !== null) {
      bp = parsePercentBp(l.taxRate);
      if (bp === null || bp > 10_000) {
        issues.push({
          path: `lines.${i}.taxRate`,
          message: 'a tax rate is between 0 and 100 with at most 2 decimals',
        });
        bp = null;
      }
    }
    inputs.push({
      qtyScaled: qty ?? 0n,
      unitPriceMinor: unit ?? 0n,
      discount: parseDiscount(l.discount, currency, `lines.${i}.discount`, issues),
      taxRateBp: bp,
    });
  });
  if (issues.length > 0) return { ok: false, issues };

  try {
    const r = calculateSalesDoc({ defaultTaxRateBp: defaultBp ?? 0, discount, lines: inputs });
    return {
      ok: true,
      value: {
        currency,
        exponent,
        defaultTaxRateBp: defaultBp ?? 0,
        discount,
        lines: inputs.map((input, i) => ({ input, result: r.lines[i]! })),
        subtotalMinor: r.subtotalMinor,
        discountMinor: r.discountMinor,
        taxMinor: r.taxMinor,
        totalMinor: r.totalMinor,
      },
    };
  } catch (err) {
    if (err instanceof SalesDocMathError)
      return { ok: false, issues: [{ path: err.path, message: err.message }] };
    throw err;
  }
}

/** The amounts of a computed document as the strings the wire carries (minor units, plus the same in major units). */
export function salesDocAmounts(
  c: Pick<
    ComputedSalesDoc,
    'currency' | 'subtotalMinor' | 'discountMinor' | 'taxMinor' | 'totalMinor'
  >,
) {
  const major = (n: bigint) => {
    const exp = currencyExponent(c.currency);
    const s = n.toString().padStart(exp + 1, '0');
    return exp === 0 ? s : `${s.slice(0, s.length - exp)}.${s.slice(s.length - exp)}`;
  };
  return {
    subtotalMinor: c.subtotalMinor.toString(),
    discountMinor: c.discountMinor.toString(),
    taxMinor: c.taxMinor.toString(),
    totalMinor: c.totalMinor.toString(),
    subtotal: major(c.subtotalMinor),
    discount: major(c.discountMinor),
    tax: major(c.taxMinor),
    total: major(c.totalMinor),
  };
}
