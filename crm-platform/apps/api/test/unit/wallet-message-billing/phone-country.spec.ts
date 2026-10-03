import { describe, expect, it } from 'vitest';
import {
  countryName,
  countryOfPhone,
  resolveCountry,
} from '../../../src/modules/wallet-message-billing/phone-country';

describe('countryOfPhone (WD-WALLET-004 rule 3)', () => {
  it('lets the longest dialling code win: 971 is the UAE', () => {
    expect(countryOfPhone('+971 50 123 4567')).toBe('AE');
    expect(countryOfPhone('971501234567')).toBe('AE');
  });

  it('resolves common destinations', () => {
    expect(countryOfPhone('+91 98765 43210')).toBe('IN');
    expect(countryOfPhone('+44 7700 900123')).toBe('GB');
    expect(countryOfPhone('+55 11 91234 5678')).toBe('BR');
    expect(countryOfPhone('+52 55 1234 5678')).toBe('MX');
    expect(countryOfPhone('0049 30 123456')).toBe('DE');
  });

  it('reads the North American area code: +1 415 is the US, +1 416 is Canada, +1 787 is Puerto Rico', () => {
    expect(countryOfPhone('+1 415 555 0100')).toBe('US');
    expect(countryOfPhone('+1 416 555 0100')).toBe('CA');
    expect(countryOfPhone('+1 787 555 0100')).toBe('PR');
  });

  it('tells Kazakhstan from Russia', () => {
    expect(countryOfPhone('+7 701 123 4567')).toBe('KZ');
    expect(countryOfPhone('+7 912 345 6789')).toBe('RU');
  });

  it('answers null for an unknown prefix or a number that is too short', () => {
    expect(countryOfPhone('+999 123456789')).toBeNull();
    expect(countryOfPhone('12345')).toBeNull();
    expect(countryOfPhone(null)).toBeNull();
    expect(countryOfPhone('')).toBeNull();
  });
});

describe('resolveCountry (WD-WALLET-006)', () => {
  it('accepts an ISO code, a name, an alias and a calling code', () => {
    expect(resolveCountry('in')).toBe('IN');
    expect(resolveCountry('India')).toBe('IN');
    expect(resolveCountry('usa')).toBe('US');
    expect(resolveCountry('UK')).toBe('GB');
    expect(resolveCountry('UAE')).toBe('AE');
    expect(resolveCountry('+91')).toBe('IN');
    expect(resolveCountry('971')).toBe('AE');
  });

  it('reads blank and * as any country, and an unknown name as not understood', () => {
    expect(resolveCountry('')).toBe('');
    expect(resolveCountry('*')).toBe('');
    expect(resolveCountry('Narnia')).toBeNull();
    expect(resolveCountry('ZZ')).toBeNull();
  });

  it('names a country in English', () => {
    expect(countryName('IN')).toBe('India');
    expect(countryName('')).toBe('');
  });
});
