import { currencyExponent as contractsExponent } from '@crm/contracts';
import { currencyExponent as taxExponent, KNOWN_CURRENCIES } from '@crm/tax';
import { describe, expect, it } from 'vitest';

describe('currency decimals used for billing amounts', () => {
  it('gives the 4-digit currencies four decimals', () => {
    expect(taxExponent('CLF')).toBe(4);
    expect(taxExponent('uyw')).toBe(4);
    expect(Number('12.3456').toFixed(taxExponent('CLF'))).toBe('12.3456');
  });

  it('agrees with the contracts table for every code that is not 4-digit', () => {
    // The contracts table still has no 4-digit entries (its invoice and deal money math is unchanged); this guards the rest.
    const drift = KNOWN_CURRENCIES.filter((c) => taxExponent(c) !== 4).filter(
      (c) => contractsExponent(c) !== taxExponent(c),
    );
    expect(drift).toEqual([]);
  });
});
