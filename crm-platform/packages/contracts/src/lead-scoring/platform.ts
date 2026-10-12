import { z } from 'zod';

/** The platform operator's control of AI lead scoring (super admins). Stored in platform_settings under `lead_scoring.config`. */

/**
 * Models offered in the picker, with the OpenRouter list price (USD per million tokens, checked against OpenRouter's public models
 * list: every one supports `response_format` and structured outputs, which the scorer relies on). Any other OpenRouter slug can be typed.
 * The default is the best scorer of the list at the lowest price tier: a 1M token context, structured output and reasoning at $0.10 in /
 * $0.50 out per million tokens, so scoring one contact costs a fraction of a cent.
 */
export const LSC_MODELS = [
  {
    id: 'openai/gpt-6-luna-pro',
    label: 'OpenAI GPT-6 Luna Pro',
    inputPerMillion: 0.1,
    outputPerMillion: 0.5,
    note: 'Best quality at the lowest price tier. The default.',
  },
  {
    id: 'openai/gpt-6-luna',
    label: 'OpenAI GPT-6 Luna',
    inputPerMillion: 0.1,
    outputPerMillion: 0.5,
    note: 'Same price tier, lighter reasoning.',
  },
  {
    id: 'inception/mercury-2.5',
    label: 'Inception Mercury 2.5',
    inputPerMillion: 0.04,
    outputPerMillion: 0.15,
    note: 'Cheapest and fastest; fine for plain contact data.',
  },
  {
    id: 'upstage/solar-pro4',
    label: 'Upstage Solar Pro 4',
    inputPerMillion: 0.09,
    outputPerMillion: 0.36,
    note: 'A cheap alternative from another vendor.',
  },
] as const;
export const LSC_DEFAULT_MODEL = 'openai/gpt-6-luna-pro';

export const LSC_PLATFORM_DEFAULTS = {
  /** Off until the operator turns it on: nothing is sent to a vendor by surprise. */
  platformEnabled: false,
  model: LSC_DEFAULT_MODEL,
  /** Scores one workspace may request an hour on the platform's key (a cost guard); 0 = no limit. */
  scoresPerHour: 300,
  /** Days the scoring log (and the cost history) is kept. */
  retentionDays: 90,
} as const;

const modelSlug = z
  .string()
  .trim()
  .min(3)
  .max(120)
  .regex(/^[A-Za-z0-9._:~/-]+$/, 'Use an OpenRouter model id such as openai/gpt-6-luna.');

export const updateLscPlatformConfigSchema = z
  .object({
    platformEnabled: z.boolean(),
    model: modelSlug,
    scoresPerHour: z.number().int().min(0).max(100_000),
    retentionDays: z.number().int().min(7).max(730),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to change.' });
export type UpdateLscPlatformConfigInput = z.infer<typeof updateLscPlatformConfigSchema>;

export const lscPlatformRunsQuerySchema = z.object({
  /** Narrow to one workspace (its uuid). */
  workspaceId: z.string().uuid().optional(),
  status: z.enum(['ok', 'kept', 'failed', 'skipped']).optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type LscPlatformRunsQuery = z.infer<typeof lscPlatformRunsQuerySchema>;

export const lscPlatformWorkspacesQuerySchema = z.object({
  search: z.string().trim().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type LscPlatformWorkspacesQuery = z.infer<typeof lscPlatformWorkspacesQuerySchema>;

export interface LscPlatformConfig {
  platformEnabled: boolean;
  model: string;
  scoresPerHour: number;
  retentionDays: number;
  models: ReadonlyArray<{
    id: string;
    label: string;
    inputPerMillion: number;
    outputPerMillion: number;
    note: string;
  }>;
}

/** What scoring cost over a window; every number comes from lead_scoring_runs. */
export interface LscCostTotals {
  scores: number;
  failed: number;
  promptTokens: number;
  completionTokens: number;
  /** USD, as a decimal string (the ledger holds eight decimals; a float would lose them). */
  costUsd: string;
  /** costUsd / scores that wrote a score; null when there are none. */
  avgCostPerScoreUsd: string | null;
  /** The part of costUsd billed against the platform's key (the operator pays it). */
  platformCostUsd: string;
}

export interface LscPlatformOverview {
  config: LscPlatformConfig;
  /** Is a platform OpenRouter key saved and active (the fallback every workspace without its own key uses). */
  platformKeyReady: boolean;
  workspacesEnabled: number;
  contactsScored: number;
  last24h: LscCostTotals;
  last30d: LscCostTotals;
}

export interface LscPlatformWorkspace {
  workspaceId: string;
  name: string;
  enabled: boolean;
  contactsScored: number;
  scores30d: number;
  costUsd30d: string;
}

export interface LscPlatformWorkspacesResponse {
  data: LscPlatformWorkspace[];
}
