import { DEFAULT_MIN_LENGTH, checkPassword, policyParts } from './password-rules';

describe('policyParts', () => {
  it('reads the platform policy', () => {
    expect(
      policyParts({
        minLength: 12,
        requireMixedCase: true,
        requireNumber: true,
        requireSymbol: false,
      }),
    ).toEqual({ min: 12, mixedCase: true, number: true, symbol: false });
  });

  it('falls back to the platform floor when the policy could not be read', () => {
    expect(policyParts(null)).toEqual({
      min: DEFAULT_MIN_LENGTH,
      mixedCase: false,
      number: false,
      symbol: false,
    });
    expect(policyParts(undefined).min).toBe(8);
  });
});

describe('checkPassword', () => {
  const strict = { min: 10, mixedCase: true, number: true, symbol: true };

  it('lists only the rules in force, in a fixed order', () => {
    expect(checkPassword('', { min: 8, mixedCase: false, number: false, symbol: false })).toEqual([
      { id: 'minLength', met: false },
    ]);
    expect(checkPassword('', strict).map((r) => r.id)).toEqual([
      'minLength',
      'mixedCase',
      'number',
      'symbol',
    ]);
  });

  it('marks each rule as met or not, as the server will judge it', () => {
    expect(checkPassword('Abcdefgh1!', strict).every((r) => r.met)).toBe(true);
    const states = Object.fromEntries(checkPassword('abcdefghi', strict).map((r) => [r.id, r.met]));
    expect(states).toEqual({ minLength: false, mixedCase: false, number: false, symbol: false });
  });

  it('counts letters of any alphabet and any kind of number or symbol', () => {
    const rules = checkPassword('Ünï٣ cödé', {
      min: 4,
      mixedCase: true,
      number: true,
      symbol: true,
    });
    expect(rules.map((r) => r.met)).toEqual([true, true, true, true]);
  });

  it('needs both cases for mixed case', () => {
    const mixed = { min: 1, mixedCase: true, number: false, symbol: false };
    expect(checkPassword('ABC', mixed)[1]?.met).toBe(false);
    expect(checkPassword('abc', mixed)[1]?.met).toBe(false);
    expect(checkPassword('aBc', mixed)[1]?.met).toBe(true);
  });
});
