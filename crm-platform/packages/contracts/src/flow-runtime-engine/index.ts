/**
 * flow-runtime-engine (FLR): running a flow after the editor saved it: triggers, enrollment, runs, retries and the run log.
 * Everything here crosses the network between the API and the screens. See docs/threadwise-port/inventory/flow-runtime-engine.md and
 * docs/api/flow-runtime-engine.md.
 */
import { z } from 'zod';
import { uuidSchema } from '../common/ids';

export * from './errors';

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
] as const;
export type FlowTriggerKind = (typeof FLOW_TRIGGER_KINDS)[number];

/** Trigger kinds whose `trigger_value` is a real id; the rest store 0 (value-less events) or null. */
export const FLOW_VALUE_TRIGGERS: readonly FlowTriggerKind[] = [
  'tag_added',
  'group_join',
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
  /** How many days back the trend covers. */
  days: z.coerce.number().int().min(1).max(180).default(30),
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
  failureReasons: z.array(z.object({ reason: z.string(), count: z.number().int() })),
  bySource: z.array(z.object({ source: z.string(), count: z.number().int() })),
  leaderboard: z.array(
    z.object({
      flowId: uuidSchema,
      flowName: z.string(),
      runs: z.number().int(),
      completed: z.number().int(),
      failed: z.number().int(),
    }),
  ),
});
export type FlowAnalytics = z.infer<typeof flowAnalyticsSchema>;
