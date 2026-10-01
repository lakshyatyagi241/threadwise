import { describe, expect, it } from 'vitest';
import { DEFAULT_ACCENT, luminance, normalizeAccent, readableOn } from './accent';

describe('accent colour', () => {
  it('keeps a valid #rrggbb and lower-cases it', () => {
    expect(normalizeAccent('#25D366')).toBe('#25d366');
  });
  it('falls back to the default for anything else', () => {
    for (const bad of [undefined, null, '', 'red', '#fff', '#12345', 'url(x)']) {
      expect(normalizeAccent(bad as string | undefined)).toBe(DEFAULT_ACCENT);
    }
  });
  it('picks readable text on dark and light accents', () => {
    expect(readableOn('#0f766e')).toBe('#ffffff');
    expect(readableOn('#facc15')).toBe('#0b1220');
    expect(luminance('#000000')).toBe(0);
    expect(luminance('#ffffff')).toBeCloseTo(1, 5);
  });
});
