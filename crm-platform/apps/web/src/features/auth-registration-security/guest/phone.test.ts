import { describe, expect, it } from 'vitest';
import {
  countryFromInternational,
  evaluatePhone,
  flagEmoji,
  formatNational,
  listCountries,
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

  it('picks the default country: admin setting, then browser region, then fallback', () => {
    expect(pickDefaultCountry('ae', ['en-GB'])).toBe('AE');
    expect(pickDefaultCountry(null, ['en-GB'])).toBe('GB');
    expect(pickDefaultCountry('ZZ', ['en', 'fr-CA'])).toBe('CA');
    expect(pickDefaultCountry(null, ['en'], 'IN')).toBe('IN');
  });

  it('lists countries with dial code, flag and a sorted name', () => {
    const list = listCountries('en');
    const india = list.find((c) => c.iso === 'IN');
    expect(india).toMatchObject({ dial: '91', name: 'India' });
    expect(india?.flag).toBe(flagEmoji('IN'));
    const names = list.map((c) => c.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
    expect(listCountries('en')).toBe(list);
  });

  it('builds a flag emoji from an ISO code', () => {
    expect(flagEmoji('IN')).toBe('\u{1F1EE}\u{1F1F3}');
    expect(flagEmoji('x')).toBe('');
  });
});
