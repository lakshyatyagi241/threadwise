/**
 * What the worker publishes in Redis so the API (and the container healthcheck) can tell it is alive and keeping up. The worker
 * has no HTTP port, and the API must not read the outbox itself: that table spans every tenant and is only reachable in
 * privileged mode, which is not allowed from a request handler. So the worker samples and the API reads.
 */

/** Sorted set of worker instances; the score is the time of the last beat in ms. Reading it is O(log n), unlike a key scan. */
export const WORKERS_KEY = 'infra:workers';
/** JSON of {@link OutboxSample}, written by whichever worker beats; expires if every worker stops. */
export const OUTBOX_SAMPLE_KEY = 'infra:outbox:sample';

export interface OutboxSample {
  /** Events due now and not yet picked up, capped at {@link READY_CAP}. */
  ready: number;
  /** Seconds the oldest due event has been due (0 when nothing is due). */
  lagSeconds: number;
  /** Events that exhausted their retries (`status = 'dead'`) and wait for a replay, capped at {@link READY_CAP}. Alert on > 0. */
  dead?: number;
  /** When the sample was taken, ms since epoch. */
  sampledAt: number;
}

/** Counting stops here: past this the exact number stops mattering and the count must stay cheap. */
export const READY_CAP = 10_000;

/** Identifies one worker process. The hostname is the container id in Docker, which is what the container healthcheck knows. */
export const instanceId = (host: string, pid: number): string => `${host}:${pid}`;

/** The beat is `aliveForBeats` times its interval before a worker stops counting as alive. */
export const ALIVE_FOR_BEATS = 3;
