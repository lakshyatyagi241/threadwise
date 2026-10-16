import { z } from 'zod';
import { cursorSchema, pageInfoSchema } from '../common/pagination';
import { uuidSchema } from '../common/ids';
import {
  connectorTypeSchema,
  marketAppKindSchema,
  marketAppStatusSchema,
  marketRequestStatusSchema,
  marketSlugSchema,
  marketVersionStatusSchema,
} from './enums';
import { marketListingSchema, marketOperatorVersionSchema } from './catalogue';
import { marketManifestSchema, type MarketManifest } from './manifest';
import { marketPricingViewSchema } from './pricing';
import { recipeSchema, type MarketRecipe } from './recipe';

/**
 * The platform operator's side of the Marketplace (`/v2/platform/marketplace`): the catalogue (listings, versions, review, publish,
 * hide, kill), the categories, the requests report and usage per app. `platform.market.manage` edits and operates the catalogue;
 * `platform.market.review` approves, rejects and publishes versions. Either one reads.
 *
 * The manifest and the recipe go in whole and are validated whole: a version that does not follow manifest v1, or whose recipe
 * contradicts it or points at a refused address, is not saved.
 */

const text = (max: number, min = 0) => z.string().trim().min(min).max(max);

// --- categories --------------------------------------------------------------------------------------------------------------------

export const createMarketCategorySchema = z
  .object({
    kind: marketAppKindSchema,
    slug: marketSlugSchema,
    name: text(60, 2),
    description: text(300).optional(),
    icon: z
      .string()
      .regex(/^[a-z0-9-]{1,32}$/)
      .optional(),
    sortOrder: z.number().int().min(0).max(10_000).default(100),
  })
  .strict();
export type CreateMarketCategoryInput = z.infer<typeof createMarketCategorySchema>;

export const updateMarketCategorySchema = z
  .object({
    rowVersion: z.number().int().positive(),
    name: text(60, 2).optional(),
    description: text(300).nullable().optional(),
    icon: z
      .string()
      .regex(/^[a-z0-9-]{1,32}$/)
      .nullable()
      .optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
export type UpdateMarketCategoryInput = z.infer<typeof updateMarketCategorySchema>;

export const marketOperatorCategorySchema = z.object({
  id: uuidSchema,
  kind: marketAppKindSchema,
  slug: marketSlugSchema,
  name: z.string(),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
  /** Apps in the category in any status. */
  appCount: z.number().int(),
  rowVersion: z.number().int(),
});
export type MarketOperatorCategory = z.infer<typeof marketOperatorCategorySchema>;
export const marketOperatorCategoryListSchema = z.object({
  data: z.array(marketOperatorCategorySchema),
});
export type MarketOperatorCategoryList = z.infer<typeof marketOperatorCategoryListSchema>;

// --- listings ----------------------------------------------------------------------------------------------------------------------

export const marketOperatorAppListQuerySchema = z.object({
  status: marketAppStatusSchema.optional(),
  kind: marketAppKindSchema.optional(),
  /** `paid`: priced listings; `free`: the rest. */
  pricing: z.enum(['free', 'paid']).optional(),
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: cursorSchema.optional(),
});
export type MarketOperatorAppListQuery = z.infer<typeof marketOperatorAppListQuerySchema>;

export const marketOperatorAppSchema = z.object({
  id: uuidSchema,
  slug: marketSlugSchema,
  kind: marketAppKindSchema,
  category: z.object({ slug: marketSlugSchema, name: z.string() }),
  name: z.string(),
  tagline: z.string(),
  status: marketAppStatusSchema,
  firstParty: z.boolean(),
  featured: z.boolean(),
  /** The plan feature a workspace needs to install it (counting its billing add-ons), or null for every plan. */
  planFeature: z.string().nullable(),
  /** What the app costs: the operator's catalogue pricing, which is the authority (the manifest's `pricing` is only a proposal). */
  pricing: marketPricingViewSchema,
  /** Workspaces whose subscription to it is in force (paid, trial or comp, not ending or ended). */
  activeSubscriptions: z.number().int(),
  sortOrder: z.number().int(),
  connectorType: connectorTypeSchema.nullable(),
  /** The published version, or null when nothing is published. */
  publishedVersion: z.string().nullable(),
  latestVersion: z.string().nullable(),
  installCount: z.number().int(),
  killReason: z.string().nullable(),
  killedAt: z.string().datetime().nullable(),
  publishedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  rowVersion: z.number().int(),
});
export type MarketOperatorApp = z.infer<typeof marketOperatorAppSchema>;

export const marketOperatorAppListSchema = z.object({
  data: z.array(marketOperatorAppSchema),
  page: pageInfoSchema,
});
export type MarketOperatorAppList = z.infer<typeof marketOperatorAppListSchema>;

export const marketOperatorAppDetailSchema = marketOperatorAppSchema.extend({
  listing: marketListingSchema,
  versions: z.array(marketOperatorVersionSchema),
  /** The manifest and recipe of the version the operator is looking at (the latest unless `versionId` is asked for). */
  manifest: marketManifestSchema,
  recipe: recipeSchema.nullable(),
  versionId: uuidSchema,
  versionStatus: marketVersionStatusSchema,
});
export type MarketOperatorAppDetail = z.infer<typeof marketOperatorAppDetailSchema>;

export const marketOperatorAppDetailQuerySchema = z.object({ versionId: uuidSchema.optional() });

export const createMarketAppSchema = z
  .object({
    /** Manifest v1. The slug, name, kind and category of the listing come from it. */
    manifest: z.unknown(),
    /** Integrations: the connector recipe. */
    recipe: z.unknown().optional(),
    tagline: text(140, 5),
    listing: marketListingSchema.default({}),
    firstParty: z.boolean().default(false),
    featured: z.boolean().default(false),
    planFeature: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,63}$/)
      .nullable()
      .optional(),
    sortOrder: z.number().int().min(0).max(10_000).default(100),
    changelog: text(2000).default('First version.'),
  })
  .strict();
export type CreateMarketAppInput = z.infer<typeof createMarketAppSchema>;

export const updateMarketAppSchema = z
  .object({
    rowVersion: z.number().int().positive(),
    tagline: text(140, 5).optional(),
    listing: marketListingSchema.optional(),
    firstParty: z.boolean().optional(),
    featured: z.boolean().optional(),
    planFeature: z
      .string()
      .regex(/^[a-z][a-z0-9_]{0,63}$/)
      .nullable()
      .optional(),
    sortOrder: z.number().int().min(0).max(10_000).optional(),
  })
  .strict();
export type UpdateMarketAppInput = z.infer<typeof updateMarketAppSchema>;

export const saveMarketVersionSchema = z
  .object({
    manifest: z.unknown(),
    recipe: z.unknown().optional(),
    changelog: text(2000, 1),
  })
  .strict();
export type SaveMarketVersionInput = z.infer<typeof saveMarketVersionSchema>;

export const approveMarketVersionSchema = z.object({ note: text(500).optional() }).strict();
export type ApproveMarketVersionInput = z.infer<typeof approveMarketVersionSchema>;

export const rejectMarketVersionSchema = z.object({ note: text(500, 5) }).strict();
export type RejectMarketVersionInput = z.infer<typeof rejectMarketVersionSchema>;

/** Publishes an approved version (the latest approved one when `versionId` is absent). */
export const publishMarketAppSchema = z.object({ versionId: uuidSchema.optional() }).strict();
export type PublishMarketAppInput = z.infer<typeof publishMarketAppSchema>;

export const killMarketAppSchema = z.object({ reason: text(300, 5) }).strict();
export type KillMarketAppInput = z.infer<typeof killMarketAppSchema>;

export const marketKillResultSchema = z.object({
  app: marketOperatorAppSchema,
  /** Installations switched off by this call. */
  disabledInstallations: z.number().int(),
  /**
   * Card renewals of the app's subscribers ended at the payment provider (at the end of the period each paid for), and how many could NOT
   * be: those still charge until the operator ends them at the provider (the Subscriptions screen lists them as failed cancellations).
   */
  renewalsStopped: z.number().int(),
  renewalsNotStopped: z.number().int(),
});
export type MarketKillResult = z.infer<typeof marketKillResultSchema>;

export const marketPublishResultSchema = z.object({
  app: marketOperatorAppSchema,
  /** Installations moved to the new version at once (it asked for no new scopes). */
  upgraded: z.number().int(),
  /** Installations that keep the old version until their admin accepts the new permission list. */
  awaitingConsent: z.number().int(),
});
export type MarketPublishResult = z.infer<typeof marketPublishResultSchema>;

// --- requests report ------------------------------------------------------------------------------------------------------------------

export const marketOperatorRequestListQuerySchema = z.object({
  status: marketRequestStatusSchema.optional(),
  kind: marketAppKindSchema.optional(),
  q: z.string().trim().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: cursorSchema.optional(),
});
export type MarketOperatorRequestListQuery = z.infer<typeof marketOperatorRequestListQuerySchema>;

export const marketOperatorRequestSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  kind: marketAppKindSchema,
  categorySlug: z.string().nullable(),
  website: z.string().nullable(),
  status: marketRequestStatusSchema,
  voteCount: z.number().int(),
  /** Notes of the workspaces that asked, newest first (at most five). */
  notes: z.array(z.string()),
  firstWorkspace: z.object({ id: uuidSchema, name: z.string() }).nullable(),
  operatorNote: z.string().nullable(),
  createdAt: z.string().datetime(),
  rowVersion: z.number().int(),
});
export type MarketOperatorRequest = z.infer<typeof marketOperatorRequestSchema>;
export const marketOperatorRequestListSchema = z.object({
  data: z.array(marketOperatorRequestSchema),
  page: pageInfoSchema,
});
export type MarketOperatorRequestList = z.infer<typeof marketOperatorRequestListSchema>;

export const updateMarketRequestSchema = z
  .object({
    rowVersion: z.number().int().positive(),
    status: marketRequestStatusSchema.optional(),
    operatorNote: text(500).nullable().optional(),
  })
  .strict();
export type UpdateMarketRequestInput = z.infer<typeof updateMarketRequestSchema>;

// --- usage -----------------------------------------------------------------------------------------------------------------------------

const eventCountsSchema = z.object({
  accepted: z.number().int(),
  duplicate: z.number().int(),
  rejected: z.number().int(),
  failed: z.number().int(),
});

export const marketUsageRowSchema = z.object({
  appId: uuidSchema,
  slug: marketSlugSchema,
  name: z.string(),
  kind: marketAppKindSchema,
  status: marketAppStatusSchema,
  installs: z.object({
    active: z.number().int(),
    disabled: z.number().int(),
    killed: z.number().int(),
    total: z.number().int(),
  }),
  health: z.object({
    healthy: z.number().int(),
    degraded: z.number().int(),
    error: z.number().int(),
    needsReauth: z.number().int(),
    unknown: z.number().int(),
  }),
  events: z.object({ last24h: eventCountsSchema, last7d: eventCountsSchema }),
});
export type MarketUsageRow = z.infer<typeof marketUsageRowSchema>;
export const marketUsageSchema = z.object({ data: z.array(marketUsageRowSchema) });
export type MarketUsage = z.infer<typeof marketUsageSchema>;

/** A stored version's documents, parsed. Convenience for the API and the operator editor. */
export interface MarketVersionDocs {
  manifest: MarketManifest;
  recipe: MarketRecipe | null;
}
