import { z } from 'zod';

/**
 * System health (TW-DASH-048..051): the operator console's probes. States follow Reference: up = Operational, warn = Degraded,
 * down = Down, idle = Idle (a probe that has nothing to check).
 */
export const HEALTH_STATES = ['up', 'warn', 'down', 'idle'] as const;
export const healthStateSchema = z.enum(HEALTH_STATES);
export type HealthState = z.infer<typeof healthStateSchema>;

export const HEALTH_CHECK_KEYS = ['database', 'cache', 'queue', 'bridge', 'storage'] as const;
export const healthCheckKeySchema = z.enum(HEALTH_CHECK_KEYS);
export type HealthCheckKey = z.infer<typeof healthCheckKeySchema>;

export const healthCheckSchema = z.object({
  key: healthCheckKeySchema,
  state: healthStateSchema,
  /** Short capitalised value shown big on the card (driver, host, bucket). */
  value: z.string(),
  detail: z.string(),
  /** Round-trip milliseconds, when the probe measured one. */
  ping: z.number().int().nonnegative().nullable(),
});
export type HealthCheck = z.infer<typeof healthCheckSchema>;

export const healthVitalsSchema = z.object({
  nodeVersion: z.string(),
  appVersion: z.string(),
  environment: z.string(),
  uptimeSeconds: z.number().int().nonnegative(),
  memoryRssMb: z.number().nonnegative(),
  memoryHeapMb: z.number().nonnegative(),
  diskFreeGb: z.number().nonnegative().nullable(),
  diskUsedPct: z.number().min(0).max(100).nullable(),
});
export type HealthVitals = z.infer<typeof healthVitalsSchema>;

export const healthQueueRowSchema = z.object({
  name: z.string(),
  pending: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  /** Why the newest failed job failed: one line, cut short, with the job's parameters removed. Null when nothing failed. */
  lastFailure: z.string().nullable(),
});
export type HealthQueueRow = z.infer<typeof healthQueueRowSchema>;

/** TW-DASH-049: last-24-hour counters across every workspace. */
export const healthActivitySchema = z.object({
  messages: z.number().int().nonnegative(),
  aiCalls: z.number().int().nonnegative(),
  conversations: z.number().int().nonnegative(),
  webhooks: z.number().int().nonnegative(),
});
export type HealthActivity = z.infer<typeof healthActivitySchema>;

/** One day of the 14-day message-volume line (UTC day, `YYYY-MM-DD`). */
export const healthThroughputPointSchema = z.object({
  date: z.string(),
  count: z.number().int().nonnegative(),
});

/** TW-DASH-050: one WhatsApp engine's numbers across every workspace (unofficial devices, WABA, Twilio). */
export const healthEngineSchema = z.object({
  key: z.enum(['baileys', 'waba', 'twilio']),
  label: z.string(),
  connected: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  /** idle with no numbers, up with a connected one, else down. Never affects the overall banner. */
  state: z.enum(['up', 'down', 'idle']),
  breakdown: z.array(z.object({ status: z.string(), count: z.number().int().nonnegative() })),
});
export type HealthEngine = z.infer<typeof healthEngineSchema>;

export const healthResponseSchema = z.object({
  overall: z.enum(['up', 'warn', 'down']),
  checks: z.array(healthCheckSchema),
  queues: z.array(healthQueueRowSchema),
  engines: z.array(healthEngineSchema),
  vitals: healthVitalsSchema,
  activity: healthActivitySchema,
  throughput: z.array(healthThroughputPointSchema),
  /** ISO-8601. */
  ts: z.string(),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

/** TW-DASH-051 in BullMQ terms: drain waiting and delayed jobs and remove failed ones, queue by queue. Active jobs are never touched. */
export const clearQueueRequestSchema = z.object({
  /** One queue name; omit to clear every queue. */
  queue: z.string().min(1).max(64).optional(),
});
export type ClearQueueRequest = z.infer<typeof clearQueueRequestSchema>;

export const clearQueueResponseSchema = z.object({
  ok: z.literal(true),
  clearedPending: z.number().int().nonnegative(),
  clearedFailed: z.number().int().nonnegative(),
  message: z.string(),
});
export type ClearQueueResponse = z.infer<typeof clearQueueResponseSchema>;
