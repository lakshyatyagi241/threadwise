import { describe, expect, it, vi } from 'vitest';
import { isConflict, isConnectionLoss, retryTransaction } from '@crm/db';

const pgError = (code: string) => Object.assign(new Error(`pg ${code}`), { code });
/** drizzle wraps the driver error: the code is on `cause`. */
const wrapped = (code: string) =>
  Object.assign(new Error('Failed query'), { cause: pgError(code) });
const noWait = { sleep: () => Promise.resolve(), random: () => 1 };

describe('retryTransaction', () => {
  it('classifies conflicts and dropped connections, through a wrapped cause', () => {
    expect(isConflict(pgError('40001'))).toBe(true);
    expect(isConflict(wrapped('40P01'))).toBe(true);
    expect(isConflict(pgError('23505'))).toBe(false);
    expect(isConnectionLoss(Object.assign(new Error('x'), { code: 'ECONNRESET' }))).toBe(true);
    expect(isConnectionLoss(new Error('Connection terminated unexpectedly'))).toBe(true);
    expect(isConnectionLoss(pgError('23505'))).toBe(false);
  });

  it('runs once and returns when nothing fails', async () => {
    const run = vi.fn().mockResolvedValue('ok');
    await expect(retryTransaction(run, noWait)).resolves.toBe('ok');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('retries a deadlock and a serialization failure, then succeeds', async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(wrapped('40P01'))
      .mockRejectedValueOnce(pgError('40001'))
      .mockResolvedValue('done');
    await expect(retryTransaction(run, noWait)).resolves.toBe('done');
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('gives up after the attempts and throws the last error', async () => {
    const err = pgError('40001');
    const run = vi.fn().mockRejectedValue(err);
    await expect(retryTransaction(run, { ...noWait, attempts: 2 })).rejects.toBe(err);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('never retries an error that is not a conflict (a unique violation stays a unique violation)', async () => {
    const run = vi.fn().mockRejectedValue(pgError('23505'));
    await expect(retryTransaction(run, noWait)).rejects.toThrow('23505');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('retries a dropped connection only when the caller says the work is idempotent', async () => {
    const lost = Object.assign(new Error('x'), { code: 'ECONNRESET' });
    const plain = vi.fn().mockRejectedValue(lost);
    await expect(retryTransaction(plain, noWait)).rejects.toBe(lost);
    expect(plain).toHaveBeenCalledTimes(1);

    const safe = vi.fn().mockRejectedValueOnce(lost).mockResolvedValue('ok');
    await expect(retryTransaction(safe, { ...noWait, idempotent: true })).resolves.toBe('ok');
    expect(safe).toHaveBeenCalledTimes(2);
  });

  it('backs off with full jitter, doubling up to the cap', async () => {
    const delays: number[] = [];
    const run = vi.fn().mockRejectedValue(pgError('40001'));
    await expect(
      retryTransaction(run, {
        attempts: 5,
        baseMs: 10,
        maxMs: 50,
        random: () => 0.5,
        sleep: () => Promise.resolve(),
        onRetry: (i) => delays.push(i.delayMs),
      }),
    ).rejects.toThrow();
    expect(delays).toEqual([5, 10, 20, 25]); // half of 10, 20, 40, then capped at 50
  });
});
