import {
  CA_PROVINCES,
  INDIA_STATES,
  US_STATES,
  getTaxProfile,
  resolveTaxForLine,
  type ResolveResult,
  type SupplyType,
  type TaxProfile,
} from '@crm/tax';
import type { TaxRateResponse } from '@crm/contracts';
import type { LineTax } from './totals';

/**
 * Country-aware tax helpers for the invoice form. The decisions (which taxes a supply carries and why) are the `@crm/tax` engine's
 * (`resolveTaxForLine`), the same one the API calls in `taxMode: 'auto'`; here it only feeds a PREVIEW and the live checks. After a
 * save the server's `taxExplanation` is what counts. Presets and rules are defaults the business verifies with its accountant.
 */

export const SUPPLY_TYPES = ['goods', 'services', 'digital'] as const;

/** The seller's tax profile, or undefined when the country has none (and for no country). */
export const profileOf = (country: string | null | undefined): TaxProfile | undefined =>
  country && country.trim() ? getTaxProfile(country) : undefined;

/** Does the seller's country require an HSN/SAC code on each line? (India's checklist asks for it per line.) */
export function hsnRequired(country: string | null | undefined): boolean {
  return profileOf(country)?.checklist.some((i) => i.field === 'line_hsn_sac') ?? false;
}

// --- tax ids ------------------------------------------------------------------------------------------------------------------

export type TaxIdState = 'empty' | 'valid' | 'invalid' | 'unchecked';

export interface TaxIdCheck {
  state: TaxIdState;
  /** What the id is called in that country ("GSTIN", "VAT identification number"). */
  label: string | null;
  /** How far the check went: the check digits, or only the shape. A valid result never proves the number is registered. */
  level: 'checksum' | 'format' | null;
  /** Why it failed, in the engine's words (English). */
  reason: string | null;
  /** A well-formed example. */
  example: string | null;
  /** The id in its canonical form. */
  normalized: string | null;
}

const NONE: TaxIdCheck = { state: 'empty', label: null, level: null, reason: null, example: null, normalized: null };

/**
 * Checks a buyer's tax id against the format of the buyer's country (the seller's when none is given). Saving is never blocked by
 * the result: a checksum failure is a warning (a typo, or a number from a register the engine cannot see).
 */
export function checkBuyerTaxId(
  buyerCountry: string | null | undefined,
  sellerCountry: string | null | undefined,
  raw: string,
): TaxIdCheck {
  const value = raw.trim();
  const profile = profileOf(buyerCountry) ?? (buyerCountry ? undefined : profileOf(sellerCountry));
  const spec = profile?.buyerTaxId.spec ?? profile?.sellerTaxId.spec ?? null;
  if (!value) return { ...NONE, label: spec?.label ?? null, example: spec?.example ?? null };
  if (!spec) return { ...NONE, state: 'unchecked' };
  const r = spec.validate(value);
  return {
    state: r.valid ? 'valid' : 'invalid',
    label: spec.label,
    level: r.level,
    reason: r.valid ? null : (r.reason ?? null),
    example: spec.example,
    normalized: r.normalized ?? null,
  };
}

// --- place of supply ----------------------------------------------------------------------------------------------------------

/** ISO 3166-2 suffixes that differ from the first abbreviation the engine lists for an Indian state. */
const INDIA_ISO: Record<string, string> = { '05': 'UT', '21': 'OD', '22': 'CG', '26': 'DH', '34': 'PY', '36': 'TS' };

export interface RegionOption {
  /** The ISO 3166-2 suffix ("MH", "CA"). */
  code: string;
  name: string;
}

/** The states or provinces to pick a place of supply from, where the engine knows them (India, United States, Canada). */
export function regionOptions(country: string | null | undefined): RegionOption[] {
  switch ((country ?? '').toUpperCase()) {
    case 'IN':
      return INDIA_STATES.flatMap((s) => {
        const code = INDIA_ISO[s.code] ?? s.abbr[0];
        return code ? [{ code, name: s.name }] : [];
      });
    case 'US':
      return US_STATES.map((s) => ({ code: s.code, name: s.name }));
    case 'CA':
      return CA_PROVINCES.map((s) => ({ code: s.code, name: s.name }));
    default:
      return [];
  }
}

/** "IN-MH" to its country and region; a bare country code has no region. */
export function splitPlace(place: string | null | undefined): { country: string; region: string } {
  const p = (place ?? '').trim().toUpperCase();
  const [country = '', region = ''] = p.split('-');
  return { country, region };
}

/** The `placeOfSupply` to send: "IN-MH" from a country and a region, or null when there is no region to name. */
export function placeOfSupplyOf(country: string | null | undefined, region: string | null | undefined): string | null {
  const c = (country ?? '').trim().toUpperCase();
  const r = (region ?? '').trim().toUpperCase();
  return c && r ? `${c}-${r}` : null;
}

// --- the live "Why this tax?" -------------------------------------------------------------------------------------------------

export interface AutoTaxContext {
  sellerCountry: string | null;
  sellerState: string | null;
  sellerTaxId: string | null;
  buyerCountry: string | null;
  buyerTaxId: string | null;
  /** ISO 3166-2 ("IN-MH") or a bare country code. */
  placeOfSupply: string | null;
  supplyType: SupplyType;
  /** The supply date (YYYY-MM-DD). */
  date: string;
}

export interface AutoTaxLine {
  hsnSac: string | null;
  /** An explicit slab picked for the line: a tax rate's percent, honoured over the profile's standard rate (single-part rates only). */
  ratePercent: string | null;
}

export interface AutoTaxPreview {
  lines: Array<LineTax | null>;
  reasons: string[];
  warnings: string[];
  documentNotes: string[];
  taxFree: boolean;
  reverseCharge: boolean;
  documentTypeHint: string | null;
}

export type AutoTaxOutcome = { ok: true; preview: AutoTaxPreview } | { ok: false; reason: 'noCountry' | 'noProfile' | 'failed' };

/**
 * What the tax engine would decide for these lines, the way the API decides it in auto mode (same inputs, same filtering of
 * withholding): one `LineTax` per line (null = no tax) plus the reasons, warnings and printable notes, each said once.
 */
export function previewAutoTax(ctx: AutoTaxContext, lines: readonly AutoTaxLine[]): AutoTaxOutcome {
  const code = (ctx.sellerCountry ?? '').trim().toUpperCase();
  if (!code) return { ok: false, reason: 'noCountry' };
  if (!getTaxProfile(code)) return { ok: false, reason: 'noProfile' };
  const buyerCountry = (ctx.buyerCountry ?? ctx.placeOfSupply?.slice(0, 2) ?? code).toUpperCase();
  const region = ctx.placeOfSupply?.includes('-') ? ctx.placeOfSupply.split('-')[1] : undefined;

  const out: AutoTaxPreview = {
    lines: [],
    reasons: [],
    warnings: [],
    documentNotes: [],
    taxFree: true,
    reverseCharge: false,
    documentTypeHint: null,
  };
  const push = (into: string[], items: readonly string[]) => {
    for (const s of items) if (!into.includes(s)) into.push(s);
  };
  try {
    for (const l of lines) {
      const res: ResolveResult = resolveTaxForLine({
        sellerProfile: code,
        seller: {
          ...(ctx.sellerState ? { region: ctx.sellerState } : {}),
          ...(ctx.sellerTaxId ? { taxId: ctx.sellerTaxId } : {}),
        },
        buyer: {
          country: buyerCountry,
          ...(region ? { region } : {}),
          type: ctx.buyerTaxId ? 'business' : 'consumer',
          ...(ctx.buyerTaxId ? { taxId: ctx.buyerTaxId } : {}),
        },
        product: {
          category: 'standard',
          ...(l.hsnSac ? { code: l.hsnSac } : {}),
          ...(l.ratePercent ? { ratePercent: l.ratePercent } : {}),
        },
        supplyType: ctx.supplyType,
        date: ctx.date,
      });
      push(out.reasons, res.reasons);
      push(out.warnings, res.warnings);
      push(out.documentNotes, res.documentNotes);
      if (res.reverseCharge) out.reverseCharge = true;
      if (!res.taxFree) out.taxFree = false;
      if (res.documentTypeHint && res.documentTypeHint !== 'tax_invoice') out.documentTypeHint = res.documentTypeHint;
      const taxes = res.taxes.filter((t) => t.category !== 'withholding' && Number(t.rate) >= 0);
      out.lines.push(
        taxes.length === 0
          ? null
          : {
              name: taxes.map((t) => t.name).join(' + '),
              inclusive: false,
              items: taxes.map((t) => ({
                code: t.code,
                name: t.name,
                rate: String(t.rate),
                ...(t.compound ? { compound: true } : {}),
              })),
            },
      );
    }
  } catch {
    return { ok: false, reason: 'failed' };
  }
  return { ok: true, preview: out };
}

// --- a tax rate as a line's tax -----------------------------------------------------------------------------------------------

const trimPct = (p: string): string => (p.includes('.') ? p.replace(/0+$/, '').replace(/\.$/, '') : p);

/** A saved tax rate as the tax a line carries: its parts when it has components (CGST + SGST), else one item named after it. */
export function lineTaxOfRate(r: Pick<TaxRateResponse, 'name' | 'rate' | 'inclusive' | 'components'>): LineTax {
  if (r.components && r.components.length > 0) {
    return {
      name: r.name,
      inclusive: r.inclusive,
      items: r.components.map((c) => ({ code: c.type, name: `${c.type} ${trimPct(c.rate)}%`, rate: c.rate })),
    };
  }
  return { name: r.name, inclusive: r.inclusive, items: [{ code: r.name, name: r.name, rate: r.rate }] };
}

/** The percent an explicit slab sends to the auto-tax engine: only a rate made of one tax counts (the server does the same). */
export const slabPercentOf = (r: Pick<TaxRateResponse, 'rate' | 'components'> | null | undefined): string | null =>
  r && !(r.components && r.components.length > 1) ? r.rate : null;
