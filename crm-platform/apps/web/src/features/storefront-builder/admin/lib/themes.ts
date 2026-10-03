import { STORE_THEMES, type StoreTheme } from '@crm/contracts';

/** The two colours of each theme tile's swatch (the diagonal gradient of the picker). */
export const THEME_SWATCH: Record<StoreTheme, readonly [string, string]> = {
  aurora: ['#FBFAF6', '#E5DFD0'],
  meridian: ['#0B1F1C', '#3A5A55'],
  verdure: ['#D5E8C6', '#8AAB7B'],
  bazaar: ['#F4A261', '#E76F51'],
  noir: ['#0a0a0a', '#262626'],
  kraft: ['#D4B896', '#A6845A'],
  mercato: ['#C8553D', '#F4D35E'],
  studio: ['#264653', '#2A9D8F'],
};

export const themeGradient = (key: string): string => {
  const pair = THEME_SWATCH[key as StoreTheme];
  return pair
    ? `linear-gradient(135deg, ${pair[0]}, ${pair[1]})`
    : 'linear-gradient(135deg, #075E54, #075E54)';
};

/** Theme tiles in picker order, with the label the contract gives them ("Aurora — minimal"). */
export const THEME_TILES = STORE_THEMES.map((t) => ({ key: t.key, label: t.label }));

/** Light swatches need dark tile text, dark ones light text (the tile prints the theme key over the swatch). */
export function swatchTextDark(key: string): boolean {
  return key === 'aurora' || key === 'verdure';
}
