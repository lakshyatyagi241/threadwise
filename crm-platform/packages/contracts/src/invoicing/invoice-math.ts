import { bpToPercent, calculateDocument, TaxMathError, type LineInput } from '@crm/tax';
import { currencyExponent } from '../deals-pipelines/money';
import {
  NO_DISCOUNT,
  parseMajor,
  parsePercentBp,
  parseQty,
  QTY_SCALE,
  toTaxDiscount,
  type DiscountSpec,
  type WireDiscount,
} from '../sales-docs/money';

/**
 * The money math of invoices (TW-INV-006, TW-INV-013, D-04, D-06). It is the SAME rule as proposals and estimates, not a copy of
 * it: gross, line discount, net, document discount and the line-by-line spread of that discount come from `calculateSalesDoc`
 * (sales-docs/money.ts); this file only adds what an invoice has and a quote does not: tax rates that are INCLUSIVE in the price,
 * and a shipping amount that is never discounted or taxed.
 *
 * THE ROUNDING RULE (one, shared with sales-docs): every amount that comes out of a product or a ratio is rounded to a whole minor
 * unit of the document's currency, half away from zero (all amounts are non-negative, so half up), at the step where it is
 * produced; sums are exact sums of already-rounded amounts, a sum is never rounded again. For tax, on a line's taxable amount
 * `t` (net less its share of the document discount) at rate `r`:
 *
 *   exclusive:  tax = round(t x r)            the buyer pays t + tax
 *   inclusive:  tax = t - round(t / (1 + r))  the buyer pays t; `tax` is the part of it that is tax
 *
 * Document figures, in the same order sales-docs reports them:
 *   subtotal   = sum of line nets (gross less the line discount)
 *   discount   = the document-level discount
 *   tax        = sum of line taxes (inclusive and exclusive)
 *   taxAdded   = sum of the exclusive taxes (what is added on top of the price)
 *   total      = subtotal - discount + taxAdded + shipping
 *
 * A currency's own number of decimals (ISO 4217: 0 for JPY, 3 for KWD) comes from `currencyExponent`; Reference divided by 100 for
 * every currency.
 */

export const INVOICE_MAX_LINES = 100;
export const INVOICE_MAX_MINOR = 1_000_000_000_000_000n;

export interface InvoiceCalcLineInput {
  /** Quantity x 10^4. */
  qtyScaled: bigint;
  unitPriceMinor: bigint;
  discount: DiscountSpec;
  /** Basis points; 0 for an untaxed line. */
  taxRateBp: number;
  taxInclusive: boolean;
  /** The label the tax summary groups under ("VAT", "GST 18%"); null reads as "Tax". */
  taxName: string | null;
}

export interface InvoiceCalcInput {
  discount: DiscountSpec;
  shippingMinor: bigint;
  lines: InvoiceCalcLineInput[];
}

export interface InvoiceCalcLineResult {
  grossMinor: bigint;
  discountMinor: bigint;
  netMinor: bigint;
  /** The line's share of the document discount. */
  sharedDiscountMinor: bigint;
  taxRateBp: number;
  taxInclusive: boolean;
  taxMinor: bigint;
  /** What the buyer pays for the line: net - share, plus the tax when it is exclusive. */
  totalMinor: bigint;
}

export interface InvoiceTaxGroup {
  name: string;
  rateBp: number;
  inclusive: boolean;
  /** The taxable amount excluding the tax itself. */
  baseMinor: bigint;
  taxMinor: bigint;
}

export interface InvoiceCalcResult {
  lines: InvoiceCalcLineResult[];
  subtotalMinor: bigint;
  discountMinor: bigint;
  taxMinor: bigint;
  taxAddedMinor: bigint;
  shippingMinor: bigint;
  totalMinor: bigint;
  taxGroups: InvoiceTaxGroup[];
}

export class InvoiceMathError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = 'InvoiceMathError';
  }
}

/**
 * Delegates to `@crm/tax` (the single totals implementation; docs/tax-engine.md): per_line rounding, half_up, one tax per line
 * (inclusive or exclusive), shipping as an undiscounted, untaxed `shipping` line. A differential test against the previous
 * in-file implementation agreed on 30,000 random invoices. The wire shapes (basis points, `InvoiceTaxGroup`) are unchanged.
 */
export function calculateInvoice(input: InvoiceCalcInput): InvoiceCalcResult {
  if (input.shippingMinor >= INVOICE_MAX_MINOR)
    throw new InvoiceMathError('shipping', 'amount is too large');
  try {
    const lines: LineInput[] = input.lines.map((l) => ({
      qtyScaled: l.qtyScaled,
      unitPriceMinor: l.unitPriceMinor,
      discount: toTaxDiscount(l.discount),
      taxInclusive: l.taxInclusive,
      // The code is the label so the engine groups the summary exactly as before: by name + rate + inclusive.
      taxes:
        l.taxRateBp > 0
          ? [{ code: l.taxName ?? 'Tax', name: l.taxName ?? 'Tax', rate: bpToPercent(l.taxRateBp) }]
          : [],
    }));
    if (input.shippingMinor > 0n)
      lines.push({ kind: 'shipping', unitPriceMinor: input.shippingMinor });
    const r = calculateDocument({
      currency: 'USD',
      discount: toTaxDiscount(input.discount),
      lines,
    });
    if (r.subtotalMinor >= INVOICE_MAX_MINOR)
      throw new InvoiceMathError('lines', 'amount is too large');
    return {
      lines: input.lines.map((l, i) => {
        const x = r.lines[i]!;
        return {
          grossMinor: x.grossMinor,
          discountMinor: x.discountMinor,
          netMinor: x.netMinor,
          sharedDiscountMinor: x.sharedDiscountMinor,
          taxRateBp: l.taxRateBp,
          taxInclusive: l.taxInclusive,
          taxMinor: x.taxMinor,
          totalMinor: x.totalMinor,
        };
      }),
      subtotalMinor: r.subtotalMinor,
      discountMinor: r.discountMinor,
      taxMinor: r.taxMinor,
      taxAddedMinor: r.taxAddedMinor,
      shippingMinor: input.shippingMinor,
      totalMinor: r.totalMinor,
      taxGroups: r.taxSummary
        .map((g) => ({
          name: g.code,
          rateBp: Math.round(Number(g.ratePercent) * 100),
          inclusive: g.inclusive,
          baseMinor: g.baseMinor,
          taxMinor: g.taxMinor,
        }))
        .sort(
          (a, b) =>
            a.rateBp - b.rateBp ||
            a.name.localeCompare(b.name) ||
            Number(a.inclusive) - Number(b.inclusive),
        ),
    };
  } catch (err) {
    if (err instanceof TaxMathError) throw new InvoiceMathError(err.path, err.message);
    throw err;
  }
}

// --- from the wire ----------------------------------------------------------------------------------------------------------

export interface InvoiceWireLine {
  qty: string;
  unitPrice: string;
  discount?: WireDiscount | null;
  /** Percent as a decimal string ("18", "7.25"); already resolved from a tax rate, "0" or absent for none. */
  taxRate?: string | null;
  taxInclusive?: boolean;
  taxName?: string | null;
}

export interface InvoiceWireContent {
  currency: string;
  discount?: WireDiscount | null;
  /** Major units, "0" when absent. */
  shipping?: string | null;
  lines: InvoiceWireLine[];
}

export interface InvoiceIssue {
  path: string;
  message: string;
}

export interface ComputedInvoice {
  currency: string;
  exponent: number;
  discount: DiscountSpec;
  shippingMinor: bigint;
  lines: Array<{ input: InvoiceCalcLineInput; result: InvoiceCalcLineResult }>;
  result: InvoiceCalcResult;
}

function discountOf(
  d: WireDiscount | null | undefined,
  currency: string,
  path: string,
  issues: InvoiceIssue[],
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
 * Prices an invoice from what a client sends (tax rates already resolved to a percent). Returns the parsed lines with their
 * results, or every problem found, each with the path of the offending field. The web form's live preview calls this too.
 */
export function computeInvoice(
  content: InvoiceWireContent,
): { ok: true; value: ComputedInvoice } | { ok: false; issues: InvoiceIssue[] } {
  const issues: InvoiceIssue[] = [];
  const currency = content.currency.toUpperCase();
  const exponent = currencyExponent(currency);
  const discount = discountOf(content.discount, currency, 'discount', issues);
  const shipping = parseMajor(content.shipping ?? '0', currency);
  if (shipping === null) {
    issues.push({
      path: 'shipping',
      message: `an amount has at most ${exponent} decimals in ${currency}`,
    });
  }
  if (content.lines.length === 0)
    issues.push({ path: 'lines', message: 'an invoice needs at least one line' });
  if (content.lines.length > INVOICE_MAX_LINES) {
    issues.push({ path: 'lines', message: `an invoice has at most ${INVOICE_MAX_LINES} lines` });
  }

  const inputs: InvoiceCalcLineInput[] = [];
  content.lines.forEach((l, i) => {
    const qty = parseQty(l.qty);
    if (qty === null || qty === 0n) {
      issues.push({
        path: `lines.${i}.qty`,
        message: `a quantity is above 0 with at most ${QTY_SCALE} decimals`,
      });
    }
    const unit = parseMajor(l.unitPrice, currency);
    if (unit === null) {
      issues.push({
        path: `lines.${i}.unitPrice`,
        message: `a price has at most ${exponent} decimals in ${currency}`,
      });
    }
    let bp = 0;
    if (l.taxRate !== undefined && l.taxRate !== null) {
      const parsed = parsePercentBp(l.taxRate);
      if (parsed === null || parsed > 10_000) {
        issues.push({
          path: `lines.${i}.taxRate`,
          message: 'a tax rate is between 0 and 100 with at most 2 decimals',
        });
      } else bp = parsed;
    }
    inputs.push({
      qtyScaled: qty ?? 0n,
      unitPriceMinor: unit ?? 0n,
      discount: discountOf(l.discount, currency, `lines.${i}.discount`, issues),
      taxRateBp: bp,
      taxInclusive: l.taxInclusive ?? false,
      taxName: l.taxName ?? null,
    });
  });
  if (issues.length > 0) return { ok: false, issues };

  try {
    const result = calculateInvoice({ discount, shippingMinor: shipping ?? 0n, lines: inputs });
    return {
      ok: true,
      value: {
        currency,
        exponent,
        discount,
        shippingMinor: shipping ?? 0n,
        lines: inputs.map((input, i) => ({ input, result: result.lines[i]! })),
        result,
      },
    };
  } catch (err) {
    if (err instanceof InvoiceMathError)
      return { ok: false, issues: [{ path: err.path, message: err.message }] };
    // calculateSalesDoc throws its own error type for an amount it cannot hold; its `path` is what a form needs.
    if (
      err instanceof Error &&
      'path' in err &&
      typeof (err as { path: unknown }).path === 'string'
    ) {
      return {
        ok: false,
        issues: [{ path: (err as { path: string }).path, message: err.message }],
      };
    }
    throw err;
  }
}
