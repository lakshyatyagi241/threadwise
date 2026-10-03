import { describe, expect, it } from 'vitest';
import { passwordSchema, PASSWORD_CONTRACT_MIN } from '@crm/contracts';
import { evaluatePassword } from '../../../src/modules/auth/support/password-policy';

const strict = {
  passwordMinLength: 8,
  passwordRequireUpper: true,
  passwordRequireNumber: true,
  passwordRequireSymbol: true,
};
const rules = (pw: string, p = strict) => evaluatePassword(pw, p).map((v) => v.rule);

/**
 * WD-AUTH-035: the rules read like Laravel's `Password` rule, which is Unicode
 * aware. ASCII classes called "é" a symbol and refused any non-Latin password.
 */
describe('password policy is Unicode aware', () => {
  it('counts characters, not UTF-16 units', () => {
    // Four emoji are eight UTF-16 units but four characters.
    expect(rules('😀😀😀😀', { ...strict, passwordMinLength: 8 })).toContain('min_length');
    expect(rules('Ab1!Ab1!', strict)).not.toContain('min_length');
  });

  it('accepts mixed case in any script', () => {
    // Cyrillic upper + lower, a digit and a symbol.
    expect(rules('Пароль-Ключ1!')).toEqual([]);
    // Greek with only lower case is still unmixed.
    expect(rules('σσσσσσσσ1!')).toContain('upper_lower');
  });

  it('does not take an accented letter for a symbol', () => {
    expect(rules('Café1234')).toContain('symbol');
    expect(rules('Café1234!')).not.toContain('symbol');
    // A space is a symbol (Laravel counts separators).
    expect(rules('Cafe 1234')).not.toContain('symbol');
  });

  it('accepts any Unicode digit as a number', () => {
    expect(rules('Passwort٣٤٥٦!', { ...strict, passwordRequireSymbol: false })).not.toContain(
      'number',
    );
  });
});

describe('the contract never asks for more than the policy can', () => {
  it('has a floor of 6, the lowest minimum an administrator can set', () => {
    expect(PASSWORD_CONTRACT_MIN).toBe(6);
    expect(passwordSchema.safeParse('abcde').success).toBe(false);
    expect(passwordSchema.safeParse('abcdef').success).toBe(true);
  });

  it('leaves the real minimum to the stored policy', () => {
    // A 6-character password passes the contract; the policy (default 8) still refuses it.
    expect(rules('Ab1!xy', { ...strict, passwordMinLength: 8 })).toContain('min_length');
    expect(rules('Ab1!xy', { ...strict, passwordMinLength: 6 })).toEqual([]);
  });
});
