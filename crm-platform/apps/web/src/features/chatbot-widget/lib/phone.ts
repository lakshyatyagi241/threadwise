import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';

/**
 * The WhatsApp number of the widget is two stored values, as in WaDesk: the dial code with a plus (`+91`) and the national
 * digits (`9876543210`). This is the country-picker arithmetic around them.
 */

export const dialCodeOf = (country: CountryCode): string => `+${getCountryCallingCode(country)}`;

/** Digits only: the dial code lives in its own field. */
export const nationalDigits = (v: string): string => v.replace(/\D+/g, '');

const VALID = new Set<string>(getCountries());

/** The picker's opening country: the platform's default, else India as in WaDesk. */
export function openingCountry(platformIso: string | null | undefined): CountryCode {
  const iso = platformIso?.toUpperCase();
  return iso && VALID.has(iso) ? (iso as CountryCode) : 'IN';
}

/** The country a saved `+cc` + digits belongs to; the first country with that dial code when the number does not parse. */
export function countryOf(cc: string, number: string, fallback: CountryCode): CountryCode {
  const code = cc.replace(/\D+/g, '');
  const digits = nationalDigits(number);
  if (code === '' || digits === '') return fallback;
  const parsed = parsePhoneNumberFromString(`+${code}${digits}`);
  if (parsed?.country) return parsed.country;
  return getCountries().find((c) => getCountryCallingCode(c) === code) ?? fallback;
}

/**
 * A pasted international number ("+91 98765 43210") re-split so the dial code is not counted twice: the country follows
 * the number and the national part drops the code. Null when the text is not an international number.
 */
export function splitInternational(
  text: string,
): { country: CountryCode; national: string } | null {
  const t = text.trim();
  if (!t.startsWith('+')) return null;
  const parsed = parsePhoneNumberFromString(t);
  if (!parsed?.country) return null;
  return { country: parsed.country, national: parsed.nationalNumber };
}

export function flagEmoji(country: string): string {
  return country.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

export interface CountryOption {
  value: CountryCode;
  label: string;
  dial: string;
}

/** Every country libphonenumber knows, named in the UI language, ordered by name. */
export function countryOptions(locale: string): CountryOption[] {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([locale], { type: 'region' });
  } catch {
    names = null;
  }
  return getCountries()
    .map((c) => ({ value: c, label: names?.of(c) ?? c, dial: dialCodeOf(c) }))
    .sort((a, b) => a.label.localeCompare(b.label, locale));
}
