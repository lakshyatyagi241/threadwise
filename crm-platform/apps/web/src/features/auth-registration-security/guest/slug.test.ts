import { describe, expect, it } from 'vitest';
import { suggestSlug } from './slug';

describe('suggestSlug', () => {
  it('lower-cases, strips accents and joins words with dashes', () => {
    expect(suggestSlug('Acme Café & Co.')).toBe('acme-cafe-co');
    expect(suggestSlug('  Study From UAE ')).toBe('study-from-uae');
  });
  it('caps at 32 characters without a trailing dash', () => {
    const s = suggestSlug('a'.repeat(31) + ' bbbbbb');
    expect(s.length).toBeLessThanOrEqual(32);
    expect(s.endsWith('-')).toBe(false);
  });
  it('returns an empty suggestion when nothing usable is left', () => {
    expect(suggestSlug('!')).toBe('');
    expect(suggestSlug('名')).toBe('');
  });
});
