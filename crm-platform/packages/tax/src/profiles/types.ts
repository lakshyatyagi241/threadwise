import type { RoundingMode } from '../money/rounding';
import type { LineTaxInput, RoundingLevel, TaxCategory } from '../totals/types';

/**
 * Country tax profiles are DATA plus one resolver function. They are defaults the business must verify with its accountant
 * or tax authority: rates and rules change. Every rate row carries an effective date range so past documents stay reproducible.
 */

export type TaxType =
  | 'vat'
  | 'gst'
  | 'cgst'
  | 'sgst'
  | 'utgst'
  | 'igst'
  | 'hst'
  | 'pst'
  | 'qst'
  | 'sales_tax'
  | 'sst'
  | 'consumption_tax'
  | 'iva'
  | 'tds'
  | 'tcs'
  | 'withholding'
  | 'custom';

export type SupplyType = 'goods' | 'services' | 'digital';

export interface RateRow {
  /** Stable code of the rate within the profile ("GST_18", "VAT_STD", "HST_ON"). */
  code: string;
  name: string;
  type: TaxType;
  category: TaxCategory;
  /** Percent string, up to 4 decimals. */
  ratePercent: string;
  /** ISO date (YYYY-MM-DD), inclusive. */
  effectiveFrom: string;
  /** ISO date, inclusive; omitted = still in force. */
  effectiveTo?: string;
  /** Sub-national scope (Indian state code is NOT used here; Canadian province, US state). Omitted = national. */
  region?: string;
  /** Limits the row to some kinds of supply (Malaysian sales tax on goods vs service tax). Omitted = any. */
  appliesTo?: readonly SupplyType[];
  /** Default price mode for this tax in the country: true = prices usually quoted tax-inclusive (retail B2C). */
  inclusiveDefault?: boolean;
  note?: string;
  /** True when a user is expected to pick it explicitly rather than have it auto-applied (reduced / special rates). */
  isDefault?: boolean;
}

export interface TaxIdResult {
  valid: boolean;
  /** Canonical form (spaces and separators stripped, upper case). */
  normalized?: string;
  /** `checksum` = structure and check digits verified; `format` = shape only (no public checksum or not implemented). */
  level: 'checksum' | 'format';
  reason?: string;
  /** Parsed parts (state code, PAN, country prefix ...). */
  details?: Record<string, string>;
}

export interface TaxIdSpec {
  id: string;
  label: string;
  /** Short example of a well-formed number (not a real registration). */
  example: string;
  validate(raw: string): TaxIdResult;
}

export type Requirement =
  'required' | 'required_if_registered' | 'b2b_only' | 'optional' | 'not_applicable';

export type ChecklistCondition =
  | 'always'
  | 'b2b'
  | 'b2c'
  | 'reverse_charge'
  | 'export'
  | 'inter_state'
  | 'intra_state'
  | 'above_threshold'
  | 'composition'
  | 'exempt_or_zero'
  | 'simplified_not_allowed';

/** One legally mandatory (or recommended) item on an invoice. `field` uses the shared vocabulary of `InvoiceFacts`. */
export interface ChecklistItem {
  field: string;
  label: string;
  level: 'required' | 'recommended';
  when: ChecklistCondition;
  /** A text the document must contain ("TAX INVOICE"), where the law fixes it. */
  mustContain?: string;
  /** Threshold in MAJOR units of the profile currency for `above_threshold`. */
  thresholdMajor?: string;
  note?: string;
}

export interface FiscalYearConfig {
  /** 1-12 */
  startMonth: number;
  /** 1-31 */
  startDay: number;
  /** How the year is labelled on invoice numbers: "2026-27", "2026-2027", "2026", "26-27". */
  labelFormat: 'YYYY-YY' | 'YYYY-YYYY' | 'YYYY' | 'YY-YY' | 'YY';
  note?: string;
}

export type SequenceReset = 'never' | 'yearly' | 'fiscal_year' | 'monthly';

export interface NumberingRules {
  /** Suggested pattern; tokens: {PREFIX} {FY} {YYYY} {YY} {MM} {SEQ}. */
  pattern: string;
  defaultPrefix: string;
  seqPad: number;
  reset: SequenceReset;
  /** Maximum characters the law allows (India: 16). */
  maxLength?: number;
  /** Characters allowed; a RegExp source for the whole number. */
  allowed?: string;
  /** Legal rule about the sequence ("consecutive, unique per fiscal year"). */
  rule: string;
  gapsAllowed: boolean;
}

export interface Source {
  name: string;
  url: string;
  /** When the preset was last checked (ISO date). */
  asOf: string;
}

export interface TaxProfile {
  /** ISO 3166-1 alpha-2 (or "CUSTOM"). Greece is "GR". */
  code: string;
  name: string;
  /** Default currency. */
  currency: string;
  /** Default BCP 47 locale for formatting. */
  locale: string;
  /** "GST", "VAT", "Sales tax" ... as the customer knows it. */
  taxLabel: string;
  /** `note_only` = no automatic rates (Brazil, Qatar, Kuwait, custom); the user enters tax by hand. */
  support: 'full' | 'rates_only' | 'note_only';
  /** Is a single tax-inclusive price the norm for consumers? Seeds the "prices include tax" toggle. */
  pricesIncludeTaxDefault: boolean;
  rounding: {
    level: RoundingLevel;
    mode: RoundingMode;
    /** True when the law dictates it (not just a sensible default). */
    dictatedByLaw: boolean;
    note: string;
  };
  rates: readonly RateRow[];
  /** Withholding / TDS / TCS options a seller can pick per invoice. */
  withholding?: readonly RateRow[];
  sellerTaxId: { spec: TaxIdSpec | null; requirement: Requirement; note?: string };
  buyerTaxId: { spec: TaxIdSpec | null; requirement: Requirement; note?: string };
  /** Extra identifiers (PAN, company number ...). */
  otherIds?: readonly TaxIdSpec[];
  /** Titles the document type must carry, e.g. { tax_invoice: "TAX INVOICE" }. */
  documentTitles: Readonly<Record<string, string>>;
  checklist: readonly ChecklistItem[];
  fiscalYear: FiscalYearConfig;
  numbering: NumberingRules;
  /** Subdivisions the resolver understands (Indian states, Canadian provinces, US states). */
  regions?: readonly { code: string; name: string }[];
  /** Plain-language notes shown next to the preset (thresholds, schemes, e-invoicing mandates, gaps). */
  notes: readonly string[];
  sources: readonly Source[];
  resolve(input: ResolveContext): ResolveResult;
}

// ---------------------------------------------------------------------------------------------------------------------------

export interface SellerInfo {
  /** Seller's region: Indian state code ("27"/"MH"), US state ("TX"), Canadian province ("ON"). */
  region?: string;
  taxId?: string;
  /** Default: registered when a tax id is present. */
  registered?: boolean;
  scheme?: 'regular' | 'composition' | 'flat_rate' | 'small_supplier' | 'oss' | 'none';
  /** Regions where the seller is registered or has nexus for sub-national taxes (US states, Canadian PST/QST). */
  registeredRegions?: readonly string[];
  /** Country of establishment when it differs from the profile (rare). */
  country?: string;
}

export interface BuyerInfo {
  /** ISO alpha-2 country. */
  country: string;
  /** Delivery / place-of-supply region where it matters (Indian state, province, US state). */
  region?: string;
  type?: 'business' | 'consumer';
  taxId?: string;
  /** Tax-exempt buyer (US resale/exemption certificate on file, diplomatic, charity ...). */
  taxExempt?: boolean;
  /** India: buyer is a unit in a Special Economic Zone. */
  isSez?: boolean;
}

export interface ProductInfo {
  /** Rate category the product normally has. `standard` when unknown. */
  category?: 'standard' | 'reduced' | 'super_reduced' | 'zero' | 'exempt' | 'special';
  /** HSN / SAC / commodity code, carried to the invoice. */
  code?: string;
  /** Explicit rate on the product (e.g. its GST slab), percent. Wins over `category`. */
  ratePercent?: string | number;
  /** Charged under the reverse-charge mechanism (India RCM, UK domestic reverse charge). */
  reverseCharge?: boolean;
  /** Printed tax name for the custom profile. */
  taxName?: string;
}

export interface ResolveContext {
  seller: SellerInfo;
  buyer: BuyerInfo;
  product: ProductInfo;
  supplyType: SupplyType;
  /** Supply date, ISO (YYYY-MM-DD). Picks the rate row in force on that day. */
  date: string;
  /** Replace the table rate with this percent (US local rates, a rate the profile lacks). */
  overrideRatePercent?: string | number;
  /** Withholding rows (codes from `profile.withholding`) the user opted into. */
  withholdingCodes?: readonly string[];
}

export interface ResolveResult {
  /** Taxes to put on the line, in order. Empty = no tax. */
  taxes: LineTaxInput[];
  /** One sentence per decision, for the "Why this tax?" panel. */
  reasons: string[];
  /** Things the user should double-check. */
  warnings: string[];
  /** Wording the document should print ("Reverse charge ...", "Supply meant for export ..."). */
  documentNotes: string[];
  /** Document type hint when tax cannot be charged ("bill_of_supply"). */
  documentTypeHint?: 'tax_invoice' | 'bill_of_supply' | 'invoice';
  placeOfSupply?: { country: string; region?: string };
  reverseCharge: boolean;
  /** Zero tax because of export / intra-community supply / exemption. */
  taxFree: boolean;
}
