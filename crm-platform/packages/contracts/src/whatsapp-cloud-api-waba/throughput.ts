import { z } from 'zod';

/**
 * WhatsApp send limits and live performance (super admin console). Meta's own figures, from its throughput reference: every
 * registered number starts at 80 messages per second (mps); a number that qualifies is upgraded to 1,000 mps by Meta; a number
 * used with both the WhatsApp Business app and the Cloud API (coexistence) is fixed at 20 mps. Inbound and outbound messages
 * share the budget. Nothing else is assumed: a figure Meta did not document is never a default here.
 */
export const WABA_DEFAULT_MPS = 80;
export const WABA_HIGH_MPS = 1000;
export const WABA_COEXISTENCE_MPS = 20;

/** Meta error codes the send path reacts to: 130429 throughput exceeded, 131057 a throughput upgrade is in progress. */
export const WABA_THROUGHPUT_EXCEEDED_CODE = 130429;
export const WABA_UPGRADE_IN_PROGRESS_CODE = 131057;

/** Where a number's effective rate comes from, strongest first. */
export const WABA_RATE_SOURCES = ['override', 'coexistence', 'meta', 'default'] as const;
export type WabaRateSource = (typeof WABA_RATE_SOURCES)[number];

/** How a number's daily messaging tier reads against the messages sent: `unknown` when Meta has not told us the tier yet. */
export const WABA_TIER_STATES = ['ok', 'warn', 'full', 'unlimited', 'unknown'] as const;
export type WabaTierState = (typeof WABA_TIER_STATES)[number];

// --- platform settings ---------------------------------------------------------------------------------------------------------

export const wabaThroughputSettingsSchema = z.object({
  /** Master switch. Off: no pacing and no holds; Meta's own 130429 handling still applies. */
  enabled: z.boolean(),
  /** The rate of a number whose throughput Meta has not reported yet. */
  defaultMps: z.number().int().min(1).max(WABA_HIGH_MPS),
  /** Share of the number's cap left unused as headroom for inbound traffic and clock skew. */
  safetyMarginPct: z.number().int().min(0).max(50),
  /** A send that would wait longer than this is handed back to its queue (with that wait) instead of holding a worker. */
  maxLocalWaitMs: z.number().int().min(0).max(60_000),
  /** After Meta answers 130429, send slower and win the rate back gradually. */
  adaptiveBackoff: z.boolean(),
  /** Share of the daily messaging tier at which a number is flagged. */
  tierWarnPct: z.number().int().min(50).max(99),
  /** Hold template sends that would pass the tier's daily cap (an estimate: see the usage note on the page). Off: only flagged. */
  enforceTierCap: z.boolean(),
  /** How often each number's throughput and tier are re-read from Meta. */
  syncIntervalMinutes: z.number().int().min(5).max(1440),
});
export type WabaThroughputSettings = z.infer<typeof wabaThroughputSettingsSchema>;

export const WABA_THROUGHPUT_SETTINGS_DEFAULTS: WabaThroughputSettings = {
  enabled: true,
  defaultMps: WABA_DEFAULT_MPS,
  safetyMarginPct: 10,
  maxLocalWaitMs: 5_000,
  adaptiveBackoff: true,
  tierWarnPct: 80,
  enforceTierCap: false,
  syncIntervalMinutes: 30,
};

export const updateWabaThroughputSettingsSchema = wabaThroughputSettingsSchema.extend({
  rowVersion: z.number().int().min(0),
});
export type UpdateWabaThroughputSettingsInput = z.infer<typeof updateWabaThroughputSettingsSchema>;

export const wabaThroughputSettingsResponseSchema = wabaThroughputSettingsSchema.extend({
  rowVersion: z.number().int(),
});
export type WabaThroughputSettingsResponse = z.infer<typeof wabaThroughputSettingsResponseSchema>;

// --- one number ----------------------------------------------------------------------------------------------------------------

export const wabaNumberLiveSchema = z.object({
  /** Sends per second over the last 10 seconds. */
  mpsNow: z.number(),
  /** Highest sends in one second over the last 60 seconds. */
  peak1m: z.number().int(),
  sent5m: z.number().int(),
  /** Sends that waited for their turn in the last 5 minutes, and their mean wait. */
  waited5m: z.number().int(),
  avgWaitMs5m: z.number().int(),
  /** Sends handed back to the queue because the wait was too long, or because the number is paused or its tier is full. */
  deferred5m: z.number().int(),
  /** Times Meta itself answered 130429 or 131057 in the last 5 minutes. */
  metaThrottled5m: z.number().int(),
  /** 1 = full speed; below 1 the number is slowed after a Meta throttle and recovering. */
  speedFactor: z.number(),
});
export type WabaNumberLive = z.infer<typeof wabaNumberLiveSchema>;

export const wabaNumberTierSchema = z.object({
  /** Meta's label, e.g. TIER_1K, or null when unknown. */
  name: z.string().nullable(),
  /** Unique recipients per 24 hours the tier allows; null for unlimited or unknown. */
  cap: z.number().int().nullable(),
  /** Unique recipients of template messages in the last 24 hours, counted here (an estimate within about 1%). */
  used24h: z.number().int(),
  pct: z.number().nullable(),
  state: z.enum(WABA_TIER_STATES),
});
export type WabaNumberTier = z.infer<typeof wabaNumberTierSchema>;

export const wabaNumberControlSchema = z.object({
  /** An operator-set rate that replaces Meta's value; null follows Meta. */
  overrideMps: z.number().int().min(1).max(WABA_HIGH_MPS).nullable(),
  paused: z.boolean(),
  pauseReason: z.string().nullable(),
  updatedAt: z.string().nullable(),
});
export type WabaNumberControl = z.infer<typeof wabaNumberControlSchema>;

export const wabaNumberThroughputSchema = z.object({
  /** The connection's uuid. */
  id: z.string().uuid(),
  workspace: z.string(),
  phoneNumberId: z.string(),
  displayPhoneNumber: z.string().nullable(),
  label: z.string().nullable(),
  status: z.string(),
  qualityRating: z.string().nullable(),
  coexistence: z.boolean(),
  /** Meta's throughput level (STANDARD, HIGH) and the mps it stands for, when Meta reported one. */
  metaLevel: z.string().nullable(),
  metaMps: z.number().int().nullable(),
  /** The rate sends are paced to now (override, coexistence cap or Meta's value, less the safety margin). */
  effectiveMps: z.number().int(),
  source: z.enum(WABA_RATE_SOURCES),
  control: wabaNumberControlSchema,
  tier: wabaNumberTierSchema,
  live: wabaNumberLiveSchema,
  syncedAt: z.string().nullable(),
  /** Why the last read from Meta failed, when it did. */
  syncError: z.string().nullable(),
  rowVersion: z.number().int(),
});
export type WabaNumberThroughput = z.infer<typeof wabaNumberThroughputSchema>;

export const wabaThroughputTotalsSchema = z.object({
  numbers: z.number().int(),
  paused: z.number().int(),
  throttled: z.number().int(),
  tierWarn: z.number().int(),
  mpsNow: z.number(),
  sent5m: z.number().int(),
  deferred5m: z.number().int(),
  metaThrottled5m: z.number().int(),
});
export type WabaThroughputTotals = z.infer<typeof wabaThroughputTotalsSchema>;

export const wabaThroughputOverviewSchema = z.object({
  settings: wabaThroughputSettingsResponseSchema,
  totals: wabaThroughputTotalsSchema,
  numbers: z.array(wabaNumberThroughputSchema),
  /** False when Redis could not be read: the live columns are zero and the page says so. */
  liveAvailable: z.boolean(),
  generatedAt: z.string(),
});
export type WabaThroughputOverview = z.infer<typeof wabaThroughputOverviewSchema>;

// --- one number, in detail ------------------------------------------------------------------------------------------------------

export const wabaThroughputEventKinds = [
  'meta_throttled',
  'upgrade_in_progress',
  'throughput_upgraded',
  'deferred',
  'paused_block',
  'tier_full',
  'paused',
  'resumed',
  'override_set',
  'override_cleared',
  'synced',
] as const;
export type WabaThroughputEventKind = (typeof wabaThroughputEventKinds)[number];

export const wabaThroughputEventSchema = z.object({
  at: z.string(),
  kind: z.enum(wabaThroughputEventKinds),
  detail: z.string().nullable(),
});
export type WabaThroughputEvent = z.infer<typeof wabaThroughputEventSchema>;

export const wabaThroughputSeriesPointSchema = z.object({
  /** Start of the second or minute, ISO. */
  at: z.string(),
  sent: z.number().int(),
  deferred: z.number().int(),
  metaThrottled: z.number().int(),
});
export type WabaThroughputSeriesPoint = z.infer<typeof wabaThroughputSeriesPointSchema>;

export const wabaNumberThroughputDetailSchema = z.object({
  number: wabaNumberThroughputSchema,
  /** Sends per second, last 60 seconds (oldest first). */
  perSecond: z.array(wabaThroughputSeriesPointSchema),
  /** Sends per minute, last 60 minutes (oldest first). */
  perMinute: z.array(wabaThroughputSeriesPointSchema),
  events: z.array(wabaThroughputEventSchema),
  liveAvailable: z.boolean(),
  generatedAt: z.string(),
});
export type WabaNumberThroughputDetail = z.infer<typeof wabaNumberThroughputDetailSchema>;

// --- operator actions ------------------------------------------------------------------------------------------------------------

export const updateWabaNumberControlSchema = z
  .object({
    /** `null` clears the override and follows Meta again. */
    overrideMps: z.number().int().min(1).max(WABA_HIGH_MPS).nullable(),
    paused: z.boolean(),
    pauseReason: z.string().trim().max(200).nullable().optional(),
    rowVersion: z.number().int().min(1),
  })
  .strict();
export type UpdateWabaNumberControlInput = z.infer<typeof updateWabaNumberControlSchema>;

export const wabaThroughputListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
});
export type WabaThroughputListQuery = z.infer<typeof wabaThroughputListQuerySchema>;
