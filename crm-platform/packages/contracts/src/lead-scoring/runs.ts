import { z } from 'zod';

export const LSC_RUN_STATUSES = ['ok', 'kept', 'failed', 'skipped'] as const;
export type LscRunStatus = (typeof LSC_RUN_STATUSES)[number];
export const LSC_RUN_TRIGGERS = ['created', 'updated', 'manual', 'backfill', 'chat'] as const;
export type LscRunTrigger = (typeof LSC_RUN_TRIGGERS)[number];

export const lscRunsQuerySchema = z.object({
  /** Only the runs of one contact (its uuid). */
  contactId: z.string().uuid().optional(),
  status: z.enum(LSC_RUN_STATUSES).optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
export type LscRunsQuery = z.infer<typeof lscRunsQuerySchema>;

export interface LscRun {
  id: string;
  createdAt: string;
  contactId: string | null;
  contactName: string | null;
  status: LscRunStatus;
  trigger: LscRunTrigger;
  score: number | null;
  previousScore: number | null;
  reasons: string[];
  model: string | null;
  promptTokens: number;
  completionTokens: number;
  /** USD, decimal string with up to eight decimals. */
  costUsd: string;
  /** vendor = the figure OpenRouter reported; estimate = tokens x list price; none = no call was made. */
  costSource: 'vendor' | 'estimate' | 'none';
  billedAgainst: 'admin' | 'workspace' | 'none';
  durationMs: number | null;
  error: string | null;
}

export interface LscRunsResponse {
  data: LscRun[];
  page: { nextCursor: string | null; hasMore: boolean; limit: number };
}

/** A workspace operator row: the run plus the workspace it belongs to. */
export interface LscPlatformRun extends LscRun {
  workspaceId: string;
  workspaceName: string;
}

export interface LscPlatformRunsResponse {
  data: LscPlatformRun[];
  page: { nextCursor: string | null; hasMore: boolean; limit: number };
}
