import { describe, expect, it } from 'vitest';
import { DEFAULT_ACCENT, accentOnDark, luminance, normalizeAccent, readableOn } from './accent';

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

  it('defaults to the bright brand green', () => {
    expect(DEFAULT_ACCENT).toBe('#25d366');
  });
  it('keeps a bright accent as is on the dark panels', () => {
    expect(accentOnDark('#25d366')).toBe('#25d366');
    expect(accentOnDark('#facc15')).toBe('#facc15');
  });
  it('lightens a dark accent until it can be read on the dark panels', () => {
    for (const dark of ['#0f766e', '#1e3a8a', '#7f1d1d', '#000000']) {
      const lifted = accentOnDark(dark);
      expect(lifted).not.toBe(dark);
      // WCAG AA for normal text against the panel colour (#0b1f1c).
      const l = luminance(lifted);
      const bg = luminance('#0b1f1c');
      expect((l + 0.05) / (bg + 0.05)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('falls back to the default for an invalid colour', () => {
    expect(accentOnDark('red')).toBe('#25d366');
  });
});
