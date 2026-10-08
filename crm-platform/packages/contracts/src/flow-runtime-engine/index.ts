/**
 * flow-runtime-engine (FLR): running a flow after the editor saved it: triggers, enrollment, runs, retries and the run log.
 * Everything here crosses the network between the API and the screens. See docs/threadwise-port/inventory/flow-runtime-engine.md and
 * docs/api/flow-runtime-engine.md.
 */
import { z } from 'zod';
import { uuidSchema } from '../common/ids';

export * from './errors';
export * from './ordering';

// --- vocabulary --------------------------------------------------------------------------------------------------------

/**
 * What starts a flow (TW-FLR-001). Reference accepted twelve; `appointment_booked` and `comment_to_dm` had no code path anywhere
 * (TW-FLR-012), so they are not offered here rather than accepted and inert.
 */
export const FLOW_TRIGGER_KINDS = [
  'keyword',
  'tag_added',
  'group_join',
  'manual_enroll',
  'contact_created',
  'opt_in',
  'order_placed',
  'deal_stage_changed',
  'away',
  'out_of_hours',
  'group_leave',
  'segment_join',
  'contact_updated',
  'field_match',
  'date_field_match',
  'schedule',
  'shopify_event',
  'woocommerce_event',
] as const;
export type FlowTriggerKind = (typeof FLOW_TRIGGER_KINDS)[number];

/** Trigger kinds whose `trigger_value` is a real id; the rest store 0 (value-less events) or null. */
export const FLOW_VALUE_TRIGGERS: readonly FlowTriggerKind[] = [
  'tag_added',
  'group_join',
  'group_leave',
  'deal_stage_changed',
];

/** The word that makes a keyword flow the default route: it fires when no other keyword matched. */
export const FLOW_CATCH_ALL_KEYWORDS = ['*', '.*', '.+', 'any'] as const;

/** Where a run came from (TW-FLR-010: every launch path writes a run row, so analytics covers all of them). */
export const FLOW_RUN_SOURCES = [
  'keyword',
  'any_message',
  'tag_added',
  'group_join',
  'contact_created',
  'opt_in',
  'order_placed',
  'deal_stage_changed',
  'away',
  'out_of_hours',
  'group_leave',
  'segment_join',
  'contact_updated',
  'field_match',
  'date_field_match',
  'schedule',
  'ecom_event',
  'manual',
  'api',
  'routing',
  'campaign',
  'webhook_lead',
  'handoff',
  'inbox',
  'retry',
] as const;
export type FlowRunSource = (typeof FLOW_RUN_SOURCES)[number];

/**
 * running: a worker is walking it. waiting: parked on a customer reply. sleeping: a Delay is counting down. halted: the channel was
 * down or the daily cap was reached; it tries again by itself. The rest are final.
 */
export const FLOW_RUN_STATUSES = [
  'running',
  'waiting',
  'sleeping',
  'halted',
  'completed',
  'failed',
  'cancelled',
  'expired',
] as const;
export type FlowRunStatus = (typeof FLOW_RUN_STATUSES)[number];
export const FLOW_LIVE_RUN_STATUSES: readonly FlowRunStatus[] = [
  'running',
  'waiting',
  'sleeping',
  'halted',
];

export const FLOW_RUN_END_REASONS = [
  'end_node',
  'dead_end',
  'loop_guard',
  'idle_timeout',
  'max_lifetime',
  'replaced',
  'takeover',
  'channel_removed',
  'cancelled',
  'send_failed',
  'failed',
] as const;
export type FlowRunEndReason = (typeof FLOW_RUN_END_REASONS)[number];

/** `completed` is set by the runtime when a run ends normally (Reference never set it, TW-FLR-051). */
export const FLOW_SUBSCRIBER_STATUSES = ['active', 'paused', 'completed', 'failed'] as const;
export type FlowSubscriberStatus = (typeof FLOW_SUBSCRIBER_STATUSES)[number];

/** Limits the runtime keeps (TW-FLR-016, TW-FLR-015). */
export const FLOW_MAX_NODE_VISITS = 20;
export const FLOW_DEFAULT_TIMEOUT_SECONDS = 600;
export const FLOW_ENROLL_MAX_CONTACTS = 500;

// --- runs --------------------------------------------------------------------------------------------------------------

export const flowRunSummarySchema = z.object({
  id: uuidSchema,
  flowId: uuidSchema,
  flowName: z.string(),
  contact: z.object({ id: uuidSchema, name: z.string().nullable() }).nullable(),
  channel: z.object({ id: uuidSchema, name: z.string(), kind: z.string() }).nullable(),
  peerKey: z.string(),
  source: z.enum(FLOW_RUN_SOURCES),
  status: z.enum(FLOW_RUN_STATUSES),
  endReason: z.enum(FLOW_RUN_END_REASONS).nullable(),
  failureReason: z.string().nullable(),
  haltReason: z.string().nullable(),
  currentNodeId: z.string().nullable(),
  startedAt: z.string(),
  lastActivityAt: z.string(),
  endedAt: z.string().nullable(),
  resumeAt: z.string().nullable(),
  steps: z.number().int(),
});
export type FlowRunSummary = z.infer<typeof flowRunSummarySchema>;

export const flowRunStepSchema = z.object({
  seq: z.number().int(),
  nodeId: z.string().nullable(),
  nodeType: z.string().nullable(),
  event: z.string(),
  detail: z.record(z.unknown()),
  error: z.string().nullable(),
  at: z.string(),
});
export type FlowRunStep = z.infer<typeof flowRunStepSchema>;

export const flowRunDetailSchema = flowRunSummarySchema.extend({
  triggerText: z.string().nullable(),
  variables: z.record(z.unknown()),
  /** What the run waits for, when it is parked: the node and the kind of wait. */
  waiting: z
    .object({ nodeId: z.string(), kind: z.string(), expiresAt: z.string().nullable() })
    .nullable(),
  log: z.array(flowRunStepSchema),
});
export type FlowRunDetail = z.infer<typeof flowRunDetailSchema>;

const dayStringSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * The window of the history, error and retry tables (TW-FLR-054): the last `days` days, or explicit `dateFrom`/`dateTo` days
 * (UTC), which win over `days`. The upper bound is always applied; no lower bound means all time.
 */
export const flowWindowShape = {
  days: z.coerce.number().int().min(1).max(365).optional(),
  dateFrom: dayStringSchema.optional(),
  dateTo: dayStringSchema.optional(),
};

export const listFlowRunsQuerySchema = z.object({
  flowId: uuidSchema.optional(),
  contactId: uuidSchema.optional(),
  status: z.enum(FLOW_RUN_STATUSES).optional(),
  source: z.enum(FLOW_RUN_SOURCES).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(64).optional(),
});
export type ListFlowRunsQuery = z.infer<typeof listFlowRunsQuerySchema>;

export const flowRunListSchema = z.object({
  items: z.array(flowRunSummarySchema),
  nextCursor: z.string().nullable(),
});
export type FlowRunList = z.infer<typeof flowRunListSchema>;

// --- subscribers and enrollment ----------------------------------------------------------------------------------------

export const flowSubscriberSchema = z.object({
  id: uuidSchema,
  flowId: uuidSchema,
  contact: z.object({ id: uuidSchema, name: z.string().nullable(), phone: z.string().nullable() }),
  status: z.enum(FLOW_SUBSCRIBER_STATUSES),
  source: z.string(),
  enrolledAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  failedAt: z.string().nullable(),
  failureReason: z.string().nullable(),
  retryCount: z.number().int(),
  lastRetriedAt: z.string().nullable(),
  lastRunId: uuidSchema.nullable(),
});
export type FlowSubscriber = z.infer<typeof flowSubscriberSchema>;

export const listFlowSubscribersQuerySchema = z.object({
  status: z.enum(FLOW_SUBSCRIBER_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().max(64).optional(),
});
export type ListFlowSubscribersQuery = z.infer<typeof listFlowSubscribersQuerySchema>;

export const flowSubscriberListSchema = z.object({
  items: z.array(flowSubscriberSchema),
  /** Over every subscriber of the flow, not only this page (Reference's API counted the page only). */
  counts: z.object({
    active: z.number().int(),
    paused: z.number().int(),
    completed: z.number().int(),
    failed: z.number().int(),
  }),
  nextCursor: z.string().nullable(),
});
export type FlowSubscriberList = z.infer<typeof flowSubscriberListSchema>;

/** Contacts to enrol: chosen ones win over a group (TW-FLR-008 rule 3). */
export const enrollContactsInputSchema = z
  .object({
    contactIds: z.array(uuidSchema).max(FLOW_ENROLL_MAX_CONTACTS).optional(),
    groupId: uuidSchema.optional(),
  })
  .refine((v) => (v.contactIds && v.contactIds.length > 0) || v.groupId, {
    message: 'Choose contacts or a group.',
  });
export type EnrollContactsInput = z.infer<typeof enrollContactsInputSchema>;

export const enrollResultSchema = z.object({
  enrolled: z.number().int(),
  /** Contacts that were already in the flow and not launched again. */
  alreadyEnrolled: z.number().int(),
  failed: z.number().int(),
  results: z.array(
    z.object({
      contactId: uuidSchema,
      outcome: z.enum(['started', 'already_enrolled', 'failed']),
      reason: z.string().nullable(),
    }),
  ),
});
export type EnrollResult = z.infer<typeof enrollResultSchema>;

/** One contact, by id or by phone (the REST API's shape, TW-FLR-009). */
export const enrollOneInputSchema = z
  .object({
    contactId: uuidSchema.optional(),
    phone: z.string().trim().min(3).max(32).optional(),
  })
  .refine((v) => v.contactId || v.phone, { message: 'Give a contact id or a phone.' });
export type EnrollOneInput = z.infer<typeof enrollOneInputSchema>;

export const enrollOneResultSchema = z.object({
  flowId: uuidSchema,
  contactId: uuidSchema,
  subscriberId: uuidSchema,
  status: z.enum(FLOW_SUBSCRIBER_STATUSES),
  enrolledAt: z.string().nullable(),
  runId: uuidSchema.nullable(),
});
export type EnrollOneResult = z.infer<typeof enrollOneResultSchema>;

export const retryResultSchema = z.object({
  retried: z.number().int(),
  skipped: z.number().int(),
});
export type RetryResult = z.infer<typeof retryResultSchema>;

/** Start a flow on an open conversation (the inbox and mobile "start flow", TW-FLR-010 rule 3). */
export const startFlowOnConversationInputSchema = z.object({ flowId: uuidSchema });
export type StartFlowOnConversationInput = z.infer<typeof startFlowOnConversationInputSchema>;

// --- analytics ---------------------------------------------------------------------------------------------------------

export const flowAnalyticsQuerySchema = z.object({
  /** How many days back the numbers cover; 0 is all time (Reference's 7, 30, 90 and "All time" chips). */
  days: z.coerce.number().int().min(0).max(3650).default(30),
  flowId: uuidSchema.optional(),
});
export type FlowAnalyticsQuery = z.infer<typeof flowAnalyticsQuerySchema>;

export const flowAnalyticsSchema = z.object({
  totals: z.object({
    enrolled: z.number().int(),
    running: z.number().int(),
    completed: z.number().int(),
    failed: z.number().int(),
    cancelled: z.number().int(),
    expired: z.number().int(),
  }),
  /** completed / finished runs, 0..1; null while nothing has finished. */
  completionRate: z.number().nullable(),
  avgSecondsToComplete: z.number().nullable(),
  trend: z.array(
    z.object({
      day: z.string(),
      started: z.number().int(),
      completed: z.number().int(),
      failed: z.number().int(),
    }),
  ),
  failureReasons: z.array(
    z.object({
      reason: z.string(),
      count: z.number().int(),
      firstSeen: z.string().nullable(),
      lastSeen: z.string().nullable(),
    }),
  ),
  bySource: z.array(z.object({ source: z.string(), count: z.number().int() })),
  leaderboard: z.array(
    z.object({
      flowId: uuidSchema,
      flowName: z.string(),
      /** Reference's three states: live (published and on), paused (published, switched off), draft (not published). */
      state: z.enum(['live', 'paused', 'draft']),
      runs: z.number().int(),
      running: z.number().int(),
      completed: z.number().int(),
      failed: z.number().int(),
      /** Percent of this flow's runs, one decimal; null with no runs. */
      completionRate: z.number().nullable(),
      failureRate: z.number().nullable(),
      avgSecondsToComplete: z.number().nullable(),
    }),
  ),
  /** The second band of tiles: reach, paused subscribers, retries and how many flows exist or ran. */
  extras: z.object({
    contactsReached: z.number().int(),
    pausedSubscribers: z.number().int(),
    retriedRuns: z.number().int(),
    retryAttempts: z.number().int(),
    flowsTotal: z.number().int(),
    flowsLive: z.number().int(),
    flowsWithRuns: z.number().int(),
    /** failed / all runs, 0..1; null with no runs. */
    failureRate: z.number().nullable(),
  }),
});
export type FlowAnalytics = z.infer<typeof flowAnalyticsSchema>;

// --- error logs, retry records, retry by ids (TW-FLR-055 to 058) ---------------------------------------------------------

/** Retries one request may name (Reference's batch cap: never an unbounded "retry everything"). */
export const FLOW_RETRY_MAX_BATCH = 50;
/** A run may not be retried again within this many seconds of its last retry (a double click, a repeated request). */
export const FLOW_RETRY_COOLDOWN_SECONDS = 30;

export const FLOW_RETRY_OUTCOMES = ['queued', 'succeeded', 'failed', 'skipped'] as const;
export type FlowRetryOutcome = (typeof FLOW_RETRY_OUTCOMES)[number];

/** One row of the execution history (TW-FLR-054): a subscriber, Reference's "run" (a contact entering a flow). */
export const flowHistoryRowSchema = flowSubscriberSchema.extend({
  flowName: z.string(),
  flowState: z.enum(['live', 'paused', 'draft']),
  /** Enrolment to completion, in seconds; null until it completed. */
  durationSeconds: z.number().int().nullable(),
  /** A failed run whose flow is switched on can be run again (TW-FLR-057). */
  canRetry: z.boolean(),
});
export type FlowHistoryRow = z.infer<typeof flowHistoryRowSchema>;

export const listFlowHistoryQuerySchema = z.object({
  flowId: uuidSchema.optional(),
  status: z.enum(FLOW_SUBSCRIBER_STATUSES).optional(),
  /** Matches the failure reason, the contact's name or phone, or the flow's name. */
  q: z.string().trim().max(120).optional(),
  ...flowWindowShape,
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(64).optional(),
});
export type ListFlowHistoryQuery = z.infer<typeof listFlowHistoryQuerySchema>;

export const flowHistoryListSchema = z.object({
  items: z.array(flowHistoryRowSchema),
  nextCursor: z.string().nullable(),
  /** Per status over the same filters except `status`, plus `all`, so the tabs add up to the unfiltered result. */
  counts: z.object({
    all: z.number().int(),
    active: z.number().int(),
    paused: z.number().int(),
    completed: z.number().int(),
    failed: z.number().int(),
  }),
});
export type FlowHistoryList = z.infer<typeof flowHistoryListSchema>;

export const flowErrorGroupsQuerySchema = z.object({
  flowId: uuidSchema.optional(),
  q: z.string().trim().max(120).optional(),
  ...flowWindowShape,
});
export type FlowErrorGroupsQuery = z.infer<typeof flowErrorGroupsQuerySchema>;

export const flowErrorGroupsSchema = z.object({
  /** Failed runs rolled up by reason, most first; an empty reason is one "no reason recorded" group (`reason` null). */
  groups: z.array(
    z.object({
      reason: z.string().nullable(),
      count: z.number().int(),
      firstSeen: z.string().nullable(),
      lastSeen: z.string().nullable(),
      flows: z.array(
        z.object({ flowId: uuidSchema, flowName: z.string(), count: z.number().int() }),
      ),
      /** Subscribers of the newest failed runs of this group, to retry them; at most one batch. */
      subscriberIds: z.array(uuidSchema),
    }),
  ),
  totals: z.object({
    failed: z.number().int(),
    distinctReasons: z.number().int(),
    affectedFlows: z.number().int(),
    affectedContacts: z.number().int(),
    retried: z.number().int(),
  }),
});
export type FlowErrorGroups = z.infer<typeof flowErrorGroupsSchema>;

export const listFlowRetriesQuerySchema = z.object({
  flowId: uuidSchema.optional(),
  outcome: z.enum(FLOW_RETRY_OUTCOMES).optional(),
  ...flowWindowShape,
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(64).optional(),
});
export type ListFlowRetriesQuery = z.infer<typeof listFlowRetriesQuerySchema>;

export const flowRetryRecordSchema = z.object({
  id: uuidSchema,
  flowId: uuidSchema,
  flowName: z.string(),
  subscriberId: uuidSchema,
  contact: z
    .object({ id: uuidSchema, name: z.string().nullable(), phone: z.string().nullable() })
    .nullable(),
  /** Who pressed retry; null for the system. */
  retriedBy: z.string().nullable(),
  source: z.enum(['manual', 'system']),
  previousStatus: z.string().nullable(),
  previousFailureReason: z.string().nullable(),
  outcome: z.enum(FLOW_RETRY_OUTCOMES),
  outcomeReason: z.string().nullable(),
  createdAt: z.string(),
});
export type FlowRetryRecord = z.infer<typeof flowRetryRecordSchema>;

export const flowRetryListSchema = z.object({
  items: z.array(flowRetryRecordSchema),
  nextCursor: z.string().nullable(),
  /** Per outcome over the same filters except `outcome`, plus `all`. */
  totals: z.object({
    all: z.number().int(),
    queued: z.number().int(),
    succeeded: z.number().int(),
    failed: z.number().int(),
    skipped: z.number().int(),
  }),
});
export type FlowRetryList = z.infer<typeof flowRetryListSchema>;

/** Retry of one run: the outcome the attempt had, so the screen can say whether it started again or failed again. */
export const retryOneResultSchema = retryResultSchema.extend({
  outcome: z.enum(FLOW_RETRY_OUTCOMES),
  reason: z.string().nullable(),
});
export type RetryOneResult = z.infer<typeof retryOneResultSchema>;

/** Retry the named failed runs (their subscriber ids), at most one batch. */
export const retryManyInputSchema = z.object({
  subscriberIds: z.array(uuidSchema).min(1).max(FLOW_RETRY_MAX_BATCH),
});
export type RetryManyInput = z.infer<typeof retryManyInputSchema>;

export const retryManyResultSchema = z.object({
  requested: z.number().int(),
  attempted: z.number().int(),
  queued: z.number().int(),
  succeeded: z.number().int(),
  failed: z.number().int(),
  skipped: z.number().int(),
  results: z.array(
    z.object({
      subscriberId: uuidSchema,
      outcome: z.enum(FLOW_RETRY_OUTCOMES).nullable(),
      /** A machine reason for a skip (`not_found`, `flow_inactive`, `too_soon`, `not_failed`) or the engine's words for a failure. */
      reason: z.string().nullable(),
    }),
  ),
});
export type RetryManyResult = z.infer<typeof retryManyResultSchema>;
