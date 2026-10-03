import { describe, expect, it } from 'vitest';
import { baseSlug, slugify } from '../../../src/modules/storefront-builder/rules/slug';

describe('slug folding beyond Latin accents (found by the admin twin run)', () => {
  it('turns Arabic letters into Latin ones, as Reference did', () => {
    expect(slugify('مرحبا بالعالم')).toBe('mrhba-balaaalm');
    expect(slugify('متجر ٢٠٢٤')).toBe('mtgr-2024');
  });
  it('treats zero-width characters as a word break and trims them', () => {
    expect(slugify('ab​cd‍')).toBe('ab-cd');
  });
  it('still falls back for scripts with no Latin form', () => {
    expect(baseSlug('李雷')).toBe('shop');
  });
});
