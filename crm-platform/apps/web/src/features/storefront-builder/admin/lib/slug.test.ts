import { describe, expect, it } from 'vitest';
import { pathModeUrl, previewPublicUrl, previewSlug, slugify } from './slug';

describe('slugify', () => {
  it('lower-cases, strips accents and joins words with single dashes', () => {
    expect(slugify('Media City Threads')).toBe('media-city-threads');
    expect(slugify('  Café  Crème -- Bar ')).toBe('cafe-creme-bar');
    expect(slugify('Shop #1 & Co.')).toBe('shop-1-co');
  });

  it('turns Arabic letters into Latin ones and zero-width characters into a break, like the server', () => {
    expect(slugify('مرحبا بالعالم שלום')).toBe('mrhba-balaaalm');
    expect(slugify('ab\u200bcd\u200d')).toBe('ab-cd');
  });

  it('cuts at 64 characters', () => {
    expect(slugify('a'.repeat(100))).toHaveLength(64);
  });

  it('falls back when nothing is left', () => {
    expect(previewSlug('')).toBe('your-shop');
    expect(previewSlug('日本語')).toBe('your-shop');
    expect(previewSlug('Acme')).toBe('acme');
  });
});

describe('previewPublicUrl', () => {
  it('swaps the slug in the path form', () => {
    expect(previewPublicUrl('https://app.test/s/old', 'old', 'new')).toBe('https://app.test/s/new');
  });
  it('swaps the slug in the subdomain form', () => {
    expect(previewPublicUrl('https://old.shops.test', 'old', 'new')).toBe('https://new.shops.test');
  });
  it('leaves a custom domain alone', () => {
    expect(previewPublicUrl('https://shop.acme.com', 'old', 'new')).toBe('https://shop.acme.com');
  });
  it('keeps the address while the slug is empty or unchanged', () => {
    expect(previewPublicUrl('https://app.test/s/old', 'old', '')).toBe('https://app.test/s/old');
    expect(previewPublicUrl('https://app.test/s/old', 'old', 'old')).toBe('https://app.test/s/old');
  });
});

describe('pathModeUrl', () => {
  it('joins origin and slug without a double slash', () => {
    expect(pathModeUrl('https://app.test/', 'x')).toBe('https://app.test/s/x');
  });
});
