import { describe, expect, it } from 'vitest';
import { currencyOptions } from './currencies';

describe('currencyOptions', () => {
  it('lists codes with their names in the UI language', () => {
    const en = currencyOptions('en');
    expect(en.find((o) => o.value === 'USD')?.label).toBe('USD - US Dollar');
    expect(en.find((o) => o.value === 'INR')?.search).toContain('rupee');
    expect(en.length).toBeGreaterThan(100);
  });
  it('localizes the names', () => {
    expect(currencyOptions('fr').find((o) => o.value === 'USD')?.label).toMatch(/dollar/i);
    expect(currencyOptions('fr').find((o) => o.value === 'USD')?.label).not.toBe('USD - US Dollar');
  });
});
