import { describe, expect, it, vi } from 'vitest';
import { AsyncOpsService } from './async-ops.service';

/**
 * ASYNC-044/045/046/050: failed work is visible and can be replayed by an authorized operator, replay only re-queues what is already
 * stored (the caller never supplies a payload), every replay is audited, and a second replay finds nothing left to replay.
 */
function build(
  opts: {
    results?: unknown[][];
    failedJobs?: Array<Record<string, unknown>>;
    retryJobs?: Array<Record<string, unknown>>;
  } = {},
) {
  const results = [...(opts.results ?? [])];
  const executed: unknown[] = [];
  const tx = {
    execute: async (q: unknown) => {
      executed.push(q);
      return { rows: results.shift() ?? [] };
    },
  };
  const store = { tx: async <T>(fn: (t: typeof tx) => Promise<T>) => fn(tx) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const queue = { getFailed: vi.fn().mockResolvedValue(opts.failedJobs ?? []) };
  const retryQueue = { getFailed: vi.fn().mockResolvedValue(opts.retryJobs ?? []) };
  const svc = new AsyncOpsService(
    store as never,
    queue as never,
    retryQueue as never,
    audit as never,
  );
  return { svc, audit, queue, retryQueue, executed };
}

describe('AsyncOpsService.deadOutbox', () => {
  it('groups dead events by type, cuts the error and returns no payload', async () => {
    const { svc } = build({
      results: [
        [
          {
            event_type: 'wallet.charge',
            n: 3,
            oldest: new Date('2026-10-01T10:00:00Z'),
            last_error: 'x'.repeat(500),
          },
        ],
      ],
    });
    const out = await svc.deadOutbox();
    expect(out).toEqual([
      {
        eventType: 'wallet.charge',
        count: 3,
        oldestAt: '2026-10-01T10:00:00.000Z',
        lastError: 'x'.repeat(300),
      },
    ]);
  });
});

describe('AsyncOpsService.replayOutbox', () => {
  it('re-queues the dead events of one type and audits who did it and how many', async () => {
    const { svc, audit } = build({ results: [[{ id: '1' }, { id: '2' }], [{ n: 1 }]] });
    const out = await svc.replayOutbox({ eventType: 'wallet.charge', limit: 200 }, 42);
    expect(out).toEqual({ replayed: 2, skippedInactiveWorkspace: 1 });
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record.mock.calls[0]![1]).toMatchObject({
      event: 'platform.async_ops.outbox_replayed',
      actorType: 'platform_operator',
      actorId: 42,
      payload: { eventType: 'wallet.charge', replayed: 2, skippedInactiveWorkspace: 1, limit: 200 },
    });
  });

  it('a second replay finds nothing left and replays nothing (no duplicate effect from a double click)', async () => {
    const { svc } = build({ results: [[], [{ n: 0 }]] });
    expect(await svc.replayOutbox({ eventType: 'wallet.charge', limit: 200 }, 42)).toEqual({
      replayed: 0,
      skippedInactiveWorkspace: 0,
    });
  });
});

describe('AsyncOpsService WhatsApp ingest jobs', () => {
  const failed = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    attemptsMade: 10,
    opts: { attempts: 10 },
    failedReason: 'db down',
    finishedOn: 1_800_000_000_000,
    data: { changes: [{ phone: '+911234567890', text: 'secret' }] },
    retry: vi.fn().mockResolvedValue(undefined),
    ...over,
  });

  it('lists failed jobs without their payload', async () => {
    const { svc } = build({ failedJobs: [failed('a', { failedReason: 'y'.repeat(500) })] });
    const out = await svc.failedWaba(50);
    expect(out).toEqual([
      {
        jobId: 'a',
        attemptsMade: 10,
        failedReason: 'y'.repeat(300),
        failedAt: new Date(1_800_000_000_000).toISOString(),
      },
    ]);
    expect(JSON.stringify(out)).not.toContain('secret');
  });

  it('retries each failed job under its own id and audits the replay', async () => {
    const a = failed('a');
    const b = failed('b');
    const { svc, audit, queue } = build({ failedJobs: [a, b] });
    expect(await svc.replayWaba({ limit: 100 }, 42)).toEqual({ replayed: 2, skipped: 0 });
    expect(queue.getFailed).toHaveBeenCalledWith(0, 99);
    // attemptsMade is already at the limit; without a reset the replayed job would get exactly one attempt and no backoff retries.
    expect(a.retry).toHaveBeenCalledWith('failed', { resetAttemptsMade: true });
    expect(b.retry).toHaveBeenCalledWith('failed', { resetAttemptsMade: true });
    expect(audit.record.mock.calls[0]![1]).toMatchObject({
      event: 'platform.async_ops.waba_ingest_replayed',
      actorId: 42,
      payload: { replayed: 2, skipped: 0, limit: 100 },
    });
  });

  it('does not retry a job that failed before using its attempts (a rule the data broke)', async () => {
    const permanent = failed('p', { attemptsMade: 2 });
    const exhausted = failed('e');
    const { svc } = build({ failedJobs: [permanent, exhausted] });
    expect(await svc.replayWaba({ limit: 100 }, 42)).toEqual({ replayed: 1, skipped: 1 });
    expect(permanent.retry).not.toHaveBeenCalled();
    expect(exhausted.retry).toHaveBeenCalled();
  });

  it('counts a job that is no longer failed as skipped instead of failing the whole replay', async () => {
    const a = failed('a', { retry: vi.fn().mockRejectedValue(new Error('not in failed state')) });
    const b = failed('b');
    const { svc } = build({ failedJobs: [a, b] });
    expect(await svc.replayWaba({ limit: 100 }, 42)).toEqual({ replayed: 1, skipped: 1 });
  });
});

describe('AsyncOpsService webhook retry jobs', () => {
  const failed = (id: string, over: Record<string, unknown> = {}) => ({
    id,
    attemptsMade: 10,
    opts: { attempts: 10 },
    failedReason: 'db down',
    finishedOn: 1_800_000_000_000,
    data: { channel: 'telegram', payload: { update: { message: { text: 'secret' } } } },
    retry: vi.fn().mockResolvedValue(undefined),
    ...over,
  });

  it('lists failed jobs with their channel and no payload', async () => {
    const { svc } = build({ retryJobs: [failed('a')] });
    const out = await svc.failedWebhookRetry(50);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ jobId: 'a', attemptsMade: 10 });
    expect(JSON.stringify(out)).not.toContain('secret');
  });

  it('replays exhausted jobs with a fresh budget, skips ones that failed on purpose, and audits it', async () => {
    const exhausted = failed('e');
    const permanent = failed('p', { attemptsMade: 2 });
    const { svc, audit, retryQueue } = build({ retryJobs: [exhausted, permanent] });
    expect(await svc.replayWebhookRetry({ limit: 100 }, 42)).toEqual({ replayed: 1, skipped: 1 });
    expect(retryQueue.getFailed).toHaveBeenCalledWith(0, 99);
    expect(exhausted.retry).toHaveBeenCalledWith('failed', { resetAttemptsMade: true });
    expect(permanent.retry).not.toHaveBeenCalled();
    expect(audit.record.mock.calls[0]![1]).toMatchObject({
      event: 'platform.async_ops.webhook_retry_replayed',
      actorId: 42,
      payload: { replayed: 1, skipped: 1, limit: 100 },
    });
  });
});
