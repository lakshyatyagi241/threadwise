/**
 * Design tokens. A screen never writes a hex colour, a font size or a magic spacing number: it asks the theme. Brand colours
 * here are placeholders until the design handover (docs/mobile/handover.md); change them here and the whole app follows.
 *
 * Reading guide: `placeholder` is the hint text inside an empty field: lighter than `textMuted` so it never reads as typed text, still 4.5:1 on a field's surface; `border` is for dividers, `borderStrong` for the edge of a control (a field, a checkbox: 3:1 against the page, as
 * WCAG asks of anything a person must find to use), `logo` is the blue of the Geta logo (sampled from the app icon) and `onLogo` what is drawn on it, used by the tab bar, `brand*` colours are the deep band behind the logo on the sign-in and sign-up screens, `*Soft` colours are the
 * quiet backgrounds of banners, badges and selected rows (always paired with the strong colour of the same name for the text on them),
 * `success` is a change for the better, a connected thing or a finished job, `instagram` and `whatsapp` are those channels' accents, `chartSent` and `chartDelivered` are two blues far enough apart in lightness to tell apart side by side (3:1 against the card).
 */
export const palette = {
  light: {
    background: '#F6F8FC',
    surface: '#FFFFFF',
    surfaceMuted: '#ECF0F8',
    border: '#D3DAE8',
    borderStrong: '#76839C',
    shadow: '#0A1F44',
    text: '#121B2E',
    textMuted: '#4B5872',
    placeholder: '#66738C',
    primary: '#1A56DB',
    onPrimary: '#FFFFFF',
    primarySoft: '#E3ECFC',
    logo: '#0916C3',
    onLogo: '#FFFFFF',
    brand: '#0B2A5C',
    onBrand: '#FFFFFF',
    onBrandMuted: '#C2D3F0',
    brandAccent: '#8DB8FF',
    danger: '#B3261E',
    onDanger: '#FFFFFF',
    dangerSoft: '#FCEBE9',
    warning: '#8A5300',
    warningSoft: '#FFF3DC',
    success: '#1B7A43',
    successSoft: '#E4F4EA',
    instagram: '#A82A74',
    instagramSoft: '#FBE8F2',
    whatsapp: '#1FA855',
    chartSent: '#1A56DB',
    chartDelivered: '#5B93F0',
    focus: '#1A73E8',
    scrim: 'rgba(0, 0, 0, 0.4)',
  },
  dark: {
    background: '#0C1220',
    surface: '#151D2E',
    surfaceMuted: '#1D2740',
    border: '#2B3750',
    borderStrong: '#5D6F8F',
    shadow: '#000000',
    text: '#E8EEF8',
    textMuted: '#A3B1C9',
    placeholder: '#8E9CB6',
    primary: '#6C9CFF',
    onPrimary: '#06173A',
    primarySoft: '#16264A',
    logo: '#0916C3',
    onLogo: '#FFFFFF',
    brand: '#0A1F44',
    onBrand: '#E8EEF8',
    onBrandMuted: '#A9BEE0',
    brandAccent: '#7FA9FF',
    danger: '#F2B8B5',
    onDanger: '#410E0B',
    dangerSoft: '#3A1917',
    warning: '#F5C26B',
    warningSoft: '#3A2D12',
    success: '#7DD9A0',
    successSoft: '#16301F',
    instagram: '#F06AB0',
    instagramSoft: '#3A1A2B',
    whatsapp: '#4CD98A',
    chartSent: '#6C9CFF',
    chartDelivered: '#B5D0FF',
    focus: '#8AB4F8',
    scrim: 'rgba(0, 0, 0, 0.6)',
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
  /** A small line above a group of things: upper case and spaced out in English (see `Text`). */
  overline: { fontSize: 12, lineHeight: 16, fontWeight: '600' },
  /** The one big number of a card. */
  metric: { fontSize: 32, lineHeight: 38, fontWeight: '700' },
} as const;
export type TypographyVariant = keyof typeof typography;

/**
 * Colours a person can give a label (Settings, Labels). They are data the person chooses, not the app's look: the same swatch on a light
 * or a dark screen. The first is the default, the web's own (WhatsApp green).
 */
export const LABEL_COLORS: readonly string[] = [
  '#075E54',
  '#1B7F4B',
  '#2563EB',
  '#7C3AED',
  '#DB2777',
  '#DC2626',
  '#EA580C',
  '#CA8A04',
  '#0891B2',
  '#475569',
];
export const DEFAULT_LABEL_COLOR: string = LABEL_COLORS[0]!;

/** The six colours a team can be given (the web's team colour picker, first one is the default); the chip colour in the inbox queue. */
export const TEAM_COLORS: readonly string[] = [
  '#075E54',
  '#13478A',
  '#5B3D8A',
  '#7B5A14',
  '#A1431F',
  '#0C7A65',
];
