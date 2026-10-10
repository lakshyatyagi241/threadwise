import { describe, expect, it } from 'vitest';
import {
  evaluatePassword,
  isPasswordStale,
} from '../../../src/modules/auth/support/password-policy';

const policy = {
  passwordMinLength: 8,
  passwordRequireUpper: true,
  passwordRequireNumber: true,
  passwordRequireSymbol: false,
};

const rules = (pw: string, p = policy, ctx = {}) => evaluatePassword(pw, p, ctx).map((v) => v.rule);

describe('password policy', () => {
  it('accepts a compliant password', () => {
    expect(rules('Str0ngPassw0rd')).toEqual([]);
  });

  it('reports every broken rule, not just the first', () => {
    expect(rules('xq')).toEqual(['min_length', 'upper_lower', 'number']);
  });

  it('enforces the symbol rule only when the policy asks for it', () => {
    expect(rules('Str0ngPassw0rd')).not.toContain('symbol');
    expect(rules('Str0ngPassw0rd', { ...policy, passwordRequireSymbol: true })).toContain('symbol');
    expect(rules('Str0ngPassw0rd!', { ...policy, passwordRequireSymbol: true })).toEqual([]);
  });

  it('never accepts a minimum length below 8 even if configured lower', () => {
    expect(rules('Ab1defg', { ...policy, passwordMinLength: 1 })).toContain('min_length');
    expect(rules('Ab1defgh', { ...policy, passwordMinLength: 1 })).not.toContain('min_length');
  });

  it('rejects well-known passwords and passwords containing the email name', () => {
    expect(rules('Password1')).toContain('common');
    expect(rules('Passw0rd!')).toContain('common');
    expect(rules('Priyasharma2026', policy, { email: 'priyasharma@acme.test' })).toContain(
      'common',
    );
    expect(rules('Zx9Qm4Wr7Lp2')).toEqual([]);
  });

  it('treats a password as stale only when a max age exists', () => {
    const now = new Date('2026-10-01T00:00:00Z');
    expect(isPasswordStale(new Date('2025-01-01'), 0, now)).toBe(false);
    expect(isPasswordStale(new Date('2026-09-20'), 90, now)).toBe(false);
    expect(isPasswordStale(new Date('2026-05-01'), 90, now)).toBe(true);
    expect(isPasswordStale(null, 90, now)).toBe(true);
  });
});
