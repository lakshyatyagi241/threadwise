import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Booking page appearance (BL-355..BL-358): how the customer's page (`/book/<workspace>/<service>`, and the manage page) looks.
 *
 * Three levels, most specific first: a service's own override, the workspace's booking page theme, the workspace brand kit (Settings,
 * Branding: three colours and a logo), then the product's look. Every appearance field is optional and null means "inherit".
 *
 * Nothing here can carry markup or a style rule: colours are `#RRGGBB`, fonts / corners / mode / background are fixed lists, text is
 * plain text, and a picture is an uploaded file the API itself serves (the page is told its id, never a URL to fetch).
 */

export const BOOKING_PAGE_FONTS = ['default', 'system', 'serif', 'rounded', 'humanist'] as const;
export const bookingPageFontSchema = z.enum(BOOKING_PAGE_FONTS);
export type BookingPageFont = z.infer<typeof bookingPageFontSchema>;

export const BOOKING_PAGE_CORNERS = ['square', 'rounded', 'pill'] as const;
export const bookingPageCornerSchema = z.enum(BOOKING_PAGE_CORNERS);
export type BookingPageCorner = z.infer<typeof bookingPageCornerSchema>;

/** `auto` follows the visitor's device setting. */
export const BOOKING_PAGE_MODES = ['light', 'dark', 'auto'] as const;
export const bookingPageModeSchema = z.enum(BOOKING_PAGE_MODES);
export type BookingPageMode = z.infer<typeof bookingPageModeSchema>;

/** solid: one colour; tint: a soft wash of the primary colour; image: the uploaded cover as a banner. */
export const BOOKING_PAGE_BACKGROUNDS = ['solid', 'tint', 'image'] as const;
export const bookingPageBackgroundSchema = z.enum(BOOKING_PAGE_BACKGROUNDS);
export type BookingPageBackground = z.infer<typeof bookingPageBackgroundSchema>;

export const BOOKING_PAGE_ASSET_SLOTS = ['logo', 'cover'] as const;
export const bookingPageAssetSlotSchema = z.enum(BOOKING_PAGE_ASSET_SLOTS);
export type BookingPageAssetSlot = z.infer<typeof bookingPageAssetSlotSchema>;

export const BOOKING_PAGE_LIMITS = {
  pageTitle: 120,
  welcomeText: 600,
  buttonLabel: 40,
  logoBytes: 1024 * 1024,
  coverBytes: 3 * 1024 * 1024,
} as const;

/** The image types an upload may have. SVG is refused on purpose: it can carry script, and the file is served to the public. */
export const BOOKING_PAGE_IMAGE_MIMES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
] as const;

/** `#RRGGBB`, stored lower case: the value ends up in a style attribute, so nothing else is accepted. */
export const bookingPageColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'Use a #RRGGBB colour.')
  .transform((v) => v.toLowerCase());

const colorOrNull = bookingPageColorSchema.nullish().transform((v) => v ?? null);

/** Plain text: trimmed, blank means "not set" (inherit). No markup is interpreted anywhere it is shown. */
const textOrNull = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

const optionOrNull = <T extends z.ZodTypeAny>(schema: T) =>
  schema.nullish().transform((v) => (v ?? null) as z.infer<T> | null);

/** A stored picture, as the page is told about it: an id and a version to build the address from (`.../assets/<org>/<id>?v=<v>`). */
export const bookingPageAssetRefSchema = z.object({
  /** The asset's uuid, or `brand-logo` for the workspace brand kit's logo. */
  id: z
    .string()
    .regex(/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|brand-logo)$/),
  /** Changes whenever the file does, so the address can be cached for a year. */
  v: z.string().regex(/^[0-9a-f]{8,64}$/),
});
export type BookingPageAssetRef = z.infer<typeof bookingPageAssetRefSchema>;

/** What the customer's page is drawn from: every level already resolved. Null colours mean the product's own. */
export const publicBookingThemeSchema = z.object({
  primaryColor: bookingPageColorSchema.nullable(),
  accentColor: bookingPageColorSchema.nullable(),
  backgroundColor: bookingPageColorSchema.nullable(),
  backgroundStyle: bookingPageBackgroundSchema,
  pageTitle: z.string().nullable(),
  welcomeText: z.string().nullable(),
  buttonLabel: z.string().nullable(),
  font: bookingPageFontSchema,
  cornerStyle: bookingPageCornerSchema,
  colorMode: bookingPageModeSchema,
  showPoweredBy: z.boolean(),
  showLanguageSwitch: z.boolean(),
  logo: bookingPageAssetRefSchema.nullable(),
  cover: bookingPageAssetRefSchema.nullable(),
});
export type PublicBookingTheme = z.infer<typeof publicBookingThemeSchema>;

/** The product's own look: what a workspace that never saved a theme (and set no brand colour) gets. */
export const DEFAULT_BOOKING_THEME: PublicBookingTheme = {
  primaryColor: null,
  accentColor: null,
  backgroundColor: null,
  backgroundStyle: 'solid',
  pageTitle: null,
  welcomeText: null,
  buttonLabel: null,
  font: 'default',
  cornerStyle: 'rounded',
  colorMode: 'auto',
  showPoweredBy: true,
  showLanguageSwitch: true,
  logo: null,
  cover: null,
};

// --- staff: the saved theme -------------------------------------------------------------------------------------------------

/** What is saved at one level; null means "inherit from the level above". */
export const bookingPageThemeSchema = z.object({
  primaryColor: bookingPageColorSchema.nullable(),
  accentColor: bookingPageColorSchema.nullable(),
  backgroundColor: bookingPageColorSchema.nullable(),
  backgroundStyle: bookingPageBackgroundSchema.nullable(),
  pageTitle: z.string().nullable(),
  welcomeText: z.string().nullable(),
  buttonLabel: z.string().nullable(),
  font: bookingPageFontSchema.nullable(),
  cornerStyle: bookingPageCornerSchema.nullable(),
  colorMode: bookingPageModeSchema.nullable(),
  showPoweredBy: z.boolean().nullable(),
  showLanguageSwitch: z.boolean().nullable(),
  /** Workspace level only: take a colour or logo that is not set here from Settings, Branding. */
  useWorkspaceBrand: z.boolean(),
  logo: bookingPageAssetRefSchema.nullable(),
  cover: bookingPageAssetRefSchema.nullable(),
  /** Null until the first save. */
  rowVersion: z.number().int().nullable(),
  updatedAt: z.string().datetime().nullable(),
});
export type BookingPageTheme = z.infer<typeof bookingPageThemeSchema>;

export const bookingPageSettingsResponseSchema = z.object({
  scope: z.enum(['workspace', 'type']),
  /** The workspace slug and, for a service, its slug: what the public addresses are built from. */
  workspaceSlug: z.string(),
  typeSlug: z.string().nullable(),
  theme: bookingPageThemeSchema,
  /** What a visitor sees now (saved theme resolved up the chain). */
  resolved: publicBookingThemeSchema,
  /** What is inherited when a field here is left empty (the level above, resolved). */
  inherited: publicBookingThemeSchema,
  /** The workspace brand kit's values, for "taken from Branding" hints. */
  brand: z.object({
    primary: bookingPageColorSchema.nullable(),
    accent: bookingPageColorSchema.nullable(),
    background: bookingPageColorSchema.nullable(),
    logo: bookingPageAssetRefSchema.nullable(),
  }),
  /** False on plans without white-label branding: the "Powered by" line stays on. */
  canRemovePoweredBy: z.boolean(),
  limits: z.object({
    pageTitle: z.number().int(),
    welcomeText: z.number().int(),
    buttonLabel: z.number().int(),
    logoBytes: z.number().int(),
    coverBytes: z.number().int(),
  }),
});
export type BookingPageSettingsResponse = z.infer<typeof bookingPageSettingsResponseSchema>;

// --- staff: saving ----------------------------------------------------------------------------------------------------------

/**
 * The whole workspace theme in one body (a save replaces what is stored; a field left out is cleared, i.e. inherits). `rowVersion` is
 * what the editor read (null when nothing was saved yet): a stale editor gets 409 ROW_VERSION_CONFLICT.
 */
export const updateBookingPageThemeSchema = z.object({
  primaryColor: colorOrNull,
  accentColor: colorOrNull,
  backgroundColor: colorOrNull,
  backgroundStyle: optionOrNull(bookingPageBackgroundSchema),
  pageTitle: textOrNull(BOOKING_PAGE_LIMITS.pageTitle),
  welcomeText: textOrNull(BOOKING_PAGE_LIMITS.welcomeText),
  buttonLabel: textOrNull(BOOKING_PAGE_LIMITS.buttonLabel),
  font: optionOrNull(bookingPageFontSchema),
  cornerStyle: optionOrNull(bookingPageCornerSchema),
  colorMode: optionOrNull(bookingPageModeSchema),
  showPoweredBy: optionOrNull(z.boolean()),
  showLanguageSwitch: optionOrNull(z.boolean()),
  useWorkspaceBrand: z.boolean().default(true),
  rowVersion: z.number().int().min(1).nullable(),
});
export type UpdateBookingPageThemeInput = z.infer<typeof updateBookingPageThemeSchema>;

/** A service overrides only these (logo and cover are uploaded separately). */
export const updateBookingTypePageThemeSchema = updateBookingPageThemeSchema.pick({
  primaryColor: true,
  accentColor: true,
  backgroundStyle: true,
  welcomeText: true,
  buttonLabel: true,
  rowVersion: true,
});
export type UpdateBookingTypePageThemeInput = z.infer<typeof updateBookingTypePageThemeSchema>;

export const bookingPageAssetResponseSchema = z.object({
  slot: bookingPageAssetSlotSchema,
  asset: bookingPageAssetRefSchema.nullable(),
});
export type BookingPageAssetResponse = z.infer<typeof bookingPageAssetResponseSchema>;

/** A service id is its uuid; re-exported here so the controller and the web read one name. */
export const bookingPageTypeIdSchema = uuidSchema;

// --- the address a picture is served from -----------------------------------------------------------------------------------

/** The path (under the web relay) of a picture: built from the workspace slug and an asset ref, never from stored text. */
export function bookingPageAssetPath(workspaceSlug: string, ref: BookingPageAssetRef): string {
  return `/api/public/appointments/assets/${encodeURIComponent(workspaceSlug)}/${ref.id}?v=${ref.v}`;
}

/** True for a path `bookingPageAssetPath` could have produced: the only kind of image address the booking page will load. */
export function isBookingPageAssetPath(value: string): boolean {
  return /^\/api\/public\/appointments\/assets\/[A-Za-z0-9_-]{1,64}\/(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|brand-logo)\?v=[0-9a-f]{8,64}$/.test(
    value,
  );
}
