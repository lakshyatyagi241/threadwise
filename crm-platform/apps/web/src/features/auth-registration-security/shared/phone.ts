import {
  getCountries,
  getCountryCallingCode,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';

/** Matches the API's `phoneSchema`: E.164, 7 to 15 digits. */
const E164 = /^\+[1-9]\d{6,14}$/;

/** The country the phone picker opens on: the platform's default, else the browser's region, else none. */
export function defaultCountry(
  platformIso: string | null | undefined,
  languageTag: string | undefined,
): CountryCode {
  const valid = new Set<string>(getCountries());
  const platform = platformIso?.toUpperCase();
  if (platform && valid.has(platform)) return platform as CountryCode;
  const region = languageTag?.split(/[-_]/)[1]?.toUpperCase();
  if (region && valid.has(region)) return region as CountryCode;
  return 'US';
}

/** Splits a stored E.164 number into the picker's two parts. A number that cannot be read keeps its digits. */
export function splitE164(e164: string | null | undefined): {
  country: CountryCode | null;
  national: string;
} {
  if (!e164) return { country: null, national: '' };
  const parsed = parsePhoneNumberFromString(e164);
  if (!parsed) return { country: null, national: e164 };
  return { country: parsed.country ?? null, national: parsed.formatNational() };
}

export type PhoneProblem = 'invalid';

/** Converts what was typed into E.164. Empty input is a valid "no phone" (null). */
export function toE164(
  national: string,
  country: CountryCode,
): { e164: string | null; problem: PhoneProblem | null } {
  const text = national.trim();
  if (!text) return { e164: null, problem: null };
  const parsed = parsePhoneNumberFromString(text, country);
  if (!parsed || !parsed.isValid()) return { e164: null, problem: 'invalid' };
  const e164 = parsed.number;
  return E164.test(e164) ? { e164, problem: null } : { e164: null, problem: 'invalid' };
}

export interface CountryOption {
  value: CountryCode;
  label: string;
  search: string;
  callingCode: string;
}

/** Every country libphonenumber knows, named in the UI language, with its dialling code. */
export function countryOptions(locale: string): CountryOption[] {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([locale], { type: 'region' });
  } catch {
    names = null;
  }
  return getCountries()
    .map((value) => {
      const name = names?.of(value) ?? value;
      const callingCode = getCountryCallingCode(value);
      const label = `${name} (+${callingCode})`;
      return {
        value,
        label,
        callingCode,
        search: `${name} ${value} +${callingCode}`.toLowerCase(),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, locale));
}
