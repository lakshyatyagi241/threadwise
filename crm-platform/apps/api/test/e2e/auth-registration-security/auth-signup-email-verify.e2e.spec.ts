import type { Redis } from 'ioredis';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MAIL_PORT,
  type MailPort,
} from '../../../src/infra/providers/auth-registration-security/mail.port';
import { REDIS_CLIENT } from '../../../src/infra/redis/redis.module';
import { PlatformSettingsService } from '../../../src/modules/auth/platform/platform-settings.service';
import { AuthKeys } from '../../../src/modules/auth/support/redis-keys';
import { startHarness, type Harness } from './harness';

/**
 * TW-AUTH-005-prep: the collect step of the three-step sign-up (collect -> verify email code ->
 * set password). Only `start()` exists so far (Task 5); the route itself lands in Task 8, so the
 * first two specs below stay RED (404) until then. The third spec exercises the existing, already
 * working `/v2/auth/signup` endpoint to prove the abandoned stage left no row behind.
 */
let h: Harness;
const api = () => request(h.app.getHttpServer());
let n = 0;
const uniqueEmail = (tag = 'u') => `${tag}${Date.now()}${n++}@example.test`;
/** A fresh client address per call (the harness trusts `x-forwarded-for`), so per-IP throttles stay apart. */
const nextIp = () => `10.52.${Math.floor(n / 250) % 250}.${n++ % 250}`;
/** Any 6-digit code that is not `code`. */
const wrongOf = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

async function startAndReadCode(fullName: string, email: string) {
  const res = await api().post('/v2/auth/signup/start').send({ fullName, email });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const msg = h.mail.find((m) => m.to === email);
  if (!msg) throw new Error(`no mail sent to ${email}`);
  const match = msg.text.match(/\b(\d{6})\b/);
  if (!match) throw new Error(`no 6-digit code found in mail to ${email}: ${msg.text}`);
  return { token: res.body.token as string, code: match[1]! };
}

/**
 * `start()` stamps `lastSentAt`, so a resend straight after it hits the 60s cooldown; backdate it.
 * A successful resend also holds the atomic cooldown claim (`<stageKey>:resend`); drop that too.
 */
async function skipResendCooldown(token: string) {
  const key = AuthKeys.signupEmailStage(token);
  const stage = JSON.parse((await h.redis.get(key))!);
  stage.lastSentAt = 0;
  await h.redis.set(key, JSON.stringify(stage), 'KEEPTTL');
  await h.redis.del(`${key}:resend`);
}

/** The newest 6-digit code mailed to `email`. */
function latestCode(email: string): string {
  const msg = h.mail.filter((m) => m.to === email).at(-1);
  const match = msg?.text.match(/\b(\d{6})\b/);
  if (!match) throw new Error(`no 6-digit code found in mail to ${email}`);
  return match[1]!;
}

beforeAll(async () => {
  h = await startHarness();
}, 240_000);

// Every request here comes from one IP; reset the per-IP sign-up throttle so the scenarios do not
// exhaust it for each other.
beforeEach(async () => {
  await h.redis.eval(
    `for _,k in ipairs(redis.call('keys','auth:ip:*')) do redis.call('del',k) end`,
    0,
  );
});

afterAll(async () => {
  await h?.stop();
});

describe('POST /v2/auth/signup/start', () => {
  it('stages the signup and returns a masked email', async () => {
    const res = await api()
      .post('/v2/auth/signup/start')
      .send({ fullName: 'Ada Lovelace', email: uniqueEmail('ada') });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.maskedEmail).toMatch(/.+@.+/);
    expect(res.body.codeLength).toBe(6);
  });

  it('rejects when the email already has an account', async () => {
    const email = uniqueEmail('dup');
    // Seed a real existing account via the EXISTING, already-working /v2/auth/signup endpoint
    // (not the new one this task adds) — this creates a real org+user row, simulating "someone
    // already signed up" without depending on the new verify/set-password endpoints Tasks 6-7
    // haven't landed yet.
    const seed = await api().post('/v2/auth/signup').send({
      orgName: 'Existing Org',
      fullName: 'Existing User',
      email,
      password: 'Str0ngPassw0rd#1',
      acceptTerms: true,
    });
    expect(seed.status, JSON.stringify(seed.body)).toBe(201);

    const res = await api().post('/v2/auth/signup/start').send({ fullName: 'Dup User', email });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe('AUTH_IDENTITY_EXISTS');
  });

  it('leaves no org or user row behind when the stage is abandoned before verification', async () => {
    const email = uniqueEmail('abandoned');
    await api().post('/v2/auth/signup/start').send({ fullName: 'Abandoned User', email });
    // Don't verify, don't set a password — confirm via the existing /v2/auth/signup endpoint's
    // own duplicate behavior: re-signing up fully with this exact email should succeed (201),
    // proving no row was created by the abandoned /start call alone.
    const res = await api().post('/v2/auth/signup').send({
      orgName: 'Fresh Org',
      fullName: 'Abandoned User',
      email,
      password: 'Str0ngPassw0rd#1',
      acceptTerms: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
  });
});

describe('POST /v2/auth/signup/verify-email-code', () => {
  it('marks the stage verified on a correct code', async () => {
    const { token, code } = await startAndReadCode('Ada', uniqueEmail('v'));
    const res = await api().post('/v2/auth/signup/verify-email-code').send({ token, code });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.token).toBe(token);
  });

  it('rejects a wrong code', async () => {
    const { token } = await startAndReadCode('Ada', uniqueEmail('w'));
    const res = await api()
      .post('/v2/auth/signup/verify-email-code')
      .send({ token, code: '000000' });
    expect(res.status, JSON.stringify(res.body)).toBe(400);
    expect(res.body.code).toBe('AUTH_OTP_INVALID');
  });

  it('counts parallel wrong guesses atomically: a burst of 10 exhausts the 5-guess budget', async () => {
    const { token, code } = await startAndReadCode('Ada', uniqueEmail('burst'));
    // Each guess from its own address, so the per-IP throttle is not what stops them: only the
    // guess counter is. With a read-modify-write counter every request read the same count, so all
    // 10 were compared with the code and the budget barely moved.
    const answers = await Promise.all(
      Array.from({ length: 10 }, () =>
        api()
          .post('/v2/auth/signup/verify-email-code')
          .set('x-forwarded-for', nextIp())
          .send({ token, code: wrongOf(code) }),
      ),
    );
    const codes = answers.map((r) => r.body.code as string);
    expect(
      codes.filter((c) => c === 'AUTH_OTP_INVALID'),
      JSON.stringify(codes),
    ).toHaveLength(5);
    expect(
      codes.filter((c) => c === 'AUTH_OTP_TOO_MANY_ATTEMPTS'),
      JSON.stringify(codes),
    ).toHaveLength(5);
    // The budget is genuinely spent: even the right code is no longer compared.
    const right = await api()
      .post('/v2/auth/signup/verify-email-code')
      .set('x-forwarded-for', nextIp())
      .send({ token, code });
    expect(right.status, JSON.stringify(right.body)).toBe(429);
    expect(right.body.code).toBe('AUTH_OTP_TOO_MANY_ATTEMPTS');
  });

  it('allows exactly 5 sequential wrong guesses, then refuses even the right code', async () => {
    const { token, code } = await startAndReadCode('Ada', uniqueEmail('seq'));
    for (let i = 0; i < 5; i++) {
      const r = await api()
        .post('/v2/auth/signup/verify-email-code')
        .send({ token, code: wrongOf(code) });
      expect(r.body.code, `guess ${i + 1}`).toBe('AUTH_OTP_INVALID');
    }
    const right = await api().post('/v2/auth/signup/verify-email-code').send({ token, code });
    expect(right.status, JSON.stringify(right.body)).toBe(429);
    expect(right.body.code).toBe('AUTH_OTP_TOO_MANY_ATTEMPTS');
  });

  it('a resend gives a fresh allowance of guesses', async () => {
    const email = uniqueEmail('fresh');
    const { token, code } = await startAndReadCode('Ada', email);
    for (let i = 0; i < 5; i++) {
      await api()
        .post('/v2/auth/signup/verify-email-code')
        .send({ token, code: wrongOf(code) });
    }
    expect(
      (await api().post('/v2/auth/signup/verify-email-code').send({ token, code })).body.code,
    ).toBe('AUTH_OTP_TOO_MANY_ATTEMPTS');
    await skipResendCooldown(token);
    const resend = await api().post('/v2/auth/signup/resend-email-code').send({ token });
    expect(resend.status, JSON.stringify(resend.body)).toBe(201);
    const msg = h.mail.filter((m) => m.to === email).at(-1)!;
    const fresh = msg.text.match(/\b(\d{6})\b/)![1]!;
    const ok = await api().post('/v2/auth/signup/verify-email-code').send({ token, code: fresh });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it('limits verify per client address: 10 a minute, then 429 RATE_LIMITED', async () => {
    const { token, code } = await startAndReadCode('Ada', uniqueEmail('ipv'));
    const ip = nextIp();
    const answers: Array<{ status: number; body: { code: string; errors?: unknown[] } }> = [];
    for (let i = 0; i < 11; i++) {
      answers.push(
        await api()
          .post('/v2/auth/signup/verify-email-code')
          .set('x-forwarded-for', ip)
          .send({ token, code: wrongOf(code) }),
      );
    }
    expect(answers.slice(0, 10).every((r) => r.body.code !== 'RATE_LIMITED')).toBe(true);
    expect(answers[10]!.status).toBe(429);
    expect(answers[10]!.body.code).toBe('RATE_LIMITED');
    expect(answers[10]!.body.errors).toEqual([
      { path: 'retryAfterSeconds', message: expect.stringMatching(/^\d+$/) },
    ]);
  });
});

describe('POST /v2/auth/signup/resend-email-code', () => {
  it('rejects a second resend inside the cooldown', async () => {
    const { token } = await startAndReadCode('Ada', uniqueEmail('r'));
    await skipResendCooldown(token);
    const first = await api().post('/v2/auth/signup/resend-email-code').send({ token });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const second = await api().post('/v2/auth/signup/resend-email-code').send({ token });
    expect(second.status, JSON.stringify(second.body)).toBe(429);
    expect(second.body.code).toBe('AUTH_OTP_RESEND_COOLDOWN');
  });

  it('limits resend per client address: 5 a minute, then 429 RATE_LIMITED', async () => {
    const { token } = await startAndReadCode('Ada', uniqueEmail('ipr'));
    const ip = nextIp();
    const codes: string[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await api()
        .post('/v2/auth/signup/resend-email-code')
        .set('x-forwarded-for', ip)
        .send({ token });
      codes.push(r.body.code);
    }
    expect(codes.slice(0, 5).every((c) => c === 'AUTH_OTP_RESEND_COOLDOWN')).toBe(true);
    expect(codes[5]).toBe('RATE_LIMITED');
  });

  it('leaves the old code still verifiable when the resend mail fails to send', async () => {
    const { token, code } = await startAndReadCode('Ada', uniqueEmail('resend-fail'));
    await skipResendCooldown(token);
    const port = h.app.get<MailPort>(MAIL_PORT);
    const realSend = port.send.bind(port);
    port.send = async () => {
      throw new Error('simulated mail outage');
    };
    try {
      const res = await api().post('/v2/auth/signup/resend-email-code').send({ token });
      expect(res.status, JSON.stringify(res.body)).toBe(502);
      expect(res.body.code).toBe('AUTH_OTP_SEND_FAILED');
    } finally {
      port.send = realSend;
    }
    // The old code must still be the one that works: the failed resend must not have
    // overwritten the stage's hash, attempts or cooldown timer.
    const verify = await api().post('/v2/auth/signup/verify-email-code').send({ token, code });
    expect(verify.status, JSON.stringify(verify.body)).toBe(200);
    // ...and the failed attempt did not keep the cooldown claim: retrying straight away works.
    const retry = await api().post('/v2/auth/signup/resend-email-code').send({ token });
    expect(retry.status, JSON.stringify(retry.body)).toBe(201);
  });

  it('claims the cooldown atomically: of 5 parallel resends exactly one goes through', async () => {
    const email = uniqueEmail('par-resend');
    const { token } = await startAndReadCode('Ada', email);
    await skipResendCooldown(token);
    const sentBefore = h.mail.filter((m) => m.to === email).length;
    // Each from its own address, so the per-IP throttle is not what stops them: only the cooldown.
    const answers = await Promise.all(
      Array.from({ length: 5 }, () =>
        api()
          .post('/v2/auth/signup/resend-email-code')
          .set('x-forwarded-for', nextIp())
          .send({ token }),
      ),
    );
    const statuses = answers.map((r) => `${r.status}:${r.body.code ?? ''}`);
    expect(
      statuses.filter((s) => s === '201:'),
      JSON.stringify(statuses),
    ).toHaveLength(1);
    expect(
      statuses.filter((s) => s === '429:AUTH_OTP_RESEND_COOLDOWN'),
      JSON.stringify(statuses),
    ).toHaveLength(4);
    // Exactly one new code was mailed, and it is the one that works.
    expect(h.mail.filter((m) => m.to === email).length).toBe(sentBefore + 1);
    const ok = await api()
      .post('/v2/auth/signup/verify-email-code')
      .send({ token, code: latestCode(email) });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
  });

  it('caps code mails per address: 5 an hour across start and resends, from any client', async () => {
    const email = uniqueEmail('cap');
    const { token } = await startAndReadCode('Ada', email); // send 1
    for (let i = 0; i < 4; i++) {
      await skipResendCooldown(token);
      const r = await api()
        .post('/v2/auth/signup/resend-email-code')
        .set('x-forwarded-for', nextIp())
        .send({ token }); // sends 2..5
      expect(r.status, `resend ${i + 1}: ${JSON.stringify(r.body)}`).toBe(201);
    }
    await skipResendCooldown(token);
    const over = await api()
      .post('/v2/auth/signup/resend-email-code')
      .set('x-forwarded-for', nextIp())
      .send({ token });
    expect(over.status, JSON.stringify(over.body)).toBe(429);
    expect(over.body.code).toBe('RATE_LIMITED');
    // A fresh /start for the same address cannot open a new budget either.
    const restart = await api()
      .post('/v2/auth/signup/start')
      .set('x-forwarded-for', nextIp())
      .send({ fullName: 'Ada', email });
    expect(restart.status, JSON.stringify(restart.body)).toBe(429);
    expect(restart.body.code).toBe('RATE_LIMITED');
  });
});

describe('email-code stale-hash race', () => {
  it('a correct guess of a code that a resend replaced mid-check never marks the stage verified', async () => {
    const email = uniqueEmail('stale');
    const { token, code: oldCode } = await startAndReadCode('Ada', email);
    await skipResendCooldown(token);
    const key = AuthKeys.signupEmailStage(token);

    // verifyEmailCode does GET -> count -> compare -> write. Run a real resend right after its GET,
    // so it compares the (correct) old code against the hash it read, which is stale by the write.
    const appRedis = h.app.get<Redis>(REDIS_CLIENT);
    const patchable = appRedis as unknown as { get: (k: string) => Promise<string | null> };
    const originalGet = patchable.get;
    const realGet = appRedis.get.bind(appRedis);
    let fired = false;
    let resendStatus = 0;
    patchable.get = async (k: string) => {
      const value = await realGet(k);
      if (k === key && !fired) {
        fired = true;
        const r = await api().post('/v2/auth/signup/resend-email-code').send({ token });
        resendStatus = r.status;
      }
      return value;
    };
    let verify: request.Response;
    try {
      verify = await api().post('/v2/auth/signup/verify-email-code').send({ token, code: oldCode });
    } finally {
      patchable.get = originalGet;
    }
    expect(resendStatus).toBe(201);
    expect(verify.status, JSON.stringify(verify.body)).toBe(400);
    expect(verify.body.code).toBe('AUTH_OTP_INVALID');
    // The stage keeps the resend's new code and is still unverified.
    const stage = JSON.parse((await h.redis.get(key))!);
    expect(stage.verified).toBe(false);
    const setPw = await api()
      .post('/v2/auth/signup/set-password')
      .send({ token, password: 'Str0ngPassw0rd#1', acceptTerms: true });
    expect(setPw.status, JSON.stringify(setPw.body)).toBe(403);
    expect(setPw.body.code).toBe('AUTH_EMAIL_NOT_VERIFIED');
    // The new code still works.
    const fresh = await api()
      .post('/v2/auth/signup/verify-email-code')
      .send({ token, code: latestCode(email) });
    expect(fresh.status, JSON.stringify(fresh.body)).toBe(200);
  });
});

describe('POST /v2/auth/signup/set-password', () => {
  async function startAndVerify(fullName: string, email: string) {
    const { token, code } = await startAndReadCode(fullName, email);
    const res = await api().post('/v2/auth/signup/verify-email-code').send({ token, code });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    return token;
  }

  it('creates the account once verified, with an auto-generated workspace name', async () => {
    const token = await startAndVerify('Ada Lovelace', uniqueEmail('sp'));
    const res = await api()
      .post('/v2/auth/signup/set-password')
      .send({ token, password: 'Str0ngPassw0rd#1', acceptTerms: true });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe('authenticated');
    expect(res.body.orgSlug).toMatch(/^ada-s-workspace/);
  });

  it('rejects when the email was never verified', async () => {
    const { token } = await startAndReadCode('Ada', uniqueEmail('nv'));
    const res = await api()
      .post('/v2/auth/signup/set-password')
      .send({ token, password: 'Str0ngPassw0rd#1', acceptTerms: true });
    expect(res.status, JSON.stringify(res.body)).toBe(403);
    expect(res.body.code).toBe('AUTH_EMAIL_NOT_VERIFIED');
  });

  it('is single-use: a second set-password with the same token is refused', async () => {
    const token = await startAndVerify('Ada', uniqueEmail('once'));
    const first = await api()
      .post('/v2/auth/signup/set-password')
      .send({ token, password: 'Str0ngPassw0rd#1', acceptTerms: true });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const second = await api()
      .post('/v2/auth/signup/set-password')
      .send({ token, password: 'Str0ngPassw0rd#1', acceptTerms: true });
    expect(second.status, JSON.stringify(second.body)).toBe(400);
    expect(second.body.code).toBe('AUTH_SIGNUP_EXPIRED');
  });

  it('refuses with AUTH_IDENTITY_EXISTS when a parallel sign-up took the address after /start', async () => {
    const email = uniqueEmail('par');
    // Two /start calls for one address both pass start()'s duplicate check (nothing exists yet).
    const a = await startAndVerify('Ada', email);
    h.mail.splice(0, h.mail.length); // so startAndReadCode reads the second stage's code, not the first
    const b = await startAndVerify('Ada', email);
    const first = await api()
      .post('/v2/auth/signup/set-password')
      .send({ token: a, password: 'Str0ngPassw0rd#1', acceptTerms: true });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const second = await api()
      .post('/v2/auth/signup/set-password')
      .send({ token: b, password: 'Str0ngPassw0rd#1', acceptTerms: true });
    expect(second.status, JSON.stringify(second.body)).toBe(409);
    expect(second.body.code).toBe('AUTH_IDENTITY_EXISTS');
  });

  it('does not burn the verified stage when the phone-verification config refuses', async () => {
    const token = await startAndVerify('Ada', uniqueEmail('cfg'));
    const setRequirePhone = async (on: boolean) => {
      await h.owner.query(
        `UPDATE platform_settings SET value = value || jsonb_build_object('requirePhoneVerification', $1::boolean) WHERE key = 'registration'`,
        [on],
      );
      h.app.get(PlatformSettingsService).invalidate();
    };
    // Mandatory phone verification with the OTP step inactive: fail closed (503)...
    await setRequirePhone(true);
    try {
      const refused = await api()
        .post('/v2/auth/signup/set-password')
        .send({ token, password: 'Str0ngPassw0rd#1', acceptTerms: true });
      expect(refused.status, JSON.stringify(refused.body)).toBe(503);
      expect(await h.redis.exists(AuthKeys.signupEmailStage(token))).toBe(1);
    } finally {
      await setRequirePhone(false);
    }
    // ...and the same verified stage still finishes once the config is fixed.
    const ok = await api()
      .post('/v2/auth/signup/set-password')
      .send({ token, password: 'Str0ngPassw0rd#1', acceptTerms: true });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });
});

describe('email-stage write-back race', () => {
  it('a resend whose mail send overlaps set-password cannot resurrect the consumed stage', async () => {
    const { token, code } = await startAndReadCode('Ada', uniqueEmail('race'));
    const verify = await api().post('/v2/auth/signup/verify-email-code').send({ token, code });
    expect(verify.status, JSON.stringify(verify.body)).toBe(200);
    const key = AuthKeys.signupEmailStage(token);
    await skipResendCooldown(token);

    // resendEmailCode does GET -> send mail -> SET. Run set-password (which DELs the stage) inside
    // the send, i.e. exactly between that GET and that SET.
    const port = h.app.get<MailPort>(MAIL_PORT);
    const realSend = port.send.bind(port);
    let setPasswordStatus = 0;
    let fired = false;
    port.send = async (m) => {
      if (!fired) {
        fired = true;
        const r = await api()
          .post('/v2/auth/signup/set-password')
          .send({ token, password: 'Str0ngPassw0rd#1', acceptTerms: true });
        setPasswordStatus = r.status;
      }
      return realSend(m);
    };
    let resend: request.Response;
    try {
      resend = await api().post('/v2/auth/signup/resend-email-code').send({ token });
    } finally {
      port.send = realSend;
    }
    expect(setPasswordStatus).toBe(201);
    expect(resend.status, JSON.stringify(resend.body)).toBe(400);
    expect(resend.body.code).toBe('AUTH_SIGNUP_EXPIRED');
    // The stage stays gone (no TTL-less resurrection), so the token cannot create a second account.
    expect(await h.redis.exists(key)).toBe(0);
    const again = await api()
      .post('/v2/auth/signup/set-password')
      .send({ token, password: 'Str0ngPassw0rd#1', acceptTerms: true });
    expect(again.status, JSON.stringify(again.body)).toBe(400);
    expect(again.body.code).toBe('AUTH_SIGNUP_EXPIRED');
  });
});
