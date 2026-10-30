import { describe, expect, it } from 'vitest';
import { maskedFields } from '../../../src/modules/crm/contacts/contacts.mapper';
import { maskValue } from '../../../src/modules/crm/contacts/phone-mask';

/**
 * Legacy #15489: a contact property flagged "masked" came back raw; only the phone number was masked. A caller without
 * `contacts.phone.reveal` now gets the flagged properties masked in every contact response. No database.
 */
describe('maskValue', () => {
  it('keeps the last four letters and digits and the separators', () => {
    expect(maskValue('1234 5678 9012')).toBe('xxxx xxxx 9012');
    expect(maskValue('ABCDE1234F')).toBe('xxxxxx234F');
  });

  it('masks non-English letters too', () => {
    expect(maskValue('أحمد علي 1234')).toBe('xxxx xxx 1234');
    expect(maskValue('José 5678')).toBe('xxxx 5678');
  });

  it('masks a short value whole', () => {
    expect(maskValue('abc')).toBe('xxx');
    expect(maskValue('1234')).toBe('xxxx');
  });

  it('masks a number as text and a list item by item', () => {
    expect(maskValue(123456789)).toBe('xxxxx6789');
    expect(maskValue(['ABCDE12345', 'xy'])).toEqual(['xxxxxx2345', 'xx']);
  });

  it('leaves nothing-to-hide values alone', () => {
    expect(maskValue(null)).toBeNull();
    expect(maskValue('  ')).toBe('  ');
    expect(maskValue(true)).toBe(true);
  });
});

describe('maskedFields', () => {
  const data = { pan: 'ABCDE1234F', city: 'Pune' };

  it('masks only the flagged keys', () => {
    expect(maskedFields(data, new Set(['pan']))).toEqual({ pan: 'xxxxxx234F', city: 'Pune' });
  });

  it('does not invent a key the contact does not hold', () => {
    expect(maskedFields(data, new Set(['aadhaar']))).toEqual(data);
  });

  it('returns the data untouched when nothing is flagged or the caller may reveal', () => {
    expect(maskedFields(data, undefined)).toBe(data);
    expect(maskedFields(data, new Set())).toBe(data);
  });
});
