import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { minLengthFrom, policyViolations, requirementsOf } from './policy-rules';

const policyError = (fieldErrors: Array<{ path: string; message: string }>) =>
  new ApiError(422, 'AUTH_PASSWORD_POLICY', 'x', 'req', fieldErrors);

describe('minLengthFrom', () => {
  it('reads N from the server wording', () => {
    expect(minLengthFrom('Use at least 8 characters.')).toBe(8);
    expect(minLengthFrom('Use at least 12 characters.')).toBe(12);
  });
  it('is null when there is no number', () => {
    expect(minLengthFrom('Too short.')).toBeNull();
    expect(minLengthFrom('')).toBeNull();
  });
});

describe('policyViolations', () => {
  it('maps `<field>.<rule>` paths to rules, one per rule', () => {
    const e = policyError([
      { path: 'newPassword.min_length', message: 'Use at least 10 characters.' },
      { path: 'newPassword.upper_lower', message: 'Mix upper and lower case letters.' },
      { path: 'newPassword.number', message: 'Include at least one number.' },
      { path: 'newPassword.symbol', message: 'Include at least one symbol.' },
      { path: 'newPassword.common', message: 'That password is too easy to guess.' },
      { path: 'newPassword.number', message: 'Include at least one number.' },
    ]);
    expect(policyViolations(e).map((v) => v.rule)).toEqual([
      'min_length',
      'upper_lower',
      'number',
      'symbol',
      'common',
    ]);
    expect(policyViolations(e)[0]).toMatchObject({ rule: 'min_length', count: 10 });
    expect(policyViolations(e)[1]!.count).toBeNull();
  });

  it('ignores entries for other fields', () => {
    const e = policyError([
      { path: 'currentPassword', message: 'Incorrect.' },
      { path: 'newPassword.number', message: 'Include at least one number.' },
      { path: 'password.symbol', message: 'Include at least one symbol.' },
    ]);
    expect(policyViolations(e).map((v) => v.rule)).toEqual(['number']);
  });

  it('falls back to the server text for an unknown rule', () => {
    const e = policyError([{ path: 'newPassword.reused', message: 'You used that before.' }]);
    expect(policyViolations(e)).toEqual([
      { rule: null, message: 'You used that before.', count: null },
    ]);
  });

  it('still understands the old bare paths', () => {
    const e = policyError([
      { path: 'password', message: 'Include at least one number.' },
      { path: 'newPassword', message: 'Mix upper and lower case letters.' },
    ]);
    expect(policyViolations(e).map((v) => [v.rule, v.message])).toEqual([
      [null, 'Include at least one number.'],
      [null, 'Mix upper and lower case letters.'],
    ]);
  });

  it('does not match a field that merely starts with the same letters', () => {
    const e = policyError([{ path: 'newPasswordHint.number', message: 'x' }]);
    expect(policyViolations(e)).toEqual([]);
  });

  it('is empty for non-API errors', () => {
    expect(policyViolations(new Error('boom'))).toEqual([]);
  });

  it('can read another field name', () => {
    const e = policyError([{ path: 'password.symbol', message: 'Include at least one symbol.' }]);
    expect(policyViolations(e, 'password').map((v) => v.rule)).toEqual(['symbol']);
  });
});

describe('requirementsOf', () => {
  it('lists only what the live policy asks for, in a fixed order', () => {
    expect(
      requirementsOf({ requireMixedCase: true, requireNumber: true, requireSymbol: false }),
    ).toEqual(['mixedCase', 'number']);
    expect(
      requirementsOf({ requireMixedCase: false, requireNumber: false, requireSymbol: true }),
    ).toEqual(['symbol']);
    expect(
      requirementsOf({ requireMixedCase: true, requireNumber: true, requireSymbol: true }),
    ).toEqual(['mixedCase', 'number', 'symbol']);
  });
  it('is empty for a length-only policy', () => {
    expect(
      requirementsOf({ requireMixedCase: false, requireNumber: false, requireSymbol: false }),
    ).toEqual([]);
  });
});
