/** Brand accent handling for the guest pages (TW-AUTH-021). Pure, so the editor preview and the real pages agree. */

export const DEFAULT_ACCENT = '#25d366';
const HEX = /^#[0-9a-fA-F]{6}$/;

/** The configured accent when it is a #rrggbb colour, otherwise the product default. */
export function normalizeAccent(value?: string | null): string {
  return value && HEX.test(value) ? value.toLowerCase() : DEFAULT_ACCENT;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of a #rrggbb colour (0 black .. 1 white). */
export function luminance(hex: string): number {
  const h = normalizeAccent(hex).slice(1);
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Text colour that stays readable on top of the accent. */
export function readableOn(hex: string): '#ffffff' | '#0b1220' {
  return luminance(hex) > 0.4 ? '#0b1220' : '#ffffff';
}

function contrast(a: number, b: number): number {
  const [hi, lo] = a >= b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

function mixWithWhite(hex: string, t: number): string {
  const h = hex.slice(1);
  const out = [0, 2, 4].map((i) => {
    const v = parseInt(h.slice(i, i + 2), 16);
    return Math.round(v + (255 - v) * t)
      .toString(16)
      .padStart(2, '0');
  });
  return `#${out.join('')}`;
}

/** The dark of the showcase panels, the background an accent word has to stand out from. */
const ART_DARK = '#0b1f1c';

/**
 * The accent as it is drawn on the dark showcase panels. A dark brand colour (a deep teal, say) would sink into
 * the panel, so it is lightened just far enough to reach a readable contrast; a bright accent is used as is.
 */
export function accentOnDark(value?: string | null): string {
  const base = normalizeAccent(value);
  const bg = luminance(ART_DARK);
  for (let t = 0; t <= 1; t += 0.05) {
    const candidate = t === 0 ? base : mixWithWhite(base, t);
    if (contrast(luminance(candidate), bg) >= 4.5) return candidate;
  }
  return '#ffffff';
}
