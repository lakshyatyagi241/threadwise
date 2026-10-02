import { describe, expect, it } from 'vitest';
import type { SyncProductsResponse } from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';
import { MAX_CHUNKS, progressPercent, pushLog, runSyncLoop, waiting } from './sync-model';

const res = (over: Partial<SyncProductsResponse> = {}): SyncProductsResponse => ({
  pushed: 0,
  hasMore: false,
  totalPending: 0,
  totalSynced: 0,
  totalFailed: 0,
  ...over,
});

const noop = () => undefined;

describe('progressPercent', () => {
  it('is 100 when nothing is left', () => {
    expect(progressPercent(res({ hasMore: false, totalSynced: 3 }))).toBe(100);
  });
  it('is capped at 95 while more remains', () => {
    expect(
      progressPercent(res({ hasMore: true, totalSynced: 1000, totalPending: 1000 })),
    ).toBeLessThanOrEqual(95);
    expect(progressPercent(res({ hasMore: true }))).toBe(0);
  });
  it('grows with the share already sent', () => {
    const half = progressPercent(
      res({ hasMore: true, totalSynced: 10, totalPending: 0, totalFailed: 9 }),
    );
    expect(half).toBeCloseTo(50, 5);
  });
});

describe('runSyncLoop', () => {
  it('posts again while hasMore and stops at the last chunk', async () => {
    const answers = [
      res({ pushed: 1000, hasMore: true, totalPending: 1000 }),
      res({ pushed: 500, hasMore: false, totalPending: 1500 }),
    ];
    let calls = 0;
    const seen: number[] = [];
    const out = await runSyncLoop(async () => answers[calls++]!, {
      onChunk: (_r, p) => seen.push(p),
    });
    expect(calls).toBe(2);
    expect(out.total).toBe(1500);
    expect(out.error).toBeNull();
    expect(out.stalled).toBe(false);
    expect(seen.at(-1)).toBe(100);
  });

  it('terminates after two chunks for 1500 never-synced products', async () => {
    let left = 1500;
    let calls = 0;
    const out = await runSyncLoop(
      async () => {
        calls++;
        const pushed = Math.min(1000, left);
        left -= pushed;
        return res({ pushed, hasMore: left > 0 });
      },
      { onChunk: noop },
    );
    expect(calls).toBe(2);
    expect(out.total).toBe(1500);
  });

  it('does not loop on a chunk that moved nothing', async () => {
    let calls = 0;
    const out = await runSyncLoop(
      async () => {
        calls++;
        return res({ pushed: 0, hasMore: true });
      },
      { onChunk: noop },
    );
    expect(calls).toBe(1);
    expect(out.stalled).toBe(true);
  });

  it('keeps what was pushed before a failure and reports the error', async () => {
    let calls = 0;
    const boom = new ApiError(502, 'CAT_PROVIDER_FAILED', 'Meta is down');
    const out = await runSyncLoop(
      async () => {
        if (calls++ === 0) return res({ pushed: 10, hasMore: true });
        throw boom;
      },
      { onChunk: noop },
    );
    expect(out.total).toBe(10);
    expect(out.error).toBe(boom);
  });

  it('has a hard cap', async () => {
    let calls = 0;
    const out = await runSyncLoop(
      async () => {
        calls++;
        return res({ pushed: 1, hasMore: true });
      },
      { onChunk: noop },
    );
    expect(calls).toBe(MAX_CHUNKS);
    expect(out.stalled).toBe(true);
  });
});

describe('waiting and pushLog', () => {
  it('counts unsynced plus failed', () => {
    expect(waiting({ unsynced: 4, failed: 1, pending: 2, synced: 3 })).toBe(5);
    expect(waiting({})).toBe(0);
  });
  it('keeps the newest line first and bounded', () => {
    let log = pushLog([], { at: '1', tone: 'info', text: 'a' });
    log = pushLog(log, { at: '2', tone: 'ok', text: 'b' });
    expect(log.map((l) => l.text)).toEqual(['b', 'a']);
    expect(log[0]!.id).toBeGreaterThan(log[1]!.id);
    for (let i = 0; i < 10; i++) log = pushLog(log, { at: '3', tone: 'info', text: 'x' }, 5);
    expect(log).toHaveLength(5);
  });
});
