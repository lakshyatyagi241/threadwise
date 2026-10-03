import { z } from 'zod';
import { cursorSchema, pageInfoSchema } from '../common/pagination';
import { uuidSchema } from '../common/ids';
import {
  connectorTypeSchema,
  marketAppKindSchema,
  marketHealthSchema,
  marketInstallStatusSchema,
  marketSlugSchema,
  marketVersionStatusSchema,
} from './enums';
import {
  marketDeveloperSchema,
  marketLinkSchema,
  marketPricingSchema,
  marketSupportSchema,
  marketSurfaceSchema,
} from './manifest';
import { recipeSetupViewSchema } from './recipe';
import { marketScopeSummarySchema } from './scopes';

/** The Marketplace as a workspace sees it: browse, search, categories, shelves and an app's page. Read with `market.apps.read`. */

/** An app is addressed by its uuid or its slug (both are public; the internal id never is). */
export const marketAppRefSchema = z.union([uuidSchema, marketSlugSchema]);

const text = (max: number) => z.string().trim().max(max);

// --- listing content (platform-owned, edited by the operator) ----------------------------------------------------------------------

export const marketListingSchema = z
  .object({
    /** The app's logo (an https image address). An integration without one falls back to the logo of its recipe. */
    logo: marketLinkSchema.nullable().default(null),
    /** The long description of the app page. Plain text; blank lines separate paragraphs. */
    longDescription: text(8000).default(''),
    highlights: z.array(text(120)).max(8).default([]),
    screenshots: z
      .array(z.object({ url: marketLinkSchema, caption: text(120).optional() }).strict())
      .max(8)
      .default([]),
    /** The data-processing disclosure of the app page (DPDP): what it stores, where, and how it is deleted. */
    dataProcessing: z
      .object({
        summary: text(1000).default(''),
        regions: z.array(text(40)).max(10).default([]),
        deletion: text(500).default(''),
      })
      .strict()
      .default({}),
  })
  .strict();
export type MarketListing = z.infer<typeof marketListingSchema>;

// --- categories --------------------------------------------------------------------------------------------------------------------

export const marketCategorySchema = z.object({
  id: uuidSchema,
  kind: marketAppKindSchema,
  slug: marketSlugSchema,
  name: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  sortOrder: z.number().int(),
  /** Published apps in it (a workspace sees published only). */
  appCount: z.number().int(),
});
export type MarketCategory = z.infer<typeof marketCategorySchema>;

export const marketCategoryListQuerySchema = z.object({ kind: marketAppKindSchema.optional() });
export type MarketCategoryListQuery = z.infer<typeof marketCategoryListQuerySchema>;
export const marketCategoryListSchema = z.object({ data: z.array(marketCategorySchema) });
export type MarketCategoryList = z.infer<typeof marketCategoryListSchema>;

// --- cards --------------------------------------------------------------------------------------------------------------------------

/** Why an app cannot be installed by this workspace right now. */
export const marketLockSchema = z.object({
  reason: z.enum(['plan_feature', 'module_disabled', 'limit_reached']),
  /** The plan feature key or the module slug the lock is about. */
  key: z.string().nullable(),
  upgradeUrl: z.string().nullable(),
});
export type MarketLock = z.infer<typeof marketLockSchema>;

export const marketInstallStateSchema = z.object({
  installationId: uuidSchema,
  status: marketInstallStatusSchema,
  health: marketHealthSchema,
  needsReconsent: z.boolean(),
});

export const marketAppCardSchema = z.object({
  id: uuidSchema,
  slug: marketSlugSchema,
  kind: marketAppKindSchema,
  category: z.object({ slug: marketSlugSchema, name: z.string() }),
  name: z.string(),
  tagline: z.string(),
  logo: z.string().nullable(),
  firstParty: z.boolean(),
  featured: z.boolean(),
  /** The published version a new install gets. */
  version: z.string(),
  pricing: marketPricingSchema,
  connectorType: connectorTypeSchema.nullable(),
  installCount: z.number().int(),
  publishedAt: z.string().datetime().nullable(),
  /** The workspace's installation of it, when there is one. */
  install: marketInstallStateSchema.nullable(),
  /** Set when the workspace cannot install it (plan, module, cap). A locked app still shows, with an upgrade prompt. */
  locked: marketLockSchema.nullable(),
});
export type MarketAppCard = z.infer<typeof marketAppCardSchema>;

export const MARKET_APP_SORTS = ['featured', 'popular', 'new', 'name'] as const;

export const marketAppListQuerySchema = z.object({
  kind: marketAppKindSchema.optional(),
  /** A category slug. */
  category: marketSlugSchema.optional(),
  q: z.string().trim().max(80).optional(),
  /** `true`: only what this workspace has installed. `false`: only what it has not. */
  installed: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  sort: z.enum(MARKET_APP_SORTS).default('featured'),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  cursor: cursorSchema.optional(),
});
export type MarketAppListQuery = z.infer<typeof marketAppListQuerySchema>;
export type MarketAppListQueryInput = z.input<typeof marketAppListQuerySchema>;

export const marketAppListSchema = z.object({
  data: z.array(marketAppCardSchema),
  page: pageInfoSchema,
});
export type MarketAppList = z.infer<typeof marketAppListSchema>;

export const marketShelvesQuerySchema = z.object({ kind: marketAppKindSchema });
export const marketShelvesSchema = z.object({
  popular: z.array(marketAppCardSchema),
  new: z.array(marketAppCardSchema),
  featured: z.array(marketAppCardSchema),
});
export type MarketShelves = z.infer<typeof marketShelvesSchema>;

// --- an app's page ----------------------------------------------------------------------------------------------------------------

export const marketChangelogEntrySchema = z.object({
  version: z.string(),
  notes: z.string(),
  publishedAt: z.string().datetime().nullable(),
});

export const marketAppDetailSchema = marketAppCardSchema.extend({
  description: z.string(),
  listing: marketListingSchema,
  scopes: z.array(marketScopeSummarySchema),
  surfaces: z.array(marketSurfaceSchema),
  support: marketSupportSchema,
  developer: marketDeveloperSchema.nullable(),
  changelog: z.array(marketChangelogEntrySchema),
  /** What an admin fills in to set it up (integrations): field list and instructions, never endpoints or secrets. */
  setup: recipeSetupViewSchema.nullable(),
});
export type MarketAppDetail = z.infer<typeof marketAppDetailSchema>;

// --- shared with the operator API ---------------------------------------------------------------------------------------------------

export const marketOperatorVersionSchema = z.object({
  id: uuidSchema,
  version: z.string(),
  status: marketVersionStatusSchema,
  changelog: z.string(),
  scopes: z.array(z.string()),
  reviewNote: z.string().nullable(),
  submittedAt: z.string().datetime().nullable(),
  reviewedAt: z.string().datetime().nullable(),
  publishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type MarketOperatorVersion = z.infer<typeof marketOperatorVersionSchema>;
