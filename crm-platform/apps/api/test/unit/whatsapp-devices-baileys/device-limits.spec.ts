import { describe, expect, it } from 'vitest';
import { DeviceLimits } from '../../../src/modules/whatsapp-devices-baileys/device-limits.service';

/** A Redis whose `multi().incr().expire().ttl().exec()` counts per key, as the real one does inside a fixed window. */
function fakeRedis(opts: { fail?: boolean } = {}) {
  const counts = new Map<string, number>();
  const ttls = new Map<string, number>();
  return {
    multi() {
      let key = '';
      let window = 0;
      const chain = {
        incr(k: string) {
          key = k;
          return chain;
        },
        expire(_k: string, w: number) {
          window = w;
          return chain;
        },
        ttl() {
          return chain;
        },
        async exec() {
          if (opts.fail) throw new Error('redis down');
          const n = (counts.get(key) ?? 0) + 1;
          counts.set(key, n);
          if (!ttls.has(key)) ttls.set(key, window);
          return [
            [null, n],
            [null, 1],
            [null, ttls.get(key)],
          ];
        },
      };
      return chain;
    },
  };
}

const limits = (r: ReturnType<typeof fakeRedis>) => new DeviceLimits(r as never);

describe('the abuse limits (spec 10.3)', () => {
  it('allows 5 pairing starts per device per hour, then 429 with retryAfterS', async () => {
    const l = limits(fakeRedis());
    for (let i = 0; i < 5; i++) await l.pairingStart(1, 10);
    const err = (await l.pairingStart(1, 10).catch((e: unknown) => e)) as {
      code: string;
      getStatus(): number;
      details: Array<{ path: string; message: string }>;
    };
    expect(err.code).toBe('DEVICE_PAIRING_RATE_LIMITED');
    expect(err.getStatus()).toBe(429);
    expect(err.details[0]).toEqual({ path: 'retryAfterS', message: '3600' });
  });

  it('the budget is per device: another device of the workspace still has its own', async () => {
    const l = limits(fakeRedis());
    for (let i = 0; i < 5; i++) await l.pairingStart(1, 10);
    await expect(l.pairingStart(1, 11)).resolves.toBeUndefined();
  });

  it('20 pairing starts per workspace per day, across devices', async () => {
    const l = limits(fakeRedis());
    // 10 devices x 2 starts each stays under the per-device budget but reaches the workspace's 20
    for (let i = 0; i < 20; i++) await l.pairingStart(1, 100 + (i % 10));
    await expect(l.pairingStart(1, 200)).rejects.toMatchObject({
      code: 'DEVICE_PAIRING_RATE_LIMITED',
    });
  });

  it('another workspace is not affected', async () => {
    const l = limits(fakeRedis());
    for (let i = 0; i < 6; i++) await l.pairingStart(1, 10).catch(() => undefined);
    await expect(l.pairingStart(2, 10)).resolves.toBeUndefined();
  });

  it('10 devices per workspace per hour, then 429 DEVICE_CREATE_RATE_LIMITED', async () => {
    const l = limits(fakeRedis());
    for (let i = 0; i < 10; i++) await l.creation(1);
    await expect(l.creation(1)).rejects.toMatchObject({ code: 'DEVICE_CREATE_RATE_LIMITED' });
  });

  it('fails open when Redis is down (and does not throw)', async () => {
    const l = limits(fakeRedis({ fail: true }));
    await expect(l.pairingStart(1, 10)).resolves.toBeUndefined();
    await expect(l.creation(1)).resolves.toBeUndefined();
  });
});
