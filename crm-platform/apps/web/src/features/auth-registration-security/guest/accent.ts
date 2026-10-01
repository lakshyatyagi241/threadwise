/** Brand accent handling for the guest pages (TW-AUTH-021). Pure, so the editor preview and the real pages agree. */

export const DEFAULT_ACCENT = '#0f766e';
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
