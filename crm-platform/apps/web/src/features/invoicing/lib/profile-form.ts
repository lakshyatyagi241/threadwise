import type { InvoiceProfile, UpdateInvoiceProfileInput } from '@crm/contracts';
import {
  CA_PROVINCES,
  INDIA_STATES,
  US_STATES,
  getTaxProfile,
  indiaState,
  isEuMember,
  TAX_PROFILES,
  type TaxIdResult,
  type TaxProfile,
} from '@crm/tax';

/**
 * Pure logic of the Business profile screen: the form model, the diff that becomes a PATCH, the number-format rules, the live
 * examples of the next numbers, the tax-id check and the bank rows. The screen only renders what these return.
 */

export interface Row {
  label: string;
  value: string;
}

/** Every editable field as the person types it (numbers and optional values are strings; blank means "none"). */
export interface ProfileForm {
  sellerName: string;
  sellerAddress: string;
  sellerCountry: string;
  sellerState: string;
  sellerTaxId: string;
  sellerRegistrationNo: string;
  sellerPhone: string;
  supportEmail: string;
  extraFields: Row[];
  logoUrl: string;
  brandColor: string;
  invoiceTitle: string;
  footerNote: string;
  bankRows: Row[];
  paymentInstructions: string;
  numberingPrefix: string;
  proformaPrefix: string;
  receiptPrefix: string;
  creditNotePrefix: string;
  salesOrderPrefix: string;
  numberFormat: string;
  numberPadding: string;
  yearlyReset: boolean;
  fiscalYearStartMonth: string;
  dueDays: string;
  terms: string;
  overdueReminders: boolean;
  defaultTaxRegime: string;
}

export const MAX_EXTRA_ROWS = 8;
export const MAX_BANK_ROWS = 12;
export const LIMITS = {
  sellerName: 191,
  sellerAddress: 1000,
  sellerTaxId: 64,
  sellerRegistrationNo: 64,
  sellerPhone: 40,
  logoUrl: 500,
  invoiceTitle: 60,
  footerNote: 2000,
  paymentInstructions: 2000,
  terms: 10000,
  numberFormat: 60,
  rowLabel: 40,
  extraValue: 80,
  bankValue: 120,
} as const;

// --- countries and states ---------------------------------------------------------------------------------------------------

export interface CountryOption {
  code: string;
  name: string;
}

/** The countries that have a tax profile (the custom profile is not a country). */
export const COUNTRY_OPTIONS: readonly CountryOption[] = TAX_PROFILES.filter((p) => p.code !== 'CUSTOM')
  .map((p) => ({ code: p.code, name: p.name }))
  .sort((a, b) => a.name.localeCompare(b.name));

export const profileOf = (country: string): TaxProfile | undefined =>
  country.trim() ? getTaxProfile(country) : undefined;

export interface StateOption {
  code: string;
  name: string;
}

/** The state or province list of a country (India, United States, Canada), or null when the code is free text. */
export function stateOptions(country: string): readonly StateOption[] | null {
  switch (country.trim().toUpperCase()) {
    case 'IN':
      return INDIA_STATES.map((s) => ({ code: s.code, name: s.name }));
    case 'US':
      return US_STATES.map((s) => ({ code: s.code, name: s.name }));
    case 'CA':
      return CA_PROVINCES;
    default:
      return null;
  }
}

/** India stores the two-digit GST state code (the first digits of a GSTIN); "MH" or "Maharashtra" are turned into "27". */
export function normalizeState(country: string, raw: string): string {
  const s = raw.trim();
  if (!s) return '';
  if (country.trim().toUpperCase() === 'IN') return indiaState(s)?.code ?? s.toUpperCase();
  return s.toUpperCase();
}

// --- form model -------------------------------------------------------------------------------------------------------------

const text = (v: string | null | undefined): string => v ?? '';

export function recordToRows(record: Record<string, string> | null | undefined): Row[] {
  return Object.entries(record ?? {}).map(([label, value]) => ({ label, value }));
}

export function profileToForm(p: InvoiceProfile): ProfileForm {
  const country = text(p.sellerCountry).toUpperCase();
  return {
    sellerName: text(p.sellerName),
    sellerAddress: text(p.sellerAddress),
    sellerCountry: country,
    sellerState: normalizeState(country, text(p.sellerState)),
    sellerTaxId: text(p.sellerTaxId),
    sellerRegistrationNo: text(p.sellerRegistrationNo),
    sellerPhone: text(p.sellerPhone),
    supportEmail: text(p.supportEmail),
    extraFields: p.extraFields.map((r) => ({ label: r.label, value: r.value })),
    logoUrl: text(p.logoUrl),
    brandColor: text(p.brandColor),
    invoiceTitle: text(p.invoiceTitle),
    footerNote: text(p.footerNote),
    bankRows: recordToRows(p.bankDetails),
    paymentInstructions: text(p.paymentInstructions),
    numberingPrefix: p.numberingPrefix,
    proformaPrefix: p.proformaPrefix,
    receiptPrefix: p.receiptPrefix,
    creditNotePrefix: p.creditNotePrefix,
    salesOrderPrefix: p.salesOrderPrefix,
    numberFormat: p.numberFormat,
    numberPadding: String(p.numberPadding),
    yearlyReset: p.yearlyReset,
    fiscalYearStartMonth: String(p.fiscalYearStartMonth),
    dueDays: p.dueDays === null ? '' : String(p.dueDays),
    terms: text(p.terms),
    overdueReminders: p.overdueReminders,
    defaultTaxRegime: p.defaultTaxRegime,
  };
}

// --- rows -------------------------------------------------------------------------------------------------------------------

const blank = (r: Row): boolean => !r.label.trim() && !r.value.trim();
const complete = (r: Row): boolean => !!r.label.trim() && !!r.value.trim();

/** Trims every row, drops the empty ones and keeps only complete rows (a half-filled row is an error the form shows, not data). */
export function normalizeRows(rows: readonly Row[]): Row[] {
  return rows
    .map((r) => ({ label: r.label.trim(), value: r.value.trim() }))
    .filter((r) => complete(r));
}

/** Bank rows to the wire record. The last row wins when a label repeats; no rows means "none" (null). */
export function bankRowsToRecord(rows: readonly Row[]): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const r of normalizeRows(rows)) out[r.label] = r.value;
  return Object.keys(out).length === 0 ? null : out;
}

const sameRecord = (a: Record<string, string> | null, b: Record<string, string> | null): boolean => {
  const ka = Object.keys(a ?? {});
  const kb = Object.keys(b ?? {});
  return ka.length === kb.length && ka.every((k) => (a as Record<string, string>)[k] === (b ?? {})[k]);
};

const sameRows = (a: readonly Row[], b: readonly Row[]): boolean =>
  a.length === b.length && a.every((r, i) => r.label === b[i]?.label && r.value === b[i]?.value);

/** Label suggestions for the bank rows of a country: the names its payers expect to see. */
export function bankLabelSuggestions(country: string): string[] {
  const c = country.trim().toUpperCase();
  const iban = ['Account name', 'IBAN', 'BIC', 'Bank'];
  switch (c) {
    case 'IN':
      return ['Account name', 'Account number', 'IFSC', 'Bank', 'Branch', 'UPI ID'];
    case 'GB':
      return ['Account name', 'Sort code', 'Account number', 'IBAN', 'BIC'];
    case 'US':
      return ['Account name', 'Routing number', 'Account number', 'SWIFT', 'Bank'];
    case 'AU':
      return ['Account name', 'BSB', 'Account number', 'Bank', 'PayID'];
    case 'NZ':
      return ['Account name', 'Account number', 'Bank'];
    case 'CA':
      return ['Account name', 'Institution number', 'Transit number', 'Account number'];
    case 'SG':
      return ['Account name', 'Account number', 'Bank', 'SWIFT', 'PayNow UEN'];
    case 'AE':
    case 'SA':
    case 'BH':
    case 'OM':
    case 'QA':
    case 'KW':
      return ['Account name', 'IBAN', 'SWIFT', 'Bank'];
    case 'MX':
      return ['Account name', 'CLABE', 'Bank'];
    case 'BR':
      return ['Account name', 'Agency', 'Account number', 'Pix key', 'Bank'];
    case 'ZA':
      return ['Account name', 'Account number', 'Branch code', 'Bank'];
    default:
      return isEuMember(c) ? iban : ['Account name', 'Account number', 'IBAN', 'SWIFT', 'Bank'];
  }
}

// --- number format ----------------------------------------------------------------------------------------------------------

export const NUMBER_TOKENS = ['{PREFIX}', '{YEAR}', '{YY}', '{SEQ}'] as const;

export type NumberFormatProblem = 'empty' | 'tooLong' | 'charset' | 'token' | 'seq' | 'year';

/** The same rules as the server (`updateInvoiceProfileSchema` and the yearly-reset check), so the person learns before saving. */
export function numberFormatProblem(format: string, yearlyReset: boolean): NumberFormatProblem | null {
  const f = format.trim();
  if (!f) return 'empty';
  if (f.length > LIMITS.numberFormat) return 'tooLong';
  if (!/^[A-Za-z0-9{}_./ -]+$/.test(f)) return 'charset';
  if (!(f.match(/\{[A-Z]+\}/g) ?? []).every((t) => (NUMBER_TOKENS as readonly string[]).includes(t))) return 'token';
  if (!f.includes('{SEQ}')) return 'seq';
  if (yearlyReset && !f.includes('{YEAR}') && !f.includes('{YY}')) return 'year';
  return null;
}

export type DocKind = 'invoice' | 'proforma' | 'receipt' | 'creditNote' | 'salesOrder';
export const DOC_KINDS: readonly DocKind[] = ['invoice', 'proforma', 'receipt', 'creditNote', 'salesOrder'];

export interface NumberingInput {
  prefixes: Record<DocKind, string>;
  numberFormat: string;
  padding: number;
  fiscalYearStartMonth: number;
}

/** The year a document belongs to: the year its fiscal year started in (April 2026 to March 2027 is "2026" for an April start). */
export function numberingYear(date: string, fiscalYearStartMonth: number): number {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return month >= fiscalYearStartMonth ? year : year - 1;
}

/** `{PREFIX}-{YEAR}-{SEQ}` + INV, 2026-10-02, seq 7, padding 6 gives `INV-2026-000007`: the rule the server applies. */
export function formatNumberExample(kind: DocKind, n: NumberingInput, date: string, seq: number): string {
  const year = numberingYear(date, n.fiscalYearStartMonth);
  return n.numberFormat
    .replaceAll('{PREFIX}', n.prefixes[kind])
    .replaceAll('{YEAR}', String(year))
    .replaceAll('{YY}', String(year % 100).padStart(2, '0'))
    .replaceAll('{SEQ}', String(seq).padStart(n.padding, '0'));
}

export function numberingInputOf(f: ProfileForm): NumberingInput {
  const padding = Number(f.numberPadding);
  const month = Number(f.fiscalYearStartMonth);
  return {
    prefixes: {
      invoice: f.numberingPrefix.trim().toUpperCase(),
      proforma: f.proformaPrefix.trim().toUpperCase(),
      receipt: f.receiptPrefix.trim().toUpperCase(),
      creditNote: f.creditNotePrefix.trim().toUpperCase(),
      salesOrder: f.salesOrderPrefix.trim().toUpperCase(),
    },
    numberFormat: f.numberFormat.trim(),
    padding: Number.isInteger(padding) && padding >= 1 && padding <= 10 ? padding : 6,
    fiscalYearStartMonth: Number.isInteger(month) && month >= 1 && month <= 12 ? month : 1,
  };
}

export interface NumberExample {
  kind: DocKind;
  number: string;
  length: number;
}

export function numberExamples(f: ProfileForm, today: string): NumberExample[] {
  const n = numberingInputOf(f);
  return DOC_KINDS.map((kind) => {
    const number = formatNumberExample(kind, n, today, 1);
    return { kind, number, length: number.length };
  });
}

export interface NumberingWarning {
  kind: DocKind;
  code: 'tooLong' | 'chars';
  max?: number;
  length: number;
}

/** What the country's law says about a number (India: at most 16 characters, letters, digits, "-" and "/"), checked on the examples. */
export function numberingWarnings(country: string, examples: readonly NumberExample[]): NumberingWarning[] {
  const rules = profileOf(country)?.numbering;
  if (!rules) return [];
  const out: NumberingWarning[] = [];
  for (const e of examples) {
    if (rules.maxLength !== undefined && e.length > rules.maxLength) {
      out.push({ kind: e.kind, code: 'tooLong', max: rules.maxLength, length: e.length });
    } else if (rules.allowed && !new RegExp(rules.allowed).test(e.number)) {
      out.push({ kind: e.kind, code: 'chars', length: e.length });
    }
  }
  return out;
}

export interface CountrySuggestion {
  regime: string;
  fiscalYearStartMonth: number;
  taxLabel: string;
  countryName: string;
}

/** What a country normally uses: its tax preset id (lowercase code) and the month its fiscal year starts. */
export function countrySuggestion(country: string): CountrySuggestion | null {
  const p = profileOf(country);
  if (!p || p.code === 'CUSTOM') return null;
  return {
    regime: p.code.toLowerCase(),
    fiscalYearStartMonth: p.fiscalYear.startMonth,
    taxLabel: p.taxLabel,
    countryName: p.name,
  };
}

/** The tax regime options: none, then every country preset by its lowercase id. */
export const REGIME_OPTIONS: readonly { id: string; name: string }[] = [
  { id: 'none', name: '' },
  ...COUNTRY_OPTIONS.map((c) => ({ id: c.code.toLowerCase(), name: c.name })),
];

// --- tax id -----------------------------------------------------------------------------------------------------------------

export interface TaxIdCheck {
  /** `no_country`: no seller country yet; `no_spec`: the country has no id format; `empty`: nothing typed; `checked`. */
  state: 'no_country' | 'no_spec' | 'empty' | 'checked';
  label: string | null;
  example: string | null;
  requirement: TaxProfile['sellerTaxId']['requirement'] | null;
  result?: TaxIdResult;
}

/** Validates the seller's tax id with the validator of the seller country's profile (a GSTIN for India, a VAT number for the EU ...). */
export function checkTaxId(country: string, raw: string): TaxIdCheck {
  const profile = profileOf(country);
  if (!profile) return { state: 'no_country', label: null, example: null, requirement: null };
  const spec = profile.sellerTaxId.spec;
  const requirement = profile.sellerTaxId.requirement;
  if (!spec) return { state: 'no_spec', label: null, example: null, requirement };
  const base = { label: spec.label, example: spec.example, requirement };
  if (!raw.trim()) return { state: 'empty', ...base };
  return { state: 'checked', ...base, result: spec.validate(raw) };
}

/** The canonical form of a typed id (spaces and dashes stripped, upper case), or the input when the validator offers none. */
export function normalizedTaxId(country: string, raw: string): string {
  const c = checkTaxId(country, raw);
  return c.state === 'checked' && c.result?.normalized ? c.result.normalized : raw.trim();
}

/** For a GSTIN: the state its first digits name, and the PAN inside. */
export function gstinFacts(check: TaxIdCheck): { stateCode: string; stateName: string; pan: string } | null {
  const d = check.result?.details;
  if (!check.result?.valid || !d?.['stateCode']) return null;
  const st = INDIA_STATES.find((s) => s.code === d['stateCode']);
  return { stateCode: d['stateCode'], stateName: st?.name ?? d['stateCode'], pan: d['pan'] ?? '' };
}

/** True when the GSTIN names another state than the one chosen for the seller (the CGST+SGST or IGST decision depends on it). */
export function gstinStateMismatch(check: TaxIdCheck, country: string, state: string): boolean {
  const facts = gstinFacts(check);
  if (!facts || country.trim().toUpperCase() !== 'IN' || !state.trim()) return false;
  return normalizeState('IN', state) !== facts.stateCode;
}

// --- validation -------------------------------------------------------------------------------------------------------------

export interface FieldIssue {
  code: string;
  params?: Record<string, string | number>;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** What the screen can check before sending. Keys are the API's field paths, so a server answer lands on the same field. */
export function validateForm(f: ProfileForm): Record<string, FieldIssue> {
  const out: Record<string, FieldIssue> = {};
  const max = (key: keyof typeof LIMITS, value: string, path: string = key) => {
    if (value.trim().length > LIMITS[key]) out[path] = { code: 'tooLong', params: { max: LIMITS[key] } };
  };
  max('sellerName', f.sellerName);
  max('sellerAddress', f.sellerAddress);
  max('sellerTaxId', f.sellerTaxId);
  max('sellerRegistrationNo', f.sellerRegistrationNo);
  max('sellerPhone', f.sellerPhone);
  max('invoiceTitle', f.invoiceTitle);
  max('footerNote', f.footerNote);
  max('paymentInstructions', f.paymentInstructions);
  max('terms', f.terms);

  if (f.sellerCountry.trim() && !/^[A-Za-z]{2}$/.test(f.sellerCountry.trim())) out['sellerCountry'] = { code: 'country' };
  if (f.sellerState.trim() && !/^[A-Za-z0-9]{1,3}$/.test(f.sellerState.trim())) out['sellerState'] = { code: 'state' };
  if (f.supportEmail.trim() && !EMAIL.test(f.supportEmail.trim())) out['supportEmail'] = { code: 'email' };

  const logo = f.logoUrl.trim();
  if (logo) {
    let ok = logo.length <= LIMITS.logoUrl && logo.startsWith('https://');
    if (ok) {
      try {
        new URL(logo);
      } catch {
        ok = false;
      }
    }
    if (!ok) out['logoUrl'] = { code: 'httpsUrl' };
  }
  if (f.brandColor.trim() && !/^#[0-9A-Fa-f]{6}$/.test(f.brandColor.trim())) out['brandColor'] = { code: 'hex' };

  for (const key of ['numberingPrefix', 'proformaPrefix', 'receiptPrefix', 'creditNotePrefix', 'salesOrderPrefix'] as const) {
    if (!/^[A-Za-z0-9]{1,10}$/.test(f[key].trim())) out[key] = { code: 'prefix' };
  }
  const problem = numberFormatProblem(f.numberFormat, f.yearlyReset);
  if (problem) out[problem === 'year' ? 'yearlyReset' : 'numberFormat'] = { code: `format.${problem}`, params: { max: LIMITS.numberFormat } };
  const pad = Number(f.numberPadding);
  if (!f.numberPadding.trim() || !Number.isInteger(pad) || pad < 1 || pad > 10) out['numberPadding'] = { code: 'padding' };
  const month = Number(f.fiscalYearStartMonth);
  if (!Number.isInteger(month) || month < 1 || month > 12) out['fiscalYearStartMonth'] = { code: 'month' };
  if (f.dueDays.trim()) {
    const d = Number(f.dueDays);
    if (!/^\d+$/.test(f.dueDays.trim()) || d > 365) out['dueDays'] = { code: 'dueDays' };
  }
  if (!/^[a-z0-9_]{1,32}$/.test(f.defaultTaxRegime)) out['defaultTaxRegime'] = { code: 'regime' };

  if (f.extraFields.filter((r) => !blank(r)).length > MAX_EXTRA_ROWS) out['extraFields'] = { code: 'tooManyRows', params: { max: MAX_EXTRA_ROWS } };
  f.extraFields.forEach((r, i) => {
    if (blank(r)) return;
    if (!complete(r)) out[`extraFields.${i}.${r.label.trim() ? 'value' : 'label'}`] = { code: 'rowIncomplete' };
    else if (r.label.trim().length > LIMITS.rowLabel) out[`extraFields.${i}.label`] = { code: 'tooLong', params: { max: LIMITS.rowLabel } };
    else if (r.value.trim().length > LIMITS.extraValue) out[`extraFields.${i}.value`] = { code: 'tooLong', params: { max: LIMITS.extraValue } };
  });

  if (f.bankRows.filter((r) => !blank(r)).length > MAX_BANK_ROWS) out['bankDetails'] = { code: 'tooManyRows', params: { max: MAX_BANK_ROWS } };
  const seen = new Set<string>();
  f.bankRows.forEach((r, i) => {
    if (blank(r)) return;
    if (!complete(r)) out[`bankDetails.${i}.${r.label.trim() ? 'value' : 'label'}`] = { code: 'rowIncomplete' };
    else if (r.label.trim().length > LIMITS.rowLabel) out[`bankDetails.${i}.label`] = { code: 'tooLong', params: { max: LIMITS.rowLabel } };
    else if (r.value.trim().length > LIMITS.bankValue) out[`bankDetails.${i}.value`] = { code: 'tooLong', params: { max: LIMITS.bankValue } };
    else if (seen.has(r.label.trim().toLowerCase())) out[`bankDetails.${i}.label`] = { code: 'duplicate' };
    seen.add(r.label.trim().toLowerCase());
  });
  return out;
}

// --- diff to patch ----------------------------------------------------------------------------------------------------------

const NULLABLE_TEXT = [
  'sellerName',
  'sellerAddress',
  'sellerTaxId',
  'sellerRegistrationNo',
  'sellerPhone',
  'supportEmail',
  'logoUrl',
  'brandColor',
  'paymentInstructions',
  'terms',
  'footerNote',
  'invoiceTitle',
] as const;
const PREFIXES = ['numberingPrefix', 'proformaPrefix', 'receiptPrefix', 'creditNotePrefix', 'salesOrderPrefix'] as const;

/**
 * Only what changed since `initial`: a cleared optional field is `null`, a half-filled row is not sent. `rowVersion` rides along
 * only when something changed and the profile has been saved before (it is null until the first save).
 */
export function diffToPatch(initial: ProfileForm, current: ProfileForm, rowVersion: number | null): UpdateInvoiceProfileInput {
  const patch: UpdateInvoiceProfileInput = {};
  const out = patch as Record<string, unknown>;

  for (const k of NULLABLE_TEXT) {
    if (initial[k].trim() !== current[k].trim()) out[k] = current[k].trim() || null;
  }
  if (initial.sellerCountry.trim().toUpperCase() !== current.sellerCountry.trim().toUpperCase()) {
    out['sellerCountry'] = current.sellerCountry.trim().toUpperCase() || null;
  }
  const state = normalizeState(current.sellerCountry, current.sellerState);
  if (normalizeState(initial.sellerCountry, initial.sellerState) !== state) out['sellerState'] = state || null;

  for (const k of PREFIXES) {
    if (initial[k].trim().toUpperCase() !== current[k].trim().toUpperCase() && current[k].trim()) out[k] = current[k].trim().toUpperCase();
  }
  if (initial.numberFormat.trim() !== current.numberFormat.trim() && current.numberFormat.trim()) out['numberFormat'] = current.numberFormat.trim();
  if (initial.numberPadding.trim() !== current.numberPadding.trim() && current.numberPadding.trim()) out['numberPadding'] = Number(current.numberPadding);
  if (initial.yearlyReset !== current.yearlyReset) out['yearlyReset'] = current.yearlyReset;
  if (initial.fiscalYearStartMonth.trim() !== current.fiscalYearStartMonth.trim() && current.fiscalYearStartMonth.trim()) {
    out['fiscalYearStartMonth'] = Number(current.fiscalYearStartMonth);
  }
  if (initial.dueDays.trim() !== current.dueDays.trim()) out['dueDays'] = current.dueDays.trim() ? Number(current.dueDays) : null;
  if (initial.overdueReminders !== current.overdueReminders) out['overdueReminders'] = current.overdueReminders;
  if (initial.defaultTaxRegime !== current.defaultTaxRegime) out['defaultTaxRegime'] = current.defaultTaxRegime;

  if (!sameRows(normalizeRows(initial.extraFields), normalizeRows(current.extraFields))) out['extraFields'] = normalizeRows(current.extraFields);
  if (!sameRecord(bankRowsToRecord(initial.bankRows), bankRowsToRecord(current.bankRows))) out['bankDetails'] = bankRowsToRecord(current.bankRows);

  if (Object.keys(patch).length > 0 && rowVersion !== null) patch.rowVersion = rowVersion;
  return patch;
}

/** Whether the form differs from what was loaded (a half-filled row that would not be sent still counts, so the guard protects it). */
export function isDirty(initial: ProfileForm, current: ProfileForm): boolean {
  return JSON.stringify(canonical(initial)) !== JSON.stringify(canonical(current));
}

const canonical = (f: ProfileForm) => ({
  ...f,
  sellerCountry: f.sellerCountry.trim().toUpperCase(),
  sellerState: normalizeState(f.sellerCountry, f.sellerState),
  extraFields: f.extraFields.filter((r) => !blank(r)),
  bankRows: f.bankRows.filter((r) => !blank(r)),
});

// --- gateway ----------------------------------------------------------------------------------------------------------------

export const MIN_SECRET_LENGTH = 16;
export const MAX_SECRET_LENGTH = 256;

export const secretProblem = (secret: string): 'short' | 'long' | null =>
  secret.length < MIN_SECRET_LENGTH ? 'short' : secret.length > MAX_SECRET_LENGTH ? 'long' : null;

/** A random signing secret (hex) the person can use instead of inventing one. */
export function generateSecret(bytes = 24): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}
