import { FAILURE_POLICIES } from '../../modules/failed-operations/failure-policy';
import { QUEUES } from './queues';

/** Share of Redis `maxmemory` in use above which the guard starts trimming finished-job history. */
export const MEMORY_WARN_RATIO = 0.75;
/** Above this the guard also trims failed jobs of every queue: a full `noeviction` Redis refuses every write, which stops all queues at once. */
export const MEMORY_HIGH_RATIO = 0.9;

/**
 * A failed job of a queue in the dead-letter policy is copied to the database by the capture sweep (once a minute, from the failed
 * set), so it must stay at least this long before it may be trimmed.
 */
export const CAPTURED_FAILURE_GRACE_MS = 10 * 60 * 1000;
/** Failures of queues whose state lives in a table are only evidence: trimmed after an hour under pressure. */
export const UNCAPTURED_FAILURE_GRACE_MS = 60 * 60 * 1000;

/** Jobs removed per queue and tick. Bounded so one tick cannot hold Redis (its commands are single threaded). */
export const TRIM_BATCH = 2_000;

export type PressureTier = 0 | 1 | 2;

/** 0 = fine (or no `maxmemory` set, so no ratio exists), 1 = trim finished history, 2 = trim failures of every queue as well. */
export function pressureTier(usedBytes: number, maxBytes: number): PressureTier {
  if (!(maxBytes > 0) || !(usedBytes >= 0)) return 0;
  const ratio = usedBytes / maxBytes;
  return ratio >= MEMORY_HIGH_RATIO ? 2 : ratio >= MEMORY_WARN_RATIO ? 1 : 0;
}

/** `used_memory` and `maxmemory` out of the text of `INFO memory`. */
export function parseMemoryInfo(info: string): { used: number; max: number } {
  const read = (key: string) => {
    const m = new RegExp(`^${key}:(\\d+)`, 'm').exec(info);
    return m ? Number(m[1]) : 0;
  };
  return { used: read('used_memory'), max: read('maxmemory') };
}

export interface TrimStep {
  queue: string;
  type: 'completed' | 'failed';
  graceMs: number;
}

const CAPTURED = new Set<string>(FAILURE_POLICIES.map((p) => p.queue));

/** What to remove at a tier, per queue. Active, waiting and delayed jobs are never in it. */
export function trimPlan(tier: PressureTier): TrimStep[] {
  if (tier === 0) return [];
  const steps: TrimStep[] = [];
  for (const queue of Object.values(QUEUES)) {
    steps.push({ queue, type: 'completed', graceMs: 0 });
    const captured = CAPTURED.has(queue);
    if (tier === 2 || !captured) {
      steps.push({
        queue,
        type: 'failed',
        graceMs: captured || tier === 2 ? CAPTURED_FAILURE_GRACE_MS : UNCAPTURED_FAILURE_GRACE_MS,
      });
    }
  }
  return steps;
}
