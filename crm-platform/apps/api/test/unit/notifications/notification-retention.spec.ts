import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  retentionConfig,
  type RetentionConfig,
} from '../../../src/config/domains/notifications.env';
import { NotificationRetentionService } from '../../../src/modules/notifications/notification-retention.service';

const DAY = 86_400_000;
const NOW = new Date('2027-03-01T03:30:00Z');
const config = (over: Partial<RetentionConfig> = {}): RetentionConfig => ({
  enabled: true,
  readDays: 90,
  unreadDays: 180,
  batchSize: 100,
  maxBatches: 50,
  ...over,
});

/**
 * A database that answers the two statements the job issues. `script` says how many rows each batch deletes per kind and whether the
 * advisory lock is granted; every executed statement is kept so the cutoffs bound into it can be checked.
 */
function harness(script: {
  read: number[];
  unread: number[];
  lock?: (call: number) => boolean;
  /** Live days saved on the retention dashboard, by item. */
  policies?: Record<string, number>;
}) {
  const queues = { read: [...script.read], unread: [...script.unread] };
  const calls: Array<{ kind: 'read' | 'unread'; cutoff: string; size: number }> = [];
  let lockCalls = 0;
  const db = {
    privileged: async <T>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
      let pendingKind: 'read' | 'unread' | null = null;
      const tx = {
        execute: async (query: { queryChunks: unknown[] }) => {
          const text = flatten(query);
          // The retention dashboard's saved windows and the note of the run: nothing saved, nothing to write back.
          if (text.includes('FROM data_retention_policies')) {
            const item = String(params_(query)[0]);
            const days = script.policies?.[item];
            return {
              rows:
                days === undefined
                  ? []
                  : [
                      {
                        item,
                        live_days: days,
                        archive_days: null,
                        row_version: 1,
                        updated_by: 1,
                        updated_at: NOW.toISOString(),
                      },
                    ],
            };
          }
          if (text.includes('data_retention_')) return { rows: [] };
          if (text.includes('pg_try_advisory_xact_lock')) {
            lockCalls += 1;
            return { rows: [{ ok: script.lock ? script.lock(lockCalls) : true }] };
          }
          pendingKind = text.includes('read_at IS NOT NULL AND created_at <') ? 'read' : 'unread';
          const params = params_(query);
          calls.push({ kind: pendingKind, cutoff: String(params[0]), size: Number(params[1]) });
          return { rows: [{ n: queues[pendingKind].shift() ?? 0 }] };
        },
      };
      return fn(tx);
    },
  };
  return { svc: new NotificationRetentionService(db as never), calls, lockCalls: () => lockCalls };
}

// Drizzle's `sql` object is a list of chunks: literal text is a StringChunk (`value: string[]`), a nested sql() has `queryChunks`, and
// every bound value is the raw JS value. Flatten it to the statement text and the list of bound values.
function flatten(q: unknown): string {
  const chunks = (q as { queryChunks?: unknown[] }).queryChunks;
  if (!chunks) return '';
  return chunks
    .map((c) => {
      if (c !== null && typeof c === 'object') {
        const v = (c as { value?: unknown }).value;
        if (Array.isArray(v)) return v.join('');
        if ((c as { queryChunks?: unknown[] }).queryChunks) return flatten(c);
      }
      return '?';
    })
    .join('');
}
function params_(q: unknown): unknown[] {
  const out: unknown[] = [];
  const walk = (x: unknown) => {
    for (const c of (x as { queryChunks?: unknown[] }).queryChunks ?? []) {
      if (c !== null && typeof c === 'object') {
        if (Array.isArray((c as { value?: unknown }).value)) continue;
        if ((c as { queryChunks?: unknown[] }).queryChunks) walk(c);
      } else {
        out.push(c);
      }
    }
  };
  walk(q);
  return out;
}

afterEach(() => vi.useRealTimers());

describe('NotificationRetentionService with a fake clock', () => {
  it('computes the cutoffs from the clock it is given: 90 days for read rows, 180 for unread', async () => {
    const { svc, calls } = harness({ read: [0], unread: [0] });
    const res = await svc.runOnce(NOW, config());
    expect(res.readCutoff).toBe(new Date(NOW.getTime() - 90 * DAY).toISOString());
    expect(res.unreadCutoff).toBe(new Date(NOW.getTime() - 180 * DAY).toISOString());
    expect(calls.map((c) => c.kind)).toEqual(['read', 'unread']);
    expect(calls[0]!.cutoff).toBe(res.readCutoff);
    expect(calls[1]!.cutoff).toBe(res.unreadCutoff);
    expect(res).toMatchObject({
      skipped: false,
      readDeleted: 0,
      unreadDeleted: 0,
      moreToDo: false,
    });
  });

  it('uses the windows saved on the retention dashboard instead of the environment’s', async () => {
    const { svc } = harness({
      read: [0],
      unread: [0],
      policies: { notifications_read: 45, notifications_unread: 100 },
    });
    const res = await svc.runOnce(NOW, config());
    expect(res.readCutoff).toBe(new Date(NOW.getTime() - 45 * DAY).toISOString());
    expect(res.unreadCutoff).toBe(new Date(NOW.getTime() - 100 * DAY).toISOString());
  });

  it('never deletes an unread row before a read one, even if the saved numbers say so', async () => {
    const { svc } = harness({
      read: [0],
      unread: [0],
      policies: { notifications_read: 120, notifications_unread: 60 },
    });
    const res = await svc.runOnce(NOW, config());
    expect(res.unreadCutoff).toBe(res.readCutoff);
  });

  it('moves with the clock: the same job a month later reaches a month further', async () => {
    const { svc } = harness({ read: [0, 0], unread: [0, 0] });
    const a = await svc.runOnce(NOW, config());
    const b = await svc.runOnce(new Date(NOW.getTime() + 30 * DAY), config());
    expect(Date.parse(b.readCutoff) - Date.parse(a.readCutoff)).toBe(30 * DAY);
  });

  it('never prunes anything from the last 90 days with the defaults (the cutoff is never later than now minus 90 days)', async () => {
    const res = await harness({ read: [0], unread: [0] }).svc.runOnce(
      NOW,
      retentionConfig({} as never),
    );
    expect(Date.parse(res.readCutoff)).toBeLessThanOrEqual(NOW.getTime() - 90 * DAY);
    expect(Date.parse(res.unreadCutoff)).toBeLessThanOrEqual(NOW.getTime() - 90 * DAY);
  });

  it('keeps deleting full batches until one comes back short, then moves to the next kind', async () => {
    const { svc, calls } = harness({ read: [100, 100, 100, 40], unread: [100, 7] });
    const res = await svc.runOnce(NOW, config());
    expect(res).toMatchObject({
      readDeleted: 340,
      unreadDeleted: 107,
      batches: 6,
      moreToDo: false,
    });
    expect(calls.map((c) => c.kind)).toEqual(['read', 'read', 'read', 'read', 'unread', 'unread']);
    expect(calls.every((c) => c.size === 100)).toBe(true);
  });

  it('stops at the batch limit per kind and says that more is left', async () => {
    const full = Array(10).fill(100) as number[];
    const { svc, calls } = harness({ read: full, unread: full });
    const res = await svc.runOnce(NOW, config({ maxBatches: 3 }));
    expect(res).toMatchObject({ readDeleted: 300, unreadDeleted: 300, batches: 6, moreToDo: true });
    expect(calls).toHaveLength(6);
  });

  it('does nothing and reports skipped when another worker holds the lock', async () => {
    const { svc, calls } = harness({ read: [100], unread: [100], lock: () => false });
    const res = await svc.runOnce(NOW, config());
    expect(res).toMatchObject({ skipped: true, readDeleted: 0, unreadDeleted: 0 });
    expect(calls).toHaveLength(0);
  });

  it('stops midway when the lock is lost to another worker, keeping what it already deleted', async () => {
    const { svc } = harness({ read: [100, 100], unread: [100], lock: (n) => n <= 1 });
    const res = await svc.runOnce(NOW, config());
    expect(res).toMatchObject({ skipped: true, readDeleted: 100 });
  });

  it('does not run its daily pass when switched off', async () => {
    const { svc, lockCalls } = harness({ read: [1], unread: [1] });
    const prev = process.env.NOTIFY_RETENTION_ENABLED;
    process.env.NOTIFY_RETENTION_ENABLED = 'false';
    try {
      await svc.daily();
    } finally {
      if (prev === undefined) delete process.env.NOTIFY_RETENTION_ENABLED;
      else process.env.NOTIFY_RETENTION_ENABLED = prev;
    }
    expect(lockCalls()).toBe(0);
  });

  it('does not overlap itself: a second daily call while one runs is ignored', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let batches = 0;
    const db = {
      privileged: async <T>(fn: (tx: unknown) => Promise<T>) => {
        await gate;
        return fn({
          execute: async (q: unknown) => {
            const text = flatten(q);
            if (text.includes('data_retention_')) return { rows: [] };
            // One advisory lock is taken per batch; the windows read and the run notes are not batches.
            if (text.includes('pg_try_advisory_xact_lock')) {
              batches += 1;
              return { rows: [{ ok: true }] };
            }
            return { rows: [{ n: 0 }] };
          },
        });
      },
    };
    const svc = new NotificationRetentionService(db as never);
    const first = svc.daily();
    const second = svc.daily();
    release();
    await Promise.all([first, second]);
    // Two batches (read, unread) from ONE pass, not four.
    expect(batches).toBe(2);
  });
});

describe('retention settings', () => {
  it('defaults to 90 / 180 days, 5000 per batch, 200 batches', () => {
    expect(retentionConfig({} as never)).toEqual({
      enabled: true,
      readDays: 90,
      unreadDays: 180,
      batchSize: 5000,
      maxBatches: 200,
    });
  });
  it('reads the environment, and never lets unread outlive-prune read', () => {
    expect(
      retentionConfig({
        NOTIFY_RETENTION_ENABLED: 'false',
        NOTIFY_RETENTION_READ_DAYS: '60',
        NOTIFY_RETENTION_UNREAD_DAYS: '45',
        NOTIFY_RETENTION_BATCH_SIZE: '1000',
        NOTIFY_RETENTION_MAX_BATCHES: '5',
      } as never),
    ).toEqual({ enabled: false, readDays: 60, unreadDays: 60, batchSize: 1000, maxBatches: 5 });
  });
  it('refuses a read age under 30 days and a silly batch size', () => {
    expect(() => retentionConfig({ NOTIFY_RETENTION_READ_DAYS: '7' } as never)).toThrow();
    expect(() => retentionConfig({ NOTIFY_RETENTION_BATCH_SIZE: '10' } as never)).toThrow();
  });
});
