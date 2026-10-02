import { describe, expect, it } from 'vitest';
import { DEFAULT_MIN_LENGTH, longEnough, policyHintParts } from './policy-hint';

const policy = (over: Partial<Parameters<typeof policyHintParts>[0] & object> = {}) => ({
  minLength: 8,
  requireMixedCase: false,
  requireNumber: false,
  requireSymbol: false,
  ...over,
});

describe('policyHintParts', () => {
  it('shows the live minimum, not a number baked into the page', () => {
    expect(policyHintParts(policy({ minLength: 6 })).min).toBe(6);
    expect(policyHintParts(policy({ minLength: 14 })).min).toBe(14);
  });

  it('lists the extra rules in a fixed order', () => {
    expect(policyHintParts(policy({ requireSymbol: true, requireMixedCase: true })).extras).toEqual(
      ['mixedCase', 'symbol'],
    );
    expect(policyHintParts(policy({ requireNumber: true })).extras).toEqual(['number']);
    expect(policyHintParts(policy()).extras).toEqual([]);
  });

  it('falls back to the default minimum when the policy could not be read', () => {
    expect(policyHintParts(null)).toEqual({ min: DEFAULT_MIN_LENGTH, extras: [] });
    expect(policyHintParts(undefined).min).toBe(8);
  });
});

describe('longEnough', () => {
  it('compares with the live minimum', () => {
    expect(longEnough('abcdef', { min: 6 })).toBe(true);
    expect(longEnough('abcde', { min: 6 })).toBe(false);
    expect(longEnough('abcdefg', { min: 8 })).toBe(false);
  });
});
