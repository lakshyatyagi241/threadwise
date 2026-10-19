import {
  DEFAULT_BOOKING_THEME,
  type BookingPageAssetRef,
  type BookingPageTheme,
  type PublicBookingTheme,
} from '@crm/contracts';

/**
 * How the booking page's look is decided (BL-355..BL-358). Pure, so the rules are tested without a database.
 *
 * Most specific first: the service's own override, the workspace's booking page theme, the workspace brand kit (Settings, Branding:
 * three colours and a logo; only while the workspace theme says to use it), then the product's look. A field that is null at one
 * level is taken from the next. Two fields are never taken as they are:
 *   - a background of `image` with no cover to show is `solid` (a banner of nothing is a gap);
 *   - "Powered by" stays on for a plan without white-label branding, whatever was saved before the plan changed.
 */

/** The appearance fields that are plain values (not pictures) and so inherit one by one. */
const VALUE_FIELDS = [
  'primaryColor',
  'accentColor',
  'backgroundColor',
  'backgroundStyle',
  'pageTitle',
  'welcomeText',
  'buttonLabel',
  'font',
  'cornerStyle',
  'colorMode',
  'showPoweredBy',
  'showLanguageSwitch',
] as const;
type ValueField = (typeof VALUE_FIELDS)[number];

/** What one level stores. `useWorkspaceBrand` only means something on the workspace level. */
export type ThemeLayer = Pick<
  BookingPageTheme,
  ValueField | 'useWorkspaceBrand' | 'logo' | 'cover'
>;

export interface BrandKit {
  primary: string | null;
  accent: string | null;
  background: string | null;
  logo: BookingPageAssetRef | null;
}

export const EMPTY_BRAND: BrandKit = { primary: null, accent: null, background: null, logo: null };

const HEX = /^#[0-9a-fA-F]{6}$/;

/** A colour from the brand kit's stored JSON: only a clean `#RRGGBB` survives, anything else is "not set". */
export const brandColor = (value: unknown): string | null =>
  typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : null;

export const EMPTY_LAYER: ThemeLayer = {
  primaryColor: null,
  accentColor: null,
  backgroundColor: null,
  backgroundStyle: null,
  pageTitle: null,
  welcomeText: null,
  buttonLabel: null,
  font: null,
  cornerStyle: null,
  colorMode: null,
  showPoweredBy: null,
  showLanguageSwitch: null,
  useWorkspaceBrand: true,
  logo: null,
  cover: null,
};

export interface ResolveInput {
  /** The service's override, if it has one. */
  type?: ThemeLayer | null;
  /** The workspace's booking page theme, if it saved one. */
  workspace?: ThemeLayer | null;
  brand: BrandKit;
  /** The plan has white-label branding (`remove_branding`). */
  canRemovePoweredBy: boolean;
}

export function resolveTheme(input: ResolveInput): PublicBookingTheme {
  const type = input.type ?? null;
  const workspace = input.workspace ?? null;
  const useBrand = workspace?.useWorkspaceBrand ?? true;
  const brand = useBrand ? input.brand : EMPTY_BRAND;

  const pick = <K extends ValueField>(
    key: K,
    fromBrand: PublicBookingTheme[K],
  ): PublicBookingTheme[K] =>
    (type?.[key] ?? workspace?.[key] ?? fromBrand) as PublicBookingTheme[K];

  const cover = type?.cover ?? workspace?.cover ?? null;
  const backgroundStyle = pick('backgroundStyle', DEFAULT_BOOKING_THEME.backgroundStyle);

  return {
    primaryColor: pick('primaryColor', brand.primary),
    accentColor: pick('accentColor', brand.accent),
    backgroundColor: pick('backgroundColor', brand.background),
    backgroundStyle: backgroundStyle === 'image' && !cover ? 'solid' : backgroundStyle,
    pageTitle: pick('pageTitle', null),
    welcomeText: pick('welcomeText', null),
    buttonLabel: pick('buttonLabel', null),
    font: pick('font', DEFAULT_BOOKING_THEME.font),
    cornerStyle: pick('cornerStyle', DEFAULT_BOOKING_THEME.cornerStyle),
    colorMode: pick('colorMode', DEFAULT_BOOKING_THEME.colorMode),
    showPoweredBy: input.canRemovePoweredBy
      ? pick('showPoweredBy', DEFAULT_BOOKING_THEME.showPoweredBy)
      : true,
    showLanguageSwitch: pick('showLanguageSwitch', DEFAULT_BOOKING_THEME.showLanguageSwitch),
    logo: type?.logo ?? workspace?.logo ?? brand.logo,
    cover,
  };
}

/** A theme row as the service passes it around (the stored fields plus the pictures). */
export function layerOf(
  stored: Pick<BookingPageTheme, ValueField | 'useWorkspaceBrand'>,
  pictures: { logo: BookingPageAssetRef | null; cover: BookingPageAssetRef | null },
): ThemeLayer {
  const layer = { ...EMPTY_LAYER, useWorkspaceBrand: stored.useWorkspaceBrand, ...pictures };
  for (const key of VALUE_FIELDS) (layer as Record<string, unknown>)[key] = stored[key];
  return layer;
}

/**
 * The fields that differ between two saved themes, for the audit trail. Text is kept short (a welcome message is not a secret, but
 * the trail should stay small) and pictures are named by their slot, never by bytes.
 */
export function themeDelta(
  before: Partial<Record<ValueField | 'useWorkspaceBrand', unknown>> | null,
  after: Partial<Record<ValueField | 'useWorkspaceBrand', unknown>>,
): Record<string, { old: unknown; new: unknown }> {
  const delta: Record<string, { old: unknown; new: unknown }> = {};
  for (const key of [...VALUE_FIELDS, 'useWorkspaceBrand'] as const) {
    const was = before?.[key] ?? null;
    const now = after[key] ?? null;
    if (was !== now) delta[key] = { old: clip(was), new: clip(now) };
  }
  return delta;
}

const clip = (v: unknown): unknown =>
  typeof v === 'string' && v.length > 80 ? `${v.slice(0, 80)}...` : v;
