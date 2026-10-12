import { z } from 'zod';
import type {
  FaqPlatformConfig,
  FaqPlatformOverview,
  FaqPlatformReindexResult,
  FaqPlatformWorkspacesResponse,
} from '@crm/contracts';

export const OVERVIEW_KEY = ['operator', 'faq', 'overview'] as const;
export const WORKSPACES_KEY = ['operator', 'faq', 'workspaces'] as const;

type Out<T> = z.ZodType<T, z.ZodTypeDef, unknown>;
const count = z.number().int().nonnegative();

const configSchema = z.object({
  engineEnabled: z.boolean(),
  embeddingModel: z.string(),
  generationModel: z.string(),
  defaultThreshold: z.number(),
  defaultThresholdCustom: z.boolean(),
  maxFaqs: count,
  maxVariationsPerFaq: count,
  semanticPerHour: count,
  verifyEnabled: z.boolean(),
  verifyModel: z.string(),
  verifyPerHour: count,
  allowedModels: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      dimensions: count,
      pricePerMillionTokens: z.number(),
      recommendedThreshold: z.number(),
      note: z.string(),
    }),
  ),
}) satisfies Out<FaqPlatformConfig>;

/**
 * The contracts package ships these response shapes as types only, so the web keeps the runtime check here. Each schema is
 * assigned to the contract type: a renamed or added field breaks the build instead of showing `undefined`.
 */
export const overviewSchema: Out<FaqPlatformOverview> = z.object({
  config: configSchema,
  platformKeyReady: z.boolean(),
  stats: z.object({
    workspacesEnabled: count,
    faqs: count,
    variations: count,
    ready: count,
    pending: count,
    failed: count,
    staleModel: count,
    matches30d: count,
    answered30d: count,
    embeddingTokens30d: count,
    verified30d: count,
    vetoed30d: count,
  }),
});

export const workspacesSchema: Out<FaqPlatformWorkspacesResponse> = z.object({
  data: z.array(
    z.object({
      workspaceId: z.string(),
      name: z.string(),
      enabled: z.boolean(),
      faqs: count,
      variations: count,
      pending: count,
      failed: count,
      matches30d: count,
      answered30d: count,
    }),
  ),
});

export const reindexSchema: Out<FaqPlatformReindexResult> = z.object({ queued: count });

export const LIMIT_CHOICES = [10, 25, 50, 100] as const;
export const DEFAULT_LIMIT = 25;
