import { describe, expect, it } from 'vitest';
import { callingCodeOf, maskPhone } from '../../../src/modules/auth/flows/phone-mask';

describe('masked phone on the sign-up code page (WD-AUTH-006)', () => {
  it('shows the real calling code, whatever its length, and only the last two digits', () => {
    expect(maskPhone('+919876543221')).toBe('+91 •••• ••21');
    expect(maskPhone('+14155238886')).toBe('+1 •••• ••86');
    expect(maskPhone('+971501234567')).toBe('+971 •••• ••67');
    expect(maskPhone('+447911123456')).toBe('+44 •••• ••56');
    expect(maskPhone('+353851234567')).toBe('+353 •••• ••67');
    expect(maskPhone('+79161234567')).toBe('+7 •••• ••67');
    expect(maskPhone('+8613812345678')).toBe('+86 •••• ••78');
  });

  it('never leaks a national digit next to the code (the old two-digit guess did for +1 and +971)', () => {
    expect(maskPhone('+14155238886')).not.toContain('+14');
    expect(maskPhone('+971501234567')).not.toContain('+97 ');
  });

  it('reads separators in the stored number', () => {
    expect(maskPhone('+91 98765-43221')).toBe('+91 •••• ••21');
  });

  it('falls back to the first digit when no calling code matches', () => {
    expect(maskPhone('+99912345678')).toBe('+9 •••• ••78');
    expect(callingCodeOf('+99912345678')).toBeNull();
  });

  it('finds the code by prefix: the plan is prefix-free', () => {
    expect(callingCodeOf('+12025550100')).toBe('1');
    expect(callingCodeOf('+97150123')).toBe('971');
    expect(callingCodeOf('+9715')).toBe('971');
    expect(callingCodeOf('+3935551234')).toBe('39');
    expect(callingCodeOf('+3585551234')).toBe('358');
  });
});
