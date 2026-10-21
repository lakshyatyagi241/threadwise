import { getCountries } from 'libphonenumber-js';
import { COUNTRY_NAMES } from './country-names';
import {
  callingCode,
  countryMatches,
  DEFAULT_COUNTRY,
  joinPhone,
  listCountries,
  nationalOf,
  splitPhone,
} from './countries';

describe('phone countries', () => {
  it('starts on India, and knows the calling code of a country', () => {
    expect(DEFAULT_COUNTRY).toBe('IN');
    expect(callingCode('IN')).toBe('+91');
    expect(callingCode('AE')).toBe('+971');
  });

  it('lists every country with its calling code, by name', () => {
    const all = listCountries('en');
    expect(all.length).toBeGreaterThan(200);
    expect(all.find((c) => c.iso === 'IN')).toMatchObject({ code: '+91' });
    const names = all.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
  });

  it('has a name for every country the library knows, and none for a country it does not', () => {
    for (const iso of getCountries()) expect(COUNTRY_NAMES[iso]).toBeTruthy();
    expect(Object.keys(COUNTRY_NAMES).sort()).toEqual([...getCountries()].sort());
    // Names, not letters: a person searches "india", not "in".
    const all = listCountries('en');
    expect(all.find((c) => c.iso === 'IN')?.name).toBe('India');
    expect(all.find((c) => c.iso === 'AE')?.name).toBe('United Arab Emirates');
    expect(all.some((c) => c.name === c.iso)).toBe(false);
  });

  it('matches a country by part of its name, its letters or its calling code', () => {
    const india = { iso: 'IN' as const, code: '+91', name: 'India' };
    expect(countryMatches(india, '')).toBe(true);
    expect(countryMatches(india, 'ind')).toBe(true);
    expect(countryMatches(india, 'in')).toBe(true);
    expect(countryMatches(india, '+9')).toBe(true);
    expect(countryMatches(india, '91')).toBe(true);
    expect(countryMatches(india, '44')).toBe(false);
    expect(countryMatches(india, 'peru')).toBe(false);
  });

  it('splits a stored number into its country and the digits after the code', () => {
    expect(splitPhone('+919876543210', 'US')).toEqual({ iso: 'IN', national: '9876543210' });
    expect(splitPhone('+971501234567', 'IN')).toEqual({ iso: 'AE', national: '501234567' });
    // Without a "+" the digits are tried as an international number, then read as the fallback country's.
    expect(splitPhone('919876543210', 'US')).toEqual({ iso: 'IN', national: '9876543210' });
    expect(splitPhone('9876543210', 'IN')).toEqual({ iso: 'IN', national: '9876543210' });
    expect(splitPhone('', 'IN')).toEqual({ iso: 'IN', national: '' });
  });

  it('keeps the country of a half typed number that starts with a code', () => {
    expect(splitPhone('+4412', 'IN')).toEqual({ iso: 'GB', national: '12' });
  });

  it('joins a country and a number into what the API takes, and back', () => {
    expect(joinPhone('IN', '98765 43210')).toBe('+919876543210');
    expect(joinPhone('IN', '')).toBe('');
    expect(joinPhone('IN', ' - ')).toBe('');
    expect(nationalOf('+919876543210', 'IN')).toBe('9876543210');
    // Another country's code is not stripped: the digits stay as they are.
    expect(nationalOf('+971501234567', 'IN')).toBe('971501234567');
    expect(nationalOf('', 'IN')).toBe('');
  });
});
