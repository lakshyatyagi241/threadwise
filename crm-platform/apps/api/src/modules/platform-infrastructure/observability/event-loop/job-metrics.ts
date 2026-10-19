import type { RuntimeMonitor } from '@crm/observability';

/** The BullMQ `Job` fields the timing needs. Structural, so the hook is testable without Redis. */
export interface JobTimingFields {
  /** When the job was added (ms since epoch). */
  timestamp: number;
  /** When the current attempt started. */
  processedOn?: number;
  /** When the current attempt ended. */
  finishedOn?: number;
  /** How many times a worker has started the job; above 1 means this attempt is a retry. */
  attemptsStarted?: number;
  /** The delay the job currently carries. 0 after a delayed job is promoted, so it cannot be trusted alone. */
  delay?: number;
  opts?: { delay?: number };
}

/** The slice of a BullMQ `Worker` the hook uses. `name` is the queue name. */
export interface ObservableWorker {
  name: string;
  on(event: 'completed' | 'failed', listener: (job: JobTimingFields | undefined) => void): unknown;
}

export interface JobTimings {
  /** Time from "ready to run" to "started". null when it is not a queue wait (a retry) or cannot be known. */
  waitMs: number | null;
  durationMs: number;
  /** Starts beyond the first: retries after a failure, and restarts after a stall. 0 for a job that ran once. */
  retries: number;
}

/**
 * Wait and duration of one finished attempt, or null when the job carries no timing.
 *
 * Wait excludes the delay the producer asked for: a job scheduled an hour ahead waited zero, not an hour, and counting the delay
 * would make every scheduled job look like a backlog. A retry's wait is not recorded at all, because `timestamp` is the first
 * enqueue and the gap since then is the earlier attempts plus backoff, not queue pressure.
 *
 * What the worker reports (measured against a real BullMQ worker): `completed` and `failed` fire when a job reaches a FINAL state,
 * not for an attempt that will be retried. So a job that succeeds on its third attempt is one `completed` observation with the
 * duration of the last attempt and no wait; earlier failed attempts are invisible here.
 */
export function jobTimings(job: JobTimingFields | undefined): JobTimings | null {
  if (!job || job.processedOn === undefined || job.finishedOn === undefined) return null;
  const durationMs = job.finishedOn - job.processedOn;
  if (!Number.isFinite(durationMs) || durationMs < 0) return null;
  const starts = job.attemptsStarted ?? 1;
  const isRetry = starts > 1;
  const retries = Number.isFinite(starts) ? Math.max(0, Math.floor(starts) - 1) : 0;
  // The larger of the two: BullMQ resets `job.delay` to 0 once a delayed job is promoted (measured against a real worker), so only
  // `opts.delay` still says how long it was asked to wait; `job.delay` can be larger after a later changeDelay.
  const delay = Math.max(job.delay ?? 0, job.opts?.delay ?? 0);
  const raw = job.processedOn - job.timestamp - delay;
  const waitMs = isRetry || !Number.isFinite(raw) ? null : Math.max(0, raw);
  return { waitMs, durationMs, retries };
}

/**
 * Feeds a worker's finished jobs to the monitor. The queue label is the worker's queue name (a fixed set, see `QUEUES`); job ids,
 * names, data and error messages never reach a metric. One observation per job that reaches a final state.
 */
export function attachJobMetrics(
  worker: ObservableWorker,
  monitor: Pick<RuntimeMonitor, 'observeJob'>,
): void {
  const record = (outcome: 'completed' | 'failed') => (job: JobTimingFields | undefined) => {
    try {
      const t = jobTimings(job);
      if (t) monitor.observeJob(worker.name, t.waitMs, t.durationMs, outcome, t.retries);
    } catch {
      // Observability must never fail a job.
    }
  };
  worker.on('completed', record('completed'));
  worker.on('failed', record('failed'));
}
