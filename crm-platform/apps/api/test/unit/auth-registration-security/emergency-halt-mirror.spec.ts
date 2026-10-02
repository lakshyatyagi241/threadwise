import { describe, expect, it, vi } from 'vitest';
import {
  EmergencyHaltService,
  HALT_MIRROR_TTL_SECONDS,
} from '../../../src/modules/auth/security/emergency-halt.service';
import { AuthKeys } from '../../../src/modules/auth/support/redis-keys';
import { guessMediaType } from '../../../src/modules/auth/platform/auth-settings.service';

function make(opts: { redisDown?: boolean; staleMirror?: '0' | '1' } = {}) {
  const store: { halted: boolean | undefined } = { halted: undefined };
  const mirror = new Map<string, { value: string; ttl: number | null }>();
  if (opts.staleMirror) mirror.set(AuthKeys.halt, { value: opts.staleMirror, ttl: 30 });
  const redis = {
    failing: Boolean(opts.redisDown),
    get: vi.fn(async (k: string) => {
      if (redis.failing) throw new Error('redis down');
      return mirror.get(k)?.value ?? null;
    }),
    set: vi.fn(async (k: string, v: string, _ex?: string, ttl?: number) => {
      if (redis.failing) throw new Error('redis down');
      mirror.set(k, { value: v, ttl: ttl ?? null });
      return 'OK';
    }),
  };
  const settings = {
    get: vi.fn(async () => store.halted),
    set: vi.fn(async (_k: string, v: boolean) => void (store.halted = v)),
  };
  const halt = new EmergencyHaltService(settings as never, redis as never);
  return { halt, redis, settings, mirror, store };
}

describe('emergency halt flag mirror (TW-AUTH-040)', () => {
  it('writes the Redis copy with an expiry, so it can never be wrong for long', async () => {
    const { halt, mirror } = make();
    await halt.set(true, 1);
    expect(mirror.get(AuthKeys.halt)).toEqual({ value: '1', ttl: HALT_MIRROR_TTL_SECONDS });
    expect(await halt.isHalted()).toBe(true);
  });

  it('after a failed mirror write the flipping instance reads the database, not a stale "not halted"', async () => {
    const { halt, redis, mirror } = make({ staleMirror: '0' });
    redis.failing = true; // the mirror write fails right after the database write
    await halt.set(true, 1);
    redis.failing = false; // Redis is back, still holding the old "0"
    expect(mirror.get(AuthKeys.halt)?.value).toBe('0');

    expect(await halt.isHalted()).toBe(true);
    // The read repaired the mirror, so it is trusted again.
    expect(mirror.get(AuthKeys.halt)?.value).toBe('1');
    await expect(halt.assertNotHalted()).rejects.toMatchObject({ code: 'AUTH_SEND_HALTED' });
  });

  it('falls back to the database when Redis cannot be read, and fills the mirror once it can', async () => {
    const { halt, redis, mirror, store } = make({ redisDown: true });
    store.halted = true;
    expect(await halt.isHalted()).toBe(true);
    redis.failing = false;
    expect(await halt.isHalted()).toBe(true);
    expect(mirror.get(AuthKeys.halt)).toEqual({ value: '1', ttl: HALT_MIRROR_TTL_SECONDS });
  });

  it('re-reads the database once the mirror has expired, so a lost mirror write is bounded by the expiry', async () => {
    const { halt, mirror, store } = make();
    store.halted = false;
    expect(await halt.isHalted()).toBe(false);
    // Flipped on another instance whose mirror write was lost: Redis still says 0 ...
    store.halted = true;
    expect(await halt.isHalted()).toBe(false);
    // ... until the key expires, after which the database decides.
    mirror.delete(AuthKeys.halt);
    expect(await halt.isHalted()).toBe(true);
  });
});

describe('auth page media kind from its address (TW-AUTH-021)', () => {
  it.each([
    ['https://cdn.test/a.mp4', 'video'],
    ['https://cdn.test/a.WEBM?x=1', 'video'],
    ['https://cdn.test/clip.mov', 'video'],
    ['https://cdn.test/loop.gif', 'gif'],
    ['https://cdn.test/photo.png', 'image'],
    ['https://cdn.test/photo.jpeg#frag', 'image'],
    ['https://cdn.test/noextension', 'image'],
    ['https://cdn.test/dir.mp4/photo.jpg', 'image'],
  ])('%s is %s', (url, kind) => {
    expect(guessMediaType(url)).toBe(kind);
  });
});
