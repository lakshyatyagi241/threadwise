import type { CashRounding } from '../money/cash';
import type { RoundingMode } from '../money/rounding';

/**
 * Where the rounding happens.
 *  - `per_line`  every amount that comes out of a product or ratio is rounded to a whole minor unit at the step that produces it
 *                (line gross, line discount, line tax ...). Sums are exact sums of rounded amounts. Printed lines always add up.
 *                India (GST invoices list tax per line) and most POS systems.
 *  - `on_total`  lines are carried at full precision and only the document figures (subtotal, each tax group, ...) are rounded.
 *                Allowed in the EU (VAT per rate on the invoice total) and REQUIRED by Japan's qualified-invoice rule (one
 *                rounding per tax rate per invoice). Line figures shown on the document may then differ from the totals by
 *                a minor unit; that is expected.
 */
export type RoundingLevel = 'per_line' | 'on_total';

export type TaxCategory =
  | 'standard'
  | 'reduced'
  | 'super_reduced'
  | 'zero'
  | 'exempt'
  | 'reverse_charge'
  | 'out_of_scope'
  | 'sales_tax'
  | 'special'
  | 'withholding';

/** A tax to apply on a line. `rate` is a percent string or number ("18", "9.975", 7.5); at most 4 decimals. */
export interface LineTaxInput {
  /** Stable code for grouping and reporting: "VAT", "CGST", "IGST", "GST", "PST", "QST", "TDS_194J"... */
  code: string;
  /** Printed name: "VAT 20%", "CGST 9%". */
  name: string;
  rate: string | number;
  category?: TaxCategory;
  /**
   * Additive by default (every tax is charged on the taxable amount). `compound: true` charges THIS tax on the taxable amount PLUS
   * the taxes listed before it on the same line.
   */
  compound?: boolean;
}

/** A negative tax: tax or income-tax withheld by the payer (India TDS, Mexican retention). Use `rate < 0` or `category: "withholding"`. */
export type DiscountInput =
  | { kind: 'none' }
  | { kind: 'percent'; /** "10" or "12.5" (at most 4 decimals). */ percent: string | number }
  | { kind: 'amount'; /** Minor units. */ minor: bigint };

export type LineKind = 'item' | 'shipping' | 'adjustment';

export interface LineInput {
  /** Echoed back on the result; any caller key. */
  id?: string;
  description?: string;
  /** `item` (default) shares in the document discount; `shipping` and `adjustment` do not unless `discountable: true`. */
  kind?: LineKind;
  /** Quantity x 10^4 (QTY_SCALE); default 1.0000. */
  qtyScaled?: bigint;
  /** Minor units of the document currency. Negative only for `adjustment` lines (and credit-note style documents). */
  unitPriceMinor: bigint;
  discount?: DiscountInput;
  taxes?: readonly LineTaxInput[];
  /** Overrides `DocumentInput.pricesIncludeTax` for this line. */
  taxInclusive?: boolean;
  discountable?: boolean;
}

export interface DocumentInput {
  /** ISO 4217 code; decides the minor-unit exponent for parsing/formatting only (the math is exponent-free). */
  currency: string;
  /** Prices on the lines already contain their tax (retail / EU B2C style). Default false (exclusive). */
  pricesIncludeTax?: boolean;
  rounding?: { level?: RoundingLevel; mode?: RoundingMode };
  /** Document-level discount, spread over the lines in proportion to their net amounts. */
  discount?: DiscountInput;
  lines: readonly LineInput[];
  /** Round the payable total to a cash increment (CHF 0.05 ...). The difference becomes `roundingMinor`. */
  cashRounding?: CashRounding | null;
  /** Payments received and credit notes applied, minor units, each >= 0. */
  payments?: readonly bigint[];
  credits?: readonly bigint[];
}

export interface LineTaxResult {
  code: string;
  name: string;
  /** Percent as typed, normalised ("9.975"); always the magnitude (withholding is signed in `amountMinor`). */
  ratePercent: string;
  category: TaxCategory;
  compound: boolean;
  /** The amount the rate was applied to (excluding the tax itself). */
  baseMinor: bigint;
  /** Signed: negative for withholding. */
  amountMinor: bigint;
}

export interface LineResult {
  index: number;
  id?: string;
  kind: LineKind;
  grossMinor: bigint;
  /** The line's own discount. */
  discountMinor: bigint;
  /** gross - line discount. */
  netMinor: bigint;
  /** The line's share of the document discount. */
  sharedDiscountMinor: bigint;
  /** net - shared discount: the amount tax is charged on (or contained in, when inclusive). */
  taxableMinor: bigint;
  inclusive: boolean;
  taxes: LineTaxResult[];
  /** Sum of positive taxes. */
  taxMinor: bigint;
  /** Sum of withholding, as a positive magnitude. */
  withholdingMinor: bigint;
  /** What the buyer is invoiced for the line: taxable (+ taxes when exclusive). Withholding is not in it. */
  totalMinor: bigint;
}

/** One row of the invoice-footer tax summary (grouped by tax code + rate + inclusive). */
export interface TaxSummaryRow {
  key: string;
  code: string;
  name: string;
  ratePercent: string;
  category: TaxCategory;
  inclusive: boolean;
  /** Taxable amount EXCLUDING the tax itself. */
  baseMinor: bigint;
  taxMinor: bigint;
}

export interface WithholdingSummaryRow {
  key: string;
  code: string;
  name: string;
  ratePercent: string;
  baseMinor: bigint;
  /** Positive magnitude withheld. */
  amountMinor: bigint;
}

export type PaymentStatus = 'unpaid' | 'partially_paid' | 'paid' | 'overpaid';

export interface DocumentResult {
  currency: string;
  exponent: number;
  roundingLevel: RoundingLevel;
  roundingMode: RoundingMode;
  pricesIncludeTax: boolean;
  lines: LineResult[];
  /** Sum of item-line nets (gross less line discounts), before the document discount. */
  subtotalMinor: bigint;
  /** The document-level discount actually applied (clamped to the subtotal). */
  discountMinor: bigint;
  shippingMinor: bigint;
  adjustmentMinor: bigint;
  /** subtotal - discount + shipping + adjustment: what tax is charged on or contained in. */
  taxableMinor: bigint;
  /** All positive taxes (inclusive and exclusive). */
  taxMinor: bigint;
  /** Only the exclusive ones: what is added on top of the prices. */
  taxAddedMinor: bigint;
  taxSummary: TaxSummaryRow[];
  withholdingMinor: bigint;
  withholdingSummary: WithholdingSummaryRow[];
  /** taxable + taxAdded. */
  totalBeforeRoundingMinor: bigint;
  /** Cash-rounding adjustment line (signed); 0 when cash rounding is off. */
  roundingMinor: bigint;
  /** The invoice total: totalBeforeRounding + rounding. */
  totalMinor: bigint;
  /** total - withholding: what the buyer actually owes the seller (TDS is paid to the tax office by the buyer). */
  payableMinor: bigint;
  paidMinor: bigint;
  creditedMinor: bigint;
  amountDueMinor: bigint;
  overpaidMinor: bigint;
  paymentStatus: PaymentStatus;
}

export class TaxMathError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = 'TaxMathError';
  }
}
