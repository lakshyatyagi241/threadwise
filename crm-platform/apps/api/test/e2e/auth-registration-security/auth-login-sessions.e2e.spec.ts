import { JwtService } from '@nestjs/jwt';
import { hash } from '@node-rs/argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MailError,
  type MailPort,
} from '../../../src/infra/providers/auth-registration-security/mail.port';
import { ClerkService } from '../../../src/modules/auth/clerk.service';
import { LoginService } from '../../../src/modules/auth/flows/login.service';
import { MailService } from '../../../src/modules/auth/mail/mail.service';
import { OperatorAuthService } from '../../../src/modules/auth/platform/operator-auth.service';
import { AuthAuditService } from '../../../src/modules/auth/security/auth-audit.service';
import { SessionService } from '../../../src/modules/auth/sessions/session.service';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import { OPERATOR_EMAIL, OPERATOR_PASSWORD, startHarness, type Harness } from './harness';

/**
 * Sign-in, sessions, second factor, sign-out, recovery mail and sign-in alerts:
 * the parity fixes of the auth audit (reports A, B and D), through HTTP against
 * real Postgres and Redis. A file of its own so the big flow spec stays as it
 * was; every scenario signs up its own organization and puts policy back.
 */
let h: Harness;
const api = () => request(h.app.getHttpServer());
const PASSWORD = 'Str0ngPassw0rd#1';
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const totp = (secret: string) => hotp(base32Decode(secret), totpStep(Date.now()));

let ipCounter = 40;
const nextIp = () => `10.77.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`;
let emailCounter = 0;
const uniqueEmail = (tag = 'u') => `${tag}${Date.now()}${emailCounter++}@example.test`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(fn: () => Promise<T | false | null | undefined>, ms = 5000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('condition not met in time');
    await sleep(80);
  }
}

interface Account {
  email: string;
  slug: string;
  access: string;
  refresh: string;
  ip: string;
}

async function signup(over: Record<string, unknown> = {}): Promise<Account> {
  const ip = nextIp();
  const email = (over.email as string) ?? uniqueEmail();
  const res = await api()
    .post('/v2/auth/signup')
    .set('x-forwarded-for', ip)
    .send({
      orgName: `Org ${email.slice(0, 12)}`,
      fullName: 'Test Person',
      email,
      password: PASSWORD,
      acceptTerms: true,
      ...over,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const session = await api().get('/v2/auth/session').set(bearer(res.body.tokens.accessToken));
  return {
    email,
    slug: session.body.org.slug,
    access: res.body.tokens.accessToken,
    refresh: res.body.tokens.refreshToken,
    ip,
  };
}

const login = (
  a: Pick<Account, 'email' | 'slug'> & { ip?: string },
  password = PASSWORD,
  extra: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) =>
  api()
    .post('/v2/auth/login')
    .set('x-forwarded-for', a.ip ?? nextIp())
    .set(headers)
    .send({ orgSlug: a.slug, email: a.email, password, ...extra });

const flushGates = () =>
  h.redis.eval(`for _,k in ipairs(redis.call('keys','auth:gate:*')) do redis.call('del',k) end`, 0);

async function ids(a: Account): Promise<{ orgId: number; userId: number }> {
  const r = await h.owner.query(
    `SELECT u.org_id, u.id FROM users u JOIN organizations o ON o.id = u.org_id WHERE o.slug = $1 AND u.email = $2`,
    [a.slug, a.email],
  );
  return { orgId: Number(r.rows[0].org_id), userId: Number(r.rows[0].id) };
}

interface EventRow {
  actor_id: string | null;
  ip: string | null;
  user_agent: string | null;
  payload: Record<string, unknown>;
}

async function events(event: string, a?: Account): Promise<EventRow[]> {
  const where = a ? `AND subject_org_id = $2` : '';
  const params: unknown[] = [event];
  if (a) params.push((await ids(a)).orgId);
  const r = await h.owner.query(
    `SELECT * FROM security_events WHERE event = $1 ${where} ORDER BY id`,
    params,
  );
  return r.rows;
}

const claimsOf = (
  jwt: string,
): { sub: number; org: number; uid: string; sid: string; ep: number; rm?: boolean } =>
  JSON.parse(Buffer.from(jwt.split('.')[1]!, 'base64url').toString('utf8'));

// --- operator (super admin enrols MFA once; the rest of the file drives the policy through it) ---

let opAccess = '';
const op = (method: 'get' | 'patch' | 'post', path: string) =>
  api()[method](`/v2/platform${path}`).set(bearer(opAccess));

async function setPolicy(patch: Record<string, unknown>) {
  const res = await op('patch', '/security/policy').send(patch);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  await flushGates();
  return res.body;
}

beforeAll(async () => {
  h = await startHarness();
  const first = await api()
    .post('/v2/platform/auth/login')
    .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  const token = first.body.tokens.accessToken as string;
  const setup = await api().post('/v2/platform/auth/mfa/setup').set(bearer(token));
  const enabled = await api()
    .post('/v2/platform/auth/mfa/enable')
    .set(bearer(token))
    .send({ code: totp(setup.body.secret) });
  expect(enabled.status).toBe(201);
  opAccess = token;
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

async function enrol(a: Account) {
  const setup = await api().post('/v2/account/mfa/setup').set(bearer(a.access));
  const enabled = await api()
    .post('/v2/account/mfa/enable')
    .set(bearer(a.access))
    .send({ code: totp(setup.body.secret) });
  expect(enabled.status, JSON.stringify(enabled.body)).toBe(201);
  return { secret: setup.body.secret as string, recovery: enabled.body.recoveryCodes as string[] };
}

// ===================================================================================================
describe('suspended users (TW-AUTH-016)', () => {
  it('can sign in and are held at the suspended screen, which keeps working', async () => {
    const a = await signup();
    await h.owner.query(`UPDATE users SET status = 'inactive' WHERE email = $1`, [a.email]);
    await flushGates();

    const res = await login(a);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe('authenticated');
    expect(res.body.flags.suspended).toBe(true);
    const token = res.body.tokens.accessToken as string;

    expect((await api().get('/v2/users/me').set(bearer(token))).body.code).toBe(
      'AUTH_ACCOUNT_SUSPENDED',
    );
    expect((await api().get('/v2/auth/session').set(bearer(token))).body.flags.suspended).toBe(
      true,
    );

    // The session is not cut off after fifteen minutes: refresh still works.
    const refreshed = await api()
      .post('/v2/auth/refresh')
      .send({ refreshToken: res.body.tokens.refreshToken });
    expect(refreshed.status).toBe(201);
    expect((await events('auth.login', a)).length).toBeGreaterThan(0);
    expect(
      (await api().post('/v2/auth/logout').set(bearer(refreshed.body.accessToken)).send({})).status,
    ).toBe(201);
  });

  it('can reset their password by mail, and still land on the suspended screen', async () => {
    const a = await signup();
    await h.owner.query(`UPDATE users SET status = 'inactive' WHERE email = $1`, [a.email]);
    await flushGates();
    const before = h.mail.length;
    const forgot = await api()
      .post('/v2/auth/forgot-password')
      .set('x-forwarded-for', nextIp())
      .send({ orgSlug: a.slug, email: a.email });
    expect(forgot.status).toBe(201);
    const mail = await until(async () =>
      h.mail.slice(before).find((m) => m.to === a.email && /reset/i.test(m.subject)),
    );
    const token = new URL(
      mail.text.match(/https?:\/\/\S*reset-password\?\S+/)![0],
    ).searchParams.get('token');
    const reset = await api()
      .post('/v2/auth/reset-password')
      .send({ orgSlug: a.slug, token, password: 'An0therStr0ng#Pass' });
    expect(reset.status, JSON.stringify(reset.body)).toBe(201);
    const again = await login(a, 'An0therStr0ng#Pass');
    expect(again.status).toBe(201);
    expect(again.body.flags.suspended).toBe(true);
  });

  it('can come in through the Clerk exchange too', async () => {
    const a = await signup();
    await h.owner.query(`UPDATE users SET status = 'inactive' WHERE email = $1`, [a.email]);
    await flushGates();
    const clerk = h.app.get(ClerkService);
    const original = clerk.verifySession.bind(clerk);
    clerk.verifySession = async () => ({
      clerkUserId: 'clerk_susp',
      email: a.email,
      fullName: 'Test Person',
    });
    try {
      const res = await api()
        .post('/v2/auth/clerk/session')
        .set('x-forwarded-for', nextIp())
        .send({ orgSlug: a.slug, clerkToken: 't' });
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.flags.suspended).toBe(true);
    } finally {
      clerk.verifySession = original;
    }
  });
});

// ===================================================================================================
describe('lockout and per-IP throttle (TW-AUTH-001/002)', () => {
  it('counts only FAILED attempts toward the per-IP ceiling', async () => {
    const a = await signup();
    const crowd = nextIp();
    // Forty-five successful sign-ins from one office address: none of them counts.
    for (let i = 0; i < 45; i++) {
      const ok = await login({ ...a, ip: crowd });
      expect(ok.status, `sign-in ${i}: ${JSON.stringify(ok.body)}`).toBe(201);
    }
    const wrong = await login({ ...a, ip: crowd }, 'nope-nope-nope');
    expect(wrong.status).toBe(401);
  }, 120_000);

  it('slows an address down after forty failures across different emails', async () => {
    const a = await signup();
    const attacker = nextIp();
    for (let i = 0; i < 40; i++) {
      const miss = await login(
        { slug: a.slug, email: `ghost${i}@example.test`, ip: attacker },
        'x',
      );
      expect(miss.status).toBe(401);
    }
    // Even the right password is refused from that address now...
    const refused = await login({ ...a, ip: attacker });
    expect(refused.status).toBe(429);
    expect(refused.body.code).toBe('RATE_LIMITED');
    // ...and nobody else is affected.
    expect((await login({ ...a, ip: nextIp() })).status).toBe(201);
  }, 120_000);

  it('does not clear the failure counter at the password step when a second factor follows', async () => {
    const a = await signup();
    await enrol(a);
    const ip = nextIp();
    for (let i = 0; i < 4; i++) expect((await login({ ...a, ip }, `bad-${i}`)).status).toBe(401);
    const stepOne = await login({ ...a, ip });
    expect(stepOne.body.status).toBe('mfa_required');
    // The password step did not wipe the four failures: one more locks this address out.
    expect((await login({ ...a, ip }, 'bad-5')).status).toBe(401);
    const locked = await login({ ...a, ip });
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe('AUTH_ACCOUNT_LOCKED');

    // A completed second factor DOES clear it.
    const b = await signup();
    const mfaB = await enrol(b);
    const ipB = nextIp();
    for (let i = 0; i < 4; i++)
      expect((await login({ ...b, ip: ipB }, `bad-${i}`)).status).toBe(401);
    const challenge = await login({ ...b, ip: ipB });
    const done = await api()
      .post('/v2/auth/login/mfa')
      .send({ challengeToken: challenge.body.challengeToken, recoveryCode: mfaB.recovery[0] });
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    for (let i = 0; i < 4; i++)
      expect((await login({ ...b, ip: ipB }, `bad-${i}`)).status).toBe(401);
    expect((await login({ ...b, ip: ipB })).body.status).toBe('mfa_required');
  });
});

// ===================================================================================================
describe('second-factor attempt budget (TW-AUTH-030)', () => {
  it('stops guessing across fresh challenges once five codes were wrong', async () => {
    const a = await signup();
    const { recovery } = await enrol(a);
    const wrong = (challengeToken: string) =>
      api().post('/v2/auth/login/mfa').send({ challengeToken, code: '000000' });

    // Three challenges, two wrong codes on the first two, one on the third: five in all.
    const c1 = (await login(a)).body.challengeToken as string;
    const c2 = (await login(a)).body.challengeToken as string;
    const c3 = (await login(a)).body.challengeToken as string;
    for (const c of [c1, c1, c2, c2, c3]) expect((await wrong(c)).status).toBe(401);

    // The sixth attempt is refused even with a valid recovery code.
    const refused = await api()
      .post('/v2/auth/login/mfa')
      .send({ challengeToken: c3, recoveryCode: recovery[0] });
    expect(refused.status).toBe(429);
    expect(refused.body.code).toBe('AUTH_ACCOUNT_LOCKED');
    expect(Number(refused.body.errors[0].message)).toBeGreaterThan(0);

    // A brand-new challenge does not reset the budget.
    const c4 = (await login(a)).body.challengeToken as string;
    expect(
      (
        await api()
          .post('/v2/auth/login/mfa')
          .send({ challengeToken: c4, recoveryCode: recovery[0] })
      ).status,
    ).toBe(429);

    // When the window passes, the person can sign in again.
    await h.redis.eval(
      `for _,k in ipairs(redis.call('keys','auth:mfa-fail:*')) do redis.call('del',k) end`,
      0,
    );
    const ok = await api()
      .post('/v2/auth/login/mfa')
      .send({ challengeToken: c4, recoveryCode: recovery[0] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect((await events('auth.mfa_failed', a)).some((e) => e.payload.reason === 'locked')).toBe(
      true,
    );
  });

  it('takes a code pasted the way the authenticator app shows it', async () => {
    const a = await signup();
    const { secret } = await enrol(a);
    const challenge = (await login(a)).body.challengeToken as string;
    // The next time-step is inside the accepted window and newer than the enrolment code.
    const next = hotp(base32Decode(secret), totpStep(Date.now()) + 1);
    const spaced = `${next.slice(0, 3)} ${next.slice(3)}`;
    const done = await api()
      .post('/v2/auth/login/mfa')
      .send({ challengeToken: challenge, code: spaced });
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    expect(done.body.status).toBe('authenticated');
  });

  it('applies to turning two-factor off and to regenerating the recovery codes', async () => {
    const a = await signup();
    await enrol(a);
    for (let i = 0; i < 3; i++) {
      const bad = await api()
        .post('/v2/account/mfa/disable')
        .set(bearer(a.access))
        .send({ password: `wrong-${i}` });
      expect(bad.body.code).toBe('AUTH_CURRENT_PASSWORD_WRONG');
    }
    for (let i = 0; i < 2; i++) {
      const bad = await api()
        .post('/v2/account/mfa/recovery-codes')
        .set(bearer(a.access))
        .send({ password: `wrong-${i}` });
      expect(bad.body.code).toBe('AUTH_CURRENT_PASSWORD_WRONG');
    }
    // Five wrong confirmations in all: the right password no longer gets through.
    const refused = await api()
      .post('/v2/account/mfa/disable')
      .set(bearer(a.access))
      .send({ password: PASSWORD });
    expect(refused.status).toBe(429);
    expect(refused.body.code).toBe('AUTH_ACCOUNT_LOCKED');
    const refusedRegen = await api()
      .post('/v2/account/mfa/recovery-codes')
      .set(bearer(a.access))
      .send({ password: PASSWORD });
    expect(refusedRegen.status).toBe(429);
    expect(
      (await events('auth.mfa_failed', a)).filter((e) => e.payload.phase === 'confirm'),
    ).toHaveLength(5);
  });

  it('applies to enrolment codes', async () => {
    const a = await signup();
    const setup = await api().post('/v2/account/mfa/setup').set(bearer(a.access));
    for (let i = 0; i < 5; i++) {
      const bad = await api()
        .post('/v2/account/mfa/enable')
        .set(bearer(a.access))
        .send({ code: '111111' });
      expect(bad.body.code).toBe('AUTH_MFA_INVALID_CODE');
    }
    const refused = await api()
      .post('/v2/account/mfa/enable')
      .set(bearer(a.access))
      .send({ code: totp(setup.body.secret) });
    expect(refused.status).toBe(429);
  });

  it('lets only one of two simultaneous enrolments through', async () => {
    const a = await signup();
    const setup = await api().post('/v2/account/mfa/setup').set(bearer(a.access));
    const code = totp(setup.body.secret);
    const both = await Promise.all([
      api().post('/v2/account/mfa/enable').set(bearer(a.access)).send({ code }),
      api().post('/v2/account/mfa/enable').set(bearer(a.access)).send({ code }),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([201, 422]);
  });
});

// ===================================================================================================
describe('the Clerk exchange and the partner portal (TW-AUTH-030/032)', () => {
  const asClerk = async <T>(identity: { email: string; id?: string }, fn: () => Promise<T>) => {
    const clerk = h.app.get(ClerkService);
    const original = clerk.verifySession.bind(clerk);
    clerk.verifySession = async () => ({
      clerkUserId: identity.id ?? `clerk_${identity.email}`,
      email: identity.email,
      fullName: 'Clerk Person',
    });
    try {
      return await fn();
    } finally {
      clerk.verifySession = original;
    }
  };
  const exchange = (a: Pick<Account, 'slug'>, ip: string) =>
    api()
      .post('/v2/auth/clerk/session')
      .set('x-forwarded-for', ip)
      .send({ orgSlug: a.slug, clerkToken: 'verified-elsewhere' });

  it('challenges a person who has two-factor on instead of opening a session', async () => {
    const a = await signup();
    const { recovery } = await enrol(a);
    await asClerk({ email: a.email }, async () => {
      const res = await exchange(a, nextIp());
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.status).toBe('mfa_required');
      expect(res.body.tokens).toBeUndefined();
      const done = await api()
        .post('/v2/auth/login/mfa')
        .send({ challengeToken: res.body.challengeToken, recoveryCode: recovery[0] });
      expect(done.status).toBe(201);
      expect(done.body.status).toBe('authenticated');
    });
  });

  it('opens a session at once when there is no second factor', async () => {
    const a = await signup();
    await asClerk({ email: a.email }, async () => {
      const res = await exchange(a, nextIp());
      expect(res.status).toBe(201);
      expect(res.body.status).toBe('authenticated');
    });
  });

  it('is refused while the person is locked out, and counts identities with no account', async () => {
    const a = await signup();
    const ip = nextIp();
    for (let i = 0; i < 5; i++) expect((await login({ ...a, ip }, `bad-${i}`)).status).toBe(401);
    await asClerk({ email: a.email }, async () => {
      const res = await exchange(a, ip);
      expect(res.status).toBe(429);
      expect(res.body.code).toBe('AUTH_ACCOUNT_LOCKED');
    });

    // An identity that matches nobody counts as a failed attempt, five of them lock that address.
    const stranger = `stranger${Date.now()}@example.test`;
    const ip2 = nextIp();
    await asClerk({ email: stranger, id: 'clerk_stranger' }, async () => {
      for (let i = 0; i < 5; i++) expect((await exchange(a, ip2)).status).toBe(401);
      expect((await exchange(a, ip2)).status).toBe(429);
    });
  });

  it('applies the sign-in lockout to partner agents, on a counter of their own', async () => {
    const a = await signup();
    const { orgId } = await ids(a);
    await h.owner.query(
      `INSERT INTO partner_agents (org_id, code, name, email, password_hash) VALUES ($1, 'AG-TEST', 'Partner', $2, $3)`,
      [orgId, 'agent@partner.test', await hash('Partner#Pass123')],
    );
    const partner = (password: string, ip: string) =>
      api()
        .post('/v2/auth/partner/login')
        .set('x-forwarded-for', ip)
        .send({ orgSlug: a.slug, email: 'agent@partner.test', password });
    const ip = nextIp();
    expect((await partner('Partner#Pass123', ip)).status).toBe(201);
    for (let i = 0; i < 5; i++) expect((await partner(`bad-${i}`, ip)).status).toBe(401);
    const locked = await partner('Partner#Pass123', ip);
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe('AUTH_ACCOUNT_LOCKED');
    // Another address is unaffected, and so is the staff counter for the same address.
    expect((await partner('Partner#Pass123', nextIp())).status).toBe(201);
    expect((await login({ ...a, ip })).status).toBe(201);
  });
});

// ===================================================================================================
describe('session lifetime and sign-out (TW-AUTH-001/012)', () => {
  it('gives a session without "keep me signed in" seven days, and a remembered one thirty', async () => {
    const a = await signup();
    await login(a, PASSWORD, { remember: true });
    const rows = await h.owner.query(
      `SELECT remember, extract(epoch FROM (s.expires_at - s.created_at)) AS secs
         FROM auth_sessions s JOIN users u ON u.org_id = s.org_id AND u.id = s.user_id
        WHERE u.email = $1 ORDER BY s.id`,
      [a.email],
    );
    const [plain, remembered] = rows.rows;
    expect(plain.remember).toBe(false);
    expect(Math.abs(Number(plain.secs) - 7 * 86400)).toBeLessThan(10);
    expect(remembered.remember).toBe(true);
    expect(Number(remembered.secs)).toBeGreaterThan(29 * 86400);
  });

  it('signs out from the refresh token alone, when the access token is long gone', async () => {
    const a = await signup();
    const out = await api().post('/v2/auth/logout').send({ refreshToken: a.refresh });
    expect(out.status).toBe(201);
    expect(out.body).toEqual({ ok: true });
    expect((await api().post('/v2/auth/refresh').send({ refreshToken: a.refresh })).status).toBe(
      401,
    );
    expect((await api().get('/v2/users/me').set(bearer(a.access))).status).toBe(401);
    expect(await events('auth.logout', a)).toHaveLength(1);
  });

  it('signs out from an access token that has just expired', async () => {
    const a = await signup();
    const claims = claimsOf(a.access);
    const jwt = h.app.get(JwtService, { strict: false });
    const expired = await jwt.signAsync(
      {
        sub: claims.sub,
        org: claims.org,
        typ: 'user',
        uid: claims.uid,
        sid: claims.sid,
        ep: claims.ep,
      },
      { secret: process.env.JWT_ACCESS_SECRET, expiresIn: -30 },
    );
    expect((await api().get('/v2/users/me').set(bearer(expired))).status).toBe(401);
    const out = await api().post('/v2/auth/logout').set(bearer(expired)).send({});
    expect(out.status).toBe(201);
    expect((await api().post('/v2/auth/refresh').send({ refreshToken: a.refresh })).status).toBe(
      401,
    );
  });

  it('answers ok to anything it cannot act on, and ends nothing', async () => {
    const a = await signup();
    expect((await api().post('/v2/auth/logout').send({})).body).toEqual({ ok: true });
    expect(
      (await api().post('/v2/auth/logout').send({ refreshToken: 'not.a.token' })).body,
    ).toEqual({ ok: true });
    expect((await api().post('/v2/auth/logout').set(bearer('garbage')).send({})).body).toEqual({
      ok: true,
    });
    // The session behind the real tokens is untouched, and a repeat sign-out is quiet.
    expect((await api().get('/v2/users/me').set(bearer(a.access))).status).toBe(200);
    await api().post('/v2/auth/logout').set(bearer(a.access)).send({});
    await api().post('/v2/auth/logout').send({ refreshToken: a.refresh });
    expect(await events('auth.logout', a)).toHaveLength(1);
  });
});

// ===================================================================================================
describe('idle timeout and session cap (TW-AUTH-033/034)', () => {
  it('says how long the limit was, ends the session once and audits it once', async () => {
    await setPolicy({ sessionTimeoutMinutes: 5 });
    try {
      const a = await signup();
      const sid = claimsOf(a.access).sid as string;
      await h.redis.set(`auth:act:${sid}`, String(Date.now() - 10 * 60_000));

      const res = await api().get('/v2/users/me').set(bearer(a.access));
      expect(res.status).toBe(401);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([
          { path: 'reason', message: 'idle' },
          { path: 'idleMinutes', message: '5' },
        ]),
      );
      for (let i = 0; i < 3; i++) {
        expect((await api().get('/v2/users/me').set(bearer(a.access))).status).toBe(401);
      }
      const row = await until(async () => {
        const r = await h.owner.query(
          `SELECT revoked_at, revoked_reason FROM auth_sessions WHERE uuid = $1`,
          [sid],
        );
        return r.rows[0].revoked_at ? r.rows[0] : false;
      });
      expect(row.revoked_reason).toBe('idle');
      await sleep(300);
      const audit = await events('auth.session_timeout', a);
      expect(audit).toHaveLength(1);
      expect(audit[0]!.payload.limitMinutes).toBe(5);

      // The refresh path tells the same story.
      const refresh = await api().post('/v2/auth/refresh').send({ refreshToken: a.refresh });
      expect(refresh.status).toBe(401);
      expect(refresh.body.errors).toEqual(
        expect.arrayContaining([{ path: 'idleMinutes', message: '5' }]),
      );
    } finally {
      await setPolicy({ sessionTimeoutMinutes: 60 });
    }
  });

  it('trims existing sessions on the next request after the cap is lowered', async () => {
    const a = await signup();
    const b = await login(a);
    const c = await login(a);
    const d = await login(a);
    const tokens = [
      a.access,
      b.body.tokens.accessToken,
      c.body.tokens.accessToken,
      d.body.tokens.accessToken,
    ];
    for (const t of tokens)
      expect((await api().get('/v2/users/me').set(bearer(t))).status).toBe(200);
    await setPolicy({ maxConcurrentSessions: 2 });
    try {
      // The third session speaks first: it stays, and the newest other one stays with it.
      expect((await api().get('/v2/users/me').set(bearer(tokens[2]!))).status).toBe(200);
      await until(async () => {
        const r = await h.owner.query(
          `SELECT count(*)::int AS n FROM auth_sessions s JOIN users u ON u.org_id = s.org_id AND u.id = s.user_id
            WHERE u.email = $1 AND s.revoked_at IS NULL`,
          [a.email],
        );
        return r.rows[0].n === 2;
      });
      const statuses = await Promise.all(
        tokens.map(async (t) => (await api().get('/v2/users/me').set(bearer(t))).status),
      );
      expect(statuses).toEqual([401, 401, 200, 200]);
      const evicted = await events('auth.concurrent_sessions_evicted', a);
      expect(evicted.at(-1)!.payload).toMatchObject({ cap: 2, evicted: 2, trigger: 'cap_lowered' });
    } finally {
      await setPolicy({ maxConcurrentSessions: 5 });
    }
  });

  it('does not sweep again for sessions already checked against the current cap', async () => {
    const a = await signup();
    await login(a);
    const before = (await events('auth.concurrent_sessions_evicted', a)).length;
    for (let i = 0; i < 3; i++) {
      expect((await api().get('/v2/users/me').set(bearer(a.access))).status).toBe(200);
    }
    await sleep(200);
    expect((await events('auth.concurrent_sessions_evicted', a)).length).toBe(before);
  });
});

// ===================================================================================================
describe("listing a person's sessions without a silent cap (TW-AUTH-031)", () => {
  it('pages by keyset, current device first, and counts every live session', async () => {
    await setPolicy({ maxConcurrentSessions: 50 });
    try {
      const a = await signup();
      for (let i = 0; i < 11; i++) expect((await login(a)).status).toBe(201);
      const { orgId, userId } = await ids(a);
      const sessions = h.app.get(SessionService);
      const sid = claimsOf(a.access).sid as string;

      const everything = await sessions.list(orgId, userId, sid);
      expect(everything).toHaveLength(12);

      const seen: string[] = [];
      let cursor: string | undefined;
      let pages = 0;
      for (;;) {
        const page = await sessions.listPage(orgId, userId, sid, { limit: 5, cursor });
        expect(page.total).toBe(12);
        if (pages === 0) expect(page.data[0]!.id).toBe(sid);
        else expect(page.data.some((s) => s.current)).toBe(false);
        seen.push(...page.data.map((s) => s.id));
        pages++;
        if (!page.page.hasMore) break;
        cursor = page.page.nextCursor!;
      }
      expect(pages).toBe(3);
      expect(new Set(seen).size).toBe(12);
      expect(new Set(seen)).toEqual(new Set(everything.map((s) => s.id)));
      await expect(
        sessions.listPage(orgId, userId, sid, { limit: 5, cursor: 'not-a-cursor' }),
      ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });

      // A page of one is just the current device; the cursor still leads on to the others.
      const solo: string[] = [];
      let soloCursor: string | undefined;
      for (let i = 0; i < 20; i++) {
        const page = await sessions.listPage(orgId, userId, sid, { limit: 1, cursor: soloCursor });
        expect(page.data).toHaveLength(1);
        if (i === 0) expect(page.data[0]!.current).toBe(true);
        solo.push(page.data[0]!.id);
        if (!page.page.hasMore) break;
        soloCursor = page.page.nextCursor!;
      }
      expect(solo).toHaveLength(12);
      expect(new Set(solo).size).toBe(12);
    } finally {
      await setPolicy({ maxConcurrentSessions: 5 });
    }
  });
});

describe('ending devices (TW-AUTH-031)', () => {
  it('logs a revoked device out on its very next request and counts exactly who was ended', async () => {
    const a = await signup();
    const b = await login(a);
    const c = await login(a);
    const sidB = claimsOf(b.body.tokens.accessToken).sid as string;
    for (const t of [a.access, b.body.tokens.accessToken, c.body.tokens.accessToken]) {
      expect((await api().get('/v2/users/me').set(bearer(t))).status).toBe(200);
    }
    const one = await api().delete(`/v2/account/sessions/${sidB}`).set(bearer(a.access));
    expect(one.status).toBe(200);
    expect((await api().get('/v2/users/me').set(bearer(b.body.tokens.accessToken))).status).toBe(
      401,
    );
    expect(
      (await api().post('/v2/auth/refresh').send({ refreshToken: b.body.tokens.refreshToken }))
        .status,
    ).toBe(401);

    const others = await api().post('/v2/account/sessions/revoke-others').set(bearer(a.access));
    expect(others.body).toEqual({ revoked: 1 });
    expect((await api().get('/v2/users/me').set(bearer(c.body.tokens.accessToken))).status).toBe(
      401,
    );
    expect((await api().get('/v2/users/me').set(bearer(a.access))).status).toBe(200);
  });
});

// ===================================================================================================
describe('platform operators (TW-AUTH-032/033/034/018)', () => {
  const SUPPORT = 'support@platform.test';
  const opLogin = (headers: Record<string, string> = {}) =>
    api()
      .post('/v2/platform/auth/login')
      .set('x-forwarded-for', nextIp())
      .set(headers)
      .send({ email: SUPPORT, password: OPERATOR_PASSWORD });

  it('caps operator sessions like user sessions', async () => {
    await setPolicy({ maxConcurrentSessions: 2 });
    try {
      const one = await opLogin();
      const two = await opLogin();
      const three = await opLogin();
      expect(three.status, JSON.stringify(three.body)).toBe(201);
      const probe = (r: request.Response) =>
        api().get('/v2/platform/auth/session').set(bearer(r.body.tokens.accessToken));
      expect((await probe(one)).status).toBe(401);
      expect((await probe(two)).status).toBe(200);
      expect((await probe(three)).status).toBe(200);
    } finally {
      await setPolicy({ maxConcurrentSessions: 5 });
    }
  });

  it('trims operator sessions on the next request when the cap is lowered', async () => {
    const one = await opLogin();
    const two = await opLogin();
    const probe = (r: request.Response) =>
      api().get('/v2/platform/auth/session').set(bearer(r.body.tokens.accessToken));
    expect((await probe(one)).status).toBe(200);
    expect((await probe(two)).status).toBe(200);
    await setPolicy({ maxConcurrentSessions: 1 });
    try {
      expect((await probe(two)).status).toBe(200);
      await until(async () => (await probe(one)).status === 401);
      expect((await probe(two)).status).toBe(200);
    } finally {
      await setPolicy({ maxConcurrentSessions: 5 });
    }
  });

  it('times operators out when idle, saying for how long, and does not exempt them as "remembered"', async () => {
    await setPolicy({ sessionTimeoutMinutes: 5 });
    try {
      const r = await opLogin();
      const sid = claimsOf(r.body.tokens.accessToken).sid as string;
      expect(claimsOf(r.body.tokens.accessToken).rm).toBe(false);
      await h.redis.set(`auth:act:${sid}`, String(Date.now() - 10 * 60_000));
      const res = await api()
        .get('/v2/platform/auth/session')
        .set(bearer(r.body.tokens.accessToken));
      expect(res.status).toBe(401);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([{ path: 'idleMinutes', message: '5' }]),
      );
      // Refresh agrees, and writes its own audit row.
      const fresh = await opLogin();
      const sid2 = claimsOf(fresh.body.tokens.accessToken).sid as string;
      await h.redis.set(`auth:act:${sid2}`, String(Date.now() - 10 * 60_000));
      await h.owner.query(
        `UPDATE platform_sessions SET last_used_at = now() - interval '10 minutes' WHERE uuid = $1`,
        [sid2],
      );
      const refresh = await api()
        .post('/v2/platform/auth/refresh')
        .send({ refreshToken: fresh.body.tokens.refreshToken });
      expect(refresh.status).toBe(401);
      expect(refresh.body.errors).toEqual(
        expect.arrayContaining([{ path: 'idleMinutes', message: '5' }]),
      );
      const rows = await h.owner.query(
        `SELECT 1 FROM security_events WHERE event = 'platform.auth.session_timeout'`,
      );
      expect(rows.rowCount).toBeGreaterThan(0);
    } finally {
      await setPolicy({ sessionTimeoutMinutes: 60 });
    }
  });

  it('emails a new-device alert to operators too, pointing at the console security page', async () => {
    const before = h.mail.length;
    await opLogin({
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });
    const other = await api()
      .post('/v2/platform/auth/login')
      .set('x-forwarded-for', '198.51.100.99')
      .set('user-agent', 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0')
      .send({ email: SUPPORT, password: OPERATOR_PASSWORD });
    expect(other.status).toBe(201);
    const mail = await until(async () =>
      h.mail.slice(before).find((m) => m.to === SUPPORT && /new sign-in/i.test(m.subject)),
    );
    expect(mail.text).toContain('/admin/account/security');
    expect(mail.text).toContain('198.51.100.99');
    const audit = await until(async () => {
      const r = await h.owner.query(
        `SELECT payload FROM security_events WHERE event = 'platform.auth.alert_emitted' ORDER BY id DESC LIMIT 1`,
      );
      return r.rows[0];
    });
    expect(audit.payload.reasons).toEqual(expect.arrayContaining(['new-device', 'new-country']));
  });

  it('asks for a second factor from every operator when the policy says admins must have one', async () => {
    const r = await opLogin();
    const token = r.body.tokens.accessToken as string;
    expect((await api().get('/v2/platform/security').set(bearer(token))).status).toBe(200);
    await setPolicy({ requireMfaForAdmins: true });
    try {
      const blocked = await api().get('/v2/platform/security').set(bearer(token));
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('AUTH_MFA_ENROLMENT_REQUIRED');
      const session = await api().get('/v2/platform/auth/session').set(bearer(token));
      expect(session.body.mfaEnrolmentRequired).toBe(true);
      expect((await opLogin()).body.mfaEnrolmentRequired).toBe(true);

      // The way out stays open, and a wrong code is audited and counted.
      const setup = await api().post('/v2/platform/auth/mfa/setup').set(bearer(token));
      expect(setup.status).toBe(201);
      for (let i = 0; i < 5; i++) {
        const bad = await api()
          .post('/v2/platform/auth/mfa/enable')
          .set(bearer(token))
          .send({ code: '000000' });
        expect(bad.body.code).toBe('AUTH_MFA_INVALID_CODE');
      }
      const refused = await api()
        .post('/v2/platform/auth/mfa/enable')
        .set(bearer(token))
        .send({ code: totp(setup.body.secret) });
      expect(refused.status).toBe(429);
      const failed = await h.owner.query(
        `SELECT 1 FROM security_events WHERE event = 'platform.auth.mfa_failed' AND payload->>'phase' = 'enrol'`,
      );
      expect(failed.rowCount).toBe(5);

      await h.redis.eval(
        `for _,k in ipairs(redis.call('keys','auth:mfa-fail:*')) do redis.call('del',k) end`,
        0,
      );
      const enabled = await api()
        .post('/v2/platform/auth/mfa/enable')
        .set(bearer(token))
        .send({ code: totp(setup.body.secret) });
      expect(enabled.status, JSON.stringify(enabled.body)).toBe(201);
      expect((await api().get('/v2/platform/security').set(bearer(token))).status).toBe(200);
    } finally {
      await setPolicy({ requireMfaForAdmins: false });
      await h.owner.query(
        `UPDATE platform_operators SET mfa_enabled = false, mfa_secret_enc = NULL, mfa_recovery_hashes = '[]'::jsonb WHERE email = $1`,
        [SUPPORT],
      );
    }
  });

  it('signs an operator out from the refresh token alone', async () => {
    const r = await opLogin();
    await h.app.get(OperatorAuthService).logout(r.body.tokens.refreshToken);
    expect(
      (
        await api()
          .post('/v2/platform/auth/refresh')
          .send({ refreshToken: r.body.tokens.refreshToken })
      ).status,
    ).toBe(401);
    expect(
      (await api().get('/v2/platform/auth/session').set(bearer(r.body.tokens.accessToken))).status,
    ).toBe(401);
  });
});

// ===================================================================================================
describe('sign-in bookkeeping (TW-AUTH-017)', () => {
  it('accepts an invitation at the first sign-in, once', async () => {
    const a = await signup();
    const { orgId, userId } = await ids(a);
    await h.owner.query(`UPDATE users SET joined_at = NULL WHERE org_id = $1 AND id = $2`, [
      orgId,
      userId,
    ]);
    expect((await login(a)).status).toBe(201);
    const first = (
      await h.owner.query(`SELECT joined_at FROM users WHERE org_id = $1 AND id = $2`, [
        orgId,
        userId,
      ])
    ).rows[0].joined_at as Date;
    expect(first).toBeTruthy();
    await sleep(50);
    expect((await login(a)).status).toBe(201);
    const second = (
      await h.owner.query(`SELECT joined_at FROM users WHERE org_id = $1 AND id = $2`, [
        orgId,
        userId,
      ])
    ).rows[0].joined_at as Date;
    expect(second.getTime()).toBe(first.getTime());
  });

  it('records a wrong password as auth.failed with the identifier, address and browser', async () => {
    const a = await signup();
    const ip = nextIp();
    await login({ ...a, ip }, 'definitely-not-it', {}, { 'user-agent': 'FailTest/2.0' });
    const last = (await events('auth.failed', a)).at(-1)!;
    expect(last.payload).toMatchObject({ identifier: a.email });
    expect(last.ip).toBe(ip);
    expect(last.user_agent).toBe('FailTest/2.0');
    // Without the password or anything derived from it.
    expect(JSON.stringify(last.payload)).not.toContain('definitely');
  });

  it('records auth.login with the user, address and browser', async () => {
    const a = await signup();
    const ip = nextIp();
    await login({ ...a, ip }, PASSWORD, {}, { 'user-agent': 'ParityTest/1.0' });
    const rows = await events('auth.login', a);
    const last = rows.at(-1)!;
    expect(last.payload).toMatchObject({ method: 'password', remember: false });
    expect(last.ip).toBe(ip);
    expect(last.user_agent).toBe('ParityTest/1.0');
    expect(Number(last.actor_id)).toBe((await ids(a)).userId);
  });

  it('still signs the person in when the audit sink is down', async () => {
    const a = await signup();
    const audit = h.app.get(AuthAuditService);
    const original = audit.record.bind(audit);
    audit.record = async () => {
      throw new Error('audit store unavailable');
    };
    try {
      const res = await login(a);
      expect(res.status, JSON.stringify(res.body)).toBe(201);
      expect(res.body.status).toBe('authenticated');
      expect(
        (await api().get('/v2/users/me').set(bearer(res.body.tokens.accessToken))).status,
      ).toBe(200);
    } finally {
      audit.record = original;
    }
  });

  it('stamps the address verified when verification is off, and gives social accounts a password clock', async () => {
    const a = await signup();
    const { orgId, userId } = await ids(a);
    await h.owner.query(
      `UPDATE user_security SET email_verified_at = NULL, password_changed_at = NULL WHERE org_id = $1 AND user_id = $2`,
      [orgId, userId],
    );
    expect((await login(a)).status).toBe(201);
    let row = (
      await h.owner.query(
        `SELECT email_verified_at, password_changed_at FROM user_security WHERE org_id = $1 AND user_id = $2`,
        [orgId, userId],
      )
    ).rows[0];
    expect(row.email_verified_at).toBeTruthy();
    // A password sign-in does not invent a password age.
    expect(row.password_changed_at).toBeNull();

    const org = (
      await h.owner.query(`SELECT id, slug, settings FROM organizations WHERE id = $1`, [orgId])
    ).rows[0];
    const user = (await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [userId])).rows[0];
    const svc = h.app.get(LoginService);
    const social = await svc.completeLogin({
      org: { id: Number(org.id), slug: org.slug, settings: org.settings },
      user: { id: userId, uuid: user.uuid, email: a.email, fullName: 'Test Person' },
      remember: false,
      mfaVerified: false,
      method: 'social',
      meta: { ip: nextIp(), userAgent: 'SocialTest/1.0' },
    });
    expect(social.remember).toBe(true);
    row = (
      await h.owner.query(
        `SELECT password_changed_at FROM user_security WHERE org_id = $1 AND user_id = $2`,
        [orgId, userId],
      )
    ).rows[0];
    expect(row.password_changed_at).toBeTruthy();
    const sess = await h.owner.query(
      `SELECT remember FROM auth_sessions WHERE user_agent = 'SocialTest/1.0'`,
    );
    expect(sess.rows[0].remember).toBe(true);
  });

  it('keeps social sessions short when the platform switched remembering off', async () => {
    await setPolicy({ rememberMeEnabled: false });
    try {
      const a = await signup();
      const { orgId, userId } = await ids(a);
      const org = (
        await h.owner.query(`SELECT id, slug, settings FROM organizations WHERE id = $1`, [orgId])
      ).rows[0];
      const user = (await h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [userId])).rows[0];
      const social = await h.app.get(LoginService).completeLogin({
        org: { id: Number(org.id), slug: org.slug, settings: org.settings },
        user: { id: userId, uuid: user.uuid, email: a.email, fullName: 'Test Person' },
        remember: false,
        mfaVerified: false,
        method: 'social',
        meta: { ip: nextIp(), userAgent: 'SocialOff/1.0' },
      });
      expect(social.remember).toBe(false);
    } finally {
      await setPolicy({ rememberMeEnabled: true });
    }
  });
});

// ===================================================================================================
describe('new-device alert (TW-AUTH-018)', () => {
  const CHROME_WIN =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const SAFARI_IPHONE =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

  async function signupFrom(ip: string, ua: string) {
    const email = uniqueEmail('alert');
    const res = await api()
      .post('/v2/auth/signup')
      .set('x-forwarded-for', ip)
      .set('user-agent', ua)
      .send({ orgName: 'Alert Co', fullName: 'Al', email, password: PASSWORD, acceptTerms: true });
    const slug = (await api().get('/v2/auth/session').set(bearer(res.body.tokens.accessToken))).body
      .org.slug as string;
    return { email, slug, access: res.body.tokens.accessToken as string, ip };
  }

  it('links to the password reset page, audits every qualifying sign-in and mails once per place', async () => {
    const a = await signupFrom('203.0.113.10', CHROME_WIN);
    const before = h.mail.length;
    const home = { 'user-agent': CHROME_WIN };
    const away = { 'user-agent': SAFARI_IPHONE };
    // away (alert), home again (alert), away again within ten minutes (alert, but no second mail).
    await login({ ...a, ip: '198.51.100.20' }, PASSWORD, {}, away);
    await until(async () => (await events('auth.alert_emitted', a as Account)).length >= 1);
    await login({ ...a, ip: '203.0.113.10' }, PASSWORD, {}, home);
    await until(async () => (await events('auth.alert_emitted', a as Account)).length >= 2);
    await login({ ...a, ip: '198.51.100.20' }, PASSWORD, {}, away);

    // The audit row is written BEFORE the dedupe, so all three sign-ins left one...
    const audits = await until(async () => {
      const rows = await events('auth.alert_emitted', a as Account);
      return rows.length >= 3 ? rows : false;
    });
    expect(audits).toHaveLength(3);
    expect(audits[0]!.payload).toMatchObject({
      reasons: ['new-device', 'new-country'],
      channel: 'email',
      prevIp: '203.0.113.10',
      thisIp: '198.51.100.20',
    });
    expect(String(audits[0]!.payload.thisUa).length).toBeLessThanOrEqual(120);
    expect(audits[0]!.payload.emailSent).toBeUndefined();

    // ...while the mailbox was spared the repeat from the same place.
    await sleep(600);
    const mails = h.mail
      .slice(before)
      .filter((x) => x.to === a.email && /new sign-in/i.test(x.subject));
    expect(mails).toHaveLength(2);
    expect(mails[0]!.text).toContain(`/forgot-password?org=${a.slug}`);
    expect(mails[0]!.text).not.toContain('/account?tab=security');
  });

  it('picks the subject by reason: a lone new device, or a new location', async () => {
    const a = await signupFrom('203.0.113.11', CHROME_WIN);
    const mark = h.mail.length;
    await login({ ...a, ip: '203.0.113.11' }, PASSWORD, {}, { 'user-agent': SAFARI_IPHONE });
    const deviceOnly = await until(async () =>
      h.mail.slice(mark).find((m) => m.to === a.email && /new sign-in/i.test(m.subject)),
    );
    expect(deviceOnly.subject).toMatch(/new device/i);
    expect(deviceOnly.subject).not.toMatch(/location/i);

    const b = await signupFrom('203.0.113.12', CHROME_WIN);
    const mark2 = h.mail.length;
    await login({ ...b, ip: '192.0.2.50' }, PASSWORD, {}, { 'user-agent': CHROME_WIN });
    const location = await until(async () =>
      h.mail.slice(mark2).find((m) => m.to === b.email && /new sign-in/i.test(m.subject)),
    );
    expect(location.subject).toMatch(/location/i);
  });

  it('does not fire when moving between workspaces', async () => {
    const email = uniqueEmail('hop');
    const first = await api()
      .post('/v2/auth/signup')
      .set('x-forwarded-for', '203.0.113.14')
      .set('user-agent', CHROME_WIN)
      .send({ orgName: 'Hop One', fullName: 'Hop', email, password: PASSWORD, acceptTerms: true });
    const second = await api()
      .post('/v2/auth/signup')
      .set('x-forwarded-for', '203.0.113.14')
      .set('user-agent', CHROME_WIN)
      .send({ orgName: 'Hop Two', fullName: 'Hop', email, password: PASSWORD, acceptTerms: true });
    const slugTwo = (
      await api().get('/v2/auth/session').set(bearer(second.body.tokens.accessToken))
    ).body.org.slug as string;
    const mark = h.mail.length;
    const hop = await api()
      .post('/v2/auth/workspaces/switch')
      .set(bearer(first.body.tokens.accessToken))
      .set('x-forwarded-for', '198.51.100.77')
      .set('user-agent', SAFARI_IPHONE)
      .send({ orgSlug: slugTwo });
    expect(hop.status, JSON.stringify(hop.body)).toBe(201);
    await sleep(700);
    expect(
      h.mail.slice(mark).filter((m) => m.to === email && /new sign-in/i.test(m.subject)),
    ).toHaveLength(0);
  });
});

// ===================================================================================================
describe('verification mail (TW-AUTH-015)', () => {
  it('is off by default: accounts count as verified and no mail goes out', async () => {
    const cfg = await api().get('/v2/auth/registration-config');
    expect(cfg.body.emailVerification).toBe('off');
    const before = h.mail.length;
    const a = await signup();
    const session = await api().get('/v2/auth/session').set(bearer(a.access));
    expect(session.body.flags.emailUnverified).toBe(false);
    await sleep(300);
    expect(h.mail.slice(before).filter((m) => m.to === a.email)).toHaveLength(0);
  });

  it('says why a resend failed and does not make the person wait for the next try', async () => {
    await op('patch', '/settings/registration').send({ emailVerification: 'banner' });
    try {
      const a = await signup();
      expect(
        (await api().get('/v2/auth/session').set(bearer(a.access))).body.flags.emailUnverified,
      ).toBe(true);
      const mail = h.app.get(MailService) as unknown as { port: MailPort };
      const original = mail.port;
      mail.port = {
        send: async () => {
          throw new MailError('auth_failed', 'smtp login refused for hunter2');
        },
      };
      try {
        const one = await api().post('/v2/auth/verify-email/resend').set(bearer(a.access));
        expect(one.status).toBe(201);
        expect(one.body).toEqual({ sent: false, alreadyVerified: false, reason: 'auth_failed' });
        // The failed attempt did not start the 60-second wait.
        const two = await api().post('/v2/auth/verify-email/resend').set(bearer(a.access));
        expect(two.status).toBe(201);
        expect(two.body.reason).toBe('auth_failed');
        expect(JSON.stringify(two.body)).not.toContain('hunter2');
      } finally {
        mail.port = original;
      }
      const ok = await api().post('/v2/auth/verify-email/resend').set(bearer(a.access));
      expect(ok.body).toEqual({ sent: true, alreadyVerified: false });
      expect((await api().post('/v2/auth/verify-email/resend').set(bearer(a.access))).status).toBe(
        429,
      );
    } finally {
      await op('patch', '/settings/registration').send({ emailVerification: 'off' });
    }
  });
});

// ===================================================================================================
describe('password rules the web hint relies on (TW-AUTH-035)', () => {
  it('publishes the rules in force, uncached', async () => {
    const res = await api().get('/v2/auth/password-policy');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      minLength: 8,
      requireMixedCase: true,
      requireNumber: true,
      requireSymbol: false,
    });
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.headers['pragma']).toBe('no-cache');
    await setPolicy({ passwordMinLength: 6, passwordRequireSymbol: true });
    try {
      expect((await api().get('/v2/auth/password-policy')).body).toEqual({
        minLength: 6,
        requireMixedCase: true,
        requireNumber: true,
        requireSymbol: true,
      });
    } finally {
      await setPolicy({ passwordMinLength: 8, passwordRequireSymbol: false });
    }
  });

  it('lets the stored policy, not the contract, decide the minimum length', async () => {
    const six = { orgName: 'Six Co', fullName: 'Six', acceptTerms: true, password: 'Ab1xyz' };
    // The default policy asks for 8: a 6-character password reaches the policy and fails THERE.
    const refused = await api()
      .post('/v2/auth/signup')
      .set('x-forwarded-for', nextIp())
      .send({ ...six, email: uniqueEmail() });
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('AUTH_PASSWORD_POLICY');
    expect(refused.body.errors.map((e: { path: string }) => e.path)).toContain(
      'password.min_length',
    );

    await setPolicy({ passwordMinLength: 6 });
    try {
      const ok = await api()
        .post('/v2/auth/signup')
        .set('x-forwarded-for', nextIp())
        .send({ ...six, email: uniqueEmail() });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    } finally {
      await setPolicy({ passwordMinLength: 8 });
    }
  });
});
