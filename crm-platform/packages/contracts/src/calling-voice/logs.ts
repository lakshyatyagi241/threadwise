/**
 * calling-voice: call logs and call analytics (TW-CALL-022 onward). The list, its KPIs, one call with its timeline and recording, the
 * short-lived playback link and the analytics page. See docs/api/calling-voice.md and docs/threadwise-port/wiring/calling-voice.md.
 */
import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { callRecordingLifecycleSchema } from './recording';

// --- vocabulary --------------------------------------------------------------------------------------------------------

/**
 * How a call reads in the log. Reference's words (`completed`, `in-progress`, `no-answer`, `failed`, plus `declined`, which its bridge
 * could write but its filter never offered). Worked out from the call row: see `callLogStatus` in the API.
 */
export const CALL_LOG_STATUSES = [
  'completed',
  'in-progress',
  'no-answer',
  'declined',
  'failed',
] as const;
export type CallLogStatus = (typeof CALL_LOG_STATUSES)[number];

/** Reference's two words for the two directions (Meta's `USER_INITIATED` is inbound). */
export const CALL_LOG_DIRECTIONS = ['inbound', 'outbound'] as const;
export type CallLogDirection = (typeof CALL_LOG_DIRECTIONS)[number];

/** The time ranges Reference's sidebar offered. A custom `from` / `to` replaces the range. */
export const CALL_LOG_RANGES = ['24h', '7d', '30d'] as const;
export type CallLogRange = (typeof CALL_LOG_RANGES)[number];
export const CALL_LOG_DEFAULT_RANGE: CallLogRange = '30d';

export const CALL_LOG_PAGE_SIZE = 25;
export const CALL_LOG_MAX_PAGE_SIZE = 100;
/** A custom range wider than this is refused (the log is read in one query). */
export const CALL_LOG_MAX_RANGE_DAYS = 366;

/** How long a playback link works. */
export const CALL_PLAYBACK_TTL_SECONDS = 300;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'a date as YYYY-MM-DD');

const rangeFields = {
  /** A preset window ending now. Ignored when `from` or `to` is given. */
  range: z.enum(CALL_LOG_RANGES).optional(),
  /** First day (inclusive) and last day (inclusive), in the caller's time zone (`tz`). */
  from: day.optional(),
  to: day.optional(),
  /** The caller's IANA time zone: days and hours are counted in it. Default UTC. */
  tz: z.string().max(64).optional(),
};

// --- list --------------------------------------------------------------------------------------------------------------

export const callLogListQuerySchema = z.object({
  ...rangeFields,
  status: z.enum(CALL_LOG_STATUSES).optional(),
  direction: z.enum(CALL_LOG_DIRECTIONS).optional(),
  /** One of the workspace's WhatsApp numbers. */
  numberId: uuidSchema.optional(),
  /** The teammate who handled the call. */
  agentId: uuidSchema.optional(),
  /** A phone number (digits, a plus or spaces are ignored) or part of the contact's name. */
  q: z.string().trim().max(80).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(CALL_LOG_MAX_PAGE_SIZE).default(CALL_LOG_PAGE_SIZE),
});
export type CallLogListQuery = z.infer<typeof callLogListQuerySchema>;

export const callLogRowSchema = z.object({
  id: uuidSchema,
  direction: z.enum(CALL_LOG_DIRECTIONS),
  status: z.enum(CALL_LOG_STATUSES),
  /** The customer's number, as Meta gave it (digits). */
  customerPhone: z.string(),
  /** The workspace's own number. */
  ourPhone: z.string(),
  contactId: uuidSchema.nullable(),
  contactName: z.string().nullable(),
  numberId: uuidSchema.nullable(),
  numberLabel: z.string().nullable(),
  handlerType: z.enum(['operator', 'ai_agent', 'voicemail', 'none']).nullable(),
  handlerId: uuidSchema.nullable(),
  handlerName: z.string().nullable(),
  startedAt: z.string().nullable(),
  durationSec: z.number().int().nonnegative(),
  endReason: z.string().nullable(),
  hasRecording: z.boolean(),
});
export type CallLogRow = z.infer<typeof callLogRowSchema>;

/** Reference's four cards: the whole workspace, whatever the filters say (its "sidebar totals"). */
export const callLogWorkspaceKpisSchema = z.object({
  total: z.number().int().nonnegative(),
  last24h: z.number().int().nonnegative(),
  /** Whole minutes talked in the last 24 hours (Reference: `sum(duration) / 60`, truncated). */
  minutes24h: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
  /** `failed` and `no-answer`, as Reference counted them. */
  failed: z.number().int().nonnegative(),
});

/** What the filters select: the cards this port adds under Reference's four. */
export const callLogSelectionKpisSchema = z.object({
  total: z.number().int().nonnegative(),
  answered: z.number().int().nonnegative(),
  missed: z.number().int().nonnegative(),
  /** Average length of the answered calls, in seconds; 0 when none was answered. */
  avgDurationSec: z.number().int().nonnegative(),
  totalMinutes: z.number().int().nonnegative(),
});
export type CallLogSelectionKpis = z.infer<typeof callLogSelectionKpisSchema>;

export const callLogListSchema = z.object({
  rows: z.array(callLogRowSchema),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  total: z.number().int().nonnegative(),
  kpis: z.object({
    workspace: callLogWorkspaceKpisSchema,
    selection: callLogSelectionKpisSchema,
  }),
});
export type CallLogList = z.infer<typeof callLogListSchema>;

/** The choices the filter bar offers: the workspace's WhatsApp numbers, and the teammates who handled a call the caller may see. */
export const callLogFiltersSchema = z.object({
  numbers: z.array(
    z.object({ id: uuidSchema, label: z.string(), phoneNumber: z.string().nullable() }),
  ),
  agents: z.array(z.object({ id: uuidSchema, name: z.string() })),
});
export type CallLogFilters = z.infer<typeof callLogFiltersSchema>;

// --- one call ----------------------------------------------------------------------------------------------------------

export const callTimelineEntrySchema = z.object({
  /** The ledger step (`connect`, `accept_sent`, `terminate`, `recording_stored`...). */
  type: z.string(),
  at: z.string(),
  /** A short, safe note: Meta's end status, the decline reason, the size of a recording. Never a payload. */
  note: z.string().nullable(),
});
export type CallTimelineEntry = z.infer<typeof callTimelineEntrySchema>;

export const callLogDetailSchema = z.object({
  call: callLogRowSchema.extend({
    answeredAt: z.string().nullable(),
    endedAt: z.string().nullable(),
    /** Why the call failed, when it did (the reason Meta or the dial gave). */
    failureReason: z.string().nullable(),
    conversationId: uuidSchema.nullable(),
  }),
  timeline: z.array(callTimelineEntrySchema),
  recording: z.object({
    available: z.boolean(),
    mime: z.string().nullable(),
    sizeBytes: z.number().int().nonnegative().nullable(),
    /** The consent evidence, the retention clock, the legal hold and, once removed, when and why (BL-144). */
    lifecycle: callRecordingLifecycleSchema,
  }),
});
export type CallLogDetail = z.infer<typeof callLogDetailSchema>;

/** `POST /v2/calling/call-logs/:id/playback`: a link that works for a few minutes, for an audio element. */
export const callPlaybackSchema = z.object({
  url: z.string(),
  expiresAt: z.string(),
  mime: z.string(),
});
export type CallPlayback = z.infer<typeof callPlaybackSchema>;

// --- analytics ---------------------------------------------------------------------------------------------------------

export const callAnalyticsQuerySchema = z.object({
  ...rangeFields,
  numberId: uuidSchema.optional(),
});
export type CallAnalyticsQuery = z.infer<typeof callAnalyticsQuerySchema>;

export const callAnalyticsSchema = z.object({
  /** The days the figures cover, in the caller's time zone. */
  from: day,
  to: day,
  tz: z.string(),
  totals: z.object({
    total: z.number().int().nonnegative(),
    answered: z.number().int().nonnegative(),
    missed: z.number().int().nonnegative(),
    /** Answered calls as a share of all finished calls, 0 to 1. */
    answeredRate: z.number().min(0).max(1),
    /** Average length of an answered call, in seconds. */
    avgHandleSec: z.number().int().nonnegative(),
    totalMinutes: z.number().int().nonnegative(),
  }),
  /** One entry per day of the range, empty days included. */
  series: z.array(
    z.object({
      day,
      total: z.number().int().nonnegative(),
      answered: z.number().int().nonnegative(),
      missed: z.number().int().nonnegative(),
    }),
  ),
  byAgent: z.array(
    z.object({
      agentId: uuidSchema.nullable(),
      name: z.string().nullable(),
      calls: z.number().int().nonnegative(),
      answered: z.number().int().nonnegative(),
      avgHandleSec: z.number().int().nonnegative(),
      totalMinutes: z.number().int().nonnegative(),
    }),
  ),
  /** Calls started in each hour of each weekday (0 = Sunday, 0 to 23): only the cells with a call. */
  heatmap: z.array(
    z.object({
      weekday: z.number().int().min(0).max(6),
      hour: z.number().int().min(0).max(23),
      calls: z.number().int().positive(),
    }),
  ),
});
export type CallAnalytics = z.infer<typeof callAnalyticsSchema>;
