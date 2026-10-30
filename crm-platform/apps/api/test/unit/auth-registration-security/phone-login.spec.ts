import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, registrationSettingsSchema } from '@crm/contracts';
import { AppError } from '../../../src/common/errors/app-error';
import { PhoneLoginService } from '../../../src/modules/auth/flows/phone-login.service';

/**
 * Sign-in with a mobile number and a code. What must hold: a number with no account looks exactly like one with an account
 * (nobody can find out who is a customer), a code works once, guesses are limited, and a right code goes through the same
 * steps a right password does (second factor, workspace choice, lockout) in `LoginService`.
 */
const PHONE = '+919876543210';
const OTHER = '+919000000000';
const meta = { ip: '203.0.113.9', userAgent: 'test' };

class FakeRedis {
  readonly store = new Map<string, string>();
  async get(key: string) {
    return this.store.get(key) ?? null;
  }
  async setex(key: string, _ttl: number, value: string) {
    this.store.set(key, value);
    return 'OK';
  }
  async del(key: string) {
    this.store.delete(key);
    return 1;
  }
  /** The service's one script: take the challenge only if it still carries the hash. */
  async eval(_script: string, _n: number, key: string, hash: string) {
    const raw = this.store.get(key);
    if (!raw) return false;
    if ((JSON.parse(raw) as { otpHash: string }).otpHash !== hash) return 0;
    this.store.delete(key);
    return raw;
  }
  multi() {
    const ops: Array<() => number> = [];
    const chain = {
      incr: (key: string) => {
        ops.push(() => {
          const next = Number(this.store.get(key) ?? 0) + 1;
          this.store.set(key, String(next));
          return next;
        });
        return chain;
      },
      expire: () => chain,
      exec: async () => ops.map((op) => [null, op()]),
    };
    return chain;
  }
}

const orgOf = (id: number) => ({ id, slug: `org-${id}`, name: `Org ${id}`, status: 'active' });
const userOf = (id: number) => ({
  id,
  uuid: `u-${id}`,
  email: `u${id}@example.test`,
  full_name: `User ${id}`,
  status: 'active',
});

function make(
  opts: {
    active?: boolean;
    accounts?: Record<string, Array<{ orgId: number; userId: number }>>;
    sendFails?: boolean;
    locked?: boolean;
    maxAttempts?: number;
    remember?: boolean;
  } = {},
) {
  const redis = new FakeRedis();
  const sent: Array<{ to: string; code: string }> = [];
  const sender = {
    send: vi.fn(async (input: { to: string; code: string }) => {
      if (opts.sendFails) throw new Error('provider down');
      sent.push({ to: input.to, code: input.code });
    }),
  };
  const accounts = opts.accounts ?? { [PHONE]: [{ orgId: 1, userId: 10 }] };
  const login = {
    loadOrgAndUser: vi.fn(async (orgId: number, userId: number) => ({
      org: orgOf(orgId),
      user: userOf(userId),
    })),
    assertNotLocked: vi.fn(async () => {
      if (opts.locked) throw new AppError(ERROR_CODES.AUTH_ACCOUNT_LOCKED, 'locked', 423);
    }),
    afterCredential: vi.fn(async () => ({ status: 'authenticated' })),
    offerWorkspaces: vi.fn(async () => ({ status: 'workspace_required' })),
  };
  const audit = { recordStandalone: vi.fn(async () => undefined) };
  const counts = new Map<string, number>();
  const rate = {
    allow: vi.fn(async () => true),
    hit: vi.fn(async (key: string) => {
      // Only the failed-code counter keeps state; the per-address throttles are not what these tests are about.
      if (!key.startsWith('auth:otp-phone-fails:')) return { count: 1, retryAfterSeconds: 0 };
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return { count, retryAfterSeconds: 0 };
    }),
    peek: vi.fn(async (key: string) => ({ count: counts.get(key) ?? 0, retryAfterSeconds: 0 })),
    reset: vi.fn(async (key: string) => {
      counts.delete(key);
    }),
  };
  const registration = {
    ...registrationSettingsSchema.parse({}),
    otp: {
      ...registrationSettingsSchema.parse({}).otp,
      maxAttempts: opts.maxAttempts ?? 5,
    },
  };
  const svc = new PhoneLoginService(
    {
      registration: async () => registration,
      policy: async () => ({ rememberMeEnabled: opts.remember ?? true }),
    } as never,
    { statusFor: async () => ({ active: opts.active ?? true }) } as never,
    { assert: vi.fn(async () => undefined) } as never,
    { activeAccountsForVerifiedPhone: async (phone: string) => accounts[phone] ?? [] } as never,
    rate as never,
    audit as never,
    login as never,
    sender as never,
    redis as never,
  );
  return { svc, redis, sent, login, audit, rate, sender };
}

const start = (svc: PhoneLoginService, phone = PHONE, remember = false) =>
  svc.start({ phone, remember }, meta);

describe('PhoneLoginService.start', () => {
  it('sends a code to a number that has an account and answers with a masked number', async () => {
    const { svc, sent } = make();
    const challenge = await start(svc);
    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe(PHONE);
    expect(challenge.maskedPhone).not.toContain('9876543210');
    expect(challenge.codeLength).toBe(sent[0]?.code.length);
  });

  it('answers a number with no account in the same shape and sends nothing', async () => {
    const { svc, sent } = make();
    const known = await start(svc);
    const unknown = await start(svc, OTHER);
    expect(sent).toHaveLength(1);
    expect(Object.keys(unknown).sort()).toEqual(Object.keys(known).sort());
    expect(unknown.expiresInSeconds).toBe(known.expiresInSeconds);
    expect(unknown.resendCooldownSeconds).toBe(known.resendCooldownSeconds);
    expect(unknown.codeLength).toBe(known.codeLength);
  });

  it('does not tell the caller when the code could not be sent', async () => {
    const { svc } = make({ sendFails: true });
    await expect(start(svc)).resolves.toMatchObject({ challengeId: expect.any(String) });
  });

  it('answers without waiting for the code to be sent, so the time it takes does not tell whose number it is', async () => {
    const { svc, sender } = make();
    sender.send.mockImplementation(() => new Promise<void>(() => undefined)); // never finishes
    const known = await start(svc);
    expect(known.challengeId).toEqual(expect.any(String));
    expect(sender.send).toHaveBeenCalledTimes(1);
  });

  it('is refused while the code step is not active', async () => {
    const { svc, sent } = make({ active: false });
    await expect(start(svc)).rejects.toMatchObject({ status: HttpStatus.SERVICE_UNAVAILABLE });
    expect(sent).toHaveLength(0);
  });

  it('is refused, for known and unknown numbers alike, once the send limit is reached', async () => {
    const { svc, rate } = make();
    rate.allow.mockResolvedValue(false);
    for (const phone of [PHONE, OTHER]) {
      await expect(start(svc, phone)).rejects.toMatchObject({
        status: HttpStatus.TOO_MANY_REQUESTS,
      });
    }
  });
});

describe('PhoneLoginService.verify', () => {
  it('opens the sign-in with the code that was sent, as a phone sign-in', async () => {
    const { svc, sent, login } = make({ remember: true });
    const { challengeId } = await start(svc, PHONE, true);
    const result = await svc.verify({ challengeId, code: sent[0]!.code }, meta);
    expect(result).toMatchObject({ status: 'authenticated' });
    expect(login.afterCredential).toHaveBeenCalledTimes(1);
    const args = login.afterCredential.mock.calls[0] as unknown[];
    expect(args[2]).toBe(true); // remember
    expect(args[5]).toBe('phone');
  });

  it('does not keep the person signed in when the platform turned that off', async () => {
    const { svc, sent, login } = make({ remember: false });
    const { challengeId } = await start(svc, PHONE, true);
    await svc.verify({ challengeId, code: sent[0]!.code }, meta);
    expect((login.afterCredential.mock.calls[0] as unknown[])[2]).toBe(false);
  });

  it('refuses a wrong code and audits it', async () => {
    const { svc, login, audit } = make();
    const { challengeId } = await start(svc);
    await expect(svc.verify({ challengeId, code: '000000' }, meta)).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_OTP_INVALID,
    });
    expect(login.afterCredential).not.toHaveBeenCalled();
    expect(audit.recordStandalone).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'auth.failed', status: 'failure' }),
    );
  });

  it('refuses any code for a number with no account, with the same answer as a wrong code', async () => {
    const { svc, login } = make();
    const { challengeId } = await start(svc, OTHER);
    await expect(svc.verify({ challengeId, code: '123456' }, meta)).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_OTP_INVALID,
    });
    expect(login.afterCredential).not.toHaveBeenCalled();
  });

  it('accepts a code only once', async () => {
    const { svc, sent } = make();
    const { challengeId } = await start(svc);
    const code = sent[0]!.code;
    await svc.verify({ challengeId, code }, meta);
    await expect(svc.verify({ challengeId, code }, meta)).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_OTP_EXPIRED,
    });
  });

  it('stops answering guesses after the allowed number, even for the right code', async () => {
    const { svc, sent } = make({ maxAttempts: 3 });
    const { challengeId } = await start(svc);
    for (let i = 0; i < 3; i++) {
      await expect(svc.verify({ challengeId, code: '000000' }, meta)).rejects.toMatchObject({
        code: ERROR_CODES.AUTH_OTP_INVALID,
      });
    }
    await expect(svc.verify({ challengeId, code: sent[0]!.code }, meta)).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_OTP_TOO_MANY_ATTEMPTS,
    });
  });

  it('keeps counting wrong codes across new challenges for the same number, so a resend does not give back the guesses', async () => {
    const { svc, sent } = make({ maxAttempts: 5 });
    // Two challenges of five wrong guesses each use up the ten the number is allowed in an hour.
    for (let c = 0; c < 2; c++) {
      const { challengeId } = await start(svc);
      for (let i = 0; i < 5; i++) {
        await expect(svc.verify({ challengeId, code: '000000' }, meta)).rejects.toMatchObject({
          code: ERROR_CODES.AUTH_OTP_INVALID,
        });
      }
    }
    const { challengeId } = await start(svc);
    await expect(
      svc.verify({ challengeId, code: sent[sent.length - 1]!.code }, meta),
    ).rejects.toMatchObject({ code: ERROR_CODES.AUTH_OTP_TOO_MANY_ATTEMPTS });
  });

  it('gives the guesses back once the right code was entered', async () => {
    const { svc, sent, rate } = make();
    const { challengeId } = await start(svc);
    await expect(svc.verify({ challengeId, code: '000000' }, meta)).rejects.toBeDefined();
    await svc.verify({ challengeId, code: sent[0]!.code }, meta);
    expect(rate.reset).toHaveBeenCalledTimes(1);
  });

  it('refuses an unknown or finished challenge', async () => {
    const { svc } = make();
    await expect(svc.verify({ challengeId: 'nope', code: '123456' }, meta)).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_OTP_EXPIRED,
    });
  });

  it('refuses a code that has expired', async () => {
    const { svc, sent, redis } = make();
    const { challengeId } = await start(svc);
    const key = [...redis.store.keys()][0]!;
    const stored = JSON.parse(redis.store.get(key)!) as { expiresAt: number };
    stored.expiresAt = Date.now() - 1000;
    redis.store.set(key, JSON.stringify(stored));
    await expect(svc.verify({ challengeId, code: sent[0]!.code }, meta)).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_OTP_EXPIRED,
    });
  });

  it('offers the workspaces when the number is in several, as a phone sign-in', async () => {
    const { svc, sent, login } = make({
      accounts: {
        [PHONE]: [
          { orgId: 1, userId: 10 },
          { orgId: 2, userId: 20 },
        ],
      },
    });
    const { challengeId } = await start(svc);
    const result = await svc.verify({ challengeId, code: sent[0]!.code }, meta);
    expect(result).toMatchObject({ status: 'workspace_required' });
    expect(login.afterCredential).not.toHaveBeenCalled();
    const args = login.offerWorkspaces.mock.calls[0] as unknown[];
    expect((args[0] as unknown[]).length).toBe(2);
    expect(args[2]).toBe('phone');
  });

  it('does not let a phone code get around a locked account', async () => {
    const { svc, sent, login } = make({ locked: true });
    const { challengeId } = await start(svc);
    await expect(svc.verify({ challengeId, code: sent[0]!.code }, meta)).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_ACCOUNT_LOCKED,
    });
    expect(login.afterCredential).not.toHaveBeenCalled();
  });

  it('refuses when the number stopped belonging to an account after the code was sent', async () => {
    const accounts: Record<string, Array<{ orgId: number; userId: number }>> = {
      [PHONE]: [{ orgId: 1, userId: 10 }],
    };
    const { svc, sent, login } = make({ accounts });
    const { challengeId } = await start(svc);
    accounts[PHONE] = [];
    await expect(svc.verify({ challengeId, code: sent[0]!.code }, meta)).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_OTP_INVALID,
    });
    expect(login.afterCredential).not.toHaveBeenCalled();
  });
});

describe('PhoneLoginService.resend', () => {
  it('waits out the cooldown, then sends a new code that replaces the old one', async () => {
    const { svc, sent, redis } = make();
    const { challengeId } = await start(svc);
    await expect(svc.resend({ challengeId }, meta)).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_OTP_RESEND_COOLDOWN,
    });
    const key = [...redis.store.keys()][0]!;
    const stored = JSON.parse(redis.store.get(key)!) as { lastSentAt: number };
    stored.lastSentAt = Date.now() - 120_000;
    redis.store.set(key, JSON.stringify(stored));

    await svc.resend({ challengeId }, meta);
    expect(sent).toHaveLength(2);
    await expect(svc.verify({ challengeId, code: sent[0]!.code }, meta)).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_OTP_INVALID,
    });
  });

  it('sends nothing for a number with no account, and answers the same', async () => {
    const { svc, sent, redis } = make();
    const { challengeId } = await start(svc, OTHER);
    const key = [...redis.store.keys()][0]!;
    const stored = JSON.parse(redis.store.get(key)!) as { lastSentAt: number };
    stored.lastSentAt = Date.now() - 120_000;
    redis.store.set(key, JSON.stringify(stored));
    await expect(svc.resend({ challengeId }, meta)).resolves.toMatchObject({
      resendCooldownSeconds: expect.any(Number),
    });
    expect(sent).toHaveLength(0);
  });
});
