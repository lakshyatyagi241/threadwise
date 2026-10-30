import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AsyncOpsService } from '../../../src/modules/platform-async-ops/async-ops.service';

afterEach(() => vi.restoreAllMocks());

/** A service whose queue holds two failed jobs; the recorder and redrive are the parts each case changes. */
function serviceWith(record: () => Promise<unknown>, redrive: () => Promise<unknown>) {
  const jobs = [
    { id: '1', attemptsMade: 3, opts: { attempts: 3 }, remove: vi.fn(async () => undefined) },
    { id: '2', attemptsMade: 3, opts: { attempts: 3 }, remove: vi.fn(async () => undefined) },
  ];
  const queue = { getFailed: vi.fn(async () => jobs) };
  const store = { tx: async (fn: (tx: unknown) => Promise<unknown>) => fn({}) };
  const audit = { record: vi.fn(async () => undefined) };
  const recorder = { record: vi.fn(record) };
  const failedOps = { redrive: vi.fn(redrive) };
  const service = new AsyncOpsService(
    store as never,
    queue as never,
    queue as never,
    audit as never,
    recorder as never,
    failedOps as never,
  );
  return { service, audit };
}

describe('bulk replay outcome', () => {
  it('counts a database error as errored and logs it, not as skipped', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { service, audit } = serviceWith(
      async () => {
        throw new Error('db down');
      },
      async () => ({ redriven: true }),
    );
    const out = await service.replayWaba({ limit: 10 }, 7);
    expect(out).toEqual({ replayed: 0, skipped: 0, errored: 2 });
    expect(error).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ payload: expect.objectContaining({ errored: 2, skipped: 0 }) }),
    );
  });

  it('keeps counting a job the redrive refuses as skipped', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { service } = serviceWith(
      async () => ({ uuid: 'u-1' }),
      async () => ({ redriven: false }),
    );
    const out = await service.replayWaba({ limit: 10 }, 7);
    expect(out).toEqual({ replayed: 0, skipped: 2, errored: 0 });
    expect(error).not.toHaveBeenCalled();
  });
});
