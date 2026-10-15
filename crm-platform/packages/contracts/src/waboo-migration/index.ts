/**
 * waboo-migration (WMIG): the platform operator's panel that runs the existing Waboo -> WaDesk migration pipeline and shows its
 * progress and report. Not a WaDesk feature. No secret ever travels here: the pipeline reads its own credentials from its environment.
 * The operator names the Waboo ORGANIZATION (workspace) id, which is the Waboo database name; the client key is derived from it.
 */
import { z } from 'zod';
import { uuidSchema } from '../common/ids';

export * from './errors';
export * from './runner';
export * from './constants';
import { WMIG_CLIENT_RE, WMIG_DB_RE, WMIG_MODES } from './constants';

/** A load needs a green dry run no older than this. */
export const WMIG_DRY_RUN_MAX_AGE_HOURS = 24;
export const WMIG_MAX_BATCH = 50;
export const WMIG_MAX_SCHEDULE_DAYS = 90;

export const WMIG_STATUSES = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
  'blocked',
] as const;
export const WMIG_BATCH_STATUSES = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;
export const WMIG_STEP_NAMES = [
  'export',
  'preflight',
  'backup',
  'dry',
  'load',
  'core-load',
  'flow-state',
  'reconcile',
  'report',
] as const;
export const WMIG_STEP_STATUSES = ['running', 'done', 'failed', 'skipped'] as const;
export const WMIG_VERDICTS = ['green', 'amber', 'red'] as const;
export type WabooMigrationVerdict = (typeof WMIG_VERDICTS)[number];

/** Lower-case slug of an organization id: the default client key. Same rule as tools/migration/pilot/staging/pipeline.cjs. */
export const deriveClientKey = (organizationId: string): string =>
  organizationId.toLowerCase().slice(0, 64);

/**
 * green only when the run is ok AND nothing is unaccounted AND there are no integrity errors; amber when that holds but the
 * verifier raised alarms (shown as "review alarms", never hidden); red otherwise. A red run is never presented as complete/OK.
 */
export function verdictOf(r: {
  ok: boolean;
  unaccounted: number;
  integrityErrors: number;
  alarms: number;
}): WabooMigrationVerdict {
  if (!r.ok || r.unaccounted !== 0 || r.integrityErrors !== 0) return 'red';
  return r.alarms > 0 ? 'amber' : 'green';
}

export const wabooMigrationStepSchema = z.object({
  name: z.string(),
  status: z.enum(WMIG_STEP_STATUSES),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  counts: z.record(z.string(), z.number()),
  message: z.string().nullable(),
});
export type WabooMigrationStep = z.infer<typeof wabooMigrationStepSchema>;

export const wabooMigrationReportSchema = z.object({
  green: z.boolean(),
  verdict: z.enum(WMIG_VERDICTS),
  unaccounted: z.number().int(),
  integrityErrors: z.number().int(),
  alarms: z.number().int(),
  summary: z.string(),
});
export type WabooMigrationReport = z.infer<typeof wabooMigrationReportSchema>;

export const wabooMigrationRunSchema = z.object({
  id: uuidSchema,
  /** The Waboo organization (workspace) id = the Waboo database name. */
  organizationId: z.string(),
  sourceClient: z.string(),
  sourceDb: z.string(),
  mode: z.enum(WMIG_MODES),
  status: z.enum(WMIG_STATUSES),
  /** Null until the run has a report or has failed; a failed run is red. */
  verdict: z.enum(WMIG_VERDICTS).nullable(),
  steps: z.array(wabooMigrationStepSchema),
  report: wabooMigrationReportSchema.nullable(),
  error: z.string().nullable(),
  batchId: uuidSchema.nullable(),
  position: z.number().int().nullable(),
  runAt: z.string().nullable(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type WabooMigrationRun = z.infer<typeof wabooMigrationRunSchema>;

export const wabooMigrationRunsResponseSchema = z.object({
  data: z.array(wabooMigrationRunSchema),
});
export type WabooMigrationRunsResponse = z.infer<typeof wabooMigrationRunsResponseSchema>;

const organizationIdSchema = z
  .string()
  .trim()
  .regex(WMIG_DB_RE, 'Letters, digits and underscore only');
const runAtSchema = z.string().datetime({ offset: true });

/** Accepts the previous field names (sourceDb, confirmClient) so older callers keep working. */
const legacy = (v: unknown): unknown => {
  if (typeof v !== 'object' || v === null) return v;
  const o = v as Record<string, unknown>;
  return {
    ...o,
    organizationId: o.organizationId ?? o.sourceDb,
    confirm: o.confirm ?? o.confirmClient,
  };
};

export const createWabooMigrationRunSchema = z.preprocess(
  legacy,
  z.object({
    organizationId: organizationIdSchema,
    /** Optional: derived from the organization id (lower-case slug). */
    sourceClient: z
      .string()
      .trim()
      .regex(WMIG_CLIENT_RE, 'Lowercase letters, digits, dash and underscore only')
      .optional(),
    /** Defaults to a dry run. */
    mode: z.enum(WMIG_MODES).default('dry'),
    /** Required for mode "load": the organization id typed again. */
    confirm: z.string().optional(),
    /** ISO timestamp, in the future and at most 90 days ahead. Omit to start now. */
    runAt: runAtSchema.optional(),
  }),
);
export type CreateWabooMigrationRunInput = z.infer<typeof createWabooMigrationRunSchema>;

export const createWabooMigrationBatchSchema = z.object({
  organizationIds: z.array(organizationIdSchema).min(1).max(WMIG_MAX_BATCH),
  mode: z.enum(WMIG_MODES).default('dry'),
  /** Required for mode "load": the NUMBER of organizations, typed. */
  confirmCount: z.coerce.number().int().optional(),
  runAt: runAtSchema.optional(),
  /** Default false: a failed organization does not stop the rest. */
  stopOnFailure: z.boolean().default(false),
});
export type CreateWabooMigrationBatchInput = z.infer<typeof createWabooMigrationBatchSchema>;

export const wabooMigrationBatchSchema = z.object({
  id: uuidSchema,
  status: z.enum(WMIG_BATCH_STATUSES),
  mode: z.enum(WMIG_MODES),
  runAt: z.string().nullable(),
  concurrency: z.literal(1),
  stopOnFailure: z.boolean(),
  total: z.number().int(),
  counts: z.record(z.string(), z.number().int()),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type WabooMigrationBatch = z.infer<typeof wabooMigrationBatchSchema>;

export const wabooMigrationBatchDetailSchema = wabooMigrationBatchSchema.extend({
  items: z.array(wabooMigrationRunSchema),
});
export type WabooMigrationBatchDetail = z.infer<typeof wabooMigrationBatchDetailSchema>;

export const wabooMigrationBatchesResponseSchema = z.object({
  data: z.array(wabooMigrationBatchSchema),
});

/** Readiness of organizations for a load: the latest dry run of each. */
export const wabooMigrationReadinessQuerySchema = z.object({
  organizationIds: z.array(organizationIdSchema).min(1).max(WMIG_MAX_BATCH),
});
export const WMIG_READINESS_REASONS = ['ok', 'no_dry', 'not_green', 'stale'] as const;
export const wabooMigrationReadinessSchema = z.object({
  data: z.array(
    z.object({
      organizationId: z.string(),
      sourceClient: z.string(),
      canLoad: z.boolean(),
      reason: z.enum(WMIG_READINESS_REASONS),
      verdict: z.enum(WMIG_VERDICTS).nullable(),
      dryRunId: uuidSchema.nullable(),
      dryRunAt: z.string().nullable(),
    }),
  ),
});
export type WabooMigrationReadiness = z.infer<typeof wabooMigrationReadinessSchema>;

export const wabooMigrationRunsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type WabooMigrationRunsQuery = z.infer<typeof wabooMigrationRunsQuerySchema>;
