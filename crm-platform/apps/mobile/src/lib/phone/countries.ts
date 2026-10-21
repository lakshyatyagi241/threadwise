import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';
import { COUNTRY_NAMES } from './country-names';

/**
 * The country part of a phone field: the countries with their calling codes, and the two directions of the number — "+919876543210"
 * split into a country and the digits after its code, and back. A number is kept as `+` and digits (what the API takes), so
 * the field can show a country picker without the form or the API knowing about it.
 */

export interface CountryOption {
  iso: CountryCode;
  /** "+91". */
  code: string;
  /** The country's name in the app's language, or its two letters where the phone cannot name it. */
  name: string;
}

/** The country code a phone field starts on: India, as in the Geta app and on the web. */
export const DEFAULT_COUNTRY: CountryCode = 'IN';

export const callingCode = (iso: CountryCode): string => `+${getCountryCallingCode(iso)}`;

function nameOf(iso: CountryCode, locale: string): string {
  try {
    // The engine's own name in the person's language, when it has one (it answers with the letters when it does not).
    const name = new Intl.DisplayNames([locale], { type: 'region' }).of(iso);
    if (name && name !== iso) return name;
  } catch {
    // Not every engine can name a region.
  }
  return COUNTRY_NAMES[iso] ?? iso;
}

/** Every country the library knows, by name in the person's language. */
export function listCountries(locale: string): CountryOption[] {
  return getCountries()
    .map((iso) => ({ iso, code: callingCode(iso), name: nameOf(iso, locale) }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}

/** Whether a country matches what was typed in the picker's search: part of its name, its letters or its calling code. */
export function countryMatches(country: CountryOption, query: string): boolean {
  const text = query.trim().toLowerCase();
  if (!text) return true;
  const digits = text.replace(/\D/g, '');
  return (
    country.name.toLowerCase().includes(text) ||
    country.iso.toLowerCase() === text ||
    (digits !== '' && country.code.slice(1).startsWith(digits))
  );
}

const digitsOf = (text: string): string => text.replace(/\D/g, '');

/** The first country that owns a calling code, for a number that does not say which of them it is (+1 is shared). */
function firstCountryOf(code: string): CountryCode | undefined {
  return getCountries().find((iso) => getCountryCallingCode(iso) === code);
}

/**
 * A stored or pasted number as a country and the digits after its calling code. A number with a "+" says its own country; one
 * without is read as a number of `fallback`, unless the digits starting with a known calling code make a valid number.
 */
export function splitPhone(
  value: string,
  fallback: CountryCode,
): { iso: CountryCode; national: string } {
  const text = value.trim();
  if (!text) return { iso: fallback, national: '' };
  const parsed = text.startsWith('+')
    ? parsePhoneNumberFromString(text)
    : parsePhoneNumberFromString(`+${digitsOf(text)}`);
  if (parsed?.isValid() || (text.startsWith('+') && parsed)) {
    const iso = parsed.country ?? firstCountryOf(parsed.countryCallingCode) ?? fallback;
    return { iso, national: parsed.nationalNumber };
  }
  if (text.startsWith('+')) {
    // Half typed: keep the country of the code it begins with, and the rest as the number.
    const digits = digitsOf(text);
    for (const length of [3, 2, 1]) {
      const iso = firstCountryOf(digits.slice(0, length));
      if (iso) return { iso, national: digits.slice(length) };
    }
  }
  return { iso: fallback, national: digitsOf(text) };
}

/** The number as the API takes it: "+", the calling code and the digits; empty when there are no digits to dial. */
export function joinPhone(iso: CountryCode, national: string): string {
  const digits = digitsOf(national);
  return digits ? `+${getCountryCallingCode(iso)}${digits}` : '';
}

/** The digits after the calling code of `iso` in a joined number (what the number box shows). */
export function nationalOf(value: string, iso: CountryCode): string {
  const code = `+${getCountryCallingCode(iso)}`;
  const text = value.trim();
  return text.startsWith(code) ? text.slice(code.length) : digitsOf(text);
}
