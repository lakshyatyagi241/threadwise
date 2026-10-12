import { z } from 'zod';

/**
 * The platform settings (TW-SET), grouped the way an operator edits them: one page, one document, one
 * `rowVersion`. Reference stored ~150 loose string rows; here each group is a typed JSON document and
 * secrets live apart, write-only. Every field has a default, so a never-saved group still reads whole.
 */

const text = (max: number) => z.string().trim().max(max).default('');
/** http(s) only: these end up in public `href`/`src`/iframe attributes, where `javascript:` would run. */
const anyUrl = z.string().url();
const httpUrl = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      (u) => /^https?:\/\//i.test(u) && anyUrl.safeParse(u).success,
      'must be an http:// or https:// URL',
    );
const url = (max: number) => z.union([z.literal(''), httpUrl(max)]).default('');
/** An uploaded brand file (served by the API under /api/v2/public/brand/<slot>) or an external http(s) URL. */
export const BRAND_ASSET_PATH = /^\/api\/v2\/public\/brand\/[a-z0-9-]+(\?v=[a-f0-9]{8})?$/;
const assetUrl = (max: number) =>
  z
    .union([
      z.literal(''),
      z.string().max(max).regex(BRAND_ASSET_PATH, 'not a brand asset path'),
      httpUrl(max),
    ])
    .default('');
const email = (max: number) =>
  z.union([z.literal(''), z.string().trim().email().max(max)]).default('');
const flag = (on: boolean) => z.boolean().default(on);
const hex = z.union([z.literal(''), z.string().regex(/^#[0-9A-Fa-f]{3,8}$/)]).default('');
const hex6 = z.union([z.literal(''), z.string().regex(/^#[0-9A-Fa-f]{6}$/)]).default('');
/** Out-of-range numbers are clamped, never rejected: a crafted 0 must not be able to lock the console. */
const clamped = (min: number, max: number, dflt: number) =>
  z
    .preprocess(
      (v) =>
        typeof v === 'number' && Number.isFinite(v)
          ? Math.min(max, Math.max(min, Math.round(v)))
          : v,
      z.number().int().min(min).max(max),
    )
    .default(dflt);

/** True for an IANA zone name the runtime knows ("Asia/Kolkata", "UTC"). */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const FONT_FAMILIES = [
  'inter',
  'roboto',
  'open-sans',
  'poppins',
  'lato',
  'montserrat',
  'nunito',
  'work-sans',
  'dm-sans',
  'rubik',
  'manrope',
  'plus-jakarta',
] as const;

export const THEME_COLOR_TOKENS = [
  'wa-deep',
  'wa-teal',
  'wa-green',
  'wa-mint',
  'wa-bubble',
  'paper-0',
  'paper-50',
  'paper-100',
  'paper-200',
  'ink-500',
  'ink-700',
  'ink-900',
  'accent-coral',
  'accent-amber',
  'accent-plum',
  'accent-sky',
] as const;
export const BRAND_THEMES = ['paper', 'bright', 'dark', 'doodle'] as const;

const colorMap = z.object(
  Object.fromEntries(THEME_COLOR_TOKENS.map((t) => [t, hex])) as Record<
    (typeof THEME_COLOR_TOKENS)[number],
    typeof hex
  >,
);
const logoMap = z.object(
  Object.fromEntries(BRAND_THEMES.map((t) => [t, assetUrl(500)])) as Record<
    (typeof BRAND_THEMES)[number],
    ReturnType<typeof assetUrl>
  >,
);

// --- TW-SET-005, 006, 008, 012 ----------------------------------------------------------------
export const generalSettingsSchema = z.object({
  appName: z.string().trim().min(1).max(80).default('CRM Platform'),
  appUrl: url(191),
  supportEmail: email(160),
  fromEmail: email(160),
  contactNumber: text(40),
  address: text(500),
  mapIframeUrl: url(1000),
  /** Appended to outbound platform messages; empty means none (TW-SET-012). */
  platformFooter: text(60),
  maintenanceMode: flag(false),
  defaultTimezone: z
    .string()
    .trim()
    .max(64)
    .refine(isValidTimezone, 'unknown timezone')
    .default('UTC'),
  defaultLanguage: z.string().trim().min(2).max(12).default('en'),
  defaultCurrency: z.string().trim().toUpperCase().min(3).max(8).default('USD'),
  defaultCountryCode: z
    .string()
    .trim()
    .regex(/^\+\d{1,5}$/)
    .default('+91'),
  defaultCountryIso: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{2}$/)
    .default('in'),
  fontFamily: z.union([z.literal(''), z.enum(FONT_FAMILIES)]).default(''),
});

// --- TW-SET-010, 013, 014, 015 ----------------------------------------------------------------
export const brandingSettingsSchema = z.object({
  faviconUrl: assetUrl(500),
  logos: logoMap.default({}),
  colors: colorMap.default({}),
  fontScale: clamped(80, 130, 100),
  uiOpacity: clamped(55, 100, 100),
  dashboardLayout: z.enum(['topbar', 'sidebar']).default('topbar'),
  sidebarColor: hex6,
  sidebarTextColor: hex6,
  sidebarAccentColor: hex6,
});

// --- TW-SET-022, 023 --------------------------------------------------------------------------
export const siteSettingsSchema = z.object({
  companyName: text(255),
  tagline: text(255),
  foundedYear: text(8),
  address: text(255),
  cityCountry: text(255),
  emailGeneral: email(190),
  emailSupport: email(190),
  emailSales: email(190),
  emailSecurity: email(190),
  emailCareers: email(190),
  phone: text(255),
  whatsapp: text(255),
  socialX: url(255),
  socialLinkedin: url(255),
  socialInstagram: url(255),
  socialYoutube: url(255),
  socialFacebook: url(255),
  socialGithub: url(255),
  footerTitle: text(120),
  footerCopyright: text(300),
  footerDescription: text(500),
});

// --- TW-SET-024 -------------------------------------------------------------------------------
export const MAILERS = [
  'smtp',
  'sendmail',
  'log',
  'array',
  'mailgun',
  'ses',
  'postmark',
  'resend',
] as const;
export const mailSettingsSchema = z.object({
  mailer: z.enum(MAILERS).default('smtp'),
  host: text(200),
  port: z.number().int().min(1).max(65535).default(587),
  username: text(200),
  encryption: z.enum(['tls', 'ssl', 'starttls', '']).default('tls'),
  fromName: text(120),
  fromAddress: email(200),
});

// --- TW-SET-026 -------------------------------------------------------------------------------
export const seoSettingsSchema = z.object({
  metaTitle: text(160),
  metaDescription: text(320),
  metaKeywords: text(500),
  robots: z.string().trim().max(120).default('index, follow'),
  canonical: url(300),
  ogUrl: url(300),
  ogImage: url(500),
  author: text(120),
  ogTitle: text(160),
  ogDescription: text(320),
  ogType: z.enum(['website', 'article', 'product', 'profile']).default('website'),
  twitterCard: z
    .enum(['summary', 'summary_large_image', 'app', 'player'])
    .default('summary_large_image'),
  twitterSite: text(60),
  twitterCreator: text(60),
  googleVerification: text(200),
  bingVerification: text(200),
});

// --- TW-SET-029 (031 flags are stored only, as in Reference) -------------------------------------
export const privacySettingsSchema = z.object({
  cookieBannerEnabled: flag(true),
  cookieBannerStyle: z.enum(['modal', 'bottom-bar', 'top-bar']).default('bottom-bar'),
  cookieMessage: z
    .string()
    .trim()
    .max(1000)
    .default(
      'We use cookies to run this site and, with your consent, to understand how it is used.',
    ),
  policyUrl: url(300),
  termsUrl: url(300),
  cookiesPolicyUrl: url(300),
  respectDoNotTrack: flag(true),
  gdprCompliance: flag(true),
  ccpaCompliance: flag(true),
  adaSkipLink: flag(true),
  adaHighContrast: flag(false),
  adaLargeText: flag(false),
  adaReducedMotion: flag(false),
});

// --- TW-SET-032 -------------------------------------------------------------------------------
export const analyticsSettingsSchema = z.object({
  googleGa4: text(50),
  googleGtm: text(50),
  metaPixel: text(50),
  microsoftClarity: text(50),
  tiktokPixel: text(50),
  linkedinPartner: text(50),
  twitterPixel: text(50),
  plausibleDomain: text(120),
  posthogKey: text(120),
  mixpanelToken: text(120),
  posthogHost: z.union([z.literal(''), httpUrl(200)]).default('https://app.posthog.com'),
  hotjarSiteId: text(30),
});

// --- TW-SET-034 -------------------------------------------------------------------------------
export const customCodeSettingsSchema = z.object({
  enabled: flag(false),
  css: z.string().max(50_000).default(''),
  js: z.string().max(50_000).default(''),
});

// --- TW-SET-035 -------------------------------------------------------------------------------
export const pwaSettingsSchema = z.object({
  enabled: flag(false),
  installPrompt: flag(true),
  offlineEnabled: flag(true),
  appName: text(60),
  shortName: text(12),
  description: text(300),
  startUrl: z.string().trim().max(200).default('/'),
  scope: z.string().trim().max(200).default('/'),
  display: z.enum(['standalone', 'fullscreen', 'minimal-ui', 'browser']).default('standalone'),
  orientation: z
    .enum(['any', 'portrait', 'landscape', 'natural', 'portrait-primary', 'landscape-primary'])
    .default('portrait'),
  themeColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{3,8}$/)
    .default('#075E54'),
  backgroundColor: z
    .string()
    .regex(/^#[0-9A-Fa-f]{3,8}$/)
    .default('#FBFAF6'),
  icon192: assetUrl(500),
  icon512: assetUrl(500),
});

// --- TW-SET-039 -------------------------------------------------------------------------------
export const STORAGE_PROVIDERS = ['s3', 'wasabi', 'bunny', 'spaces', 'r2', 'minio'] as const;
export const storageSettingsSchema = z.object({
  enabled: flag(false),
  provider: z.enum(STORAGE_PROVIDERS).default('s3'),
  visibility: z.enum(['public', 'private']).default('private'),
  basePath: text(191),
  accessKeyId: text(191),
  region: text(64),
  bucket: text(191),
  endpoint: url(300),
  cdnUrl: url(300),
  pathStyle: flag(true),
  /** Bunny only: the storage zone name. */
  storageZone: text(191),
});

// --- TW-SET-038 (the VAPID key pair is generated, never typed: see the generate-keys endpoint) --
export const tiPwaSettingsSchema = z.object({
  enabled: flag(false),
  name: text(60),
  shortName: text(12),
  icon192: assetUrl(500),
  icon512: assetUrl(500),
});

// --- TW-WABA-001: the one Meta app (and Interakt partner) every workspace's WhatsApp numbers are onboarded through -------
export const WABA_PROVIDERS = ['interakt', 'meta'] as const;
const metaId = (max: number) =>
  z.union([z.literal(''), z.string().trim().regex(/^\d+$/).max(max)]).default('');
export const whatsappSettingsSchema = z.object({
  /** Meta app id (also sent to the browser for the Facebook SDK). */
  appId: metaId(64),
  /** Embedded Signup configuration id. Empty: workspaces paste a token manually. */
  configId: metaId(64),
  coexistence: flag(false),
  /** `vNN.N`; empty keeps the server default. */
  graphVersion: z
    .union([
      z.literal(''),
      z
        .string()
        .trim()
        .regex(/^v\d{1,2}\.\d{1,2}$/, 'must look like v25.0'),
    ])
    .default(''),
  /** Which route a newly connected number uses. */
  defaultProvider: z.enum(WABA_PROVIDERS).default('interakt'),
  /** Interakt's Embedded Signup solution id. */
  solutionId: metaId(64),
  /** Platform system user (assigned to each WABA) and the business used to find a WABA. */
  systemUserId: metaId(64),
  businessId: metaId(64),
  /** Require a valid body signature on every webhook POST, Interakt-forwarded ones included. */
  requireSignature: flag(false),
});

// --- TW-CAMP: how a campaign retries and when it ends on its own (Reference's campaign_* system settings) -----------------------
export const campaignsSettingsSchema = z.object({
  /** Tries per recipient before it is marked failed. */
  retryAttempts: clamped(0, 10, 3),
  /** Seconds between tries (it grows with each one). */
  retryBackoffSec: clamped(10, 3600, 60),
  /** A campaign nobody finished is ended after `defaultExpiryHours`. */
  autoExpiryEnabled: flag(true),
  defaultExpiryHours: clamped(1, 720, 24),
});

// --- TW-APPT-028: the one Google OAuth client every workspace connects its Calendar through (Reference: google_calendar_* system settings) --
export const googleCalendarSettingsSchema = z.object({
  /** The master switch (Reference's `google_calendar_enabled`). Off: no workspace can connect, and nothing is written to or read from a calendar. */
  enabled: flag(true),
  /** The OAuth 2.0 client id from Google Cloud (Web application). Empty: the `GOOGLE_CALENDAR_CLIENT_ID` environment value applies. */
  clientId: text(200),
  /** The redirect URI registered on that client. Empty: `<APP_URL>/v2/public/appointments/calendar/google/callback`. */
  redirectUri: url(300),
});

// --- The Email (Gmail) add-on: the Google OAuth client every workspace connects its mailboxes through. A SEPARATE client from Calendar, because
// the Gmail scopes are restricted and need Google's own verification (docs/threadwise-port/plan/channel-email-build.md decision 5) -------
export const googleMailSettingsSchema = z.object({
  /** The master switch. Off: no workspace can connect a mailbox, and no mailbox is read or sent from (what is stored is kept). */
  enabled: flag(true),
  /** The OAuth 2.0 client id from Google Cloud (Web application). Empty: the `GOOGLE_MAIL_CLIENT_ID` environment value applies. */
  clientId: text(200),
  /** The redirect URI registered on that client. Empty: `<APP_URL>/v2/public/email/google/callback`. */
  redirectUri: url(300),
});

// --- Flow builder: which builder(s) every workspace is offered (an addition beyond Reference) ---------------------------------------
export const FLB_BUILDER_MODES = ['simple', 'advanced'] as const;
export type FlbBuilderMode = (typeof FLB_BUILDER_MODES)[number];
export const flowBuilderSettingsSchema = z.object({
  /** The platform default for every workspace; a workspace can override it (workspace_settings.flow_builder_mode). `simple`: the step-by-step builder. `advanced`: the canvas builder. */
  mode: z.enum(FLB_BUILDER_MODES).default('advanced'),
});

export const SET_GROUP_SCHEMAS = {
  general: generalSettingsSchema,
  branding: brandingSettingsSchema,
  site: siteSettingsSchema,
  mail: mailSettingsSchema,
  seo: seoSettingsSchema,
  privacy: privacySettingsSchema,
  analytics: analyticsSettingsSchema,
  customCode: customCodeSettingsSchema,
  pwa: pwaSettingsSchema,
  storage: storageSettingsSchema,
  tiPwa: tiPwaSettingsSchema,
  whatsapp: whatsappSettingsSchema,
  campaigns: campaignsSettingsSchema,
  googleCalendar: googleCalendarSettingsSchema,
  googleMail: googleMailSettingsSchema,
  flowBuilder: flowBuilderSettingsSchema,
} as const;
export type SetGroup = keyof typeof SET_GROUP_SCHEMAS;
export const SET_GROUPS = Object.keys(SET_GROUP_SCHEMAS) as SetGroup[];
export const setGroupSchema = z.enum(SET_GROUPS as [SetGroup, ...SetGroup[]]);

/** Fields that are secrets: stored encrypted, never returned, written only through the patch. */
export const SET_SECRET_FIELDS = {
  general: [],
  branding: [],
  site: [],
  mail: ['password'],
  seo: [],
  privacy: [],
  analytics: [],
  customCode: [],
  pwa: [],
  storage: ['secret', 'storagePassword'],
  tiPwa: [],
  /** appSecret signs/verifies Meta calls; verifyToken is the webhook handshake token (blank: derived). */
  whatsapp: ['appSecret', 'verifyToken', 'partnerAuthKey', 'systemUserToken'],
  campaigns: [],
  /** The OAuth client secret: sent to Google when a code is exchanged or a token refreshed, never returned. */
  googleCalendar: ['clientSecret'],
  /** The Gmail OAuth client secret: sent to Google when a code is exchanged or a token refreshed, never returned. */
  googleMail: ['clientSecret'],
  flowBuilder: [],
} as const satisfies Record<SetGroup, readonly string[]>;

/** Groups whose saved state can be checked against the outside world (a "test" button). */
export const SET_TESTABLE_GROUPS = ['mail', 'storage'] as const satisfies readonly SetGroup[];
export type SetTestableGroup = (typeof SET_TESTABLE_GROUPS)[number];
export type SetGroupValues<G extends SetGroup> = z.infer<(typeof SET_GROUP_SCHEMAS)[G]>;
