/**
 * Design tokens. A screen never writes a hex colour, a font size or a magic spacing number: it asks the theme. Brand colours
 * here are placeholders until the design handover (docs/mobile/handover.md); change them here and the whole app follows.
 */
export const palette = {
  light: {
    background: '#F7F8F6',
    surface: '#FFFFFF',
    surfaceMuted: '#EEF1EC',
    border: '#D5DBD2',
    text: '#14211B',
    textMuted: '#4F5E55',
    primary: '#0B6B4D',
    onPrimary: '#FFFFFF',
    danger: '#B3261E',
    onDanger: '#FFFFFF',
    focus: '#1A73E8',
  },
  dark: {
    background: '#0E1512',
    surface: '#16201B',
    surfaceMuted: '#1D2924',
    border: '#2E3B35',
    text: '#EAF0EC',
    textMuted: '#A3B3AA',
    primary: '#3DB88D',
    onPrimary: '#06241A',
    danger: '#F2B8B5',
    onDanger: '#410E0B',
    focus: '#8AB4F8',
  },
} as const;

export type ThemeColors = { [K in keyof (typeof palette)['light']]: string };

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;

/** The smallest tap target on iOS (44pt) and Android (48dp) guidelines; interactive elements never go below this. */
export const MIN_TOUCH_TARGET = 48;

export const typography = {
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
  label: { fontSize: 14, lineHeight: 18, fontWeight: '600' },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '400' },
} as const;
export type TypographyVariant = keyof typeof typography;
