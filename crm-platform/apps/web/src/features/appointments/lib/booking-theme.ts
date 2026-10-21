import {
  bookingPageAssetPath,
  isBookingPageAssetPath,
  type BookingPageAssetRef,
  type BookingPageCorner,
  type BookingPageFont,
  type BookingPageMode,
  type PublicBookingTheme,
} from '@crm/contracts';
import {
  check,
  ensureContrast,
  isHexColour,
  luminance,
  mix,
  readableOn,
  type ContrastCheck,
} from '@/lib/brand-kit/colour';

/**
 * How the customer's booking page is drawn from its theme (BL-355..BL-358). Pure: the editor's preview and the real page call the same
 * functions, so what the owner sees is what a customer gets.
 *
 * The page is built on the app's colour tokens (`bg-background`, `text-brand`, `ring-primary`...). The theme does not add classes or
 * rules; it sets those tokens, as inline custom properties, on one wrapper element. Every value that reaches a style attribute is a
 * `#RRGGBB` colour that passed `isHexColour`, a length from a fixed table, or a font stack from a fixed list.
 */

export type Scheme = 'light' | 'dark';

/** What the page needs to draw: the resolved theme with its pictures turned into addresses the page may load. */
export interface ThemeView {
  primaryColor: string | null;
  accentColor: string | null;
  backgroundColor: string | null;
  backgroundStyle: PublicBookingTheme['backgroundStyle'];
  pageTitle: string | null;
  welcomeText: string | null;
  buttonLabel: string | null;
  font: BookingPageFont;
  cornerStyle: BookingPageCorner;
  colorMode: BookingPageMode;
  showPoweredBy: boolean;
  showLanguageSwitch: boolean;
  logoUrl: string | null;
  coverUrl: string | null;
}

/** An address the page may load a picture from: one of our own asset paths, or (editor preview only) a file the person just chose. */
export function safeImageSrc(value: string | null | undefined, allowBlob = false): string | null {
  if (!value) return null;
  if (isBookingPageAssetPath(value)) return value;
  if (allowBlob && /^blob:[A-Za-z0-9:/._-]{1,200}$/.test(value)) return value;
  return null;
}

/** `local` replaces a picture with one the person just chose in the editor (a `blob:` address, or null for "removed"). */
export function toView(
  theme: PublicBookingTheme,
  org: string,
  local?: { logo?: string | null; cover?: string | null },
): ThemeView {
  const asset = (ref: BookingPageAssetRef | null) => (ref ? bookingPageAssetPath(org, ref) : null);
  return {
    primaryColor: theme.primaryColor,
    accentColor: theme.accentColor,
    backgroundColor: theme.backgroundColor,
    backgroundStyle: theme.backgroundStyle,
    pageTitle: theme.pageTitle,
    welcomeText: theme.welcomeText,
    buttonLabel: theme.buttonLabel,
    font: theme.font,
    cornerStyle: theme.cornerStyle,
    colorMode: theme.colorMode,
    showPoweredBy: theme.showPoweredBy,
    showLanguageSwitch: theme.showLanguageSwitch,
    logoUrl: local && 'logo' in local ? (local.logo ?? null) : asset(theme.logo),
    coverUrl: local && 'cover' in local ? (local.cover ?? null) : asset(theme.cover),
  };
}

export const schemeFor = (mode: BookingPageMode, systemDark: boolean): Scheme =>
  mode === 'light' ? 'light' : mode === 'dark' ? 'dark' : systemDark ? 'dark' : 'light';

// --- the palette --------------------------------------------------------------------------------------------------------------

interface Base {
  surface: string;
  foreground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  primary: string;
  brand: string;
  backdrop: string;
  danger: string;
  success: string;
  warning: string;
}

/** The product's own colours (the same as the `@crm/ui` tokens): a page with no colour set looks exactly as it did before themes. */
const PRODUCT: Record<Scheme, Base> = {
  light: {
    surface: '#ffffff',
    foreground: '#0f172a',
    muted: '#f4f3ff',
    mutedForeground: '#64748b',
    border: '#e2e8f0',
    primary: '#3214db',
    brand: '#3214db',
    backdrop: '#f8f7ff',
    danger: '#b91c1c',
    success: '#15803d',
    warning: '#b45309',
  },
  dark: {
    surface: '#0b1220',
    foreground: '#e2e8f0',
    muted: '#111a2e',
    mutedForeground: '#94a3b8',
    border: '#1e293b',
    primary: '#8b7cf6',
    brand: '#3214db',
    backdrop: '#0e1627',
    danger: '#f87171',
    success: '#4ade80',
    warning: '#fbbf24',
  },
};

export const FONT_STACKS: Record<Exclude<BookingPageFont, 'default'>, string> = {
  system: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  serif: "Georgia, Cambria, 'Times New Roman', Times, serif",
  rounded:
    "ui-rounded, 'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Quicksand, Nunito, 'Varela Round', system-ui, sans-serif",
  humanist:
    "Seravek, 'Gill Sans Nova', Ubuntu, Calibri, 'DejaVu Sans', 'Trebuchet MS', Verdana, sans-serif",
};

/** The corner scale per style; `--radius` is what `rounded-md` reads, the others are Tailwind's own theme variables. */
const CORNERS: Record<BookingPageCorner, Record<string, string>> = {
  square: {
    '--radius': '0px',
    '--radius-sm': '0px',
    '--radius-lg': '0px',
    '--radius-xl': '0px',
    '--radius-2xl': '0px',
  },
  rounded: {
    '--radius': '0.5rem',
    '--radius-sm': '0.25rem',
    '--radius-lg': '0.5rem',
    '--radius-xl': '0.75rem',
    '--radius-2xl': '1rem',
  },
  pill: {
    '--radius': '9999px',
    '--radius-sm': '0.75rem',
    '--radius-lg': '1.25rem',
    '--radius-xl': '1.5rem',
    '--radius-2xl': '2rem',
  },
};

export interface Palette {
  scheme: Scheme;
  /** Custom properties for the wrapper element, all validated. */
  vars: Record<string, string>;
  /** The colour behind the page. */
  backdrop: string;
  /** Contrast findings the editor shows. */
  checks: ContrastCheck[];
}

const colour = (v: string | null): string | null => (v && isHexColour(v) ? v.toLowerCase() : null);

export function buildPalette(view: ThemeView, scheme: Scheme): Palette {
  const d = PRODUCT[scheme];
  const customPrimary = colour(view.primaryColor);
  const customAccent = colour(view.accentColor);
  const customBackdrop = colour(view.backgroundColor);
  const tintSource = customPrimary ?? d.primary;

  // Text and focus rings use the primary colour on the page surface: lightened or darkened just enough to be readable.
  const primary = customPrimary ? ensureContrast(customPrimary, d.surface, 4.5) : d.primary;
  // The fill of buttons and selected times: the button colour, else the primary colour, else the product's own.
  const brand = customAccent ?? customPrimary ?? d.brand;

  const muted = customPrimary
    ? mix(d.surface, tintSource, scheme === 'light' ? 0.06 : 0.14)
    : d.muted;
  const mutedForeground = ensureContrast(
    ensureContrast(d.mutedForeground, muted, 4.5),
    d.surface,
    4.5,
  );

  let backdrop = d.backdrop;
  if (view.backgroundStyle === 'tint') {
    backdrop = mix(d.surface, tintSource, scheme === 'light' ? 0.1 : 0.16);
  } else if (view.backgroundStyle === 'solid' && customBackdrop) {
    // A pale colour chosen for the light page would glare in the dark one, so it is taken down to a dark shade of the same hue.
    backdrop =
      scheme === 'dark' && luminance(customBackdrop) > 0.08
        ? mix(customBackdrop, '#000000', 0.85)
        : customBackdrop;
  }
  const darkBackdrop = luminance(backdrop) < 0.18;
  const backdropText = ensureContrast(darkBackdrop ? '#e2e8f0' : '#0f172a', backdrop, 4.5);
  const backdropMuted = ensureContrast(darkBackdrop ? '#94a3b8' : '#64748b', backdrop, 4.5);

  const vars: Record<string, string> = {
    '--background': d.surface,
    '--foreground': d.foreground,
    '--muted': muted,
    '--muted-foreground': mutedForeground,
    '--border': d.border,
    '--primary': primary,
    '--primary-foreground': readableOn(primary),
    '--brand': brand,
    '--brand-foreground': readableOn(brand),
    '--danger': d.danger,
    '--danger-foreground': scheme === 'dark' ? '#2b0a0a' : '#ffffff',
    '--success': d.success,
    '--warning': d.warning,
    '--bk-backdrop': backdrop,
    '--bk-backdrop-fg': backdropText,
    '--bk-backdrop-muted': backdropMuted,
    ...CORNERS[view.cornerStyle],
  };

  const checks: ContrastCheck[] = [];
  if (customPrimary) checks.push(check('primaryText', customPrimary, d.surface, 4.5));
  checks.push(check('button', readableOn(brand), brand, 4.5));
  // The product's own button colour is not the workspace's choice, so it is not flagged when nothing is customised.
  if (customAccent || customPrimary) checks.push(check('buttonEdge', brand, d.surface, 3));
  return { scheme, vars, backdrop, checks };
}

/** The wrapper's style: the palette, the font and the browser's own controls (`color-scheme`). */
export function wrapperStyle(view: ThemeView, palette: Palette): Record<string, string> {
  const style: Record<string, string> = { ...palette.vars, colorScheme: palette.scheme };
  if (view.font !== 'default') style.fontFamily = FONT_STACKS[view.font];
  return style;
}

/** The checks that need a word to the owner: the primary colour will be adjusted, or the button blends into the page. */
export const warningsOf = (checks: readonly ContrastCheck[]): ContrastCheck[] =>
  checks.filter((c) => !c.ok);
