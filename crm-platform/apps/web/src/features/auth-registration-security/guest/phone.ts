import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  isSupportedCountry,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';

/** Phone helpers for the sign-up form (WD-AUTH-005): country list, as-you-type formatting, E.164. */

export interface CountryOption {
  iso: CountryCode;
  /** Calling code without the plus: "91". */
  dial: string;
  name: string;
  /** Lower-cased text the picker's search box matches: name, ISO code and "+dial". */
  search: string;
}

/** The CSS class of a country's flag image (`flag-icons`): `fi fi-in`. Empty for anything that is not an ISO code. */
export function flagClass(iso: string): string {
  const lower = iso.trim().toLowerCase();
  return /^[a-z]{2}$/.test(lower) ? `fi fi-${lower}` : '';
}

function regionName(iso: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(iso) ?? iso;
  } catch {
    return iso;
  }
}

const cache = new Map<string, CountryOption[]>();

/** Every country libphonenumber knows, named in the visitor's language and sorted by that name. */
export function listCountries(locale: string): CountryOption[] {
  const hit = cache.get(locale);
  if (hit) return hit;
  const list = getCountries()
    .map((iso) => {
      const name = regionName(iso, locale);
      const dial = getCountryCallingCode(iso);
      return { iso, dial, name, search: `${name} ${iso} +${dial}`.toLowerCase() };
    })
    .sort((a, b) => a.name.localeCompare(b.name, locale));
  cache.set(locale, list);
  return list;
}

/** Used when the platform has no default country: the same fallback the reference product opens on. */
export const FALLBACK_COUNTRY: CountryCode = 'IN';

/**
 * The country preselected in the picker: the platform's default when it is a real country, otherwise
 * `fallback`. The browser's language is deliberately not consulted: the same page must open on the same
 * country for everyone (and render the same on the server and in the browser).
 */
export function pickDefaultCountry(
  configured: string | null | undefined,
  fallback: CountryCode = FALLBACK_COUNTRY,
): CountryCode {
  const upper = configured?.trim().toUpperCase();
  return upper && isSupportedCountry(upper) ? (upper as CountryCode) : fallback;
}

/** Formats what the visitor has typed for the chosen country ("98765 43210"). Plus-prefixed input stays international. */
export function formatNational(raw: string, iso: CountryCode): string {
  const trimmed = raw.trimStart();
  if (trimmed.startsWith('+')) return new AsYouType().input(trimmed);
  return new AsYouType(iso).input(trimmed);
}

export interface PhoneState {
  /** `+919876543210` when the number is valid for its country, otherwise null. */
  e164: string | null;
  valid: boolean;
  /** Enough digits to be a number at all (used to avoid shouting while typing). */
  possible: boolean;
  /** Country the number belongs to, which may differ from the picker when a +code was typed. */
  iso: CountryCode;
}

export function evaluatePhone(raw: string, iso: CountryCode): PhoneState {
  const text = raw.trim();
  if (!text) return { e164: null, valid: false, possible: false, iso };
  const parsed = text.startsWith('+')
    ? parsePhoneNumberFromString(text)
    : parsePhoneNumberFromString(text, iso);
  if (!parsed) return { e164: null, valid: false, possible: false, iso };
  const valid = parsed.isValid();
  return {
    e164: valid ? parsed.number : null,
    valid,
    possible: parsed.isPossible(),
    iso: (parsed.country as CountryCode | undefined) ?? iso,
  };
}

/** When a number is typed or pasted with a leading +code, which country should the picker switch to? */
export function countryFromInternational(raw: string): CountryCode | null {
  const text = raw.trim();
  if (!text.startsWith('+')) return null;
  const parsed = parsePhoneNumberFromString(text);
  return (parsed?.country as CountryCode | undefined) ?? null;
}

/** The part of an international number after the calling code, formatted for display. */
export function nationalPart(raw: string, iso: CountryCode): string {
  const parsed = parsePhoneNumberFromString(raw.trim(), iso);
  return parsed ? parsed.formatNational() : raw;
}

/**
 * "+91 •••• ••21": the calling code, then the rest hidden except the last two digits. The calling code comes from
 * the number itself, so it is right for one-digit (+1), three-digit (+971) and every other length, instead of
 * guessing a prefix length. A value that is not a readable international number is masked without a code.
 */
export function maskPhone(e164: string): string {
  const text = e164.trim();
  const parsed = text.startsWith('+') ? parsePhoneNumberFromString(text) : undefined;
  const digits = text.replace(/\D/g, '');
  if (!digits) return '';
  const tail = digits.slice(-2);
  if (!parsed || tail.length < 2) return `•••• ••${tail}`;
  return `+${parsed.countryCallingCode} •••• ••${tail}`;
}
