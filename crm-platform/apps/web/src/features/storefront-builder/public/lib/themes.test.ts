import { STORE_THEME_KEYS } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BRAND,
  THEMES,
  THEME_KEYS,
  contrast,
  isCustomBrand,
  readableOn,
  resolveTheme,
  themeKeyOf,
} from './themes';

describe('theme tokens (TW-STORE-011)', () => {
  it('knows exactly the themes the settings page offers', () => {
    expect([...THEME_KEYS].sort()).toEqual([...STORE_THEME_KEYS].sort());
  });

  it.each([
    ['aurora', '#FBFAF6', '#FFFFFF', '#0B1F1C', '#6B807C', '#E5DFD0', '14px', '46px'],
    ['meridian', '#F5F2EA', '#FFFFFF', '#0B1F1C', '#6B807C', '#D9D2BD', '2px', '58px'],
    ['verdure', '#F4F1E8', '#FAF8F0', '#2D3A22', '#7B8A6A', '#D5DCC4', '20px', '44px'],
    ['bazaar', '#FFF6EC', '#FFFFFF', '#2A1810', '#7A5C40', '#F4D7B8', '10px', '42px'],
    ['noir', '#0A0A0A', '#141414', '#F0F0F0', '#A0A0A0', '#2A2A2A', '4px', '52px'],
    ['kraft', '#EDE4D3', '#F5EFE0', '#3B2C1A', '#8B7556', '#C9B894', '8px', '42px'],
    ['mercato', '#FFF8E7', '#FFFEF8', '#1F1408', '#7C5B3A', '#F4D35E', '12px', '46px'],
    ['studio', '#F4F1ED', '#FFFFFF', '#264653', '#7B8E94', '#D8DCDD', '24px', '56px'],
  ] as const)(
    '%s matches the inventory table',
    (key, bg, surface, text, muted, border, radius, hero) => {
      expect(THEMES[key]).toMatchObject({
        bg,
        surface,
        text,
        muted,
        border,
        radius,
        heroSize: hero,
      });
    },
  );

  it('keeps each theme its own brand and accent', () => {
    const brands = Object.fromEntries(THEME_KEYS.map((k) => [k, THEMES[k].brand]));
    expect(brands).toMatchObject({
      aurora: '#075E54',
      meridian: '#0B1F1C',
      verdure: '#5C7C4D',
      bazaar: '#E76F51',
      noir: '#D4AF37',
      kraft: '#A6845A',
      mercato: '#C8553D',
      studio: '#2A9D8F',
    });
    expect(THEMES.aurora.accent).toBeNull();
    for (const k of THEME_KEYS.filter((x) => x !== 'aurora'))
      expect(THEMES[k].accent).toBe(THEMES[k].brand);
  });

  it('falls back to Aurora for an unknown or missing key', () => {
    expect(themeKeyOf('nope')).toBe('aurora');
    expect(themeKeyOf(undefined)).toBe('aurora');
    expect(themeKeyOf('noir')).toBe('noir');
    expect(resolveTheme('', null).key).toBe('aurora');
  });
});

describe('brand colour', () => {
  it('replaces the theme brand in every theme; only Aurora’s accent follows it', () => {
    for (const key of THEME_KEYS) {
      const r = resolveTheme(key, '#112233');
      expect(r.brand).toBe('#112233');
      expect(r.vars['--sf-brand']).toBe('#112233');
      expect(r.accent).toBe(key === 'aurora' ? '#112233' : THEMES[key].accent);
    }
  });

  it('treats the platform default and anything malformed as "not set"', () => {
    expect(isCustomBrand('#075E54')).toBe(false);
    expect(isCustomBrand('#075e54')).toBe(false);
    expect(isCustomBrand('red')).toBe(false);
    expect(isCustomBrand('#12ab9')).toBe(false);
    expect(isCustomBrand('#12ab9F')).toBe(true);
    expect(resolveTheme('studio', DEFAULT_BRAND).brand).toBe('#2A9D8F');
    expect(resolveTheme('studio', 'red').brand).toBe('#2A9D8F');
  });

  it('exports every token as a --sf variable and system font stacks only', () => {
    const { vars } = resolveTheme('kraft', null);
    for (const k of [
      'bg',
      'surface',
      'text',
      'muted',
      'border',
      'brand',
      'accent',
      'radius',
      'hero-size',
    ]) {
      expect(vars[`--sf-${k}`], k).toBeTruthy();
    }
    for (const stack of [vars['--sf-serif'], vars['--sf-sans'], vars['--sf-mono']]) {
      expect(stack).not.toMatch(/fraunces|jakarta|jetbrains|googleapis/i);
    }
  });
});

describe('contrast', () => {
  it('computes the WCAG ratio', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 0);
    expect(contrast('#777777', '#777777')).toBe(1);
  });

  it('picks readable text for a brand button', () => {
    expect(readableOn('#075E54')).toBe('#FFFFFF');
    expect(readableOn('#E76F51')).toBe('#FFFFFF');
    expect(readableOn('#D4AF37')).toBe('#000000');
    expect(readableOn('#F4D35E')).toBe('#000000');
  });

  it('keeps Noir readable (dark theme)', () => {
    const n = THEMES.noir;
    expect(contrast(n.text, n.bg)).toBeGreaterThanOrEqual(7);
    expect(contrast(n.text, n.surface)).toBeGreaterThanOrEqual(7);
    expect(contrast(n.muted, n.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(n.muted, n.surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(n.brand, n.bg)).toBeGreaterThanOrEqual(7);
    expect(contrast(n.brand, n.surface)).toBeGreaterThanOrEqual(7);
    // the filled gold button: black text on gold
    expect(contrast('#000000', n.brand)).toBeGreaterThanOrEqual(7);
    // the 28% gold focus ring and borders stay visible against the card
    expect(contrast(n.border, n.bg)).toBeGreaterThan(1.1);
  });

  it('never lets a dark merchant brand disappear as text on Noir', () => {
    const r = resolveTheme('noir', '#0B3D91');
    expect(r.brand).toBe('#0B3D91');
    expect(contrast(r.brandInk, THEMES.noir.bg)).toBeGreaterThanOrEqual(3);
    expect(r.brandInk).toBe(THEMES.noir.accent);
  });

  it('keeps the light themes’ own text and brand-ink readable', () => {
    for (const key of THEME_KEYS.filter((k) => k !== 'noir')) {
      const t = THEMES[key];
      expect(contrast(t.text, t.bg), key).toBeGreaterThanOrEqual(7);
      const ink = resolveTheme(key, null).brandInk;
      expect(contrast(ink, t.bg), key).toBeGreaterThanOrEqual(3);
    }
  });
});
