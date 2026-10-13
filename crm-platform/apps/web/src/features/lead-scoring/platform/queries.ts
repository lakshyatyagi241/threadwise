import { z } from 'zod';
import type {
  LscCostTotals,
  LscPlatformConfig,
  LscPlatformOverview,
  LscPlatformRun,
  LscPlatformRunsResponse,
  LscPlatformWorkspacesResponse,
} from '@crm/contracts';
import { LSC_RUN_STATUSES, LSC_RUN_TRIGGERS } from '@crm/contracts';

export const OVERVIEW_KEY = ['operator', 'lead-scoring', 'overview'] as const;
export const WORKSPACES_KEY = ['operator', 'lead-scoring', 'workspaces'] as const;
export const WORKSPACE_OPTIONS_KEY = ['operator', 'lead-scoring', 'workspace-options'] as const;
export const RUNS_KEY = ['operator', 'lead-scoring', 'runs'] as const;

type Out<T> = z.ZodType<T, z.ZodTypeDef, unknown>;
const count = z.number().int().nonnegative();
/** USD amounts travel as decimal strings (eight decimals); a float would lose them. */
const usd = z.string().regex(/^-?\d+(\.\d+)?$/);

const configSchema = z.object({
  platformEnabled: z.boolean(),
  model: z.string(),
  scoresPerHour: count,
  retentionDays: count,
  models: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      inputPerMillion: z.number(),
      outputPerMillion: z.number(),
      note: z.string(),
    }),
  ),
}) satisfies Out<LscPlatformConfig>;

const totalsSchema = z.object({
  scores: count,
  failed: count,
  promptTokens: count,
  completionTokens: count,
  costUsd: usd,
  avgCostPerScoreUsd: usd.nullable(),
  platformCostUsd: usd,
}) satisfies Out<LscCostTotals>;

/**
 * The contracts package ships these response shapes as types only, so the web keeps the runtime check here. Each schema is
 * assigned to the contract type: a renamed or added field breaks the build instead of showing `undefined`.
 */
export const overviewSchema: Out<LscPlatformOverview> = z.object({
  config: configSchema,
  platformKeyReady: z.boolean(),
  workspacesEnabled: count,
  contactsScored: count,
  last24h: totalsSchema,
  last30d: totalsSchema,
});

export const workspacesSchema: Out<LscPlatformWorkspacesResponse> = z.object({
  data: z.array(
    z.object({
      workspaceId: z.string(),
      name: z.string(),
      enabled: z.boolean(),
      contactsScored: count,
      scores30d: count,
      costUsd30d: usd,
    }),
  ),
});

const runSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  contactId: z.string().nullable(),
  contactName: z.string().nullable(),
  status: z.enum(LSC_RUN_STATUSES),
  trigger: z.enum(LSC_RUN_TRIGGERS),
  score: z.number().nullable(),
  previousScore: z.number().nullable(),
  reasons: z.array(z.string()),
  model: z.string().nullable(),
  promptTokens: count,
  completionTokens: count,
  costUsd: usd,
  costSource: z.enum(['vendor', 'estimate', 'none']),
  billedAgainst: z.enum(['admin', 'workspace', 'none']),
  durationMs: count.nullable(),
  error: z.string().nullable(),
  workspaceId: z.string(),
  workspaceName: z.string(),
}) satisfies Out<LscPlatformRun>;

export const runsSchema: Out<LscPlatformRunsResponse> = z.object({
  data: z.array(runSchema),
  page: z.object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
    limit: count,
  }),
});

export const LIMIT_CHOICES = [10, 25, 50, 100] as const;
export const DEFAULT_LIMIT = 25;
export const RUNS_PAGE_SIZE = 25;
