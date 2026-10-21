import { describe, expect, it } from 'vitest';
import {
  CAPTURED_FAILURE_GRACE_MS,
  UNCAPTURED_FAILURE_GRACE_MS,
  parseMemoryInfo,
  pressureTier,
  trimPlan,
} from './queue-guard';
import { QUEUES } from './queues';

// what the worker module passes: the queues the dead-letter sweep copies (a stand-in for the real list, which the domain owns)
const CAPTURED = new Set<string>([QUEUES.WABA_INGEST, QUEUES.WEBHOOK_INGEST]);

describe('queue guard', () => {
  it('reads used_memory and maxmemory from INFO memory', () => {
    const info =
      '# Memory\r\nused_memory:1048576\r\nused_memory_human:1.00M\r\nmaxmemory:201326592\r\n';
    expect(parseMemoryInfo(info)).toEqual({ used: 1048576, max: 201326592 });
    expect(parseMemoryInfo('')).toEqual({ used: 0, max: 0 });
  });

  it('picks the tier from the share of maxmemory', () => {
    expect(pressureTier(50, 100)).toBe(0);
    expect(pressureTier(75, 100)).toBe(1);
    expect(pressureTier(90, 100)).toBe(2);
    // No maxmemory set: there is no ratio, so nothing is trimmed.
    expect(pressureTier(900, 0)).toBe(0);
  });

  it('does nothing when memory is fine', () => {
    expect(trimPlan(0, CAPTURED)).toEqual([]);
  });

  it('tier 1 keeps the failures that the dead-letter sweep copies for longer than the others', () => {
    const plan = trimPlan(1, CAPTURED);
    const failed = (q: string) => plan.find((s) => s.queue === q && s.type === 'failed');
    expect(failed(QUEUES.WABA_INGEST)).toBeUndefined();
    expect(failed(QUEUES.CAMPAIGN)?.graceMs).toBe(UNCAPTURED_FAILURE_GRACE_MS);
    expect(plan.filter((s) => s.type === 'completed')).toHaveLength(Object.values(QUEUES).length);
  });

  it('tier 2 trims failures of every queue but leaves the capture sweep time to copy them', () => {
    const failed = trimPlan(2, CAPTURED).filter((s) => s.type === 'failed');
    expect(failed).toHaveLength(Object.values(QUEUES).length);
    expect(failed.every((s) => s.graceMs === CAPTURED_FAILURE_GRACE_MS)).toBe(true);
  });
});
