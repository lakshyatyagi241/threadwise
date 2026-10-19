import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { productResponseSchema } from './product';

/**
 * The Meta commerce catalog of a workspace (TW-CAT-001..016): the connection, its sync with the product list, the messages sent
 * from it and the automation keys. The access token is encrypted at rest and never leaves the API.
 */

export const CATALOG_PROVIDERS = ['meta_cloud', 'dialog_360'] as const;
export const catalogProviderSchema = z.enum(CATALOG_PROVIDERS);
export type CatalogProvider = z.infer<typeof catalogProviderSchema>;

/** One chunk of a sync is one Meta batch call; the screen calls again while `hasMore`. */
export const CATALOG_SYNC_CHUNK = 1000;
export const CATALOG_SEND_MAX_RECIPIENTS = 500;
export const CATALOG_SEND_MAX_PRODUCTS = 30;

export const catalogAutomationSchema = z.object({
  orderAckEnabled: z.boolean(),
  orderAckPayUrl: z.string().nullable(),
  conciergeEnabled: z.boolean(),
  conciergeHeader: z.string().nullable(),
  conciergeMax: z.number().int(),
  conciergeReplyOnEmpty: z.boolean(),
  conciergeEmptyText: z.string().nullable(),
});
export type CatalogAutomation = z.infer<typeof catalogAutomationSchema>;

export const catalogSummarySchema = z.object({
  id: uuidSchema,
  provider: catalogProviderSchema,
  catalogId: z.string(),
  catalogName: z.string().nullable(),
  wabaId: z.string().nullable(),
  phoneNumberId: z.string().nullable(),
  isCartEnabled: z.boolean(),
  isCatalogVisible: z.boolean(),
  lastSyncedAt: z.string().datetime().nullable(),
  automation: catalogAutomationSchema,
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
});
export type CatalogSummary = z.infer<typeof catalogSummarySchema>;

export const catalogHealthSampleSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  sku: z.string().nullable(),
  imageUrl: z.string().nullable(),
  priceMinor: z.number().int(),
  metaSyncStatus: z.string().nullable(),
});

/** Share of rows that can sell as they are; a row without an image or a price, or whose last push errored, cannot. */
export const catalogHealthSchema = z.object({
  score: z.number().int().nullable(),
  total: z.number().int(),
  noImage: z.number().int(),
  noPrice: z.number().int(),
  errored: z.number().int(),
  flagged: z.number().int(),
  samples: z.array(catalogHealthSampleSchema),
});
export type CatalogHealth = z.infer<typeof catalogHealthSchema>;

export const catalogSenderSchema = z.object({
  /** `<engine>:<uuid>`: what the send form posts back. */
  key: z.string(),
  engine: z.string(),
  label: z.string(),
  phone: z.string().nullable(),
});
export type CatalogSender = z.infer<typeof catalogSenderSchema>;

export const catalogShopSchema = z.object({
  id: uuidSchema,
  shopName: z.string().nullable(),
  slug: z.string(),
});
export type CatalogShop = z.infer<typeof catalogShopSchema>;

export const catalogSendActivitySchema = z.object({
  id: uuidSchema,
  recipient: z.string(),
  mode: z.enum(['spm', 'mpm', 'link']),
  body: z.string().nullable(),
  header: z.string().nullable(),
  productCount: z.number().int(),
  productNames: z.array(z.string()),
  status: z.enum(['sent', 'failed']),
  error: z.string().nullable(),
  sentBy: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type CatalogSendActivity = z.infer<typeof catalogSendActivitySchema>;

/** The Setup tab in one read. */
export const catalogOverviewSchema = z.object({
  catalog: catalogSummarySchema.nullable(),
  shops: z.array(catalogShopSchema),
  /** Counts by sync state; products never pushed are under `unsynced`. */
  statusBuckets: z.record(z.number().int()),
  totalProducts: z.number().int(),
  /** The 50 most recently changed. */
  products: z.array(productResponseSchema),
  health: catalogHealthSchema,
  recentSends: z.array(catalogSendActivitySchema),
  senders: z.array(catalogSenderSchema),
  /** A connected sender exists: the Send tab works. */
  hasSender: z.boolean(),
  sets: z.number().int(),
});
export type CatalogOverview = z.infer<typeof catalogOverviewSchema>;

export const connectCatalogSchema = z.object({
  provider: catalogProviderSchema,
  catalogId: z.string().trim().min(1).max(64),
  catalogName: z.string().trim().max(191).nullish(),
  wabaId: z.string().trim().max(64).nullish(),
  phoneNumberId: z.string().trim().max(64).nullish(),
  accessToken: z.string().trim().min(20).max(4096),
});
export type ConnectCatalogInput = z.infer<typeof connectCatalogSchema>;

/** Create a new catalog on Meta from here and link it to the connected WABA (needs the WABA's business id). */
export const createCatalogSchema = z.object({
  name: z.string().trim().min(1).max(191),
  /** The code of Meta's catalog login popup; exchanged for the token that is allowed to create the catalog. */
  loginCode: z.string().trim().min(1).max(2048).optional(),
});
export type CreateCatalogInput = z.infer<typeof createCatalogSchema>;

/** What the browser needs to open the catalog login popup. The app secret is never here. */
export const catalogLoginConfigSchema = z.object({
  ready: z.boolean(),
  appId: z.string().nullable(),
  configId: z.string().nullable(),
  graphVersion: z.string(),
});
export type CatalogLoginConfig = z.infer<typeof catalogLoginConfigSchema>;

export const renameCatalogSchema = createCatalogSchema.pick({ name: true });
export type RenameCatalogInput = z.infer<typeof renameCatalogSchema>;

/** Deletes the catalog on Meta; `confirmCatalogId` must equal the connected catalog id. */
export const deleteRemoteCatalogSchema = z.object({
  confirmCatalogId: z.string().trim().min(1).max(64),
});
export type DeleteRemoteCatalogInput = z.infer<typeof deleteRemoteCatalogSchema>;

export const commerceSettingsSchema = z.object({
  isCatalogVisible: z.boolean().default(false),
  isCartEnabled: z.boolean().default(false),
});
export type CommerceSettingsInput = z.infer<typeof commerceSettingsSchema>;

export const saveAutomationSchema = z.object({
  orderAckEnabled: z.boolean().default(false),
  orderAckPayUrl: z.string().trim().url().max(500).nullish(),
  conciergeEnabled: z.boolean().default(false),
  conciergeHeader: z.string().trim().max(60).nullish(),
  conciergeMax: z.number().int().min(1).max(30).default(10),
  conciergeReplyOnEmpty: z.boolean().default(false),
  conciergeEmptyText: z.string().trim().max(1024).nullish(),
});
export type SaveAutomationInput = z.infer<typeof saveAutomationSchema>;

/** Push these products (at most one chunk); without ids, the active products never pushed or failed. */
export const syncProductsSchema = z.object({
  productIds: z.array(uuidSchema).max(CATALOG_SYNC_CHUNK).optional(),
});
export type SyncProductsInput = z.infer<typeof syncProductsSchema>;

export const syncProductsResponseSchema = z.object({
  pushed: z.number().int(),
  hasMore: z.boolean(),
  totalPending: z.number().int(),
  totalSynced: z.number().int(),
  totalFailed: z.number().int(),
});
export type SyncProductsResponse = z.infer<typeof syncProductsResponseSchema>;

export const pollBatchesResponseSchema = z.object({
  pending: z.number().int(),
  synced: z.number().int(),
  failed: z.number().int(),
});
export type PollBatchesResponse = z.infer<typeof pollBatchesResponseSchema>;

export const importFromMetaResponseSchema = z.object({
  imported: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
  total: z.number().int(),
});
export type ImportFromMetaResponse = z.infer<typeof importFromMetaResponseSchema>;

export const CATALOG_SEND_MODES = ['spm', 'mpm', 'link'] as const;
export const catalogSendModeSchema = z.enum(CATALOG_SEND_MODES);
export type CatalogSendMode = z.infer<typeof catalogSendModeSchema>;

/** The Send tab form. At least one recipient source must yield a number (checked by the API). */
export const sendCatalogSchema = z.object({
  manualNumbers: z.string().max(65535).optional(),
  groupIds: z.array(uuidSchema).max(200).default([]),
  contactIds: z.array(uuidSchema).max(CATALOG_SEND_MAX_RECIPIENTS).default([]),
  /** `<engine>:<uuid>` from the sender list. */
  sender: z.string().max(64).optional(),
  shopId: uuidSchema.optional(),
  mode: catalogSendModeSchema,
  body: z.string().max(1024).nullish(),
  header: z.string().max(60).nullish(),
  footer: z.string().max(60).nullish(),
  productIds: z.array(uuidSchema).max(CATALOG_SEND_MAX_PRODUCTS).default([]),
});
export type SendCatalogInput = z.infer<typeof sendCatalogSchema>;

export const sendCatalogResponseSchema = z.object({
  /** At least one message went out. */
  ok: z.boolean(),
  sent: z.number().int(),
  failed: z.number().int(),
  total: z.number().int(),
  /** The first 10 failures as "<number>: <reason>". */
  errors: z.array(z.string()),
});
export type SendCatalogResponse = z.infer<typeof sendCatalogResponseSchema>;

export const catalogAudienceGroupSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  count: z.number().int(),
});
export const catalogAudienceContactSchema = z.object({
  id: uuidSchema,
  name: z.string().nullable(),
  mobile: z.string().nullable(),
});

/**
 * `q` narrows the contact picker by name or number. Reference shipped every contact to the browser; the picker lists the 500 newest
 * (or the 500 newest matches), and groups reach everyone else.
 */
export const catalogSendOptionsQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
});
export type CatalogSendOptionsQuery = z.infer<typeof catalogSendOptionsQuerySchema>;

/** What the Send tab needs to draw its pickers. */
export const catalogSendOptionsSchema = z.object({
  senders: z.array(catalogSenderSchema),
  shops: z.array(catalogShopSchema),
  groups: z.array(catalogAudienceGroupSchema),
  contacts: z.array(catalogAudienceContactSchema),
  recentSends: z.array(catalogSendActivitySchema),
  totalProducts: z.number().int(),
  connected: z.boolean(),
});
export type CatalogSendOptions = z.infer<typeof catalogSendOptionsSchema>;

export const catalogActivityQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export type CatalogActivityQuery = z.infer<typeof catalogActivityQuerySchema>;
export const catalogActivityResponseSchema = z.object({
  data: z.array(catalogSendActivitySchema),
});
export type CatalogActivityResponse = z.infer<typeof catalogActivityResponseSchema>;
