import { describe, expect, it, vi } from 'vitest';
import { sampleQueueDepth, type DepthQueue } from '../../../src/modules/platform-infrastructure';

const NOW = 1_700_000_000_000;

function fake(counts: Record<string, number>, oldestTs?: number): DepthQueue & { getJobs: ReturnType<typeof vi.fn> } {
  return {
    getJobCounts: vi.fn(async () => counts),
    getJobs: vi.fn(async () => (oldestTs === undefined ? [] : [{ timestamp: oldestTs }])),
  };
}

describe('sampleQueueDepth', () => {
  it('reports the states apart and the age of the oldest waiting job in seconds', async () => {
    const q = fake({ waiting: 40, active: 8, delayed: 5, failed: 2 }, NOW - 12_500);
    expect(await sampleQueueDepth(q, NOW)).toEqual({ waiting: 40, active: 8, delayed: 5, failed: 2, oldestWaitingSeconds: 12.5 });
    expect(q.getJobs).toHaveBeenCalledWith(['waiting'], 0, 0, true);
  });

  it('counts prioritized jobs as waiting: they are runnable work', async () => {
    const q = fake({ waiting: 1, prioritized: 9 }, NOW - 1000);
    expect((await sampleQueueDepth(q, NOW)).waiting).toBe(10);
  });

  it('does not look up an oldest job for an idle queue (one round trip)', async () => {
    const q = fake({ waiting: 0, active: 3 });
    const d = await sampleQueueDepth(q, NOW);
    expect(d.oldestWaitingSeconds).toBe(0);
    expect(q.getJobs).not.toHaveBeenCalled();
  });

  it('keeps delayed work out of the backlog and never reports a negative age', async () => {
    const q = fake({ waiting: 2, delayed: 5000 }, NOW + 5000);
    const d = await sampleQueueDepth(q, NOW);
    expect(d.waiting).toBe(2);
    expect(d.delayed).toBe(5000);
    expect(d.oldestWaitingSeconds).toBe(0);
  });

  it('survives a missing state in the counts', async () => {
    expect(await sampleQueueDepth(fake({}), NOW)).toEqual({ waiting: 0, active: 0, delayed: 0, failed: 0, oldestWaitingSeconds: 0 });
  });
});
