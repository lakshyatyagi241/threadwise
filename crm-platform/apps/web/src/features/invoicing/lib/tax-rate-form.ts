import {
  TAX_RATE_NAME_MAX,
  type CreateTaxRateInput,
  type TaxRateResponse,
  type TaxType,
  type UpdateTaxRateInput,
} from '@crm/contracts';

/**
 * The tax-rate form, as pure functions: the same rules the API's `createTaxRateSchema` enforces (a percent with at most 4
 * decimals, components that add up to the rate), checked live so the person sees the problem before the server does. Rates are
 * handled as integers in 1/10000 of a percent ("9.975" -> 99750): no float touches a rate.
 */

export interface ComponentDraft {
  type: string;
  rate: string;
}

export interface TaxRateFormState {
  name: string;
  type: TaxType;
  rate: string;
  inclusive: boolean;
  description: string;
  country: string;
  region: string;
  /** A compound rate (CGST + SGST, GST + PST) lists its parts; they must add up to `rate`. */
  compound: boolean;
  components: ComponentDraft[];
  effectiveFrom: string;
  effectiveTo: string;
  defaultHsnSac: string;
  isDefault: boolean;
  isActive: boolean;
}

export const MAX_COMPONENTS = 6;

/** The tax types in the order the select offers them: the common ones first, then the regional and the special ones. */
export const TAX_TYPE_ORDER: readonly TaxType[] = [
  'vat',
  'gst',
  'sales_tax',
  'cgst',
  'sgst',
  'igst',
  'utgst',
  'hst',
  'pst',
  'qst',
  'iva',
  'sst',
  'consumption_tax',
  'tds',
  'tcs',
  'withholding',
  'custom',
  'other',
];
const PERCENT = /^\d{1,3}(\.\d{1,4})?$/;
const HSN = /^[0-9A-Za-z]{2,12}$/;
const PPM_FACTOR = 10_000;

/** A real calendar day (`2026-02-30` is not one). */
const isRealDay = (v: string): boolean =>
  /^\d{4}-\d{2}-\d{2}$/.test(v) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** "18", "7.25", "9.975": at most 3 digits and 4 decimals, and not above 100. */
export function isPercent(text: string): boolean {
  const s = text.trim();
  return PERCENT.test(s) && percentUnits(s) <= 100 * PPM_FACTOR;
}

/** A percent string as an integer of 1/10000 percent. Call only on a string that passed `isPercent`'s pattern. */
export function percentUnits(text: string): number {
  const [i = '0', f = ''] = text.trim().split('.');
  return Number(i) * PPM_FACTOR + Number(f.padEnd(4, '0').slice(0, 4));
}

/** 99750 -> "9.975", 180000 -> "18", 0 -> "0". */
export function unitsToPercent(units: number): string {
  const whole = Math.floor(units / PPM_FACTOR);
  const frac = String(units % PPM_FACTOR)
    .padStart(4, '0')
    .replace(/0+$/, '');
  return frac ? `${whole}.${frac}` : String(whole);
}

/** What the parts add up to, as a percent string; null when a part is not a valid percent. */
export function componentsTotal(components: readonly ComponentDraft[]): string | null {
  let sum = 0;
  for (const c of components) {
    if (!PERCENT.test(c.rate.trim())) return null;
    sum += percentUnits(c.rate);
  }
  return unitsToPercent(sum);
}

export type TaxRateProblem =
  | 'nameRequired'
  | 'nameTooLong'
  | 'rateInvalid'
  | 'countryInvalid'
  | 'regionInvalid'
  | 'dateInvalid'
  | 'dateOrder'
  | 'hsnInvalid'
  | 'componentsMissing'
  | 'componentTypeRequired'
  | 'componentRateInvalid'
  | 'componentsSum'
  | 'descriptionTooLong';

export type TaxRateField =
  | 'name'
  | 'rate'
  | 'country'
  | 'region'
  | 'effectiveFrom'
  | 'effectiveTo'
  | 'defaultHsnSac'
  | 'components'
  | 'description';

/** Problems keyed by field; empty when the form can be sent. */
export function validateTaxRateForm(
  f: TaxRateFormState,
): Partial<Record<TaxRateField, TaxRateProblem>> {
  const out: Partial<Record<TaxRateField, TaxRateProblem>> = {};
  const name = f.name.trim();
  if (!name) out.name = 'nameRequired';
  else if (name.length > TAX_RATE_NAME_MAX) out.name = 'nameTooLong';
  if (!isPercent(f.rate)) out.rate = 'rateInvalid';
  if (f.description.trim().length > 500) out.description = 'descriptionTooLong';
  if (f.country.trim() && !/^[A-Za-z]{2}$/.test(f.country.trim())) out.country = 'countryInvalid';
  const region = f.region.trim();
  if (region && region.length > 8) out.region = 'regionInvalid';
  if (f.effectiveFrom && !isRealDay(f.effectiveFrom)) out.effectiveFrom = 'dateInvalid';
  if (f.effectiveTo && !isRealDay(f.effectiveTo)) out.effectiveTo = 'dateInvalid';
  if (
    !out.effectiveFrom &&
    !out.effectiveTo &&
    f.effectiveFrom &&
    f.effectiveTo &&
    f.effectiveTo < f.effectiveFrom
  )
    out.effectiveTo = 'dateOrder';
  if (f.defaultHsnSac.trim() && !HSN.test(f.defaultHsnSac.trim())) out.defaultHsnSac = 'hsnInvalid';
  if (f.compound) {
    if (f.components.length === 0) out.components = 'componentsMissing';
    else if (f.components.some((c) => !c.type.trim() || c.type.trim().length > 12))
      out.components = 'componentTypeRequired';
    else if (f.components.some((c) => !PERCENT.test(c.rate.trim())))
      out.components = 'componentRateInvalid';
    else if (!out.rate && componentsTotal(f.components) !== unitsToPercent(percentUnits(f.rate)))
      out.components = 'componentsSum';
  }
  return out;
}

export const emptyTaxRateForm = (over: Partial<TaxRateFormState> = {}): TaxRateFormState => ({
  name: '',
  type: 'vat',
  rate: '',
  inclusive: false,
  description: '',
  country: '',
  region: '',
  compound: false,
  components: [],
  effectiveFrom: '',
  effectiveTo: '',
  defaultHsnSac: '',
  isDefault: false,
  isActive: true,
  ...over,
});

export function formFromRate(r: TaxRateResponse): TaxRateFormState {
  return {
    name: r.name,
    type: r.type,
    rate: r.rate,
    inclusive: r.inclusive,
    description: r.description ?? '',
    country: r.country ?? '',
    region: r.region ?? '',
    compound: (r.components?.length ?? 0) > 0,
    components: (r.components ?? []).map((c) => ({ type: c.type, rate: c.rate })),
    effectiveFrom: r.effectiveFrom ?? '',
    effectiveTo: r.effectiveTo ?? '',
    defaultHsnSac: r.defaultHsnSac ?? '',
    isDefault: r.isDefault,
    isActive: r.isActive,
  };
}

/** Components of an equal split of a rate, as a starting point (18 -> 9 + 9); the last part takes the remainder. */
export function splitEvenly(rate: string, types: readonly string[]): ComponentDraft[] {
  if (!isPercent(rate) || types.length === 0) return types.map((type) => ({ type, rate: '' }));
  const total = percentUnits(rate);
  const each = Math.floor(total / types.length);
  return types.map((type, i) => ({
    type,
    rate: unitsToPercent(i === types.length - 1 ? total - each * (types.length - 1) : each),
  }));
}

const orNull = (s: string): string | null => s.trim() || null;

type SharedFields = Omit<CreateTaxRateInput, 'isDefault' | 'isActive' | 'name' | 'rate'> & {
  name: string;
  rate: string;
};

function shared(f: TaxRateFormState): SharedFields {
  return {
    name: f.name.trim(),
    type: f.type,
    rate: unitsToPercent(percentUnits(f.rate)),
    inclusive: f.inclusive,
    description: orNull(f.description),
    country: f.country.trim() ? f.country.trim().toUpperCase() : null,
    region: orNull(f.region),
    components: f.compound
      ? f.components.map((c) => ({
          type: c.type.trim().toUpperCase(),
          rate: unitsToPercent(percentUnits(c.rate)),
        }))
      : null,
    effectiveFrom: f.effectiveFrom || null,
    effectiveTo: f.effectiveTo || null,
    defaultHsnSac: orNull(f.defaultHsnSac),
  };
}

export const toCreateInput = (f: TaxRateFormState): CreateTaxRateInput => ({
  ...shared(f),
  isDefault: f.isDefault,
  isActive: f.isDefault ? true : f.isActive,
});

/** The patch of an edit (the default flag moves through its own endpoint). */
export const toUpdatePatch = (f: TaxRateFormState): Omit<UpdateTaxRateInput, 'rowVersion'> => ({
  ...shared(f),
  isActive: f.isDefault ? true : f.isActive,
});
