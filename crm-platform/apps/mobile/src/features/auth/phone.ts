import {
  getCountryCallingCode,
  isSupportedCountry,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';

/**
 * Phone numbers for sign-up (TW-AUTH-005), checked with the same library as the web so both accept and refuse the same numbers.
 * The web has a country picker; the app has one field: a number typed with a leading "+" is international, any other number is
 * read as a number of the platform's default country.
 */

/** Used when the platform has no default country: the same fallback the web opens on. */
export const FALLBACK_COUNTRY: CountryCode = 'IN';

/** The platform's default country when it is a real one, otherwise the fallback. */
export function pickDefaultCountry(configured: string | null | undefined): CountryCode {
  const upper = configured?.trim().toUpperCase();
  return upper && isSupportedCountry(upper) ? (upper as CountryCode) : FALLBACK_COUNTRY;
}

/** "+91": the calling code of a country, for the field's placeholder. */
export const callingCodeOf = (iso: CountryCode): string => `+${getCountryCallingCode(iso)}`;

function parse(raw: string, iso: CountryCode) {
  const text = raw.trim();
  if (!text) return undefined;
  return text.startsWith('+')
    ? parsePhoneNumberFromString(text)
    : parsePhoneNumberFromString(text, iso);
}

export interface PhoneState {
  /** `+919876543210` when the number is valid, otherwise null. */
  e164: string | null;
  valid: boolean;
}

export function evaluatePhone(raw: string, iso: CountryCode): PhoneState {
  const parsed = parse(raw, iso);
  if (!parsed?.isValid()) return { e164: null, valid: false };
  return { e164: parsed.number, valid: true };
}

/** "+91 98765 43210" for a valid number, the text as typed otherwise (never "fix" what we cannot read). */
export function formatPhone(raw: string, iso: CountryCode): string {
  const parsed = parse(raw, iso);
  return parsed?.isValid() ? parsed.formatInternational() : raw;
}

/**
 * "+91 •••• ••21": the calling code, then the rest hidden except the last two digits. Built from the number the person typed, so
 * it is right for a one-digit (+1), three-digit (+971) or any other calling code, instead of the server guessing a prefix length.
 */
export function maskPhone(e164: string): string {
  const text = e164.trim();
  const digits = text.replace(/\D/g, '');
  if (!digits) return '';
  const tail = digits.slice(-2);
  const parsed = text.startsWith('+') ? parsePhoneNumberFromString(text) : undefined;
  if (!parsed || tail.length < 2) return `•••• ••${tail}`;
  return `+${parsed.countryCallingCode} •••• ••${tail}`;
}
