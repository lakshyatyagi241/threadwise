import { describe, expect, it } from 'vitest';
import { parseChatLimit, parsePhone, validateDetails } from './details-form';

describe('parsePhone', () => {
  it('turns what people type into E.164', () => {
    expect(parsePhone('+91 98765-43210')).toBe('+919876543210');
    expect(parsePhone('(+1) 415.555.0100')).toBe('+14155550100');
    expect(parsePhone('0091 98765 43210')).toBe('+919876543210');
  });

  it('reads an empty field as no phone', () => {
    expect(parsePhone('')).toBeNull();
    expect(parsePhone('   ')).toBeNull();
  });

  it('refuses a number without a country code or with letters', () => {
    expect(parsePhone('9876543210')).toBeUndefined();
    expect(parsePhone('+91 98765 abc')).toBeUndefined();
    expect(parsePhone('+0123456789')).toBeUndefined();
  });
});

describe('parseChatLimit', () => {
  it('reads an empty field as no limit', () => {
    expect(parseChatLimit('')).toBeNull();
    expect(parseChatLimit('  ')).toBeNull();
  });

  it('accepts whole numbers from 1 to 1000', () => {
    expect(parseChatLimit('1')).toBe(1);
    expect(parseChatLimit(' 5 ')).toBe(5);
    expect(parseChatLimit('1000')).toBe(1000);
  });

  it('refuses zero, negatives, decimals, text and anything above the maximum', () => {
    for (const bad of ['0', '-3', '2.5', 'abc', '1001', '99999', '1e2']) {
      expect(parseChatLimit(bad)).toBeUndefined();
    }
  });
});

describe('validateDetails', () => {
  it('returns the values to save', () => {
    expect(validateDetails({ phone: '+91 98765 43210', chatLimit: '3' })).toEqual({
      phone: '+919876543210',
      chatLimit: 3,
    });
    expect(validateDetails({ phone: '', chatLimit: '' })).toEqual({ phone: null, chatLimit: null });
  });

  it('names every field that is wrong', () => {
    expect(validateDetails({ phone: '123', chatLimit: '0' })).toEqual({
      errors: { phone: 'invalid', chatLimit: 'invalid' },
    });
  });
});
