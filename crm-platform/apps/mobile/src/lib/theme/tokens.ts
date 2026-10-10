/**
 * Design tokens. A screen never writes a hex colour, a font size or a magic spacing number: it asks the theme. Brand colours
 * here are placeholders until the design handover (docs/mobile/handover.md); change them here and the whole app follows.
 *
 * Reading guide: `border` is for dividers, `borderStrong` for the edge of a control (a field, a checkbox: 3:1 against the page, as
 * WCAG asks of anything a person must find to use), `brand*` colours are the deep band behind the logo on the sign-in and sign-up screens, `*Soft` colours are the
 * quiet backgrounds of banners, badges and selected rows (always paired with the strong colour of the same name for the text on them),
 * `success` is a change for the better, a connected thing or a finished job, `instagram` is that channel's accent.
 */
export const palette = {
  light: {
    background: '#F7F8F6',
    surface: '#FFFFFF',
    surfaceMuted: '#EEF1EC',
    border: '#D5DBD2',
    borderStrong: '#7B887F',
    shadow: '#0A3A2C',
    text: '#14211B',
    textMuted: '#4F5E55',
    primary: '#0B6B4D',
    onPrimary: '#FFFFFF',
    primarySoft: '#E3F1EA',
    brand: '#0A3A2C',
    onBrand: '#FFFFFF',
    onBrandMuted: '#B9D4C7',
    brandAccent: '#7FE0B5',
    danger: '#B3261E',
    onDanger: '#FFFFFF',
    dangerSoft: '#FCEBE9',
    warning: '#8A5300',
    warningSoft: '#FFF3DC',
    success: '#1B7A43',
    successSoft: '#E4F4EA',
    instagram: '#C13584',
    instagramSoft: '#FBE8F2',
    focus: '#1A73E8',
  },
  dark: {
    background: '#0E1512',
    surface: '#16201B',
    surfaceMuted: '#1D2924',
    border: '#2E3B35',
    borderStrong: '#5F7269',
    shadow: '#000000',
    text: '#EAF0EC',
    textMuted: '#A3B3AA',
    primary: '#3DB88D',
    onPrimary: '#06241A',
    primarySoft: '#17332A',
    brand: '#0A2F24',
    onBrand: '#EAF0EC',
    onBrandMuted: '#A3C2B4',
    brandAccent: '#5FD6A5',
    danger: '#F2B8B5',
    onDanger: '#410E0B',
    dangerSoft: '#3A1917',
    warning: '#F5C26B',
    warningSoft: '#3A2D12',
    success: '#7DD9A0',
    successSoft: '#16301F',
    instagram: '#F06AB0',
    instagramSoft: '#3A1A2B',
    focus: '#8AB4F8',
  },
} as const;

export type ThemeColors = { [K in keyof (typeof palette)['light']]: string };

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 6, md: 12, lg: 16, xl: 28, pill: 999 } as const;

/** The smallest tap target on iOS (44pt) and Android (48dp) guidelines; interactive elements never go below this. */
export const MIN_TOUCH_TARGET = 48;
/** Height of a text field and of a primary button: a little taller than the minimum so a thumb lands on it easily. */
export const CONTROL_HEIGHT = 52;

export const typography = {
  display: { fontSize: 30, lineHeight: 36, fontWeight: '800' },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
  label: { fontSize: 14, lineHeight: 18, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
  /** The title of a panel inside a screen: between a label and a heading, so cards do not all shout. */
  subheading: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
  /** The one big number of a card. */
  metric: { fontSize: 32, lineHeight: 38, fontWeight: '700' },
} as const;
export type TypographyVariant = keyof typeof typography;
