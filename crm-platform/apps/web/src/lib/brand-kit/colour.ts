/**
 * The workspace brand kit's colour maths, shared by every public page that takes a customer's colours (the booking page first; the
 * invoice page, forms and link pages can adopt it). Pure and dependency free, so a preview in the editor and the real page agree.
 *
 * Only `#RRGGBB` is ever accepted: a colour ends up in a style attribute, so nothing else may get through. Anything that is not a clean
 * hex is "not a colour" (`null`), never a guess.
 */

const HEX = /^#[0-9a-fA-F]{6}$/;

export type Rgb = readonly [number, number, number];

export const isHexColour = (value: unknown): value is string =>
  typeof value === 'string' && HEX.test(value);

export function parseHex(value: string): Rgb | null {
  if (!HEX.test(value)) return null;
  return [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16)) as unknown as Rgb;
}

export function toHex([r, g, b]: Rgb): string {
  const part = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

const channel = (v: number): number => {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** WCAG relative luminance, 0 (black) to 1 (white). A value that is not a hex counts as black. */
export function luminance(hex: string): number {
  const rgb = parseHex(hex) ?? [0, 0, 0];
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

/** WCAG contrast ratio, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** `amount` (0 to 1) of `b` mixed into `a`. */
export function mix(a: string, b: string, amount: number): string {
  const x = parseHex(a) ?? [0, 0, 0];
  const y = parseHex(b) ?? [0, 0, 0];
  const t = Math.max(0, Math.min(1, amount));
  return toHex([0, 1, 2].map((i) => x[i]! + (y[i]! - x[i]!) * t) as unknown as Rgb);
}

export const WHITE = '#ffffff';
export const BLACK = '#000000';
/** The two text colours used on a filled surface: near-white and a deep slate (softer than pure black, still above AA on any fill). */
export const ON_DARK = '#ffffff';
export const ON_LIGHT = '#0b1220';

/**
 * The text colour that reads best on `background`: whichever of near-white and deep slate has the higher contrast. On the few mid
 * tones where neither reaches 4.5:1 (a bright periwinkle, say), pure black does, so that is used rather than a text that fails.
 */
export function readableOn(background: string): string {
  const best =
    contrastRatio(ON_DARK, background) >= contrastRatio(ON_LIGHT, background) ? ON_DARK : ON_LIGHT;
  if (contrastRatio(best, background) >= 4.5) return best;
  return contrastRatio(BLACK, background) >= contrastRatio(WHITE, background) ? BLACK : WHITE;
}

/**
 * `colour` moved toward black (on a light background) or white (on a dark one) just far enough to reach `min` contrast against
 * `background`; unchanged when it already does. The hue stays, so a brand colour that is a little too pale for text is darkened, not
 * replaced.
 */
export function ensureContrast(colour: string, background: string, min = 4.5): string {
  if (!HEX.test(colour) || !HEX.test(background)) return colour;
  if (contrastRatio(colour, background) >= min) return colour;
  // Toward whichever end of the scale can reach the contrast at all: on a mid grey that is black, though the grey is "dark" by luminance.
  const target =
    contrastRatio(BLACK, background) >= contrastRatio(WHITE, background) ? BLACK : WHITE;
  for (let step = 1; step <= 20; step++) {
    const candidate = mix(colour, target, step / 20);
    if (contrastRatio(candidate, background) >= min) return candidate;
  }
  return target;
}

export interface ContrastCheck {
  /** What is being drawn on what. */
  pair: 'primaryText' | 'button' | 'buttonEdge' | 'backdropText';
  ratio: number;
  /** The least the pair should reach (4.5 for text, 3 for the edge of a control). */
  min: number;
  ok: boolean;
}

export const check = (
  pair: ContrastCheck['pair'],
  fg: string,
  bg: string,
  min: number,
): ContrastCheck => {
  const ratio = Math.round(contrastRatio(fg, bg) * 100) / 100;
  return { pair, ratio, min, ok: ratio >= min };
};
