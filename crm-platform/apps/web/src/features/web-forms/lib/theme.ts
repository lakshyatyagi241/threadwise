import { formThemeSchema } from '@crm/contracts';
import type { ThemeTokens } from './types';

/**
 * Theming is tokens, never CSS (spec section 8): the renderer turns the tokens into CSS custom properties on ONE wrapper element, and
 * the server accepts only these keys and value shapes (`formThemeSchema`). A form can therefore not carry a style rule, and nothing
 * leaks outside its wrapper. Every function here is defensive anyway: a value that is not a token never reaches the page.
 */

export const DEFAULT_THEME: ThemeTokens = formThemeSchema.parse({});

type Colours = Pick<
  ThemeTokens,
  'primary' | 'background' | 'surface' | 'text' | 'mutedText' | 'border'
>;
const colours = (
  primary: string,
  background: string,
  surface: string,
  text: string,
  mutedText: string,
  border: string,
): Colours => ({ primary, background, surface, text, mutedText, border });

export const THEME_PRESET_KEYS = [
  'classic',
  'ocean',
  'forest',
  'sunset',
  'berry',
  'slate',
  'noir',
  'paper',
] as const;
export type ThemePresetKey = (typeof THEME_PRESET_KEYS)[number];

/** Eight starting points, each a partial token set laid over the defaults. Colours are the light palette; `mode` darkens them. */
export const THEME_PRESETS: Record<ThemePresetKey, Partial<ThemeTokens>> = {
  classic: {},
  ocean: {
    ...colours('#1d5fd1', '#eef4ff', '#ffffff', '#0f172a', '#475569', '#c9d8f5'),
    radius: 'md',
  },
  forest: {
    ...colours('#2f6b3f', '#f1f6ee', '#ffffff', '#14241a', '#5a6b5e', '#cfdccb'),
    radius: 'lg',
  },
  sunset: {
    ...colours('#c2410c', '#fff6ec', '#ffffff', '#2a1810', '#7a5c40', '#f4d7b8'),
    radius: 'md',
  },
  berry: {
    ...colours('#9d2a6b', '#fbf1f7', '#ffffff', '#2b0e1e', '#7a4d67', '#ebcfe0'),
    radius: 'pill',
  },
  slate: {
    ...colours('#334155', '#f1f5f9', '#ffffff', '#0f172a', '#64748b', '#cbd5e1'),
    radius: 'sm',
  },
  noir: {
    ...colours('#34d399', '#0b0f14', '#141a22', '#f3f4f6', '#9ca3af', '#2a323d'),
    radius: 'md',
  },
  paper: {
    ...colours('#1f2937', '#faf7f0', '#ffffff', '#1f2937', '#6b7280', '#e4ddcb'),
    radius: 'none',
    fontFamily: 'serif',
  },
};

/** The keys a preset owns; the others (layout, images, width, label position) survive picking a preset. */
const PRESET_KEYS: ReadonlyArray<keyof ThemeTokens> = [
  'primary',
  'background',
  'surface',
  'text',
  'mutedText',
  'border',
  'error',
  'radius',
  'fontFamily',
];

export function applyPreset(base: ThemeTokens, key: ThemePresetKey): ThemeTokens {
  const preset = { ...DEFAULT_THEME, ...THEME_PRESETS[key] };
  const next = { ...base };
  for (const k of PRESET_KEYS) (next as Record<string, unknown>)[k] = preset[k];
  return next;
}

/** The preset a theme still equals, or null once the owner changed a token (the picker then shows "Custom"). */
export function presetOf(theme: ThemeTokens): ThemePresetKey | null {
  for (const key of THEME_PRESET_KEYS) {
    const want = { ...DEFAULT_THEME, ...THEME_PRESETS[key] };
    if (PRESET_KEYS.every((k) => want[k] === theme[k])) return key;
  }
  return null;
}

export const RADIUS_PX: Record<ThemeTokens['radius'], string> = {
  none: '0px',
  sm: '4px',
  md: '8px',
  lg: '16px',
  pill: '999px',
};
const DENSITY_GAP: Record<ThemeTokens['density'], string> = {
  compact: '12px',
  comfortable: '18px',
  spacious: '26px',
};
const DENSITY_PAD: Record<ThemeTokens['density'], string> = {
  compact: '9px',
  comfortable: '12px',
  spacious: '15px',
};
const SHADOW: Record<ThemeTokens['shadow'], string> = {
  none: 'none',
  sm: '0 1px 3px rgba(15,23,42,0.12)',
  md: '0 10px 30px rgba(15,23,42,0.12)',
  lg: '0 24px 60px rgba(15,23,42,0.2)',
};

export const FONT_STACKS: Record<ThemeTokens['fontFamily'], string> = {
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  inter: "'Inter', system-ui, sans-serif",
  roboto: "'Roboto', system-ui, sans-serif",
  open_sans: "'Open Sans', system-ui, sans-serif",
  lato: "'Lato', system-ui, sans-serif",
  poppins: "'Poppins', system-ui, sans-serif",
  merriweather: "'Merriweather', Georgia, serif",
  nunito: "'Nunito', system-ui, sans-serif",
};

/** Google Fonts family parameter per font that is not a system stack. The stylesheet address is built only from this closed list. */
const GOOGLE_FAMILY: Partial<Record<ThemeTokens['fontFamily'], string>> = {
  inter: 'Inter:wght@400;500;600',
  roboto: 'Roboto:wght@400;500;700',
  open_sans: 'Open+Sans:wght@400;600;700',
  lato: 'Lato:wght@400;700',
  poppins: 'Poppins:wght@400;500;600',
  merriweather: 'Merriweather:wght@400;700',
  nunito: 'Nunito:wght@400;600;700',
};

/** The stylesheet for the chosen font, or null for a system stack: the renderer loads a web font only when it is chosen. */
export function fontStylesheet(font: ThemeTokens['fontFamily']): string | null {
  const family = GOOGLE_FAMILY[font];
  return family ? `https://fonts.googleapis.com/css2?family=${family}&display=swap` : null;
}

/** `#rrggbb`, the one colour shape the contract allows. */
export const HEX = /^#[0-9a-f]{6}$/i;
export const isHex = (v: string): boolean => HEX.test(v);

/** A colour that is not a hex falls back to the default instead of reaching the page, so a bad token cannot inject anything. */
const safe = (v: string, fallback: string) => (HEX.test(v) ? v : fallback);

/** The https address of an image, or null. Image tokens come from the workspace's media; anything else is dropped. */
export function safeImageUrl(v: string | null | undefined): string | null {
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === 'https:' && !/["'()\s\\]/.test(u.href) ? u.href : null;
  } catch {
    return null;
  }
}

/**
 * Tokens to custom properties on the wrapper. Every value is a validated token, never a free string. The five neutrals are the LIGHT
 * palette (`--f-l-*`): the stylesheet maps them to the colours in use and swaps in the dark neutrals for dark mode, because an inline
 * custom property would otherwise win over any rule of the stylesheet.
 */
export function tokensToCssVars(t: ThemeTokens): Record<string, string> {
  const vars: Record<string, string> = {
    '--f-primary': safe(t.primary, DEFAULT_THEME.primary),
    '--f-l-bg': safe(t.background, DEFAULT_THEME.background),
    '--f-l-surface': safe(t.surface, DEFAULT_THEME.surface),
    '--f-l-text': safe(t.text, DEFAULT_THEME.text),
    '--f-l-muted': safe(t.mutedText, DEFAULT_THEME.mutedText),
    '--f-l-border': safe(t.border, DEFAULT_THEME.border),
    '--f-error': safe(t.error, DEFAULT_THEME.error),
    '--f-radius': RADIUS_PX[t.radius] ?? RADIUS_PX.md,
    // A pill shape is for controls; the card, cover and notices keep a soft corner instead of becoming an oval.
    '--f-card-radius': t.radius === 'pill' ? '24px' : (RADIUS_PX[t.radius] ?? RADIUS_PX.md),
    '--f-gap': DENSITY_GAP[t.density] ?? DENSITY_GAP.comfortable,
    '--f-pad': DENSITY_PAD[t.density] ?? DENSITY_PAD.comfortable,
    '--f-font': FONT_STACKS[t.fontFamily] ?? FONT_STACKS.system,
    '--f-scale': String(
      Math.min(1.4, Math.max(0.8, Number.isFinite(t.fontScale) ? t.fontScale : 1)),
    ),
    '--f-max': `${Math.min(960, Math.max(320, Math.round(t.maxWidth) || 560))}px`,
    '--f-shadow': SHADOW[t.shadow] ?? SHADOW.md,
  };
  const bg = safeImageUrl(t.backgroundImage);
  if (bg) vars['--f-bg-image'] = `url("${bg}")`;
  return vars;
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function rgbOf(hex: string): [number, number, number] | null {
  if (!HEX.test(hex)) return null;
  const h = hex.slice(1);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** WCAG contrast ratio of two hex colours (1 to 21), or null when either is not a hex. */
export function contrastRatio(a: string, b: string): number | null {
  const x = rgbOf(a);
  const y = rgbOf(b);
  if (!x || !y) return null;
  const l = (c: [number, number, number]) =>
    0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
  const [hi, lo] = [l(x), l(y)].sort((p, q) => q - p) as [number, number];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

export const MIN_CONTRAST = 4.5;

export interface ContrastWarning {
  pair: 'text' | 'muted' | 'button';
  ratio: number;
}

/** The pairs under 4.5:1, so the Design tab can warn live (spec section 8). */
export function contrastWarnings(t: ThemeTokens): ContrastWarning[] {
  const out: ContrastWarning[] = [];
  const pairs: Array<[ContrastWarning['pair'], string, string]> = [
    ['text', t.text, t.surface],
    ['muted', t.mutedText, t.surface],
    // The filled button writes white on the primary colour; an outline button writes the primary on the surface.
    t.buttonStyle === 'filled'
      ? ['button', '#ffffff', t.primary]
      : ['button', t.primary, t.surface],
  ];
  for (const [pair, fg, bg] of pairs) {
    const ratio = contrastRatio(fg, bg);
    if (ratio !== null && ratio < MIN_CONTRAST) out.push({ pair, ratio });
  }
  return out;
}
