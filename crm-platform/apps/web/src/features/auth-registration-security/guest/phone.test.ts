import { describe, expect, it } from 'vitest';
import {
  countryFromInternational,
  evaluatePhone,
  flagClass,
  formatNational,
  listCountries,
  maskPhone,
  pickDefaultCountry,
} from './phone';

describe('phone helpers', () => {
  it('produces E.164 from national input and the chosen country', () => {
    expect(evaluatePhone('98765 43210', 'IN')).toMatchObject({
      e164: '+919876543210',
      valid: true,
    });
    expect(evaluatePhone('(415) 555-2671', 'US')).toMatchObject({
      e164: '+14155552671',
      valid: true,
    });
    expect(evaluatePhone('050 123 4567', 'AE')).toMatchObject({
      e164: '+971501234567',
      valid: true,
    });
  });

  it('accepts a pasted international number regardless of the picker', () => {
    const s = evaluatePhone('+44 20 7946 0958', 'IN');
    expect(s.e164).toBe('+442079460958');
    expect(s.iso).toBe('GB');
  });

  it('refuses numbers that are not valid for the country', () => {
    expect(evaluatePhone('12345', 'IN')).toMatchObject({ e164: null, valid: false });
    expect(evaluatePhone('', 'IN')).toMatchObject({ e164: null, valid: false, possible: false });
    expect(evaluatePhone('abc', 'IN').e164).toBeNull();
  });

  it('formats as the visitor types', () => {
    expect(formatNational('9876543210', 'IN')).toBe('98765 43210');
    expect(formatNational('4155552671', 'US')).toBe('(415) 555-2671');
    expect(formatNational('+919876543210', 'US')).toBe('+91 98765 43210');
  });

  it('detects the country of a typed +code', () => {
    expect(countryFromInternational('+919876543210')).toBe('IN');
    expect(countryFromInternational('9876543210')).toBeNull();
    expect(countryFromInternational('+')).toBeNull();
  });

  it('opens on the platform default country, else on the reference fallback (India)', () => {
    expect(pickDefaultCountry('ae')).toBe('AE');
    expect(pickDefaultCountry(' gb ')).toBe('GB');
    expect(pickDefaultCountry(null)).toBe('IN');
    expect(pickDefaultCountry('ZZ')).toBe('IN');
    expect(pickDefaultCountry(undefined, 'US')).toBe('US');
  });

  it('lists countries with dial code, a searchable text and a sorted name', () => {
    const list = listCountries('en');
    const india = list.find((c) => c.iso === 'IN');
    expect(india).toMatchObject({ dial: '91', name: 'India' });
    expect(india?.search).toBe('india in +91');
    const names = list.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
    expect(listCountries('en')).toBe(list);
  });

  it('names the flag image class of a country, and nothing for a non-code', () => {
    expect(flagClass('IN')).toBe('fi fi-in');
    expect(flagClass(' gb ')).toBe('fi fi-gb');
    expect(flagClass('x')).toBe('');
    expect(flagClass('')).toBe('');
  });

  it('resolves shared calling codes by the typed number, not by a short lookup table', () => {
    // Reference only knew eleven dial codes; any other fell back to the default country.
    expect(countryFromInternational('+14155552671')).toBe('US');
    expect(countryFromInternational('+12025550123')).toBe('US');
    expect(countryFromInternational('+971501234567')).toBe('AE');
    expect(countryFromInternational('+353871234567')).toBe('IE');
    expect(countryFromInternational('+9779812345678')).toBe('NP');
  });
});

describe('maskPhone', () => {
  it('keeps the real calling code, whatever its length', () => {
    expect(maskPhone('+919876543210')).toBe('+91 •••• ••10');
    expect(maskPhone('+14155552671')).toBe('+1 •••• ••71');
    expect(maskPhone('+971501234567')).toBe('+971 •••• ••67');
    expect(maskPhone('+353871234567')).toBe('+353 •••• ••67');
    expect(maskPhone('+442079460958')).toBe('+44 •••• ••58');
  });

  it('never shows more than the last two digits', () => {
    for (const n of ['+919876543210', '+14155552671', '+971501234567']) {
      const masked = maskPhone(n);
      expect(masked.replace(/\D/g, '').length).toBeLessThanOrEqual(5);
      expect(masked).not.toContain(n.slice(-6));
    }
  });

  it('masks a number without a readable calling code', () => {
    expect(maskPhone('9876543210')).toBe('•••• ••10');
    expect(maskPhone('')).toBe('');
  });
});
