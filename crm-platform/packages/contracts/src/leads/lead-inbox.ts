import { z } from 'zod';
import { cursorSchema, pageInfoSchema } from '../common/pagination';
import { uuidSchema } from '../common/ids';
import { leadEventResponseSchema, leadEventStatusSchema, type LeadEventStatus } from './lead-event';
import { leadSourceKindSchema, leadSourceStatusSchema } from './lead-source';

/**
 * The lead inbox (BL-014, spec L-17, L-18): every delivery any lead source received, in one place, including the ones that could not
 * become a contact; retry of a lead that waits (one or many); and, for sources that can be pulled, "Sync now" and a backfill of a
 * date range with their progress. Reads need `leads.sources.read`; opening a payload, retrying, syncing and backfilling need
 * `leads.sources.manage`.
 */

/** `attention` is the two statuses that wait for a person (`needs_review`, `failed`). */
export const LEAD_INBOX_STATUS_FILTERS = [
  'attention',
  'received',
  'created',
  'updated',
  'duplicate',
  'needs_review',
  'failed',
] as const;
export const leadInboxStatusFilterSchema = z.enum(LEAD_INBOX_STATUS_FILTERS);
export type LeadInboxStatusFilter = z.infer<typeof leadInboxStatusFilterSchema>;

/** The statuses a filter stands for. */
export const statusesOfFilter = (f: LeadInboxStatusFilter): LeadEventStatus[] =>
  f === 'attention' ? ['needs_review', 'failed'] : [f];

const instant = z.string().datetime({ offset: true });

export const leadInboxFilterSchema = z.object({
  sourceId: uuidSchema.optional(),
  status: leadInboxStatusFilterSchema.optional(),
  /** A reason code on the event (`no_contact_point`, `invalid_phone`, `plan_limit_reached`, `internal_error`...). */
  reason: z
    .string()
    .trim()
    .regex(/^[a-z_]{1,60}$/)
    .optional(),
  /** `true` for test leads only, `false` to hide them. Omit for both. */
  isTest: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  /** When the lead was received, from (inclusive) and to (exclusive). */
  from: instant.optional(),
  to: instant.optional(),
  /** The start of the sender's own id for the lead. It is not searched anywhere else: a name or a number is personal data. */
  q: z.string().trim().min(1).max(100).optional(),
});
export type LeadInboxFilter = z.infer<typeof leadInboxFilterSchema>;

export const listLeadInboxQuerySchema = leadInboxFilterSchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: cursorSchema.optional(),
});
export type ListLeadInboxQuery = z.infer<typeof listLeadInboxQuerySchema>;

export const leadInboxItemSchema = leadEventResponseSchema.extend({
  sourceName: z.string(),
  sourceKind: leadSourceKindSchema,
  sourceStatus: leadSourceStatusSchema,
  /** A retry would be accepted: the lead waits, its payload is still stored and its source is active. */
  retryable: z.boolean(),
});
export type LeadInboxItem = z.infer<typeof leadInboxItemSchema>;

export const leadInboxListResponseSchema = z.object({
  data: z.array(leadInboxItemSchema),
  page: pageInfoSchema,
});
export type LeadInboxListResponse = z.infer<typeof leadInboxListResponseSchema>;

/** Counts by status over a window (default: the last 30 days), for the filter chips. */
export const leadInboxSummaryQuerySchema = leadInboxFilterSchema.pick({
  sourceId: true,
  isTest: true,
  from: true,
  to: true,
});
export type LeadInboxSummaryQuery = z.infer<typeof leadInboxSummaryQuerySchema>;

export const LEAD_INBOX_DEFAULT_WINDOW_DAYS = 30;

export const leadInboxSummaryResponseSchema = z.object({
  /** Every status, zero when none. */
  counts: z.record(leadEventStatusSchema, z.number().int().min(0)),
  /** `needs_review` plus `failed`. */
  attention: z.number().int().min(0),
  total: z.number().int().min(0),
  from: z.string().datetime(),
  to: z.string().datetime().nullable(),
});
export type LeadInboxSummaryResponse = z.infer<typeof leadInboxSummaryResponseSchema>;

/**
 * One delivery with its payload, personal data masked as the privacy rules mask it everywhere else: phone numbers, e-mail addresses,
 * names, addresses and free text are hidden, secrets are redacted. Opening it is audited (action `read`). The unmasked payload is the
 * source's own event route (audited as `export`).
 */
export const leadInboxDetailResponseSchema = leadInboxItemSchema.extend({
  payload: z.record(z.unknown()).nullable(),
  /** At least one value was masked or redacted. */
  payloadMasked: z.boolean(),
});
export type LeadInboxDetailResponse = z.infer<typeof leadInboxDetailResponseSchema>;

// --- retry ---------------------------------------------------------------------------------------------------------------------

export const LEAD_INBOX_RETRY_MAX = 100;

export const retryLeadInboxSchema = z.object({
  eventIds: z
    .array(uuidSchema)
    .min(1)
    .max(LEAD_INBOX_RETRY_MAX)
    .refine((ids) => new Set(ids).size === ids.length, { message: 'each lead once' }),
});
export type RetryLeadInboxInput = z.infer<typeof retryLeadInboxSchema>;

export const LEAD_RETRY_OUTCOMES = [
  'retried',
  'not_found',
  'not_retryable',
  'payload_purged',
  'source_paused',
  'error',
] as const;
export const leadRetryOutcomeSchema = z.enum(LEAD_RETRY_OUTCOMES);
export type LeadRetryOutcome = z.infer<typeof leadRetryOutcomeSchema>;

export const leadRetryResultSchema = z.object({
  id: uuidSchema,
  outcome: leadRetryOutcomeSchema,
  /** The lead's status after the retry (`retried`), else null. */
  status: leadEventStatusSchema.nullable(),
});
export type LeadRetryResult = z.infer<typeof leadRetryResultSchema>;

export const retryLeadInboxResponseSchema = z.object({
  results: z.array(leadRetryResultSchema),
  retried: z.number().int().min(0),
  skipped: z.number().int().min(0),
});
export type RetryLeadInboxResponse = z.infer<typeof retryLeadInboxResponseSchema>;

// --- sync now and backfill -----------------------------------------------------------------------------------------------------

export const LEAD_SYNC_KINDS = ['sync', 'backfill'] as const;
export const leadSyncKindSchema = z.enum(LEAD_SYNC_KINDS);
export type LeadSyncKind = z.infer<typeof leadSyncKindSchema>;

/**
 *  queued    asked for, waiting for the worker
 *  running   the worker is pulling
 *  done      finished; everything asked for was fetched and handed to the pipeline
 *  partial   stopped early (the source asked us to slow down, or some leads could not be handed over); running again completes it
 *  failed    the source refused or failed; `error` says why
 */
export const LEAD_SYNC_STATUSES = ['queued', 'running', 'done', 'partial', 'failed'] as const;
export const leadSyncStatusSchema = z.enum(LEAD_SYNC_STATUSES);
export type LeadSyncStatus = z.infer<typeof leadSyncStatusSchema>;

export const leadSyncRunSchema = z.object({
  id: uuidSchema,
  sourceId: uuidSchema,
  sourceName: z.string(),
  kind: leadSyncKindSchema,
  status: leadSyncStatusSchema,
  /** A backfill's range. Null for "sync now" (everything since the last time). */
  rangeFrom: z.string().datetime().nullable(),
  rangeTo: z.string().datetime().nullable(),
  /** Leads the source returned, and what became of them: new to us, already known, not handed over. */
  fetched: z.number().int().min(0),
  accepted: z.number().int().min(0),
  duplicates: z.number().int().min(0),
  failed: z.number().int().min(0),
  /** A backfill is pulled window by window: how many are done of how many are expected. */
  windowsDone: z.number().int().min(0),
  windowsTotal: z.number().int().min(0),
  /** A stable code when `failed` or `partial` (`too_soon`, `provider_error`, `credentials_refused`, `interrupted`...). Never provider text. */
  error: z.string().nullable(),
  requestedAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  finishedAt: z.string().datetime().nullable(),
});
export type LeadSyncRun = z.infer<typeof leadSyncRunSchema>;

/** A source that can be pulled, what it can do, and where it stands. */
export const leadPullSourceSchema = z.object({
  sourceId: uuidSchema,
  sourceName: z.string(),
  sourceKind: leadSourceKindSchema,
  sourceStatus: leadSourceStatusSchema,
  canSync: z.boolean(),
  canBackfill: z.boolean(),
  /** The source's own limit: no two requests sooner than this. "Sync now" is refused until it has passed. */
  minIntervalSeconds: z.number().int().min(0),
  /** How far back a backfill may reach, in days (the source keeps no older history). Null when it cannot backfill. */
  maxBackfillDays: z.number().int().min(1).nullable(),
  /** The first instant "Sync now" is accepted again; null = now. */
  nextSyncAt: z.string().datetime().nullable(),
  activeRun: leadSyncRunSchema.nullable(),
  lastRun: leadSyncRunSchema.nullable(),
});
export type LeadPullSource = z.infer<typeof leadPullSourceSchema>;

export const leadPullSourcesResponseSchema = z.object({ data: z.array(leadPullSourceSchema) });
export type LeadPullSourcesResponse = z.infer<typeof leadPullSourcesResponseSchema>;

/** A backfill is at most this many days wide, whatever the source allows. */
export const LEAD_BACKFILL_MAX_DAYS = 90;

export const backfillLeadsSchema = z
  .object({
    from: instant,
    to: instant,
    /** The sources to pull. Omit for every source that can backfill. */
    sourceIds: z.array(uuidSchema).min(1).max(50).optional(),
  })
  .refine((v) => new Date(v.from).getTime() < new Date(v.to).getTime(), {
    message: 'the start must be before the end',
    path: ['to'],
  })
  .refine(
    (v) =>
      new Date(v.to).getTime() - new Date(v.from).getTime() <= LEAD_BACKFILL_MAX_DAYS * 86_400_000,
    { message: `at most ${LEAD_BACKFILL_MAX_DAYS} days at a time`, path: ['to'] },
  );
export type BackfillLeadsInput = z.infer<typeof backfillLeadsSchema>;

export const backfillLeadsResponseSchema = z.object({
  /** One run per source asked. A source that cannot backfill, or has a run going, is in `skipped` with the reason. */
  runs: z.array(leadSyncRunSchema),
  skipped: z.array(
    z.object({
      sourceId: uuidSchema,
      reason: z.enum([
        'not_supported',
        'paused',
        'in_progress',
        'too_soon',
        'range_too_old',
        'not_found',
      ]),
    }),
  ),
});
export type BackfillLeadsResponse = z.infer<typeof backfillLeadsResponseSchema>;

export const listLeadSyncRunsQuerySchema = z.object({
  sourceId: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type ListLeadSyncRunsQuery = z.infer<typeof listLeadSyncRunsQuerySchema>;

export const leadSyncRunsResponseSchema = z.object({ data: z.array(leadSyncRunSchema) });
export type LeadSyncRunsResponse = z.infer<typeof leadSyncRunsResponseSchema>;
