import { describe, expect, it } from 'vitest';
import { sendProductSchema } from '@crm/contracts';
import { digitsOf, isValidPhone } from './share';

describe('isValidPhone', () => {
  it('needs 7 or more digits whatever the punctuation', () => {
    expect(isValidPhone('+1 555 0100')).toBe(true);
    expect(isValidPhone('555-010')).toBe(false);
    expect(isValidPhone('1234567')).toBe(true);
    expect(isValidPhone('123456')).toBe(false);
    expect(isValidPhone('')).toBe(false);
    expect(isValidPhone('call me')).toBe(false);
  });
  it('strips everything but digits', () => {
    expect(digitsOf('+91 (98765) 43210')).toBe('919876543210');
  });
  it('a valid number satisfies the contract', () => {
    expect(sendProductSchema.safeParse({ phone: '+1 555 0100123' }).success).toBe(true);
  });
});
