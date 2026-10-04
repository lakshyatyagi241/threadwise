import { z } from 'zod';
import { NAV_LAYOUT_KEYS } from './nav-layout';

/**
 * What the customer shell reads on load (TW-ASHELL-011, 012, 015): which navigation mode every customer gets, and the
 * rail colours the platform admin chose. The values are edited on the platform Appearance page (TW-SET-013 to 015) and
 * served here, so the shell never reads another domain's tables.
 */
export const SHELL_MODES = ['topbar', 'sidebar'] as const;
export type ShellMode = (typeof SHELL_MODES)[number];

/** Anything other than `sidebar` reads as `topbar` (Reference: `grid` and every other value fall back). */
export const parseShellMode = (raw: unknown): ShellMode =>
  raw === 'sidebar' ? 'sidebar' : 'topbar';

const hex6 = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const railColorsSchema = z.object({
  /** Custom rail background. Null: the rail follows the active theme. */
  color: hex6.nullable(),
  /** Custom text colour. Null: black or white by the background's luminance. */
  textColor: hex6.nullable(),
  /** Custom accent. Null: the shipped green. */
  accentColor: hex6.nullable(),
});
export type RailColors = z.infer<typeof railColorsSchema>;

export const shellConfigResponseSchema = z.object({
  mode: z.enum(SHELL_MODES),
  rail: railColorsSchema,
  /** The top bar's entries (always ending in `more`) and the More zone, from the menu layout (TW-ASHELL-009). */
  bar: z.array(z.enum(NAV_LAYOUT_KEYS)),
  more: z.array(z.enum(NAV_LAYOUT_KEYS)),
  /** The guided tour runs once for a person who has not seen it (TW-ASHELL-023). */
  tour: z.object({ run: z.boolean() }),
});
export type ShellConfigResponse = z.infer<typeof shellConfigResponseSchema>;

export const DEFAULT_RAIL_ACCENT = '#25D366';

/** Reference's luminance test: 0.299R + 0.587G + 0.114B over 255. Above 0.6 the rail is light and needs dark text. */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

export const isLightColor = (hex: string): boolean => luminance(hex) > 0.6;

const alpha = (hex: string, pct: number) => `color-mix(in srgb, ${hex} ${pct}%, transparent)`;

export interface RailTheme {
  /** True when the background is fixed to a custom colour on every theme. */
  fixedBackground: boolean;
  light: boolean;
  /** CSS custom properties to set on the rail element; they override the shell's `--nav-*` tokens. */
  vars: Record<string, string>;
}

/**
 * The rail's colours (TW-ASHELL-011 rules 3 and 4). Without a custom background the rail keeps following the theme, and only
 * an explicit text or accent colour changes it. With one, the rail is that colour on every theme, light or dark text by
 * luminance; an explicit text colour derives the whole scale (72, 50, 42, 8, 6 and 14 percent of it).
 */
export function railTheme(rail: RailColors): RailTheme | null {
  const { color, textColor, accentColor } = rail;
  if (!color && !textColor && !accentColor) return null;
  const vars: Record<string, string> = {};
  const accent = accentColor ?? DEFAULT_RAIL_ACCENT;
  const light = color ? isLightColor(color) : false;
  if (color) vars['--nav-bg'] = color;
  const text = textColor ?? (color ? (light ? '#0B1F1C' : '#F5F3EC') : null);
  if (text) {
    vars['--nav-foreground'] = alpha(text, 72);
    vars['--nav-muted'] = alpha(text, 50);
    vars['--nav-disabled'] = alpha(text, 42);
    vars['--nav-hover'] = alpha(text, 8);
    vars['--nav-border'] = alpha(text, 6);
    vars['--nav-active-foreground'] = text;
  }
  vars['--nav-active'] = text ? alpha(text, 14) : alpha(accent, 14);
  vars['--nav-ring'] = accent;
  if (accentColor || color || textColor) vars['--nav-accent'] = accent;
  return { fixedBackground: Boolean(color), light, vars };
}

/** "Good morning" and friends by the viewer's local hour (TW-ASHELL-016). */
export type GreetingKey = 'midnightOil' | 'morning' | 'afternoon' | 'evening' | 'night';
export function greetingKey(hour: number): GreetingKey {
  if (hour < 5) return 'midnightOil';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  if (hour < 21) return 'evening';
  return 'night';
}

/** First word of the name, as Reference's `explode(' ')[0]`. */
export const firstName = (name: string): string => name.trim().split(/\s+/)[0] ?? '';
