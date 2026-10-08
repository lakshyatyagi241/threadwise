/**
 * Series colours. Eight categorical hues in a fixed order (blue, orange, aqua, yellow, magenta, green, violet, red), each stepped for
 * the light and the dark surface; the values live in CSS variables (`--rc-1` .. `--rc-8`, see `RC_CSS`) so a chart recolours with the
 * theme. A colour follows the entity (series, slice, bar) by its position, never cycled: a 9th slice folds into "Other".
 */
export const PALETTE_SIZE = 8;

export const LIGHT = [
  '#2a78d6',
  '#eb6834',
  '#1baf7a',
  '#eda100',
  '#e87ba4',
  '#008300',
  '#4a3aa7',
  '#e34948',
] as const;
export const DARK = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
] as const;

/** The colour for the n-th series, slice or bar (0-based). The 9th and later share the neutral "other" colour. */
export const colorAt = (i: number): string =>
  i >= 0 && i < PALETTE_SIZE ? `var(--rc-${i + 1})` : 'var(--rc-other)';

const vars = (colors: readonly string[]) => colors.map((c, i) => `--rc-${i + 1}:${c};`).join('');

/** The variables for every report on the page. Dark values follow the app's own `data-theme`. */
export const RC_CSS = `.rc{${vars(LIGHT)}--rc-other:#8a8f98;}
:root[data-theme='dark'] .rc{${vars(DARK)}--rc-other:#8b93a1;}`;

/** On paper the light values are used whatever the screen theme is. */
export const RC_PRINT_CSS = `.report-print-root .rc{${LIGHT.map((c, i) => `--rc-${i + 1}:${c} !important;`).join('')}--rc-other:#8a8f98 !important;}`;

/** More slices than colours: the smallest fold into one "Other" slice so every colour stays tied to one entity. */
export function foldSlices<T extends { label: string; value: number }>(
  slices: readonly T[],
  other: string,
): Array<{ label: string; value: number }> {
  if (slices.length <= PALETTE_SIZE) return slices.map((s) => ({ label: s.label, value: s.value }));
  const sorted = [...slices].sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, PALETTE_SIZE - 1).map((s) => ({ label: s.label, value: s.value }));
  const rest = sorted.slice(PALETTE_SIZE - 1).reduce((n, s) => n + s.value, 0);
  return [...head, { label: other, value: rest }];
}
