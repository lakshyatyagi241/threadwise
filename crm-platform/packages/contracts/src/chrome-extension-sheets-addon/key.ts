import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * The member's personal Sheets key and the add-on setup page (TW-EXT-001 to 006). The key is what the add-on sends as a bearer token; the
 * member creates it here, in their own session, and sees the secret exactly once.
 */

/** Every key starts with this; the add-on and the guard use it to tell a Sheets key from anything else before a lookup. */
export const EXT_SHEETS_KEY_PREFIX = 'wsn_live_';
/** 32 lowercase hex characters after the prefix (128 bits). */
export const EXT_SHEETS_KEY_PATTERN = /^wsn_live_[0-9a-f]{32}$/;
/** The Marketplace listing this add-on is installed from (`marketplace_apps.slug`). */
export const EXT_SHEETS_APP_SLUG = 'google-sheets';
/** The permission key a role needs to use the add-on at all (see docs/specs/marketplace-extension-listings.md section 4a). */
export const EXT_SHEETS_USE_PERMISSION = 'app.google-sheets.use';

export const extSheetsKeyStatusSchema = z.object({
  active: z.boolean(),
  /** Last 8 characters of the secret, so the member can recognise which key is in the add-on. Null without a key. */
  suffix: z.string().nullable(),
  /** `wsn_live_••••••••<suffix>`, ready to print. Null without a key. */
  masked: z.string().nullable(),
  createdAt: z.string().datetime().nullable(),
  /** Null until the add-on first calls with it. Written at most once a minute. */
  lastUsedAt: z.string().datetime().nullable(),
});
export type ExtSheetsKeyStatus = z.infer<typeof extSheetsKeyStatusSchema>;

/** Answer to generate: the new status plus the secret, which is never returned again. A previous key stops working at once. */
export const extSheetsKeyIssuedSchema = extSheetsKeyStatusSchema.extend({
  key: z.string().regex(EXT_SHEETS_KEY_PATTERN),
  /** True when this replaced a key that was active. */
  rotated: z.boolean(),
});
export type ExtSheetsKeyIssued = z.infer<typeof extSheetsKeyIssuedSchema>;

/** Why the add-on cannot be used right now. `not_installed`: an admin has to install it from the Marketplace first. */
export const EXT_SHEETS_BLOCKERS = ['not_installed'] as const;
export type ExtSheetsBlocker = (typeof EXT_SHEETS_BLOCKERS)[number];

export const extSheetsFileSchema = z.object({
  name: z.string(),
  description: z.string(),
  /** False while the add-on source is not on the server; the download then answers 404. */
  available: z.boolean(),
  sizeBytes: z.number().int(),
  contentType: z.string(),
});
export type ExtSheetsFile = z.infer<typeof extSheetsFileSchema>;

export const extSheetsShopSchema = z.object({
  id: uuidSchema,
  shopName: z.string().nullable(),
  slug: z.string(),
  currency: z.string(),
  enabled: z.boolean(),
  themeKey: z.string(),
  customDomain: z.string().nullable(),
  publicUrl: z.string(),
  updatedAt: z.string().datetime(),
});
export type ExtSheetsShop = z.infer<typeof extSheetsShopSchema>;

export const extSheetsRecentProductSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  priceMajor: z.string(),
  currencyCode: z.string(),
  imageUrl: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type ExtSheetsRecentProduct = z.infer<typeof extSheetsRecentProductSchema>;

/** `GET /v2/extension/sheets/overview`: everything the setup page draws, in one call. */
export const extSheetsOverviewSchema = z.object({
  /** The add-on is installed and active in this workspace. */
  installed: z.boolean(),
  blockers: z.array(z.enum(EXT_SHEETS_BLOCKERS)),
  /** Where the add-on is listed in the Google Workspace Marketplace; the operator sets it on the listing. Null until set. */
  marketplaceUrl: z.string().url().nullable(),
  /** The address the add-on calls: the API origin, with no path. The served `Code.gs` has it filled in. */
  apiBase: z.string().url(),
  key: extSheetsKeyStatusSchema,
  /** What this member's role lets the key do, for the page to explain. */
  can: z.object({
    readContacts: z.boolean(),
    writeContacts: z.boolean(),
    readCatalog: z.boolean(),
    writeCatalog: z.boolean(),
  }),
  files: z.array(extSheetsFileSchema),
  /** Shops and recent products of the workspace; empty when the member's role cannot read the catalog. */
  shops: z.array(extSheetsShopSchema),
  productCount: z.number().int(),
  recentProducts: z.array(extSheetsRecentProductSchema),
});
export type ExtSheetsOverview = z.infer<typeof extSheetsOverviewSchema>;

/** The file names the add-on download serves; anything else is a 404. */
export const EXT_SHEETS_FILE_NAMES = [
  'Code.gs',
  'Dialog.html',
  'Settings.html',
  'Help.html',
  'appsscript.json',
  'README.md',
] as const;
export type ExtSheetsFileName = (typeof EXT_SHEETS_FILE_NAMES)[number];
