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
});
export type HealthQueueRow = z.infer<typeof healthQueueRowSchema>;

export const healthResponseSchema = z.object({
  overall: z.enum(['up', 'warn', 'down']),
  checks: z.array(healthCheckSchema),
  queues: z.array(healthQueueRowSchema),
  vitals: healthVitalsSchema,
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
