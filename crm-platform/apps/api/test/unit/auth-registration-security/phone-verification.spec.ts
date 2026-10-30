import { HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { ERROR_CODES, registrationSettingsSchema } from '@crm/contracts';
import {
  RequestContextStore,
  type RequestContext,
} from '../../../src/common/context/request-context';
import { PhoneVerificationService } from '../../../src/modules/auth/account/phone-verification.service';

/**
 * Verifying the number on one's own profile so it can sign in. What must hold: only the number the code was sent to is marked
 * (a number changed in between is never confirmed by the old code), a code works once and guesses are limited, the number is
 * never in the answer in full, and nothing is sent unless the platform's code step is active.
 */
const PHONE = '+919876543210';
const OTHER = '+919000000000';
const ctx: RequestContext = {
  requestId: 'r1',
  orgId: 1,
  actorType: 'user',
  actorId: 10,
  userId: 10,
  ip: '203.0.113.9',
};
const run = <T>(fn: () => Promise<T>) => RequestContextStore.run(ctx, fn);

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

function make(
  opts: {
    active?: boolean;
    phone?: string | null;
    verified?: boolean;
    sendFails?: boolean;
    maxAttempts?: number;
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
  // The profile row, and the one UPDATE the service makes: it matches only when the number in the statement is the one saved now.
  const profile = {
    phone: opts.phone === undefined ? PHONE : opts.phone,
    verified: opts.verified ?? false,
  };
  const updates: string[] = [];
  const db = {
    txAs: async (_ctx: unknown, fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        execute: async (query: { queryChunks: unknown[] }) => {
          const text = JSON.stringify(query.queryChunks);
          if (text.includes('UPDATE user_profiles')) {
            const phone = query.queryChunks.find((c) => typeof c === 'string' && c.startsWith('+'));
            if (phone === profile.phone) {
              profile.verified = true;
              updates.push(String(phone));
              return { rows: [{ user_id: 10 }] };
            }
            return { rows: [] };
          }
          return {
            rows: [
              {
                phone_e164: profile.phone,
                phone_verified_at: profile.verified ? new Date() : null,
              },
            ],
          };
        },
      }),
  };
  const counts = new Map<string, number>();
  const rate = {
    allow: vi.fn(async () => true),
    hit: vi.fn(async (key: string) => {
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return { count, retryAfterSeconds: 0 };
    }),
    peek: vi.fn(async (key: string) => ({ count: counts.get(key) ?? 0, retryAfterSeconds: 0 })),
    reset: vi.fn(async (key: string) => {
      counts.delete(key);
    }),
  };
  const audit = {
    record: vi.fn(async () => undefined),
    recordStandalone: vi.fn(async () => undefined),
  };
  const registration = {
    ...registrationSettingsSchema.parse({}),
    otp: { ...registrationSettingsSchema.parse({}).otp, maxAttempts: opts.maxAttempts ?? 5 },
  };
  const svc = new PhoneVerificationService(
    { registration: async () => registration } as never,
    { statusFor: async () => ({ active: opts.active ?? true }) } as never,
    rate as never,
    audit as never,
    db as never,
    sender as never,
    redis as never,
  );
  return { svc, redis, sent, profile, updates, audit, rate, sender };
}

describe('PhoneVerificationService.start', () => {
  it('sends a code to the number on the profile and answers with a masked number', async () => {
    const { svc, sent } = make();
    const challenge = await run(() => svc.start());
    expect(sent).toEqual([{ to: PHONE, code: expect.any(String) }]);
    expect(challenge.maskedPhone).not.toContain('9876543210');
    expect(challenge.codeLength).toBe(sent[0]?.code.length);
  });

  it('asks for a number first when the profile has none', async () => {
    const { svc, sent } = make({ phone: null });
    await expect(run(() => svc.start())).rejects.toMatchObject({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
    expect(sent).toHaveLength(0);
  });

  it('does not send again for a number that is already verified', async () => {
    const { svc, sent } = make({ verified: true });
    await expect(run(() => svc.start())).rejects.toMatchObject({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
    expect(sent).toHaveLength(0);
  });

  it('is refused while the code step is not active', async () => {
    const { svc, sent } = make({ active: false });
    await expect(run(() => svc.start())).rejects.toMatchObject({
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
    expect(sent).toHaveLength(0);
  });

  it('tells the signed-in person when the code could not be sent, and keeps nothing pending', async () => {
    const { svc, redis } = make({ sendFails: true });
    await expect(run(() => svc.start())).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_OTP_SEND_FAILED,
      status: HttpStatus.BAD_GATEWAY,
    });
    expect(redis.store.size).toBe(0);
  });

  it('treats asking again for the same number as a resend: the cooldown applies', async () => {
    const { svc, sent } = make();
    await run(() => svc.start());
    await expect(run(() => svc.start())).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_OTP_RESEND_COOLDOWN,
    });
    expect(sent).toHaveLength(1);
  });

  it('refuses once the person has used the days budget of codes, whatever the numbers', async () => {
    const { svc, rate, sent } = make();
    rate.allow.mockImplementation(
      async (key: string) => !key.startsWith('auth:phone-verify-sends:'),
    );
    await expect(run(() => svc.start())).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
    expect(sent).toHaveLength(0);
  });

  it('is refused once the send limit for the number is reached', async () => {
    const { svc, rate, sent } = make();
    rate.allow.mockResolvedValue(false);
    await expect(run(() => svc.start())).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
    expect(sent).toHaveLength(0);
  });
});

describe('PhoneVerificationService.confirm', () => {
  it('marks the number verified with the code that was sent, and audits it', async () => {
    const { svc, sent, profile, audit } = make();
    await run(() => svc.start());
    await expect(run(() => svc.confirm({ code: sent[0]!.code }))).resolves.toEqual({
      verified: true,
    });
    expect(profile.verified).toBe(true);
    expect(audit.record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ event: 'auth.phone_verified', status: 'success' }),
    );
  });

  it('refuses a wrong code, audits it, and leaves the number unverified', async () => {
    const { svc, profile, audit } = make();
    await run(() => svc.start());
    await expect(run(() => svc.confirm({ code: '000000' }))).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_OTP_INVALID,
    });
    expect(profile.verified).toBe(false);
    expect(audit.recordStandalone).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'auth.failed', status: 'failure' }),
    );
  });

  it('accepts a code only once', async () => {
    const { svc, sent } = make();
    await run(() => svc.start());
    const code = sent[0]!.code;
    await run(() => svc.confirm({ code }));
    await expect(run(() => svc.confirm({ code }))).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_OTP_EXPIRED,
    });
  });

  it('does not verify a number the profile no longer holds, even with the right code', async () => {
    const { svc, sent, profile, updates } = make();
    await run(() => svc.start());
    profile.phone = OTHER; // changed after the code went out
    await expect(run(() => svc.confirm({ code: sent[0]!.code }))).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_OTP_EXPIRED,
    });
    expect(profile.verified).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it('stops answering guesses after the allowed number, even for the right code', async () => {
    const { svc, sent } = make({ maxAttempts: 3 });
    await run(() => svc.start());
    for (let i = 0; i < 3; i++) {
      await expect(run(() => svc.confirm({ code: '000000' }))).rejects.toMatchObject({
        code: ERROR_CODES.AUTH_OTP_INVALID,
      });
    }
    await expect(run(() => svc.confirm({ code: sent[0]!.code }))).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_OTP_TOO_MANY_ATTEMPTS,
    });
  });

  it('refuses when nothing was asked for, or the code has expired', async () => {
    const { svc, sent, redis } = make();
    await expect(run(() => svc.confirm({ code: '123456' }))).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_OTP_EXPIRED,
    });
    await run(() => svc.start());
    const key = [...redis.store.keys()][0]!;
    const stored = JSON.parse(redis.store.get(key)!) as { expiresAt: number };
    stored.expiresAt = Date.now() - 1000;
    redis.store.set(key, JSON.stringify(stored));
    await expect(run(() => svc.confirm({ code: sent[0]!.code }))).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_OTP_EXPIRED,
    });
  });
});

describe('PhoneVerificationService.resend', () => {
  it('waits out the cooldown, then sends a new code that replaces the old one', async () => {
    const { svc, sent, redis } = make();
    await run(() => svc.start());
    await expect(run(() => svc.resend())).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_OTP_RESEND_COOLDOWN,
    });
    const key = [...redis.store.keys()][0]!;
    const stored = JSON.parse(redis.store.get(key)!) as { lastSentAt: number };
    stored.lastSentAt = Date.now() - 120_000;
    redis.store.set(key, JSON.stringify(stored));

    await run(() => svc.resend());
    expect(sent).toHaveLength(2);
    await expect(run(() => svc.confirm({ code: sent[0]!.code }))).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_OTP_INVALID,
    });
  });

  it('sends nothing when the number was changed after the first code', async () => {
    const { svc, sent, profile, redis } = make();
    await run(() => svc.start());
    const key = [...redis.store.keys()][0]!;
    const stored = JSON.parse(redis.store.get(key)!) as { lastSentAt: number };
    stored.lastSentAt = Date.now() - 120_000;
    redis.store.set(key, JSON.stringify(stored));
    profile.phone = OTHER;
    await expect(run(() => svc.resend())).rejects.toMatchObject({
      code: ERROR_CODES.AUTH_OTP_EXPIRED,
    });
    expect(sent).toHaveLength(1);
  });
});
