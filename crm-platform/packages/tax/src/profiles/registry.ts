import { CANADA_PROFILE } from './countries/canada';
import { CUSTOM_PROFILE } from './countries/custom';
import { EU_PROFILES } from './countries/eu';
import { INDIA_PROFILE } from './countries/india';
import {
  AUSTRALIA_PROFILE,
  BAHRAIN_PROFILE,
  BRAZIL_PROFILE,
  JAPAN_PROFILE,
  KENYA_PROFILE,
  KUWAIT_PROFILE,
  MALAYSIA_PROFILE,
  MEXICO_PROFILE,
  NEW_ZEALAND_PROFILE,
  NIGERIA_PROFILE,
  OMAN_PROFILE,
  QATAR_PROFILE,
  SAUDI_PROFILE,
  SINGAPORE_PROFILE,
  SOUTH_AFRICA_PROFILE,
  UAE_PROFILE,
} from './countries/simple';
import { UK_PROFILE } from './countries/uk';
import { US_PROFILE } from './countries/us';
import type { TaxProfile } from './types';

const ALL: readonly TaxProfile[] = [
  INDIA_PROFILE,
  UAE_PROFILE,
  SAUDI_PROFILE,
  BAHRAIN_PROFILE,
  OMAN_PROFILE,
  QATAR_PROFILE,
  KUWAIT_PROFILE,
  UK_PROFILE,
  ...EU_PROFILES,
  US_PROFILE,
  CANADA_PROFILE,
  AUSTRALIA_PROFILE,
  NEW_ZEALAND_PROFILE,
  SINGAPORE_PROFILE,
  MALAYSIA_PROFILE,
  SOUTH_AFRICA_PROFILE,
  NIGERIA_PROFILE,
  KENYA_PROFILE,
  MEXICO_PROFILE,
  BRAZIL_PROFILE,
  JAPAN_PROFILE,
  CUSTOM_PROFILE,
];

const BY_CODE = new Map(ALL.map((p) => [p.code, p]));
/** Common alternative codes: UK for GB, EL for GR (the VAT prefix), XX/ZZ for custom. */
const ALIASES: Readonly<Record<string, string>> = {
  UK: 'GB',
  EL: 'GR',
  XX: 'CUSTOM',
  ZZ: 'CUSTOM',
  OTHER: 'CUSTOM',
};

/** All profiles, custom last. */
export const TAX_PROFILES: readonly TaxProfile[] = ALL;

/** Looks a profile up by ISO alpha-2 code (case-insensitive; "UK" and "EL" are accepted). Undefined when there is none. */
export function getTaxProfile(code: string): TaxProfile | undefined {
  const c = code.trim().toUpperCase();
  return BY_CODE.get(ALIASES[c] ?? c);
}

/** Like `getTaxProfile` but falls back to the CUSTOM profile for an unknown country, so a caller never has to branch. */
export function taxProfileOrCustom(code: string | null | undefined): TaxProfile {
  return (code ? getTaxProfile(code) : undefined) ?? CUSTOM_PROFILE;
}

export const listTaxProfiles = (): readonly TaxProfile[] => ALL;
