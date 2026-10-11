import { hash } from '@node-rs/argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EpochService } from '../../../src/modules/auth/sessions/epoch.service';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import { startHarness, type Harness } from './harness';

/**
 * The authentication-audit fixes, through HTTP against real Postgres and Redis: partner-agent revocation, recent
 * authentication for two-factor enrolment, the stronger proof for turning it off, the password blocklist, the account-wide
 * failure counter and the email-change hardening. Every scenario signs up its own organization.
 */
let h: Harness;
const api = () => request(h.app.getHttpServer());
const PASSWORD = 'Str0ngPassw0rd#1';
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const totp = (secret: string) => hotp(base32Decode(secret), totpStep(Date.now()));

// EpochService keeps the value for a few seconds in memory; a test that writes Redis directly must drop that copy.
const forgetEpoch = () => {
  (h.app.get(EpochService) as unknown as { cached: unknown }).cached = null;
};

let ipCounter = 30;
const nextIp = () => `10.88.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`;
let emailCounter = 0;
const uniqueEmail = (tag = 'h') => `${tag}${Date.now()}${emailCounter++}@example.test`;

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
) =>
  api()
    .post('/v2/auth/login')
    .set('x-forwarded-for', a.ip ?? nextIp())
    .send({ orgSlug: a.slug, email: a.email, password, ...extra });

const flushGates = () =>
  h.redis.eval(`for _,k in ipairs(redis.call('keys','auth:gate:*')) do redis.call('del',k) end`, 0);

beforeAll(async () => {
  h = await startHarness();
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

describe('partner agents are revocable', () => {
  async function partner() {
    const a = await signup();
    const org = await h.owner.query(`SELECT id FROM organizations WHERE slug = $1`, [a.slug]);
    const orgId = Number(org.rows[0].id);
    const email = uniqueEmail('agent');
    const row = await h.owner.query(
      `INSERT INTO partner_agents (org_id, code, name, email, password_hash) VALUES ($1, $2, 'Agent', $3, $4) RETURNING id`,
      [orgId, `AG-${Date.now() % 100000}`, email, await hash(PASSWORD)],
    );
    const agentId = Number(row.rows[0].id);
    const res = await api()
      .post('/v2/auth/partner/login')
      .set('x-forwarded-for', nextIp())
      .send({ orgSlug: a.slug, email, password: PASSWORD });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return {
      orgId,
      agentId,
      access: res.body.accessToken as string,
      refresh: res.body.refreshToken as string,
    };
  }

  it('a suspended agent loses the API and cannot refresh, even with tokens that are still valid', async () => {
    const p = await partner();
    expect((await api().get('/v2/partner/leads').set(bearer(p.access))).status).toBe(200);

    await h.owner.query(`UPDATE partner_agents SET status = 'suspended' WHERE id = $1`, [
      p.agentId,
    ]);
    // an instance that did not see the change serves the cached verdict for up to 30 s; the one that did, at once
    await h.redis.del(`auth:partner:${p.orgId}:${p.agentId}`);

    expect((await api().get('/v2/partner/leads').set(bearer(p.access))).status).toBe(401);
    expect((await api().post('/v2/auth/refresh').send({ refreshToken: p.refresh })).status).toBe(
      401,
    );
  });

  it('is also cut off by the platform-wide "revoke everything" epoch', async () => {
    const p = await partner();
    expect((await api().get('/v2/partner/leads').set(bearer(p.access))).status).toBe(200);
    await h.owner
      .query(`INSERT INTO platform_settings (key, value, is_secret) VALUES ('auth.epoch', '99'::jsonb, false)
                         ON CONFLICT (key) DO UPDATE SET value = '99'::jsonb`);
    await h.redis.set('auth:epoch', '99');
    forgetEpoch();
    expect((await api().get('/v2/partner/leads').set(bearer(p.access))).status).toBe(401);
    await h.owner.query(`UPDATE platform_settings SET value = '0'::jsonb WHERE key = 'auth.epoch'`);
    await h.redis.set('auth:epoch', '0');
    forgetEpoch();
  });
});

describe('two-factor enrolment needs recent authentication', () => {
  const age = (a: Account) =>
    h.owner.query(
      `UPDATE auth_sessions SET created_at = now() - interval '1 hour'
       WHERE org_id = (SELECT id FROM organizations WHERE slug = $1)`,
      [a.slug],
    );

  it('a fresh sign-in needs no password; an old session must send it', async () => {
    const fresh = await signup();
    expect(
      (await api().post('/v2/account/mfa/setup').set(bearer(fresh.access)).send({})).status,
    ).toBe(201);

    const old = await signup();
    await age(old);
    const refused = await api().post('/v2/account/mfa/setup').set(bearer(old.access)).send({});
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('AUTH_REAUTH_REQUIRED');
    const wrong = await api()
      .post('/v2/account/mfa/setup')
      .set(bearer(old.access))
      .send({ password: 'not-it' });
    expect(wrong.body.code).toBe('AUTH_CURRENT_PASSWORD_WRONG');
    const ok = await api()
      .post('/v2/account/mfa/setup')
      .set(bearer(old.access))
      .send({ password: PASSWORD });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);

    // confirming the first code is guarded the same way
    const noPw = await api()
      .post('/v2/account/mfa/enable')
      .set(bearer(old.access))
      .send({ code: totp(ok.body.secret) });
    expect(noPw.body.code).toBe('AUTH_REAUTH_REQUIRED');
    const enabled = await api()
      .post('/v2/account/mfa/enable')
      .set(bearer(old.access))
      .send({ code: totp(ok.body.secret), password: PASSWORD });
    expect(enabled.status, JSON.stringify(enabled.body)).toBe(201);
    expect(enabled.body.recoveryCodes).toHaveLength(10);
  });

  it('tells the person by email when the second factor changes', async () => {
    const a = await signup();
    const setup = await api().post('/v2/account/mfa/setup').set(bearer(a.access)).send({});
    await api()
      .post('/v2/account/mfa/enable')
      .set(bearer(a.access))
      .send({ code: totp(setup.body.secret) });
    await new Promise((r) => setTimeout(r, 400));
    expect(h.mail.some((m) => m.to === a.email && /security change/i.test(m.subject))).toBe(true);
  });
});

describe('password policy', () => {
  it('refuses a common password and its dressed-up variants at sign-up, and says why', async () => {
    for (const password of ['Welcome123!', 'Summer2024!!', 'Qwerty12345!', 'Passw0rd!2026']) {
      const res = await api()
        .post('/v2/auth/signup')
        .set('x-forwarded-for', nextIp())
        .send({
          orgName: 'Weak Org',
          fullName: 'Weak Person',
          email: uniqueEmail('weak'),
          password,
          acceptTerms: true,
        });
      expect(res.status, password).toBe(422);
      expect(res.body.code).toBe('AUTH_PASSWORD_POLICY');
    }
  });

  it('the default minimum is 12 characters', async () => {
    const res = await api()
      .post('/v2/auth/signup')
      .set('x-forwarded-for', nextIp())
      .send({
        orgName: 'Short Org',
        fullName: 'Short Person',
        email: uniqueEmail('short'),
        password: 'Ab1!xyQmZ',
        acceptTerms: true,
      });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('min_length');
  });
});

describe('account-wide failure counter', () => {
  it('after many failures from many addresses, an unfamiliar network is challenged while the owner keeps signing in', async () => {
    const a = await signup();
    // the owner signs in from a network they will keep using
    const home = '198.51.100.20';
    expect((await login({ ...a, ip: home })).status).toBe(201);

    // 5 x the lockout threshold (5) = 25 failures against the account, each from a different address
    for (let i = 0; i < 25; i++) {
      const res = await login({ ...a, ip: `203.0.${i}.9` }, `Wrong-${i}-password!`);
      expect([401, 429, 400]).toContain(res.status);
    }
    const stranger = await login({ ...a, ip: '192.0.2.77' }, PASSWORD);
    expect(stranger.status).toBe(429);
    expect(stranger.body.code).toBe('AUTH_CHALLENGE_REQUIRED');

    // the owner's usual network (same first two octets) is unaffected
    const owner = await login({ ...a, ip: '198.51.7.7' }, PASSWORD);
    expect(owner.status, JSON.stringify(owner.body)).toBe(201);
    const flagged = await h.owner.query(
      `SELECT 1 FROM security_events WHERE event = 'auth.account_under_attack'`,
    );
    expect(flagged.rows.length).toBeGreaterThan(0);
  });
});

describe('email change', () => {
  it('kills reset links already mailed to the old address and signs every session out', async () => {
    const a = await signup();
    await h.owner.query(
      `UPDATE user_security SET email_verified_at = now()
       WHERE org_id = (SELECT id FROM organizations WHERE slug = $1)`,
      [a.slug],
    );
    await api()
      .post('/v2/auth/forgot-password')
      .set('x-forwarded-for', nextIp())
      .send({ orgSlug: a.slug, email: a.email });
    const reset = await (async () => {
      for (let i = 0; i < 40; i++) {
        const m = h.mail.find(
          (x) => x.to === a.email && /password/i.test(x.subject) && /reset-password/.test(x.text),
        );
        if (m) return m;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('no reset mail');
    })();
    const resetToken = new URL(
      /https?:\/\/\S+reset-password\?\S+/.exec(reset.text)![0],
    ).searchParams.get('token')!;

    const to = uniqueEmail('moved');
    expect(
      (
        await api()
          .post('/v2/account/email-change')
          .set(bearer(a.access))
          .send({ newEmail: to, password: PASSWORD })
      ).status,
    ).toBe(201);
    const confirm = h.mail.find((m) => m.to === to && /confirm/i.test(m.subject))!;
    const link = new URL(/https?:\/\/\S+confirm-email-change\?\S+/.exec(confirm.text)![0]);
    expect(
      (
        await api()
          .post('/v2/account/email-change/confirm')
          .send({ orgSlug: link.searchParams.get('org'), token: link.searchParams.get('token') })
      ).status,
    ).toBe(201);

    // the old mailbox's reset link is dead, and the session that asked for the change is signed out
    const used = await api()
      .post('/v2/auth/reset-password')
      .send({ orgSlug: a.slug, token: resetToken, password: 'An0ther#Strong1xyz' });
    expect(used.status).toBe(400);
    expect((await api().get('/v2/auth/session').set(bearer(a.access))).status).toBe(401);
    await flushGates();
  });
});
