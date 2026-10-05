import { describe, expect, it } from 'vitest';
import { normaliseLeadPhone } from '../../../src/modules/leads/lead-phone';

describe('normaliseLeadPhone (spec open question 12)', () => {
  it('takes a + or 00 number as written', () => {
    expect(normaliseLeadPhone('+91 98765 43210', '44')?.e164).toBe('+919876543210');
    expect(normaliseLeadPhone('0044 7700 900123', '91')?.e164).toBe('+447700900123');
  });

  it('adds the default country code to a local number and drops the trunk zero', () => {
    expect(normaliseLeadPhone('98765 43210', '91')?.e164).toBe('+919876543210');
    expect(normaliseLeadPhone('07700 900123', '+44')?.e164).toBe('+447700900123');
    expect(normaliseLeadPhone('09876543210', '91')?.e164).toBe('+919876543210');
  });

  it('a local number that itself starts with the code digits still gets the code', () => {
    // 10 digits, begins "91": a bare "starts with the code" test would take it as already international.
    expect(normaliseLeadPhone('9198765432', '91')?.e164).toBe('+919198765432');
  });

  it('leaves a number that carries its country code but no plus alone', () => {
    expect(normaliseLeadPhone('919876543210', '91')?.e164).toBe('+919876543210');
    expect(normaliseLeadPhone('447700900123', '91')?.e164).toBe('+447700900123');
    expect(normaliseLeadPhone('919876543210', null)?.e164).toBe('+919876543210');
  });

  it('never guesses a country: a bare short number with no default code is not a number', () => {
    expect(normaliseLeadPhone('9876543210', null)).toBeNull();
    expect(normaliseLeadPhone('5551234', undefined)).toBeNull();
  });

  it('rejects what cannot be a phone number', () => {
    expect(normaliseLeadPhone('', '91')).toBeNull();
    expect(normaliseLeadPhone('   ', '91')).toBeNull();
    expect(normaliseLeadPhone('call me', '91')).toBeNull();
    expect(normaliseLeadPhone('+1', '91')).toBeNull();
    expect(normaliseLeadPhone('+1234567890123456789', '91')).toBeNull();
    expect(normaliseLeadPhone(null, '91')).toBeNull();
  });

  it('returns the digits key the contact matcher uses', () => {
    expect(normaliseLeadPhone('98765 43210', '91')).toEqual({
      e164: '+919876543210',
      digits: '919876543210',
    });
  });
});
