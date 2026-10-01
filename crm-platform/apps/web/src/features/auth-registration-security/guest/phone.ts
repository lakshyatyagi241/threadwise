import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  isSupportedCountry,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';

/** Phone helpers for the sign-up form (TW-AUTH-005): country list, as-you-type formatting, E.164. */

export interface CountryOption {
  iso: CountryCode;
  /** Calling code without the plus: "91". */
  dial: string;
  name: string;
  flag: string;
}

/** Regional-indicator emoji for an ISO 3166 alpha-2 code ("IN" -> flag). */
export function flagEmoji(iso: string): string {
  const upper = iso.toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return '';
  return String.fromCodePoint(...[...upper].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
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
    .map((iso) => ({
      iso,
      dial: getCountryCallingCode(iso),
      name: regionName(iso, locale),
      flag: flagEmoji(iso),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
  cache.set(locale, list);
  return list;
}

/**
 * The country preselected in the picker: the admin's default when valid, otherwise the region of
 * the browser language (en-GB -> GB), otherwise `fallback`.
 */
export function pickDefaultCountry(
  configured: string | null | undefined,
  languages: readonly string[] = [],
  fallback: CountryCode = 'US',
): CountryCode {
  const upper = configured?.toUpperCase();
  if (upper && isSupportedCountry(upper)) return upper as CountryCode;
  for (const tag of languages) {
    const region = tag.split('-')[1]?.toUpperCase();
    if (region && isSupportedCountry(region)) return region as CountryCode;
  }
  return fallback;
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
