import { describe, expect, it } from 'vitest';
import { countryOptions, defaultCountry, splitE164, toE164 } from './phone';

describe('toE164', () => {
  it('normalizes national numbers for the chosen country', () => {
    expect(toE164('98765 43210', 'IN')).toEqual({ e164: '+919876543210', problem: null });
    expect(toE164('(415) 555-2671', 'US')).toEqual({ e164: '+14155552671', problem: null });
    expect(toE164('050 123 4567', 'AE')).toEqual({ e164: '+971501234567', problem: null });
  });

  it('accepts an international number typed into the box whatever the country says', () => {
    expect(toE164('+44 7911 123456', 'IN')).toEqual({ e164: '+447911123456', problem: null });
  });

  it('treats blank as "no phone", not an error', () => {
    expect(toE164('', 'IN')).toEqual({ e164: null, problem: null });
    expect(toE164('   ', 'IN')).toEqual({ e164: null, problem: null });
  });

  it('rejects numbers that cannot exist', () => {
    expect(toE164('123', 'IN').problem).toBe('invalid');
    expect(toE164('abcdef', 'US').problem).toBe('invalid');
    expect(toE164('0000000000', 'IN').problem).toBe('invalid');
  });
});

describe('splitE164', () => {
  it('finds the country and the national part', () => {
    const s = splitE164('+919876543210');
    expect(s.country).toBe('IN');
    expect(s.national.replace(/\D/g, '').endsWith('9876543210')).toBe(true);
  });
  it('round-trips through toE164', () => {
    for (const e of ['+919876543210', '+14155552671', '+971501234567', '+447911123456']) {
      const { country, national } = splitE164(e);
      expect(country).not.toBeNull();
      expect(toE164(national, country!).e164).toBe(e);
    }
  });
  it('handles empty and unreadable values', () => {
    expect(splitE164(null)).toEqual({ country: null, national: '' });
    expect(splitE164('')).toEqual({ country: null, national: '' });
    expect(splitE164('garbage')).toEqual({ country: null, national: 'garbage' });
  });
});

describe('defaultCountry', () => {
  it('prefers the platform default, then the browser region, then US', () => {
    expect(defaultCountry('ae', 'en-IN')).toBe('AE');
    expect(defaultCountry(null, 'en-IN')).toBe('IN');
    expect(defaultCountry(null, 'ar_SA')).toBe('SA');
    expect(defaultCountry(null, 'en')).toBe('US');
    expect(defaultCountry('XX', undefined)).toBe('US');
  });
});

describe('countryOptions', () => {
  it('lists countries with dialling codes, named in the UI language', () => {
    const en = countryOptions('en');
    const india = en.find((c) => c.value === 'IN');
    expect(india?.label).toBe('India (+91)');
    expect(india?.search).toContain('india');
    expect(en.length).toBeGreaterThan(200);
    const ar = countryOptions('ar');
    expect(ar.find((c) => c.value === 'IN')?.label).not.toBe('India (+91)');
  });
});
