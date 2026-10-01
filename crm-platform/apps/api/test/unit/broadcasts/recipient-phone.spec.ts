import { describe, expect, it } from 'vitest';
import { assemblePhone, senderDigits } from '../../../src/modules/broadcasts/recipient-phone';

describe('assemblePhone (TW-BCAST-016 rule 4)', () => {
  it('keeps an E.164 number whole', () => {
    expect(assemblePhone('+91 98765 43210', null)).toBe('919876543210');
    expect(assemblePhone('+919876543210', '+91')).toBe('919876543210');
  });
  it('prefixes the country code to a local number', () => {
    expect(assemblePhone('9876543210', '+91')).toBe('919876543210');
    expect(assemblePhone('9876543210', '91')).toBe('919876543210');
  });
  it('does not double the country code when the local number already starts with it', () => {
    expect(assemblePhone('919876543210', '+91')).toBe('919876543210');
  });
  it('is empty when there is no number', () => {
    expect(assemblePhone(null, '+91')).toBe('');
    expect(assemblePhone('  ', '+91')).toBe('');
    expect(assemblePhone('abc', '+91')).toBe('');
  });
  it('uses the local digits when there is no country code', () => {
    expect(assemblePhone('9876543210', null)).toBe('9876543210');
  });
  it('builds a sender number the same way', () => {
    expect(senderDigits('+91', '98765 43210')).toBe('919876543210');
  });
});
