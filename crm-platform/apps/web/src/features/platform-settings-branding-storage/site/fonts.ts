/**
 * The 12 UI fonts the General page offers (TW-SET-006 rule 1): a CSS stack and the Google Fonts family string each.
 * An unknown or blank key means "theme default" and emits nothing.
 */
export const FONT_CATALOGUE: Record<string, { stack: string; google: string }> = {
  inter: { stack: "'Inter', system-ui, sans-serif", google: 'Inter:wght@400;500;600;700' },
  roboto: { stack: "'Roboto', system-ui, sans-serif", google: 'Roboto:wght@400;500;700' },
  'open-sans': {
    stack: "'Open Sans', system-ui, sans-serif",
    google: 'Open+Sans:wght@400;500;600;700',
  },
  poppins: { stack: "'Poppins', system-ui, sans-serif", google: 'Poppins:wght@400;500;600;700' },
  lato: { stack: "'Lato', system-ui, sans-serif", google: 'Lato:wght@400;700' },
  montserrat: {
    stack: "'Montserrat', system-ui, sans-serif",
    google: 'Montserrat:wght@400;500;600;700',
  },
  nunito: { stack: "'Nunito', system-ui, sans-serif", google: 'Nunito:wght@400;600;700' },
  'work-sans': {
    stack: "'Work Sans', system-ui, sans-serif",
    google: 'Work+Sans:wght@400;500;600;700',
  },
  'dm-sans': { stack: "'DM Sans', system-ui, sans-serif", google: 'DM+Sans:wght@400;500;700' },
  rubik: { stack: "'Rubik', system-ui, sans-serif", google: 'Rubik:wght@400;500;600;700' },
  manrope: { stack: "'Manrope', system-ui, sans-serif", google: 'Manrope:wght@400;500;600;700' },
  'plus-jakarta': {
    stack: "'Plus Jakarta Sans', system-ui, sans-serif",
    google: 'Plus+Jakarta+Sans:wght@400;500;600;700',
  },
};

/** The stylesheet URL and the CSS rule for a font key, or null for blank or unknown. */
export function fontAssets(key: string): { href: string; css: string } | null {
  const f = FONT_CATALOGUE[key];
  if (!f) return null;
  return {
    href: `https://fonts.googleapis.com/css2?family=${f.google}&display=swap`,
    css: `:root{--font-sans:${f.stack}}body{font-family:var(--font-sans)}`,
  };
}
