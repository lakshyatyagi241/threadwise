import { getCountries } from 'libphonenumber-js';

const FALLBACK_ZONES = [
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
];

/** Every IANA zone the engine knows, plus the saved value even when the engine lists it under another name. */
export function timeZoneOptions(current?: string | null): string[] {
  const fn = (Intl as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
  const set = new Set(typeof fn === 'function' ? fn.call(Intl, 'timeZone') : FALLBACK_ZONES);
  set.add('UTC');
  if (current) set.add(current);
  return [...set].sort((a, b) => a.localeCompare(b));
}

export interface CountryOption {
  /** ISO 3166-1 alpha-2, upper case. */
  code: string;
  name: string;
}

/** Countries sorted by their name in the viewer's language. */
export function countryOptions(locale: string): CountryOption[] {
  let names: Intl.DisplayNames | null = null;
  try {
    names = new Intl.DisplayNames([locale], { type: 'region' });
  } catch {
    names = null;
  }
  return getCountries()
    .map((code) => ({ code, name: names?.of(code) ?? code }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}
