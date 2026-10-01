import { describe, expect, it } from 'vitest';
import { canonicalizePhone, composeDisplayName, phoneKey } from '@crm/contracts';

/**
 * TW-CON-012 (display name) and TW-CON-013 (one phone canonicaliser). The same function is what
 * create, import and dedupe call, so these cases are the contract between all three.
 */
describe('canonicalizePhone (TW-CON-013)', () => {
  it('TW-CON-013 #1: "+91" and "9812345678" canonicalise to 919812345678', () => {
    expect(canonicalizePhone({ number: '9812345678', countryCode: '+91' })).toEqual({
      e164: '+919812345678',
      digits: '919812345678',
    });
  });

  it('TW-CON-013 #2: a leading 00 is dropped, with no country code given', () => {
    expect(canonicalizePhone({ number: '00971501234567' })?.digits).toBe('971501234567');
  });

  it('TW-CON-025 #2: "+91 98123 45678", "919812345678" and "0091 9812345678" are ONE number', () => {
    // Reference's dedupe/import canonicaliser did not strip "00", so the third was a stranger.
    const a = canonicalizePhone({ number: '+91 98123 45678' });
    const b = canonicalizePhone({ number: '919812345678' });
    const c = canonicalizePhone({ number: '0091 9812345678' });
    expect(a?.e164).toBe('+919812345678');
    expect(b?.e164).toBe(a?.e164);
    expect(c?.e164).toBe(a?.e164);
  });

  it('does not double the country code when the number already starts with it', () => {
    expect(canonicalizePhone({ number: '919812345678', countryCode: '91' })?.digits).toBe(
      '919812345678',
    );
    expect(canonicalizePhone({ number: '+919812345678', countryCode: '+91' })?.digits).toBe(
      '919812345678',
    );
  });

  it('accepts the country code as "+91", "91" or "0091"', () => {
    for (const cc of ['+91', '91', '0091']) {
      expect(canonicalizePhone({ number: '9812345678', countryCode: cc })?.digits).toBe(
        '919812345678',
      );
    }
  });

  it('uses the default country code only when the row has none of its own', () => {
    expect(canonicalizePhone({ number: '9812345678', defaultCountryCode: '+91' })?.e164).toBe(
      '+919812345678',
    );
    expect(
      canonicalizePhone({ number: '501234567', countryCode: '+971', defaultCountryCode: '+91' })
        ?.e164,
    ).toBe('+971501234567');
  });

  it('rejects what cannot be a phone: no digits, too short, too long, a leading zero', () => {
    expect(canonicalizePhone({ number: '' })).toBeNull();
    expect(canonicalizePhone({ number: null })).toBeNull();
    expect(canonicalizePhone({ number: 'call me' })).toBeNull();
    expect(canonicalizePhone({ number: '12345' })).toBeNull();
    expect(canonicalizePhone({ number: '1234567890123456' })).toBeNull();
    expect(canonicalizePhone({ number: '0123456789' })).toBeNull();
  });

  it('phoneKey is the e164 of the stored pieces, or null', () => {
    expect(phoneKey('98123 45678', '+91')).toBe('+919812345678');
    expect(phoneKey(null)).toBeNull();
  });
});

describe('composeDisplayName (TW-CON-012)', () => {
  it('TW-CON-012 #1: first and last name give "Aarav Sharma"; the title never joins in', () => {
    expect(composeDisplayName({ firstName: 'Aarav', lastName: 'Sharma' })).toBe('Aarav Sharma');
  });

  it('TW-CON-012 #2: a typed name wins and first name stays separate', () => {
    expect(composeDisplayName({ name: 'ACME Support' })).toBe('ACME Support');
  });

  it('TW-CON-012 #3: a UI add with first name "Priya" is "Priya", not "Mr Priya"', () => {
    expect(composeDisplayName({ firstName: 'Priya' })).toBe('Priya');
  });

  it('is null when there is nothing to build a name from', () => {
    expect(composeDisplayName({ name: '  ', firstName: ' ', lastName: null })).toBeNull();
  });

  it('keeps the middle name between first and last', () => {
    expect(composeDisplayName({ firstName: 'A', middleName: 'B', lastName: 'C' })).toBe('A B C');
  });
});
