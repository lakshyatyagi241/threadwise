import { z } from 'zod';

/**
 * Settings of the scheduled-messages engine (SCHED, TW-NODE-030, 036). Read straight from the environment (the central schema
 * belongs to the kernel) and validated once; every value has a safe default so a fresh checkout runs.
 */
const schema = z.object({
  /**
   * How late a one-off may start and still run. Reference skipped a past one-off at boot and left its row `scheduled` forever
   * (a double-send guard). Here a run is claimed in the database, so there is no double-send to guard against; this only stops a
   * message from the past reaching someone days later after an outage.
   */
  SCHED_MAX_LATE_MINUTES: z.coerce.number().int().min(0).default(60),
  /** A `running` row whose job has finished or vanished is queued again after this long (the reconciliation job of TW-NODE-036). */
  SCHED_STALE_RUN_MINUTES: z.coerce.number().int().min(1).default(10),
});

export type ScheduledConfig = z.output<typeof schema>;

/** Read at call time so tests can change the environment between runs. */
export function scheduledConfig(env: NodeJS.ProcessEnv = process.env): ScheduledConfig {
  return schema.parse(env);
}
