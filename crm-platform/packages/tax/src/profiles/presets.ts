import { indiaSplit } from './countries/india';
import { getTaxProfile } from './registry';
import type { RateRow, TaxType } from './types';
import { todayIso } from './utils';

/**
 * Seed rows for the `tax_rates` table: `taxPresetsForCountry("IN")` -> bulk-create. The shape mirrors the table (name <= 60 chars,
 * rate in basis points, `inclusive` default) plus the extra metadata (type, category, effective dates, region) a richer table or the
 * UI can use. THIS PACKAGE DOES NOT TOUCH THE DATABASE.
 *
 * `rateBp` is the rate x 100 rounded to an integer; `rateBpExact` is false when that rounding changed the rate (Quebec QST 9.975%,
 * Mexican IVA retention 10.6667%). Store `ratePercent` when the column has the precision; otherwise skip or hand-check those rows.
 */
export interface TaxPresetRow {
  countryCode: string;
  code: string;
  name: string;
  /** Percent string, up to 4 decimals. */
  ratePercent: string;
  rateBp: number;
  rateBpExact: boolean;
  type: TaxType;
  category: RateRow['category'];
  /** Default price mode for this tax: true = prices usually include the tax. */
  inclusive: boolean;
  /** ISO date (YYYY-MM-DD). */
  effectiveFrom: string;
  effectiveTo: string | null;
  /** The country's default (standard) rate: preselect it. */
  isDefault: boolean;
  /** State / province for sub-national rows. */
  region: string | null;
  description: string | null;
  /** India: the CGST+SGST / IGST split of a combined slab. */
  components?: {
    intra: { code: string; name: string; ratePercent: string }[];
    inter: { code: string; name: string; ratePercent: string }[];
  };
  /** Withholding rows (TDS, CIS, retentions) are separate and off by default. */
  isWithholding: boolean;
}

export interface TaxPresetOptions {
  /** ISO date; default today. Only rows in force on this date are returned unless `includeHistorical`. */
  asOf?: string;
  /** Include rows that ended before `asOf` (and rows starting after it). */
  includeHistorical?: boolean;
  includeWithholding?: boolean;
}

function toRow(countryCode: string, r: RateRow, withholding: boolean): TaxPresetRow {
  const [w = '0', f = ''] = r.ratePercent.split('.');
  const bpExactStr = `${w}${f.padEnd(2, '0').slice(0, 2)}`;
  const exact = f.length <= 2;
  const rateBp = exact ? Number(bpExactStr) : Math.round(Number(r.ratePercent) * 100);
  const name = r.name.length > 60 ? `${r.name.slice(0, 57)}...` : r.name;
  const row: TaxPresetRow = {
    countryCode,
    code: r.code,
    name,
    ratePercent: r.ratePercent,
    rateBp,
    rateBpExact: exact,
    type: r.type,
    category: r.category,
    inclusive: r.inclusiveDefault ?? false,
    effectiveFrom: r.effectiveFrom,
    effectiveTo: r.effectiveTo ?? null,
    isDefault: r.isDefault === true,
    region: r.region ?? null,
    description: r.note ?? null,
    isWithholding: withholding,
  };
  if (
    countryCode === 'IN' &&
    r.type === 'gst' &&
    r.category !== 'exempt' &&
    r.ratePercent !== '0'
  ) {
    const s = indiaSplit(r.ratePercent);
    row.components = {
      intra: s.intra.map((t) => ({ code: t.code, name: t.name, ratePercent: String(t.rate) })),
      inter: s.inter.map((t) => ({ code: t.code, name: t.name, ratePercent: String(t.rate) })),
    };
  }
  return row;
}

/** The tax-rate rows to seed for a country. Returns [] for a country without a profile (use the CUSTOM profile). */
export function taxPresetsForCountry(code: string, opts: TaxPresetOptions = {}): TaxPresetRow[] {
  const profile = getTaxProfile(code);
  if (!profile) return [];
  const asOf = opts.asOf ?? todayIso();
  const inForce = (r: RateRow) =>
    r.effectiveFrom <= asOf && (!r.effectiveTo || r.effectiveTo >= asOf);
  const keep = (r: RateRow) => opts.includeHistorical === true || inForce(r);
  const rows = profile.rates.filter(keep).map((r) => toRow(profile.code, r, false));
  if (opts.includeWithholding)
    rows.push(...(profile.withholding ?? []).filter(keep).map((r) => toRow(profile.code, r, true)));
  return rows;
}
