import { describe, expect, it, vi } from 'vitest';
import {
  ACCOUNT_ATTACK_FACTOR,
  AccountAttackGuard,
} from '../../../src/modules/auth/security/account-attack.service';

/** Counters and sets in memory; enough Redis for the guard. */
function fakes(captcha: 'not-configured' | 'ok' | 'failed' = 'not-configured') {
  const counts = new Map<string, number>();
  const sets = new Map<string, Set<string>>();
  const rate = {
    hit: vi.fn(async (key: string) => {
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return { count: counts.get(key)!, retryAfterSeconds: 3000 };
    }),
    peek: vi.fn(async (key: string) => ({ count: counts.get(key) ?? 0, retryAfterSeconds: 3000 })),
  };
  const redis = {
    sadd: async (k: string, v: string) => (sets.get(k) ?? sets.set(k, new Set()).get(k)!).add(v),
    expire: async () => 1,
    scard: async (k: string) => sets.get(k)?.size ?? 0,
    spop: async () => null,
    sismember: async (k: string, v: string) => (sets.get(k)?.has(v) ? 1 : 0),
  };
  const audit = { recordStandalone: vi.fn(async () => undefined) };
  const cap = { check: vi.fn(async () => captcha) };
  const guard = new AccountAttackGuard(rate as never, cap as never, audit as never, redis as never);
  return { guard, audit, cap };
}

const policy = { lockoutAfterFailures: 5 };
const LIMIT = 5 * ACCOUNT_ATTACK_FACTOR;
const spread = async (guard: AccountAttackGuard, n: number, email = 'a@acme.test') => {
  for (let i = 0; i < n; i++) await guard.recordFailure('staff', 1, email, policy);
};

describe('account-wide failure counter (distributed guessing)', () => {
  it('does nothing until the account has failed LIMIT times, from any addresses', async () => {
    const { guard } = fakes();
    await spread(guard, LIMIT - 1);
    await expect(
      guard.assertAllowed('staff', 1, 'a@acme.test', '203.0.113.9', undefined, policy),
    ).resolves.toBeUndefined();
  });

  it('then refuses networks the person has never signed in from', async () => {
    const { guard } = fakes();
    await spread(guard, LIMIT);
    await expect(
      guard.assertAllowed('staff', 1, 'a@acme.test', '203.0.113.9', undefined, policy),
    ).rejects.toMatchObject({ code: 'AUTH_CHALLENGE_REQUIRED' });
  });

  it('never locks out the owner on a network they have used before', async () => {
    const { guard } = fakes();
    await guard.rememberNetwork('staff', 1, 'a@acme.test', '198.51.100.20');
    await spread(guard, LIMIT * 3);
    // same first two octets as the remembered sign-in
    await expect(
      guard.assertAllowed('staff', 1, 'a@acme.test', '198.51.7.7', undefined, policy),
    ).resolves.toBeUndefined();
    await expect(
      guard.assertAllowed('staff', 1, 'a@acme.test', '203.0.113.9', undefined, policy),
    ).rejects.toMatchObject({ code: 'AUTH_CHALLENGE_REQUIRED' });
  });

  it('lets an unfamiliar network through when it solves the captcha', async () => {
    const { guard, cap } = fakes('ok');
    await spread(guard, LIMIT);
    await expect(
      guard.assertAllowed('staff', 1, 'a@acme.test', '203.0.113.9', 'token', policy),
    ).resolves.toBeUndefined();
    expect(cap.check).toHaveBeenCalledWith('token', 'login');
  });

  it('keeps accounts, workspaces and pools apart', async () => {
    const { guard } = fakes();
    await spread(guard, LIMIT, 'a@acme.test');
    await expect(
      guard.assertAllowed('staff', 1, 'b@acme.test', '203.0.113.9', undefined, policy),
    ).resolves.toBeUndefined();
    await expect(
      guard.assertAllowed('staff', 2, 'a@acme.test', '203.0.113.9', undefined, policy),
    ).resolves.toBeUndefined();
    await expect(
      guard.assertAllowed('operator', 1, 'a@acme.test', '203.0.113.9', undefined, policy),
    ).resolves.toBeUndefined();
  });

  it('treats the partner pool as captcha-less (they have no captcha form)', async () => {
    const { guard, cap } = fakes('ok');
    for (let i = 0; i < LIMIT; i++) await guard.recordFailure('partner', 1, 'p@x.test', policy);
    await expect(
      guard.assertAllowed('partner', 1, 'p@x.test', '203.0.113.9', 'whatever', policy),
    ).rejects.toMatchObject({ code: 'AUTH_CHALLENGE_REQUIRED' });
    expect(cap.check).not.toHaveBeenCalled();
  });

  it('is off when the lockout is switched off, and records the crossing once', async () => {
    const off = fakes();
    await spread(off.guard, 100);
    expect(off.guard.threshold({ lockoutAfterFailures: 0 })).toBe(0);
    const { guard, audit } = fakes();
    await spread(guard, LIMIT + 10);
    expect(audit.recordStandalone).toHaveBeenCalledTimes(1);
    expect(audit.recordStandalone).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'auth.account_under_attack', status: 'warning' }),
    );
  });

  it('gives the same answer for an account that does not exist (no oracle)', async () => {
    const { guard } = fakes();
    await spread(guard, LIMIT, 'ghost@nowhere.test');
    await expect(
      guard.assertAllowed('staff', 1, 'ghost@nowhere.test', '203.0.113.9', undefined, policy),
    ).rejects.toMatchObject({ code: 'AUTH_CHALLENGE_REQUIRED' });
  });
});
