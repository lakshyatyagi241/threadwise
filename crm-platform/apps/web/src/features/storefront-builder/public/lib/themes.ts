/**
 * The 8 shop themes (WD-STORE-011): one shell, eight token sets. A theme is data (palette, card radius, hero size) plus a few
 * CSS overrides keyed by `data-sf-theme` in storefront.css. The tokens reach the page as CSS variables on the shop's root
 * element, so nothing leaks outside it.
 */

export const THEME_KEYS = [
  'aurora',
  'meridian',
  'verdure',
  'bazaar',
  'noir',
  'kraft',
  'mercato',
  'studio',
] as const;
export type ThemeKey = (typeof THEME_KEYS)[number];
export const DEFAULT_THEME: ThemeKey = 'aurora';
export const DEFAULT_BRAND = '#075E54';

export interface ThemeTokens {
  key: ThemeKey;
  bg: string;
  surface: string;
  text: string;
  muted: string;
  border: string;
  /** The theme's own brand colour, used only when the merchant has not set one. */
  brand: string;
  /** Fixed accent; null means the accent follows the brand (Aurora). */
  accent: string | null;
  radius: string;
  heroSize: string;
  dark: boolean;
}

export const THEMES: Record<ThemeKey, ThemeTokens> = {
  aurora: {
    key: 'aurora',
    bg: '#FBFAF6',
    surface: '#FFFFFF',
    text: '#0B1F1C',
    muted: '#6B807C',
    border: '#E5DFD0',
    brand: DEFAULT_BRAND,
    accent: null,
    radius: '14px',
    heroSize: '46px',
    dark: false,
  },
  meridian: {
    key: 'meridian',
    bg: '#F5F2EA',
    surface: '#FFFFFF',
    text: '#0B1F1C',
    muted: '#6B807C',
    border: '#D9D2BD',
    brand: '#0B1F1C',
    accent: '#0B1F1C',
    radius: '2px',
    heroSize: '58px',
    dark: false,
  },
  verdure: {
    key: 'verdure',
    bg: '#F4F1E8',
    surface: '#FAF8F0',
    text: '#2D3A22',
    muted: '#7B8A6A',
    border: '#D5DCC4',
    brand: '#5C7C4D',
    accent: '#5C7C4D',
    radius: '20px',
    heroSize: '44px',
    dark: false,
  },
  bazaar: {
    key: 'bazaar',
    bg: '#FFF6EC',
    surface: '#FFFFFF',
    text: '#2A1810',
    muted: '#7A5C40',
    border: '#F4D7B8',
    brand: '#E76F51',
    accent: '#E76F51',
    radius: '10px',
    heroSize: '42px',
    dark: false,
  },
  noir: {
    key: 'noir',
    bg: '#0A0A0A',
    surface: '#141414',
    text: '#F0F0F0',
    muted: '#A0A0A0',
    border: '#2A2A2A',
    brand: '#D4AF37',
    accent: '#D4AF37',
    radius: '4px',
    heroSize: '52px',
    dark: true,
  },
  kraft: {
    key: 'kraft',
    bg: '#EDE4D3',
    surface: '#F5EFE0',
    text: '#3B2C1A',
    muted: '#8B7556',
    border: '#C9B894',
    brand: '#A6845A',
    accent: '#A6845A',
    radius: '8px',
    heroSize: '42px',
    dark: false,
  },
  mercato: {
    key: 'mercato',
    bg: '#FFF8E7',
    surface: '#FFFEF8',
    text: '#1F1408',
    muted: '#7C5B3A',
    border: '#F4D35E',
    brand: '#C8553D',
    accent: '#C8553D',
    radius: '12px',
    heroSize: '46px',
    dark: false,
  },
  studio: {
    key: 'studio',
    bg: '#F4F1ED',
    surface: '#FFFFFF',
    text: '#264653',
    muted: '#7B8E94',
    border: '#D8DCDD',
    brand: '#2A9D8F',
    accent: '#2A9D8F',
    radius: '24px',
    heroSize: '56px',
    dark: false,
  },
};

/** An unknown or missing key renders Aurora. */
export function themeKeyOf(key: string | null | undefined): ThemeKey {
  return (THEME_KEYS as readonly string[]).includes(key ?? '') ? (key as ThemeKey) : DEFAULT_THEME;
}

const HEX6 = /^#[0-9a-f]{6}$/i;
export const isHexColor = (v: unknown): v is string => typeof v === 'string' && HEX6.test(v.trim());

/**
 * A brand colour the merchant chose. The API sends the platform default (#075E54) for a shop that never set one, so that value
 * means "none": the theme keeps its own brand colour and the eight themes stay distinct.
 */
export const isCustomBrand = (v: unknown): v is string =>
  isHexColor(v) && v.trim().toUpperCase() !== DEFAULT_BRAND.toUpperCase();

function channel(hex: string, at: number): number {
  const v = parseInt(hex.slice(at, at + 2), 16) / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of a #rrggbb colour. */
export function luminance(hex: string): number {
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

/** WCAG contrast ratio, 1 to 21. */
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** White text on the colour unless it fails 3:1 (bold button text), else black: keeps the eight palettes' white-on-brand look. */
export function readableOn(hex: string): '#000000' | '#FFFFFF' {
  return contrast(hex, '#FFFFFF') >= 3 ? '#FFFFFF' : '#000000';
}

export interface ResolvedTheme {
  key: ThemeKey;
  tokens: ThemeTokens;
  brand: string;
  accent: string;
  /** The brand colour as text on the page background: falls back to the accent, then the text colour, when it would not read. */
  brandInk: string;
  vars: Record<string, string>;
}

/** Fonts are system stacks: the shop loads nothing from a CDN (decision D-13). */
export const FONT_STACKS = {
  serif: "Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Times New Roman', serif",
  sans: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
} as const;

/**
 * The tokens a page renders with. The merchant's brand colour replaces the theme's brand in every theme; each theme keeps its
 * own fixed accent except Aurora, whose accent follows the brand.
 */
export function resolveTheme(
  themeKey: string | null | undefined,
  brandColor: string | null | undefined,
): ResolvedTheme {
  const tokens = THEMES[themeKeyOf(themeKey)];
  const brand = isCustomBrand(brandColor) ? brandColor.trim() : tokens.brand;
  const accent = tokens.accent ?? brand;
  const brandInk =
    contrast(brand, tokens.bg) >= 3 && contrast(brand, tokens.surface) >= 3
      ? brand
      : contrast(accent, tokens.bg) >= 3
        ? accent
        : tokens.text;
  return {
    key: tokens.key,
    tokens,
    brand,
    accent,
    brandInk,
    vars: {
      '--sf-bg': tokens.bg,
      '--sf-surface': tokens.surface,
      '--sf-text': tokens.text,
      '--sf-muted': tokens.muted,
      '--sf-border': tokens.border,
      '--sf-brand': brand,
      '--sf-on-brand': readableOn(brand),
      '--sf-brand-ink': brandInk,
      '--sf-accent': accent,
      '--sf-on-accent': readableOn(accent),
      '--sf-radius': tokens.radius,
      '--sf-hero-size': tokens.heroSize,
      '--sf-serif': FONT_STACKS.serif,
      '--sf-sans': FONT_STACKS.sans,
      '--sf-mono': FONT_STACKS.mono,
    },
  };
}
