/** The slice of a BullMQ `Queue` the sampler uses. Structural, so it is testable without Redis. */
export interface DepthQueue {
  getJobCounts(...states: string[]): Promise<Record<string, number>>;
  getJobs(
    types: string[],
    start?: number,
    end?: number,
    asc?: boolean,
  ): Promise<Array<{ timestamp?: number } | undefined>>;
}

export interface QueueDepth {
  waiting: number;
  active: number;
  /** Delayed jobs are scheduled or backing off: reported apart so a retry storm is not read as a backlog. */
  delayed: number;
  failed: number;
  /** Age of the oldest job that is eligible to run and has not started; 0 when none waits. */
  oldestWaitingSeconds: number;
}

const COUNT_STATES = ['waiting', 'active', 'delayed', 'prioritized', 'failed'] as const;

/**
 * One queue's depth and oldest eligible waiting age (QCAP-013, 014). `prioritized` counts as waiting: it is runnable work.
 * The oldest job is only looked up when something waits, so an idle queue costs one round trip.
 */
export async function sampleQueueDepth(queue: DepthQueue, now = Date.now()): Promise<QueueDepth> {
  const c = await queue.getJobCounts(...COUNT_STATES);
  const waiting = (c.waiting ?? 0) + (c.prioritized ?? 0);
  let oldestWaitingSeconds = 0;
  if (waiting > 0) {
    // asc=true returns the oldest first: BullMQ pushes to the left of the wait list and workers take from the right.
    const [oldest] = await queue.getJobs(['waiting'], 0, 0, true);
    if (oldest?.timestamp) oldestWaitingSeconds = Math.max(0, (now - oldest.timestamp) / 1000);
  }
  return {
    waiting,
    active: c.active ?? 0,
    delayed: c.delayed ?? 0,
    failed: c.failed ?? 0,
    oldestWaitingSeconds,
  };
}
