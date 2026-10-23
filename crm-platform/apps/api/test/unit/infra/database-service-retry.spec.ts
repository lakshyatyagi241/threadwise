import { describe, expect, it, vi } from 'vitest';
import type { DbClientPair } from '@crm/db';
import { DatabaseService } from '../../../src/infra/db/database.service';

const pgError = (code: string) => Object.assign(new Error(`pg ${code}`), { code });
const noWait = { sleep: () => Promise.resolve(), random: () => 1 };

/** A database stand-in without a pool: runTransaction falls back to db.transaction(fn). Counts rolled-back and committed runs. */
function service() {
  const state = { rolledBack: 0, committed: 0 };
  const tx = { execute: vi.fn().mockResolvedValue({ rows: [] }) };
  const db = {
    transaction: async (fn: (t: typeof tx) => Promise<unknown>) => {
      try {
        const out = await fn(tx);
        state.committed++;
        return out;
      } catch (err) {
        state.rolledBack++;
        throw err;
      }
    },
  };
  const pair = { primary: { db }, replica: { db } } as unknown as DbClientPair;
  return { svc: new DatabaseService(pair), state };
}

describe('DatabaseService transaction retry option', () => {
  it('without the option a deadlock is thrown on the first try (behaviour unchanged)', async () => {
    const { svc, state } = service();
    const fn = vi.fn().mockRejectedValue(pgError('40P01'));
    await expect(svc.txAs({ orgId: 1 }, fn)).rejects.toMatchObject({ code: '40P01' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(state.rolledBack).toBe(1);
  });

  it('retries a deadlock in txAs, runs the work again from the start, and commits once', async () => {
    const { svc, state } = service();
    const fn = vi.fn().mockRejectedValueOnce(pgError('40P01')).mockResolvedValueOnce('done');
    await expect(svc.txAs({ orgId: 1 }, fn, { retry: noWait })).resolves.toBe('done');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(state).toEqual({ rolledBack: 1, committed: 1 });
  });

  it('retries a serialization failure in privileged', async () => {
    const { svc } = service();
    const fn = vi.fn().mockRejectedValueOnce(pgError('40001')).mockResolvedValueOnce(7);
    await expect(svc.privileged(fn, { retry: noWait })).resolves.toBe(7);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('does not retry an ordinary error such as a unique violation', async () => {
    const { svc } = service();
    const fn = vi.fn().mockRejectedValue(pgError('23505'));
    await expect(svc.txAs({ orgId: 1 }, fn, { retry: noWait })).rejects.toMatchObject({
      code: '23505',
    });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('a dropped connection is retried only when the caller says the work is safe to repeat', async () => {
    const lost = Object.assign(new Error('Connection terminated unexpectedly'), {
      code: 'ECONNRESET',
    });
    const a = service();
    const plain = vi.fn().mockRejectedValue(lost);
    await expect(a.svc.txAs({ orgId: 1 }, plain, { retry: noWait })).rejects.toBe(lost);
    expect(plain).toHaveBeenCalledTimes(1);

    const b = service();
    const idem = vi.fn().mockRejectedValueOnce(lost).mockResolvedValueOnce('ok');
    await expect(
      b.svc.txAs({ orgId: 1 }, idem, { retry: { ...noWait, idempotent: true } }),
    ).resolves.toBe('ok');
    expect(idem).toHaveBeenCalledTimes(2);
  });

  it('gives up after the attempts and throws the last conflict', async () => {
    const { svc } = service();
    const fn = vi.fn().mockRejectedValue(pgError('40P01'));
    await expect(
      svc.txAs({ orgId: 1 }, fn, { retry: { ...noWait, attempts: 3 } }),
    ).rejects.toMatchObject({ code: '40P01' });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('db.retry retries a conflict but not a dropped connection; db.retryIdem retries both', async () => {
    const lost = Object.assign(new Error('Connection terminated unexpectedly'), {
      code: 'ECONNRESET',
    });
    const { svc } = service();
    // the default sleeps are real here, so keep the failures to one each (the first backoff is at most 25 ms)
    const conflict = vi.fn().mockRejectedValueOnce(pgError('40001')).mockResolvedValueOnce('ok');
    await expect(svc.retry.txAs({ orgId: 1 }, conflict)).resolves.toBe('ok');
    expect(conflict).toHaveBeenCalledTimes(2);

    const dropped = vi.fn().mockRejectedValue(lost);
    await expect(svc.retry.txAs({ orgId: 1 }, dropped)).rejects.toBe(lost);
    expect(dropped).toHaveBeenCalledTimes(1);

    const idem = vi.fn().mockRejectedValueOnce(lost).mockResolvedValueOnce('ok');
    await expect(svc.retryIdem.txAs({ orgId: 1 }, idem)).resolves.toBe('ok');
    expect(idem).toHaveBeenCalledTimes(2);
  });

  it('db.retry.tx still needs a request context (fails closed, nothing is retried)', async () => {
    const { svc } = service();
    const fn = vi.fn();
    await expect(svc.retry.tx(fn)).rejects.toThrow();
    expect(fn).not.toHaveBeenCalled();
  });

  it('refuses to run without a tenant, retry or not (the RLS guard is unchanged)', async () => {
    const { svc } = service();
    const fn = vi.fn();
    await expect(svc.txAs({ orgId: 0 }, fn, { retry: noWait })).rejects.toThrow(/orgId/);
    expect(fn).not.toHaveBeenCalled();
  });
});
