import { describe, expect, it } from 'vitest';
import { defaultFooter } from './footer-line';

describe('defaultFooter', () => {
  it('reads "year product / country" when the platform has a default country', () => {
    expect(defaultFooter('Acme', 'IN', 'en', 2026)).toBe('2026 Acme / India');
    expect(defaultFooter('Acme', 'ae', 'en', 2026)).toBe('2026 Acme / United Arab Emirates');
  });

  it('names the country in the visitor language', () => {
    expect(defaultFooter('Acme', 'IN', 'ar', 2026)).toContain('الهند');
  });

  it('drops the country when there is none or it is not a country code', () => {
    expect(defaultFooter('Acme', null, 'en', 2026)).toBe('2026 Acme');
    expect(defaultFooter('Acme', undefined, 'en', 2026)).toBe('2026 Acme');
    expect(defaultFooter('Acme', 'India', 'en', 2026)).toBe('2026 Acme');
    expect(defaultFooter('Acme', '12', 'en', 2026)).toBe('2026 Acme');
  });
});
