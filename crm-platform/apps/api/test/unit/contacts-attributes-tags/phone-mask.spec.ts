import { describe, expect, it } from 'vitest';
import { maskPhone } from '../../../src/modules/crm/contacts/phone-mask';

/**
 * TW-AUTH-042 — Reference's `mask_phone()` (app/Support/security_helpers.php) was disabled
 * product-wide: it early-returns the input unchanged, and the clamp + separator-preserving loop
 * after that return were never reachable. These cases match the examples and rules documented
 * in docs/threadwise-port/inventory/auth-registration-security.md for that dead algorithm, now
 * revived behind the `contacts.phone.reveal` RBAC gate instead of the old global toggle.
 */
describe('maskPhone', () => {
  it('masks all but the last 4 digits by default', () => {
    expect(maskPhone('919145808988')).toBe('xxxxxxxx8988');
  });

  it('preserves separators (+, space) while masking only the digits', () => {
    expect(maskPhone('+91 91458 08988')).toBe('+xx xxxxx x8988');
  });

  it('honours a smaller visible count', () => {
    expect(maskPhone('919145808988', 2)).toBe('xxxxxxxxxx88');
  });

  it('clamps visible below 2 up to 2', () => {
    expect(maskPhone('919145808988', 0)).toBe('xxxxxxxxxx88');
    expect(maskPhone('919145808988', 1)).toBe('xxxxxxxxxx88');
  });

  it('clamps visible above 4 down to 4', () => {
    expect(maskPhone('919145808988', 10)).toBe('xxxxxxxx8988');
  });

  it('returns a number with fewer digits than the visible window unchanged', () => {
    expect(maskPhone('123', 4)).toBe('123');
    expect(maskPhone('1234', 4)).toBe('1234');
  });

  it('returns a number with exactly the clamped visible digit count unchanged', () => {
    expect(maskPhone('12', 2)).toBe('12');
  });

  it('masks everything but the last visible digits once there are more digits than the window', () => {
    expect(maskPhone('12345', 4)).toBe('x2345');
  });

  it('empty or whitespace-only input returns empty', () => {
    expect(maskPhone('')).toBe('');
    expect(maskPhone('   ')).toBe('');
  });

  it('leaves non-digit characters (letters, punctuation) untouched', () => {
    // 11 digits, visible 4: the first 7 (1 415 555) are masked, "2671" stays.
    expect(maskPhone('+1 (415) 555-2671')).toBe('+x (xxx) xxx-2671');
  });
});
