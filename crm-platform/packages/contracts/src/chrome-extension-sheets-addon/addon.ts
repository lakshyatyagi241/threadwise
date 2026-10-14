import { z } from 'zod';
import { productCurrencySchema } from '../catalog-products/product';
import { STORE_THEME_KEYS } from '../storefront-builder/storefront';

/**
 * The add-on API (`/api/v1/sheets-addon`): what the Google Apps Script client sends and receives. Field names are snake_case and every
 * answer carries `ok`, as Reference's add-on does, so the client reads one way whichever server it talks to. Identifiers are uuids.
 */

/** The most rows one request may carry (Reference capped a product sync at 500; contacts follow the same figure). */
export const EXT_SHEETS_MAX_ROWS = 500;
/** The largest JSON body an add-on call may carry: 500 rows with long descriptions is well past the 100 KiB default. */
export const EXT_SHEETS_MAX_BODY_BYTES = 2 * 1024 * 1024;
/** The most contacts one pull returns. */
export const EXT_SHEETS_MAX_PULL = 500;

/** A sheet cell: blank means "not given", a number is read as its text (phone numbers arrive as numbers). */
const cell = (max: number) =>
  z.preprocess((v) => {
    if (v === null || v === undefined) return undefined;
    const text = typeof v === 'number' ? String(v) : v;
    return typeof text === 'string' && text.trim() === '' ? undefined : text;
  }, z.string().trim().max(max).optional());

const flag = z.preprocess((v) => {
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    if (['true', 'yes', 'y', '1'].includes(t)) return true;
    if (['false', 'no', 'n', '0'].includes(t)) return false;
    if (t === '') return undefined;
  }
  if (v === null) return undefined;
  return v;
}, z.boolean().optional());

// --- errors ---------------------------------------------------------------------------------------------------------------------------

/** Every failure of an add-on route: `ok` is false and `error` is the sentence to show the member. */
export const extSheetsErrorSchema = z.object({
  ok: z.literal(false),
  error: z.string(),
  code: z.string(),
  /** Field errors of a 422, keyed by the field the client sent (`rows`, `shop_name`). */
  details: z.record(z.array(z.string())).optional(),
  requestId: z.string().optional(),
});
export type ExtSheetsError = z.infer<typeof extSheetsErrorSchema>;

// --- health ---------------------------------------------------------------------------------------------------------------------------

export const extSheetsHealthSchema = z.object({
  ok: z.literal(true),
  user: z.object({ id: z.string().uuid(), name: z.string(), email: z.string() }),
  /** The workspace the key belongs to. */
  workspace: z.object({ id: z.string().uuid(), name: z.string() }),
  /** What this key may do right now: the member's role intersected with what the install consented to. */
  can: z.object({
    read_contacts: z.boolean(),
    write_contacts: z.boolean(),
    read_catalog: z.boolean(),
    write_catalog: z.boolean(),
  }),
  limits: z.object({ max_rows: z.number().int(), max_pull: z.number().int() }),
  api_version: z.literal(1),
  server_time: z.string().datetime(),
});
export type ExtSheetsHealth = z.infer<typeof extSheetsHealthSchema>;

// --- shops and products (the Reference behavior) -----------------------------------------------------------------------------------------

export const extSheetsShopOutSchema = z.object({
  id: z.string().uuid(),
  shop_name: z.string().nullable(),
  slug: z.string(),
  currency: z.string(),
  enabled: z.boolean(),
  theme_key: z.string(),
  custom_domain: z.string().nullable(),
  public_url: z.string(),
  /** Workspace-wide: products are not tied to one shop. */
  product_count: z.number().int(),
  updated_at: z.string().datetime(),
});
export type ExtSheetsShopOut = z.infer<typeof extSheetsShopOutSchema>;

export const extSheetsShopsResponseSchema = z.object({
  ok: z.literal(true),
  shops: z.array(extSheetsShopOutSchema),
  workspace: z.string().uuid(),
  product_count_total: z.number().int(),
});
export type ExtSheetsShopsResponse = z.infer<typeof extSheetsShopsResponseSchema>;

/** One product row of the sheet. It is read on its own, so a bad row is reported and the others still go through. */
export const extSheetsProductRowSchema = z.object({
  /** Echoed back in the result: the sheet row number or anything the client uses to find the row again. */
  ref: z.union([z.string().max(64), z.number().int()]).optional(),
  name: z.preprocess(
    (v) => (typeof v === 'number' ? String(v) : v),
    z.string().trim().min(1, 'The name is required').max(191),
  ),
  category: cell(96),
  description: cell(2000),
  image_url: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? undefined : (v ?? undefined)),
    z.string().trim().url('Enter a full web address').max(1024).optional(),
  ),
  price: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    z
      .union([z.number(), z.string().regex(/^\d+(\.\d+)?$/, 'Enter a number')])
      .pipe(
        z.coerce
          .number()
          .min(0, 'The price cannot be negative')
          .max(1_000_000, 'The price is at most 1000000'),
      ),
  ),
  sku: cell(96),
  /** A number sets the count, an empty cell or null means unlimited, and leaving the field out keeps what is stored (Reference). */
  stock: z.preprocess(
    (v) => (v === '' ? null : v),
    z
      .union([
        z.null(),
        z.coerce.number().int('Stock must be a whole number').min(0).max(1_000_000),
      ])
      .optional(),
  ),
  active: flag,
});
export type ExtSheetsProductRow = z.infer<typeof extSheetsProductRowSchema>;

/**
 * `POST /sync`. The shop part is validated as a whole (422, like Reference); the product rows are checked one by one inside the handler, so
 * `products` is accepted here as a list of anything, 1 to 500 long.
 */
export const extSheetsSyncRequestSchema = z.object({
  shop_id: z.string().uuid().nullish(),
  shop_name: z.string().trim().min(1, 'The shop name is required').max(191),
  description: z.string().trim().max(2000).nullish(),
  currency: z
    .string()
    .trim()
    .length(3, 'Use a three-letter currency code')
    .transform((v) => v.toUpperCase())
    .pipe(productCurrencySchema)
    .nullish(),
  theme_key: z.enum(STORE_THEME_KEYS).nullish(),
  products: z
    .array(z.unknown())
    .min(1, 'Send at least one product')
    .max(EXT_SHEETS_MAX_ROWS, `Send at most ${EXT_SHEETS_MAX_ROWS} products at a time`),
});
export type ExtSheetsSyncRequest = z.infer<typeof extSheetsSyncRequestSchema>;

export const EXT_SHEETS_ROW_STATUSES = ['created', 'updated', 'unchanged', 'failed'] as const;
export type ExtSheetsRowStatus = (typeof EXT_SHEETS_ROW_STATUSES)[number];

export const extSheetsRowErrorSchema = z.object({
  /** A stable code (`VALIDATION_FAILED`, `FORBIDDEN`, `PLAN_LIMIT_REACHED`, `CONFLICT`...). */
  code: z.string(),
  message: z.string(),
  /** The field the problem is about, when there is one (`price`, `email`). */
  field: z.string().optional(),
});

/** What happened to one row. `index` is the 0-based position in the request; `ref` is the client's own label when it sent one. */
export const extSheetsRowResultSchema = z.object({
  index: z.number().int(),
  ref: z.union([z.string(), z.number()]).optional(),
  status: z.enum(EXT_SHEETS_ROW_STATUSES),
  /** The product or contact that was written or matched. Absent on a failed row. */
  id: z.string().uuid().optional(),
  error: extSheetsRowErrorSchema.optional(),
});
export type ExtSheetsRowResult = z.infer<typeof extSheetsRowResultSchema>;

export const extSheetsRowSummarySchema = z.object({
  created: z.number().int(),
  updated: z.number().int(),
  unchanged: z.number().int(),
  failed: z.number().int(),
  /** Rows that were written: created + updated (Reference's `total`). */
  total: z.number().int(),
});
export type ExtSheetsRowSummary = z.infer<typeof extSheetsRowSummarySchema>;

export const extSheetsSyncResponseSchema = z.object({
  ok: z.literal(true),
  shop: z.object({
    id: z.string().uuid(),
    shop_name: z.string().nullable(),
    slug: z.string(),
    currency: z.string(),
    public_url: z.string(),
    /** True when this call made the shop. */
    created: z.boolean(),
  }),
  products: extSheetsRowSummarySchema.extend({ results: z.array(extSheetsRowResultSchema) }),
});
export type ExtSheetsSyncResponse = z.infer<typeof extSheetsSyncResponseSchema>;

// --- contacts (new in this port; Reference's add-on has no contacts) ---------------------------------------------------------------------

/** One contact as the add-on reads it. */
export const extSheetsContactOutSchema = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  source: z.string().nullable(),
  is_unsubscribed: z.boolean(),
  /** The workspace's custom contact properties, by key. */
  attributes: z.record(z.unknown()),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type ExtSheetsContactOut = z.infer<typeof extSheetsContactOutSchema>;

export const extSheetsContactsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(EXT_SHEETS_MAX_PULL).default(200),
  /** The `next_cursor` of the previous page. */
  cursor: z.string().min(1).max(512).optional(),
  /** Search over name, email and phone digits. */
  q: z.string().trim().min(1).max(200).optional(),
});
export type ExtSheetsContactsQuery = z.infer<typeof extSheetsContactsQuerySchema>;

export const extSheetsContactsResponseSchema = z.object({
  ok: z.literal(true),
  contacts: z.array(extSheetsContactOutSchema),
  next_cursor: z.string().nullable(),
  has_more: z.boolean(),
});
export type ExtSheetsContactsResponse = z.infer<typeof extSheetsContactsResponseSchema>;

/** One contact row of the sheet. Blank cells are "not given": they never clear a value that is already stored. */
export const extSheetsContactRowSchema = z.object({
  ref: z.union([z.string().max(64), z.number().int()]).optional(),
  name: cell(255),
  first_name: cell(255),
  last_name: cell(255),
  email: cell(254),
  phone: cell(32),
  /** Dial code for a phone written without one ("+91", "91"); overrides the request's default for this row. */
  country_code: cell(8),
  /** Defaults to `google_sheets`. */
  source: cell(128),
  is_unsubscribed: flag,
  attributes: z.record(z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
});
export type ExtSheetsContactRow = z.infer<typeof extSheetsContactRowSchema>;

export const extSheetsContactsSyncRequestSchema = z.object({
  /** Dial code applied to a phone that does not carry its own country code. */
  default_country_code: z
    .string()
    .trim()
    .max(8)
    .nullish()
    .transform((v) => (v ? v : undefined)),
  rows: z
    .array(z.unknown())
    .min(1, 'Send at least one row')
    .max(EXT_SHEETS_MAX_ROWS, `Send at most ${EXT_SHEETS_MAX_ROWS} rows at a time`),
});
export type ExtSheetsContactsSyncRequest = z.infer<typeof extSheetsContactsSyncRequestSchema>;

export const extSheetsContactsSyncResponseSchema = z.object({
  ok: z.literal(true),
  summary: extSheetsRowSummarySchema,
  results: z.array(extSheetsRowResultSchema),
});
export type ExtSheetsContactsSyncResponse = z.infer<typeof extSheetsContactsSyncResponseSchema>;

// --- webhook trigger (new in this port; the Pabbly-style "send new or changed rows" mode of the add-on) -----------------------------------

/** Why the add-on sent this call: a test from Initial Setup, a row typed in the sheet, or the hourly sweep for rows changed from elsewhere. */
export const EXT_SHEETS_WEBHOOK_EVENTS = ['test', 'edit', 'schedule'] as const;
export type ExtSheetsWebhookEvent = (typeof EXT_SHEETS_WEBHOOK_EVENTS)[number];

/** `POST /webhook` (and `POST /webhook/:key`). Rows are the contact row shape, plus the raw `values` by column heading for the test capture. */
export const extSheetsWebhookRequestSchema = z.object({
  event: z.enum(EXT_SHEETS_WEBHOOK_EVENTS),
  sheet_name: z.string().trim().max(255).optional(),
  default_country_code: z
    .string()
    .trim()
    .max(8)
    .nullish()
    .transform((v) => (v ? v : undefined)),
  rows: z
    .array(z.unknown())
    .min(1, 'Send at least one row')
    .max(EXT_SHEETS_MAX_ROWS, `Send at most ${EXT_SHEETS_MAX_ROWS} rows at a time`),
});
export type ExtSheetsWebhookRequest = z.infer<typeof extSheetsWebhookRequestSchema>;

/** What the last webhook call carried, kept for a day so the setup page can show the columns the sheet sends (the "capture" step). */
export const extSheetsCaptureSchema = z.object({
  receivedAt: z.string().datetime(),
  event: z.enum(EXT_SHEETS_WEBHOOK_EVENTS),
  sheetName: z.string().nullable(),
  rows: z.number().int(),
  /** Column headings of the first row, in sheet order. */
  fields: z.array(z.string()),
  /** The first row's raw values by heading, cut to short text. */
  sample: z.record(z.string()),
});
export type ExtSheetsCapture = z.infer<typeof extSheetsCaptureSchema>;

export const extSheetsWebhookResponseSchema = z.object({
  ok: z.literal(true),
  event: z.enum(EXT_SHEETS_WEBHOOK_EVENTS),
  /** Rows the call carried. */
  received: z.number().int(),
  /** A test only checks the connection and records the columns; no contact is written. */
  written: z.boolean(),
  summary: extSheetsRowSummarySchema.optional(),
  results: z.array(extSheetsRowResultSchema).optional(),
  fields: z.array(z.string()),
});
export type ExtSheetsWebhookResponse = z.infer<typeof extSheetsWebhookResponseSchema>;
