import { describe, expect, it, vi } from 'vitest';
import { FailureCaptureService, isFinalFailure } from './failure-capture.service';

const job = (over: Record<string, unknown> = {}) =>
  ({ id: 'j1', name: 'n', data: {}, attemptsMade: 1, opts: { attempts: 3 }, ...over }) as never;
const unrecoverable = Object.assign(new Error('Malformed ingest job'), {
  name: 'UnrecoverableError',
});

describe('isFinalFailure', () => {
  it('a failed attempt that will be retried is not final (BullMQ emits `failed` for it too)', () => {
    expect(isFinalFailure({ attemptsMade: 1, opts: { attempts: 3 } }, new Error('x'))).toBe(false);
    expect(isFinalFailure({ attemptsMade: 2, opts: { attempts: 3 } }, new Error('x'))).toBe(false);
  });

  it('the last attempt is final', () => {
    expect(isFinalFailure({ attemptsMade: 3, opts: { attempts: 3 } }, new Error('x'))).toBe(true);
  });

  it('an UnrecoverableError is final whatever the count', () => {
    expect(isFinalFailure({ attemptsMade: 1, opts: { attempts: 10 } }, unrecoverable)).toBe(true);
  });

  it('a job with no attempts option has one try', () => {
    expect(isFinalFailure({ attemptsMade: 1, opts: {} }, new Error('x'))).toBe(true);
  });
});

function build() {
  const recorder = {
    record: vi.fn().mockResolvedValue({ recorded: true, created: true, uuid: 'u' }),
  };
  const repo = { byUuid: vi.fn(), replayFailed: vi.fn(), close: vi.fn() };
  const svc = new FailureCaptureService({} as never, recorder as never, repo as never, {} as never);
  return { svc, recorder, repo };
}

describe('FailureCaptureService.onFailed', () => {
  it('records nothing for an attempt that will be retried', async () => {
    const { svc, recorder } = build();
    await svc.onFailed('webhook-ingest', job({ attemptsMade: 1 }), new Error('db down'));
    expect(recorder.record).not.toHaveBeenCalled();
  });

  it('records an exhausted job, marked recoverable-by-count', async () => {
    const { svc, recorder } = build();
    await svc.onFailed('webhook-ingest', job({ attemptsMade: 3 }), new Error('db down'));
    expect(recorder.record).toHaveBeenCalledTimes(1);
    expect(recorder.record.mock.calls[0]![2]).toBe(false);
  });

  it('records an unrecoverable job as such', async () => {
    const { svc, recorder } = build();
    await svc.onFailed('webhook-ingest', job({ attemptsMade: 1 }), unrecoverable);
    expect(recorder.record.mock.calls[0]![2]).toBe(true);
  });

  it('never throws out of the event handler when the record cannot be written (the sweep will retry)', async () => {
    const { svc, recorder } = build();
    recorder.record.mockRejectedValue(new Error('database is down'));
    await expect(
      svc.onFailed('webhook-ingest', job({ attemptsMade: 3 }), new Error('x')),
    ).resolves.toBeUndefined();
    // Three tries, the last two after a wait: the database may be back a second later.
    expect(recorder.record).toHaveBeenCalledTimes(3);
  }, 10_000);

  it('does not record a redriven job as a new operation: it goes back to its own record', async () => {
    const { svc, recorder, repo } = build();
    repo.byUuid.mockResolvedValue({ source_queue: 'webhook-ingest', replay_count: 1 });
    const id = 'dlq-3f0c2d1e-5b7a-4c1d-9e2f-1a2b3c4d5e6f-1';
    await svc.onFailed(
      'webhook-ingest',
      job({ id, attemptsMade: 10, opts: { attempts: 10 } }),
      new Error('db down'),
    );
    expect(recorder.record).not.toHaveBeenCalled();
    expect(repo.replayFailed).toHaveBeenCalledWith(
      '3f0c2d1e-5b7a-4c1d-9e2f-1a2b3c4d5e6f',
      expect.objectContaining({ status: 'OPEN', attemptsMade: 10 }),
    );
  });

  it('escalates a redriven job that failed again once the replay budget is used', async () => {
    const { svc, repo } = build();
    repo.byUuid.mockResolvedValue({ source_queue: 'webhook-ingest', replay_count: 3 });
    const id = 'dlq-3f0c2d1e-5b7a-4c1d-9e2f-1a2b3c4d5e6f-3';
    await svc.onFailed(
      'webhook-ingest',
      job({ id, attemptsMade: 10, opts: { attempts: 10 } }),
      new Error('db down'),
    );
    expect(repo.replayFailed.mock.calls[0]![1].status).toBe('ESCALATED');
  });
});

describe('FailureCaptureService.onCompleted', () => {
  it('closes the record of a redriven job that completed, and ignores every other job', async () => {
    const { svc, repo } = build();
    await svc.onCompleted('webhook-ingest', job({ id: 'ingest-abc' }));
    expect(repo.close).not.toHaveBeenCalled();
    await svc.onCompleted(
      'webhook-ingest',
      job({ id: 'dlq-3f0c2d1e-5b7a-4c1d-9e2f-1a2b3c4d5e6f-1' }),
    );
    expect(repo.close).toHaveBeenCalledWith(
      '3f0c2d1e-5b7a-4c1d-9e2f-1a2b3c4d5e6f',
      'RESOLVED',
      ['REDRIVING'],
      expect.any(String),
      expect.anything(),
    );
  });
});
