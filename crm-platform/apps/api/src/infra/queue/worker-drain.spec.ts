import { describe, expect, it, vi } from 'vitest';
import { drainWorkers } from './worker-drain.service';

describe('drainWorkers', () => {
  it('closes every worker and counts the ones that closed', async () => {
    const a = { name: 'a', close: vi.fn().mockResolvedValue(undefined) };
    const b = { name: 'b', close: vi.fn().mockResolvedValue(undefined) };
    expect(await drainWorkers([a, b])).toBe(2);
    expect(a.close).toHaveBeenCalledOnce();
    expect(b.close).toHaveBeenCalledOnce();
  });

  it('one worker failing to close does not stop the others', async () => {
    const bad = { name: 'bad', close: vi.fn().mockRejectedValue(new Error('boom')) };
    const good = { name: 'good', close: vi.fn().mockResolvedValue(undefined) };
    const onError = vi.fn();
    expect(await drainWorkers([bad, good], onError)).toBe(1);
    expect(good.close).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith('bad', expect.any(Error));
  });

  it('waits for a running job: resolves only after close does', async () => {
    let release!: () => void;
    const slow = { name: 'slow', close: () => new Promise<void>((r) => (release = r)) };
    let done = false;
    const p = drainWorkers([slow]).then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false);
    release();
    await p;
    expect(done).toBe(true);
  });
});
