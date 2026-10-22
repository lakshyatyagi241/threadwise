import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthKeys } from '../../../src/modules/auth/support/redis-keys';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  seedAnotherWorkspace,
  startHarness,
  type Harness,
} from './harness';
import { BRIDGE_SENDER, BRIDGE_TOKEN } from './stubs';
import { pngOfSize } from '../../support/images';

/**
 * The auth domain end to end through HTTP: sign-up, verification, login,
 * lockout, sessions, MFA, recovery, gates, social, captcha, OTP, account
 * screens, workspace switch and the operator Security Center. One app, one
 * database; every scenario creates its own organization so they do not
 * interfere, and policy changes are put back.
 */
let h: Harness;
const api = () => request(h.app.getHttpServer());
const PASSWORD = 'Str0ngPassw0rd#1';
let ipCounter = 10;
const nextIp = () => `10.9.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`;
let emailCounter = 0;
const uniqueEmail = (tag = 'user') => `${tag}${Date.now()}${emailCounter++}@example.test`;

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const totp = (secret: string) => hotp(base32Decode(secret), totpStep(Date.now()));

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

/** A second workspace for an email that already has one; public sign-up refuses that (one identity, one account). */
async function anotherWorkspace(email: string, orgName: string): Promise<Account> {
  const r = await seedAnotherWorkspace(h, { email, orgName, password: PASSWORD });
  return {
    email,
    slug: r.orgSlug,
    access: r.tokens.accessToken,
    refresh: r.tokens.refreshToken,
    ip: nextIp(),
  };
}

const login = (
  a: Pick<Account, 'email' | 'slug' | 'ip'>,
  password = PASSWORD,
  extra: Record<string, unknown> = {},
) =>
  api()
    .post('/v2/auth/login')
    .set('x-forwarded-for', a.ip)
    .send({ orgSlug: a.slug, email: a.email, password, ...extra });

function mailTo(email: string, subject: string) {
  const m = [...h.mail]
    .reverse()
    .find((x) => x.to === email && x.subject.toLowerCase().includes(subject));
  if (!m)
    throw new Error(
      `no "${subject}" mail for ${email}; have: ${h.mail
        .filter((x) => x.to === email)
        .map((x) => x.subject)
        .join(' | ')}`,
    );
  return m;
}
const linkParams = (text: string, pathPart: string) =>
  new URL(text.match(new RegExp(`https?://\\S*${pathPart}\\?\\S+`))![0]).searchParams;

async function verifyEmail(a: Account) {
  // One address can belong to several organizations: pick the mail for THIS workspace.
  const mail = [...h.mail]
    .reverse()
    .find(
      (m) =>
        m.to === a.email &&
        m.subject.toLowerCase().includes('verify') &&
        m.text.includes(`org=${a.slug}`),
    );
  if (!mail) throw new Error(`no verification mail for ${a.email} in ${a.slug}`);
  const p = linkParams(mail.text, 'verify-email');
  const res = await api()
    .post('/v2/auth/verify-email')
    .send({ orgSlug: p.get('org'), token: p.get('token') });
  expect(res.status).toBe(201);
}

// --- operator --------------------------------------------------------------------------------------------------

let opAccess = '';
let opSecret = '';
let opRecovery: string[] = [];

async function operatorLoginWithRecovery(): Promise<string> {
  const first = await api()
    .post('/v2/platform/auth/login')
    .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  expect(first.body.status).toBe('mfa_required');
  const code = opRecovery.shift()!;
  const done = await api()
    .post('/v2/platform/auth/login/mfa')
    .send({ challengeToken: first.body.challengeToken, recoveryCode: code });
  expect(done.status, JSON.stringify(done.body)).toBe(201);
  return done.body.tokens.accessToken as string;
}

const op = (method: 'get' | 'patch' | 'post', path: string) =>
  api()[method](`/v2/platform${path}`).set(bearer(opAccess));

async function setPolicy(patch: Record<string, unknown>) {
  const res = await op('patch', '/security/policy').send(patch);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  await h.redis.eval(
    `for _,k in ipairs(redis.call('keys','auth:gate:*')) do redis.call('del',k) end`,
    0,
  );
  return res.body;
}

beforeAll(async () => {
  h = await startHarness();

  // Super admin must enrol MFA at first sign-in; keep the secret and recovery codes for later logins.
  const first = await api()
    .post('/v2/platform/auth/login')
    .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  expect(first.body).toMatchObject({ status: 'authenticated', mfaEnrolmentRequired: true });
  const token = first.body.tokens.accessToken as string;
  const blocked = await api().get('/v2/platform/security').set(bearer(token));
  expect(blocked.status).toBe(403);
  expect(blocked.body.code).toBe('AUTH_MFA_ENROLMENT_REQUIRED');
  const setup = await api().post('/v2/platform/auth/mfa/setup').set(bearer(token));
  opSecret = setup.body.secret;
  const enabled = await api()
    .post('/v2/platform/auth/mfa/enable')
    .set(bearer(token))
    .send({ code: totp(opSecret) });
  expect(enabled.status).toBe(201);
  opRecovery = enabled.body.recoveryCodes;
  opAccess = token;
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

describe('registration', () => {
  it('publishes the guest-page configuration without authentication', async () => {
    const res = await api().get('/v2/auth/registration-config');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      registrationOpen: true,
      emailVerification: 'off',
      captcha: null,
      social: { google: false, facebook: false },
      otp: { enabled: false },
      rememberMeEnabled: true,
    });
    expect(res.body.authPages.login.heading).toBeTruthy();
    // Untouched copy is flagged so a localised client can substitute its own.
    expect(res.body.authPages.defaulted.login).toEqual(
      expect.arrayContaining(['heading', 'subheading']),
    );
  });

  it('creates verified accounts in the default mode, as Reference auto-verifies', async () => {
    const a = await signup();
    const session = await api().get('/v2/auth/session').set(bearer(a.access));
    expect(session.body.flags).toMatchObject({ emailUnverified: false, emailBlocked: false });
    // The flows below exercise the verification mail, so the rest of the suite runs in banner mode.
    const switched = await op('patch', '/settings/registration').send({
      emailVerification: 'banner',
    });
    expect(switched.status).toBeLessThan(300);
  });

  it('creates an organization with its first user and lands them in onboarding', async () => {
    const a = await signup();
    const session = await api().get('/v2/auth/session').set(bearer(a.access));
    expect(session.body.landing).toBe('onboarding');
    expect(session.body.org.onboardingStep).toBe('workspace');
    expect(session.body.roles.map((r: { name: string }) => r.name)).toEqual(['Owner']);
    expect(Object.keys(session.body.permissions)).toContain('admin.user.manage');
    expect(session.body.flags).toMatchObject({
      emailUnverified: true,
      emailBlocked: false,
      suspended: false,
    });
    expect(session.body.user.email).toBe(a.email);
  });

  it('refuses weak passwords, naming every broken rule', async () => {
    const res = await api().post('/v2/auth/signup').set('x-forwarded-for', nextIp()).send({
      orgName: 'Weak Co',
      fullName: 'W',
      email: uniqueEmail(),
      password: 'password',
      acceptTerms: true,
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('AUTH_PASSWORD_POLICY');
    expect(res.body.errors.length).toBeGreaterThanOrEqual(2);
    // Each broken rule is addressable: `<field>.<rule>`.
    expect(res.body.errors.map((e: { path: string }) => e.path)).toEqual(
      expect.arrayContaining(['password.upper_lower', 'password.number']),
    );
  });

  it('requires the terms, a valid email and rejects a taken workspace address', async () => {
    const base = { orgName: 'X Co', fullName: 'X', password: PASSWORD };
    const noTerms = await api()
      .post('/v2/auth/signup')
      .set('x-forwarded-for', nextIp())
      .send({ ...base, email: uniqueEmail(), acceptTerms: false });
    expect(noTerms.status).toBe(422);
    const a = await signup();
    const taken = await api()
      .post('/v2/auth/signup')
      .set('x-forwarded-for', nextIp())
      .send({ ...base, email: uniqueEmail(), acceptTerms: true, orgSlug: a.slug });
    expect(taken.status).toBe(409);
    expect(taken.body.code).toBe('AUTH_SLUG_TAKEN');
  });

  it('can be closed by an operator', async () => {
    await op('patch', '/settings/registration').send({ publicRegistration: false });
    try {
      const res = await api().post('/v2/auth/signup').set('x-forwarded-for', nextIp()).send({
        orgName: 'Closed Co',
        fullName: 'C',
        email: uniqueEmail(),
        password: PASSWORD,
        acceptTerms: true,
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('AUTH_SIGNUP_CLOSED');
      const cfg = await api().get('/v2/auth/registration-config');
      expect(cfg.body.registrationOpen).toBe(false);
    } finally {
      await op('patch', '/settings/registration').send({ publicRegistration: true });
    }
  });

  it('verifies the email once and never signs anyone in', async () => {
    const a = await signup();
    const p = linkParams(mailTo(a.email, 'verify').text, 'verify-email');
    const first = await api()
      .post('/v2/auth/verify-email')
      .send({ orgSlug: p.get('org'), token: p.get('token') });
    expect(first.status).toBe(201);
    expect(first.body).toEqual({ ok: true });
    expect(JSON.stringify(first.body)).not.toMatch(/token/i);
    const again = await api()
      .post('/v2/auth/verify-email')
      .send({ orgSlug: p.get('org'), token: p.get('token') });
    expect(again.status).toBe(400);
    expect(again.body.code).toBe('AUTH_TOKEN_INVALID');
    const session = await api().get('/v2/auth/session').set(bearer(a.access));
    expect(session.body.flags.emailUnverified).toBe(false);
  });

  it('throttles the verification resend', async () => {
    const a = await signup();
    const one = await api().post('/v2/auth/verify-email/resend').set(bearer(a.access));
    expect(one.status).toBe(201);
    const two = await api().post('/v2/auth/verify-email/resend').set(bearer(a.access));
    expect(two.status).toBe(429);
    await verifyEmail(a);
    const third = await api().post('/v2/auth/verify-email/resend').set(bearer(a.access));
    expect(third.body).toMatchObject({ sent: false, alreadyVerified: true });
  });

  it('holds the account until the code is confirmed when registration OTP is on', async () => {
    // The code travels through the real sender to the bridge stub; the harness reads it back from there.
    const bridge = await op('post', '/settings/senders').send({
      kind: 'device',
      label: 'Flow test bridge',
      bridgeUrl: h.stubs.bridge.url,
      senderNumber: BRIDGE_SENDER,
      secret: BRIDGE_TOKEN,
    });
    expect(bridge.status, JSON.stringify(bridge.body)).toBe(201);
    await op('patch', '/settings/registration').send({
      otp: {
        enabled: true,
        sender: `device:${bridge.body.id}`,
        ttlMinutes: 5,
        length: 6,
        resendCooldownSec: 15,
        maxAttempts: 3,
      },
    });
    try {
      const email = uniqueEmail('otp');
      const ip = nextIp();
      const body = {
        orgName: 'Otp Co',
        fullName: 'Otp',
        email,
        password: PASSWORD,
        acceptTerms: true,
        phone: '+919876543221',
      };

      const noPhone = await api()
        .post('/v2/auth/signup')
        .set('x-forwarded-for', ip)
        .send({ ...body, phone: undefined });
      expect(noPhone.status).toBe(422);

      const staged = await api().post('/v2/auth/signup').set('x-forwarded-for', ip).send(body);
      expect(staged.status).toBe(201);
      expect(staged.body).toMatchObject({
        status: 'otp_required',
        maskedPhone: '+91 •••• ••21',
        codeLength: 6,
      });
      const exists = await h.owner.query(`SELECT 1 FROM users WHERE email = $1`, [email]);
      expect(exists.rowCount).toBe(0);

      const code = h.otps.at(-1)!.code;
      const wrong = await api()
        .post('/v2/auth/signup/verify-otp')
        .send({
          challengeId: staged.body.challengeId,
          code: code === '000000' ? '111111' : '000000',
        });
      expect(wrong.status).toBe(400);
      expect(wrong.body.code).toBe('AUTH_OTP_INVALID');

      const tooSoon = await api()
        .post('/v2/auth/signup/resend-otp')
        .send({ challengeId: staged.body.challengeId });
      expect(tooSoon.status).toBe(429);
      expect(tooSoon.body.code).toBe('AUTH_OTP_RESEND_COOLDOWN');
      expect(Number(tooSoon.body.errors[0].message)).toBeGreaterThan(0);

      const gone = await api()
        .post('/v2/auth/signup/verify-otp')
        .send({ challengeId: '00000000-0000-4000-8000-000000000000', code });
      expect(gone.status).toBe(400);
      expect(gone.body.code).toBe('AUTH_SIGNUP_EXPIRED');

      const ok = await api()
        .post('/v2/auth/signup/verify-otp')
        .send({ challengeId: staged.body.challengeId, code });
      expect(ok.status).toBe(201);
      expect(ok.body.status).toBe('authenticated');
      expect(ok.body.orgSlug).toBeTruthy();
      const created = await h.owner.query(
        `SELECT p.phone_verified_at FROM users u JOIN user_profiles p ON p.org_id = u.org_id AND p.user_id = u.id WHERE u.email = $1`,
        [email],
      );
      expect(created.rows[0].phone_verified_at).not.toBeNull();
    } finally {
      await op('patch', '/settings/registration').send({ otp: { enabled: false } });
      await api().delete(`/v2/platform/settings/senders/${bridge.body.id}`).set(bearer(opAccess));
    }
  });
});

describe('one identity, one account on the one-step and phone-code paths', () => {
  const countUsers = async (email: string) =>
    (await h.owner.query(`SELECT count(*)::int AS c FROM users WHERE email = $1`, [email])).rows[0]
      .c as number;
  const countOrgs = async () =>
    (await h.owner.query(`SELECT count(*)::int AS c FROM organizations`)).rows[0].c as number;

  it('the one-step sign-up refuses an email that already has an account, creating nothing', async () => {
    const existing = await signup();
    const orgsBefore = await countOrgs();
    const res = await api().post('/v2/auth/signup').set('x-forwarded-for', nextIp()).send({
      orgName: 'Second Try Co',
      fullName: 'Second Try',
      email: existing.email,
      password: PASSWORD,
      acceptTerms: true,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe('AUTH_IDENTITY_EXISTS');
    expect(res.body.errors).toEqual([
      {
        path: 'email',
        message:
          'An account with this email already exists. Sign in, or ask a workspace admin to invite you.',
      },
    ]);
    expect(await countUsers(existing.email)).toBe(1);
    expect(await countOrgs()).toBe(orgsBefore);
  });

  it('the one-step sign-up refuses a mobile number that already has an account', async () => {
    const phone = '+919876500201';
    await signup({ phone });
    const orgsBefore = await countOrgs();
    const res = await api()
      .post('/v2/auth/signup')
      .set('x-forwarded-for', nextIp())
      .send({
        orgName: 'Same Phone Co',
        fullName: 'Same Phone',
        email: uniqueEmail('samephone'),
        password: PASSWORD,
        acceptTerms: true,
        phone,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe('AUTH_IDENTITY_EXISTS');
    expect(await countOrgs()).toBe(orgsBefore);
  });

  it('a sign-up staged behind the phone code is refused when the same email finished first', async () => {
    // Two sign-ups for one email both pass the first identity check (nothing exists yet) and both
    // wait behind the phone code, for up to 7 days. Whichever confirms second must not get an account.
    const bridge = await op('post', '/settings/senders').send({
      kind: 'device',
      label: 'Identity race bridge',
      bridgeUrl: h.stubs.bridge.url,
      senderNumber: BRIDGE_SENDER,
      secret: BRIDGE_TOKEN,
    });
    expect(bridge.status, JSON.stringify(bridge.body)).toBe(201);
    await op('patch', '/settings/registration').send({
      otp: {
        enabled: true,
        sender: `device:${bridge.body.id}`,
        ttlMinutes: 5,
        length: 6,
        resendCooldownSec: 15,
        maxAttempts: 3,
      },
    });
    try {
      const email = uniqueEmail('otp-race');

      // A: the three-step flow (start -> email code -> password), staged behind the phone code.
      const ipA = nextIp();
      const started = await api()
        .post('/v2/auth/signup/start')
        .set('x-forwarded-for', ipA)
        .send({ fullName: 'Race A', email, phone: '+919876500301' });
      expect(started.status, JSON.stringify(started.body)).toBe(201);
      const emailCode = h.mail
        .filter((m) => m.to === email)
        .at(-1)!
        .text.match(/\b(\d{6})\b/)![1]!;
      const verified = await api()
        .post('/v2/auth/signup/verify-email-code')
        .set('x-forwarded-for', ipA)
        .send({ token: started.body.token, code: emailCode });
      expect(verified.status, JSON.stringify(verified.body)).toBe(200);
      const stagedA = await api()
        .post('/v2/auth/signup/set-password')
        .set('x-forwarded-for', ipA)
        .send({ token: started.body.token, password: PASSWORD, acceptTerms: true });
      expect(stagedA.status, JSON.stringify(stagedA.body)).toBe(201);
      expect(stagedA.body.status).toBe('otp_required');
      const codeA = h.otps.at(-1)!.code;

      // B: the one-step sign-up for the same email, also staged (A has no account yet).
      const stagedB = await api().post('/v2/auth/signup').set('x-forwarded-for', nextIp()).send({
        orgName: 'Race B Co',
        fullName: 'Race B',
        email,
        password: PASSWORD,
        acceptTerms: true,
        phone: '+919876500302',
      });
      expect(stagedB.status, JSON.stringify(stagedB.body)).toBe(201);
      expect(stagedB.body.status).toBe('otp_required');
      const codeB = h.otps.at(-1)!.code;
      expect(await countUsers(email)).toBe(0);

      const doneA = await api()
        .post('/v2/auth/signup/verify-otp')
        .send({ challengeId: stagedA.body.challengeId, code: codeA });
      expect(doneA.status, JSON.stringify(doneA.body)).toBe(201);
      expect(doneA.body.status).toBe('authenticated');

      const orgsBefore = await countOrgs();
      const doneB = await api()
        .post('/v2/auth/signup/verify-otp')
        .send({ challengeId: stagedB.body.challengeId, code: codeB });
      expect(doneB.status, JSON.stringify(doneB.body)).toBe(409);
      expect(doneB.body.code).toBe('AUTH_IDENTITY_EXISTS');
      expect(await countUsers(email)).toBe(1);
      expect(await countOrgs()).toBe(orgsBefore);
      // Refused for the identity, not for the stage itself: B's stage is not consumed.
      expect(await h.redis.exists(AuthKeys.signup(stagedB.body.challengeId))).toBe(1);
    } finally {
      await op('patch', '/settings/registration').send({ otp: { enabled: false } });
      await api().delete(`/v2/platform/settings/senders/${bridge.body.id}`).set(bearer(opAccess));
    }
  });
});

describe('sign-in, lockout and sessions', () => {
  it('answers every credential failure identically', async () => {
    const a = await signup();
    const wrong = await login(a, 'Wr0ng!Password');
    const unknownUser = await login({ ...a, email: 'nobody@example.test' });
    const unknownOrg = await login({ ...a, slug: 'does-not-exist' });
    for (const r of [wrong, unknownUser, unknownOrg]) {
      expect(r.status).toBe(401);
      expect(r.body.code).toBe('AUTH_INVALID_CREDENTIALS');
      expect(r.body.detail).toBe(wrong.body.detail);
    }
  });

  it('locks an account/IP pair after five failures, even for the right password, and not other addresses', async () => {
    const a = await signup();
    for (let i = 0; i < 5; i++) expect((await login(a, `bad-${i}`)).status).toBe(401);
    const locked = await login(a, PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.body.code).toBe('AUTH_ACCOUNT_LOCKED');
    expect(Number(locked.body.errors[0].message)).toBeGreaterThan(0);
    const elsewhere = await login({ ...a, ip: nextIp() }, PASSWORD);
    expect(elsewhere.status).toBe(201);
    const logged = await h.owner.query(
      `SELECT count(*)::int AS n FROM security_events WHERE event = 'auth.lockout'`,
    );
    expect(logged.rows[0].n).toBeGreaterThan(0);
  });

  it('rotates refresh tokens, tolerates a racing tab, and kills the session when an old token is replayed', async () => {
    const a = await signup();
    const r1 = await api().post('/v2/auth/refresh').send({ refreshToken: a.refresh });
    expect(r1.status).toBe(201);
    expect(r1.body.refreshToken).not.toBe(a.refresh);
    expect(typeof r1.body.expiresIn).toBe('number');

    // The original token again, immediately: a second tab. Answered, not punished.
    const racing = await api().post('/v2/auth/refresh').send({ refreshToken: a.refresh });
    expect(racing.status).toBe(201);

    const r2 = await api().post('/v2/auth/refresh').send({ refreshToken: r1.body.refreshToken });
    expect(r2.status).toBe(201);

    // Now r1's token is two rotations old: that is a replay.
    await h.owner.query(`UPDATE auth_sessions SET rotated_at = now() - interval '5 minutes'`);
    const replay = await api().post('/v2/auth/refresh').send({ refreshToken: a.refresh });
    expect(replay.status).toBe(401);
    // ...and it took the live session down with it.
    const after = await api().post('/v2/auth/refresh').send({ refreshToken: r2.body.refreshToken });
    expect(after.status).toBe(401);
    const dead = await api().get('/v2/auth/session').set(bearer(r2.body.accessToken));
    expect(dead.status).toBe(401);
  });

  it('ends the session on logout: the still-valid access token stops working at once', async () => {
    const a = await signup();
    expect((await api().get('/v2/users/me').set(bearer(a.access))).status).toBe(200);
    expect((await api().post('/v2/auth/logout').set(bearer(a.access)).send({})).status).toBe(201);
    expect((await api().get('/v2/users/me').set(bearer(a.access))).status).toBe(401);
    expect((await api().post('/v2/auth/refresh').send({ refreshToken: a.refresh })).status).toBe(
      401,
    );
  });

  it('gives remembered sessions the long lifetime and others seven days', async () => {
    const a = await signup();
    await login(a, PASSWORD, { remember: true });
    const rows = await h.owner.query(
      `SELECT remember, extract(epoch FROM (s.expires_at - s.created_at)) AS secs FROM auth_sessions s JOIN users u ON u.org_id = s.org_id AND u.id = s.user_id WHERE u.email = $1 ORDER BY s.id`,
      [a.email],
    );
    const [plain, remembered] = rows.rows;
    expect(plain.remember).toBe(false);
    // Reference's session lifetime is 7 days; "keep me signed in" extends it to 30.
    expect(Number(plain.secs)).toBeLessThanOrEqual(7 * 86400 + 5);
    expect(Number(plain.secs)).toBeGreaterThan(6 * 86400);
    expect(remembered.remember).toBe(true);
    expect(Number(remembered.secs)).toBeGreaterThan(20 * 86400);
  });

  it("lists devices, ends one, ends all others, and never reveals another user's session", async () => {
    const a = await signup();
    const second = await login({ ...a, ip: nextIp() }, PASSWORD);
    const third = await login({ ...a, ip: nextIp() }, PASSWORD);
    const list = await api().get('/v2/account/sessions').set(bearer(a.access));
    expect(list.body.data).toHaveLength(3);
    expect(list.body.data.filter((s: { current: boolean }) => s.current)).toHaveLength(1);

    const current = list.body.data.find((s: { current: boolean }) => s.current).id;
    const cannot = await api().delete(`/v2/account/sessions/${current}`).set(bearer(a.access));
    expect(cannot.status).toBe(422);
    expect(cannot.body.code).toBe('AUTH_CANNOT_REVOKE_CURRENT');

    const other = list.body.data.find((s: { current: boolean }) => !s.current).id;
    expect((await api().delete(`/v2/account/sessions/${other}`).set(bearer(a.access))).status).toBe(
      200,
    );

    const stranger = await signup();
    const strangerSessions = await api().get('/v2/account/sessions').set(bearer(stranger.access));
    const foreign = await api()
      .delete(`/v2/account/sessions/${strangerSessions.body.data[0].id}`)
      .set(bearer(a.access));
    expect(foreign.status).toBe(404);

    const others = await api().post('/v2/account/sessions/revoke-others').set(bearer(a.access));
    expect(others.body.revoked).toBeGreaterThanOrEqual(1);
    const stillMine = await api().get('/v2/users/me').set(bearer(a.access));
    expect(stillMine.status).toBe(200);
    void second;
    void third;
  });

  it('caps concurrent sessions by retiring the oldest', async () => {
    await setPolicy({ maxConcurrentSessions: 2 });
    try {
      const a = await signup();
      const b = await login({ ...a, ip: nextIp() }, PASSWORD);
      const c = await login({ ...a, ip: nextIp() }, PASSWORD);
      expect(c.status, JSON.stringify(c.body)).toBe(201);
      expect((await api().get('/v2/users/me').set(bearer(a.access))).status).toBe(401);
      expect((await api().get('/v2/users/me').set(bearer(b.body.tokens.accessToken))).status).toBe(
        200,
      );
      expect((await api().get('/v2/users/me').set(bearer(c.body.tokens.accessToken))).status).toBe(
        200,
      );
    } finally {
      await setPolicy({ maxConcurrentSessions: 5 });
    }
  });

  it('times out idle sessions that were not remembered, but not remembered ones', async () => {
    await setPolicy({ sessionTimeoutMinutes: 5 });
    try {
      const a = await signup();
      const remembered = await login({ ...a, ip: nextIp() }, PASSWORD, { remember: true });
      const sessions = await api().get('/v2/account/sessions').set(bearer(a.access));
      const own = sessions.body.data.find((s: { current: boolean }) => s.current).id;
      const rememberedSid = sessions.body.data.find((s: { remember: boolean }) => s.remember).id;
      const old = String(Date.now() - 10 * 60_000);
      await h.redis.set(`auth:act:${own}`, old);
      await h.redis.set(`auth:act:${rememberedSid}`, old);
      expect((await api().get('/v2/users/me').set(bearer(a.access))).status).toBe(401);
      expect(
        (await api().get('/v2/users/me').set(bearer(remembered.body.tokens.accessToken))).status,
      ).toBe(200);
    } finally {
      await setPolicy({ sessionTimeoutMinutes: 60 });
    }
  });
});

describe('sign-in policy knobs', () => {
  const CHROME_WIN =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const SAFARI_IPHONE =
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

  it('emails a new-device / new-location alert once, and respects the switches', async () => {
    const email = uniqueEmail('alert');
    const first = await api()
      .post('/v2/auth/signup')
      .set('x-forwarded-for', '203.0.113.10')
      .set('user-agent', CHROME_WIN)
      .send({ orgName: 'Alert Co', fullName: 'Al', email, password: PASSWORD, acceptTerms: true });
    const slug = (await api().get('/v2/auth/session').set(bearer(first.body.tokens.accessToken)))
      .body.org.slug;
    const before = h.mail.length;

    // Same browser, same network: no alert (and the first-ever sign-in has nothing to compare with).
    await api()
      .post('/v2/auth/login')
      .set('x-forwarded-for', '203.0.113.10')
      .set('user-agent', CHROME_WIN)
      .send({ orgSlug: slug, email, password: PASSWORD });
    await new Promise((r) => setTimeout(r, 500));
    expect(
      h.mail.slice(before).filter((m) => m.subject.toLowerCase().includes('new sign-in')),
    ).toHaveLength(0);

    // A different browser family and OS from a different network.
    await api()
      .post('/v2/auth/login')
      .set('x-forwarded-for', '198.51.100.20')
      .set('user-agent', SAFARI_IPHONE)
      .send({ orgSlug: slug, email, password: PASSWORD });
    await new Promise((r) => setTimeout(r, 600));
    const alerts = h.mail
      .slice(before)
      .filter((m) => m.to === email && m.subject.toLowerCase().includes('new sign-in'));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.text).toMatch(/new device/);
    expect(alerts[0]!.text).toMatch(/different location/);
    expect(alerts[0]!.text).toContain('198.51.100.20');

    // The same sign-in again within ten minutes does not mail twice.
    await api()
      .post('/v2/auth/login')
      .set('x-forwarded-for', '198.51.100.20')
      .set('user-agent', SAFARI_IPHONE)
      .send({ orgSlug: slug, email, password: PASSWORD });
    await new Promise((r) => setTimeout(r, 500));
    expect(
      h.mail
        .slice(before)
        .filter((m) => m.to === email && m.subject.toLowerCase().includes('new sign-in')),
    ).toHaveLength(1);

    await setPolicy({ alertOnNewDevice: false, alertOnNewCountry: false });
    try {
      const mark = h.mail.length;
      await api()
        .post('/v2/auth/login')
        .set('x-forwarded-for', '192.0.2.77')
        .set('user-agent', 'Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0')
        .send({ orgSlug: slug, email, password: PASSWORD });
      await new Promise((r) => setTimeout(r, 500));
      expect(
        h.mail.slice(mark).filter((m) => m.subject.toLowerCase().includes('new sign-in')),
      ).toHaveLength(0);
    } finally {
      await setPolicy({ alertOnNewDevice: true, alertOnNewCountry: true });
    }
  });

  it('can switch "keep me signed in" off platform-wide', async () => {
    await setPolicy({ rememberMeEnabled: false });
    try {
      const a = await signup();
      await login(a, PASSWORD, { remember: true });
      const rows = await h.owner.query(
        `SELECT remember FROM auth_sessions s JOIN users u ON u.org_id = s.org_id AND u.id = s.user_id WHERE u.email = $1`,
        [a.email],
      );
      expect(rows.rows.every((r: { remember: boolean }) => r.remember === false)).toBe(true);
    } finally {
      await setPolicy({ rememberMeEnabled: true });
    }
  });

  it('forces a new password once the current one is older than the maximum age', async () => {
    const a = await signup();
    await h.owner.query(
      `UPDATE user_security SET password_changed_at = now() - interval '10 days' WHERE (org_id, user_id) IN (SELECT org_id, id FROM users WHERE email = $1)`,
      [a.email],
    );
    expect((await login({ ...a, ip: nextIp() }, PASSWORD)).body.flags.passwordChangeRequired).toBe(
      false,
    );
    await setPolicy({ passwordMaxAgeDays: 5 });
    try {
      const blocked = await api().get('/v2/users/me').set(bearer(a.access));
      expect(blocked.body.code).toBe('AUTH_PASSWORD_CHANGE_REQUIRED');
      expect(
        (await login({ ...a, ip: nextIp() }, PASSWORD)).body.flags.passwordChangeRequired,
      ).toBe(true);
    } finally {
      await setPolicy({ passwordMaxAgeDays: 0 });
    }
  });
});

describe('password recovery and change', () => {
  it('answers forgot-password the same for known and unknown addresses, and mails only the known one', async () => {
    const a = await signup();
    const before = h.mail.length;
    const known = await api()
      .post('/v2/auth/forgot-password')
      .send({ orgSlug: a.slug, email: a.email });
    const unknown = await api()
      .post('/v2/auth/forgot-password')
      .send({ orgSlug: a.slug, email: 'ghost@example.test' });
    expect(known.status).toBe(201);
    expect(unknown.body).toEqual(known.body);
    await new Promise((r) => setTimeout(r, 400));
    expect(
      h.mail.slice(before).filter((m) => m.subject.toLowerCase().includes('reset')),
    ).toHaveLength(1);
    expect(mailTo(a.email, 'reset').to).toBe(a.email);
  });

  it('resets once, enforces the policy without burning the token, signs every device out and confirms by mail', async () => {
    const a = await signup();
    await api().post('/v2/auth/forgot-password').send({ orgSlug: a.slug, email: a.email });
    await new Promise((r) => setTimeout(r, 300));
    const p = linkParams(mailTo(a.email, 'reset').text, 'reset-password');
    const body = { orgSlug: p.get('org'), token: p.get('token') };

    const weak = await api()
      .post('/v2/auth/reset-password')
      .send({ ...body, password: 'password1' });
    expect(weak.body.code).toBe('AUTH_PASSWORD_POLICY');

    const NEW = 'Brand#New9Secret';
    expect(
      (
        await api()
          .post('/v2/auth/reset-password')
          .send({ ...body, password: NEW })
      ).status,
    ).toBe(201);
    expect(
      (
        await api()
          .post('/v2/auth/reset-password')
          .send({ ...body, password: 'An0ther#Strong1' })
      ).body.code,
    ).toBe('AUTH_TOKEN_INVALID');
    expect((await api().get('/v2/users/me').set(bearer(a.access))).status).toBe(401);
    expect((await login(a, PASSWORD)).status).toBe(401);
    expect((await login(a, NEW)).status).toBe(201);
    expect(mailTo(a.email, 'password was changed')).toBeTruthy();
    // Proving the inbox also proves the address.
    const again = await login(a, NEW);
    const s = await api().get('/v2/auth/session').set(bearer(again.body.tokens.accessToken));
    expect(s.body.flags.emailUnverified).toBe(false);
  });

  it('changes a password with the current one, keeps this device, drops the others, rejects reuse', async () => {
    const a = await signup();
    const other = await login({ ...a, ip: nextIp() }, PASSWORD);
    const wrong = await api()
      .post('/v2/account/password')
      .set(bearer(a.access))
      .send({ currentPassword: 'nope', newPassword: 'Another#Strong1' });
    expect(wrong.body.code).toBe('AUTH_CURRENT_PASSWORD_WRONG');
    const weak = await api()
      .post('/v2/account/password')
      .set(bearer(a.access))
      .send({ currentPassword: PASSWORD, newPassword: 'weakweak' });
    expect(weak.body.code).toBe('AUTH_PASSWORD_POLICY');
    expect(weak.body.errors[0].path).toMatch(/^newPassword\./);
    const same = await api()
      .post('/v2/account/password')
      .set(bearer(a.access))
      .send({ currentPassword: PASSWORD, newPassword: PASSWORD });
    expect(same.status).toBe(422);

    const ok = await api()
      .post('/v2/account/password')
      .set(bearer(a.access))
      .send({ currentPassword: PASSWORD, newPassword: 'Another#Strong1' });
    expect(ok.status).toBe(201);
    expect(ok.body.revokedOtherSessions).toBe(1);
    expect((await api().get('/v2/users/me').set(bearer(a.access))).status).toBe(200);
    expect(
      (await api().get('/v2/users/me').set(bearer(other.body.tokens.accessToken))).status,
    ).toBe(401);
  });

  it('changes the sign-in email only after the new address confirms it', async () => {
    const a = await signup();
    const to = uniqueEmail('new');
    const wrong = await api()
      .post('/v2/account/email-change')
      .set(bearer(a.access))
      .send({ newEmail: to, password: 'nope' });
    expect(wrong.status).toBe(422);
    expect(
      (
        await api()
          .post('/v2/account/email-change')
          .set(bearer(a.access))
          .send({ newEmail: to, password: PASSWORD })
      ).status,
    ).toBe(201);
    expect((await api().get('/v2/account/profile').set(bearer(a.access))).body.pendingEmail).toBe(
      to,
    );
    expect((await login(a, PASSWORD)).status).toBe(201);

    const p = linkParams(mailTo(to, 'confirm your new email').text, 'confirm-email-change');
    expect(
      (
        await api()
          .post('/v2/account/email-change/confirm')
          .send({ orgSlug: p.get('org'), token: p.get('token') })
      ).status,
    ).toBe(201);
    expect((await login({ ...a, email: to }, PASSWORD)).status).toBe(201);
    expect((await login(a, PASSWORD)).status).toBe(401);
    expect(mailTo(a.email, 'sign-in email was changed').text).toContain(to);
  });

  it('finds workspaces by email without confirming whether the address exists', async () => {
    const a = await signup();
    await verifyEmail(a);
    const known = await api().post('/v2/auth/find-workspaces').send({ email: a.email });
    const unknown = await api()
      .post('/v2/auth/find-workspaces')
      .send({ email: 'nobody-here@example.test' });
    expect(unknown.body).toEqual(known.body);
    await new Promise((r) => setTimeout(r, 400));
    expect(mailTo(a.email, 'workspaces').text).toContain(a.slug);
    expect(h.mail.some((m) => m.to === 'nobody-here@example.test')).toBe(false);
  });
});

describe('two-factor authentication', () => {
  async function enrol(a: Account) {
    const setup = await api().post('/v2/account/mfa/setup').set(bearer(a.access));
    expect(setup.status).toBe(201);
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);
    const again = await api().post('/v2/account/mfa/setup').set(bearer(a.access));
    expect(again.body.secret).toBe(setup.body.secret);
    const enabled = await api()
      .post('/v2/account/mfa/enable')
      .set(bearer(a.access))
      .send({ code: totp(setup.body.secret) });
    expect(enabled.status, JSON.stringify(enabled.body)).toBe(201);
    expect(enabled.body.recoveryCodes).toHaveLength(10);
    return {
      secret: setup.body.secret as string,
      recovery: enabled.body.recoveryCodes as string[],
      code: totp(setup.body.secret),
    };
  }

  it('turns sign-in into a two-step challenge with single-use recovery codes and no replay', async () => {
    const a = await signup();
    const { secret, recovery, code } = await enrol(a);
    const stored = await h.owner.query(
      `SELECT mfa_secret_enc FROM user_security s JOIN users u ON u.org_id = s.org_id AND u.id = s.user_id WHERE u.email = $1`,
      [a.email],
    );
    expect(stored.rows[0].mfa_secret_enc).not.toContain(secret);

    const step1 = await login({ ...a, ip: nextIp() }, PASSWORD);
    expect(step1.body.status).toBe('mfa_required');
    expect(step1.body.tokens).toBeUndefined();

    const bad = await api()
      .post('/v2/auth/login/mfa')
      .send({ challengeToken: step1.body.challengeToken, code: '000000' });
    expect(bad.status).toBe(401);
    expect(bad.body.code).toBe('AUTH_MFA_INVALID_CODE');

    // The code that enrolled the device is already spent for this time step.
    const replay = await api()
      .post('/v2/auth/login/mfa')
      .send({ challengeToken: step1.body.challengeToken, code });
    expect(replay.status).toBe(401);

    const viaRecovery = await api()
      .post('/v2/auth/login/mfa')
      .send({ challengeToken: step1.body.challengeToken, recoveryCode: recovery[0] });
    expect(viaRecovery.status).toBe(201);
    expect(viaRecovery.body.status).toBe('authenticated');

    const step2 = await login({ ...a, ip: nextIp() }, PASSWORD);
    const reused = await api()
      .post('/v2/auth/login/mfa')
      .send({ challengeToken: step2.body.challengeToken, recoveryCode: recovery[0] });
    expect(reused.status).toBe(401);
    // A consumed challenge cannot be reused either.
    const dead = await api()
      .post('/v2/auth/login/mfa')
      .send({ challengeToken: step1.body.challengeToken, recoveryCode: recovery[1] });
    expect(dead.body.code).toBe('AUTH_MFA_CHALLENGE_EXPIRED');
    expect(
      (await api().get('/v2/account/mfa').set(bearer(a.access))).body.recoveryCodesRemaining,
    ).toBe(9);
  });

  it('abandons a challenge after five wrong codes', async () => {
    const a = await signup();
    await enrol(a);
    const step = await login({ ...a, ip: nextIp() }, PASSWORD);
    for (let i = 0; i < 5; i++) {
      expect(
        (
          await api()
            .post('/v2/auth/login/mfa')
            .send({ challengeToken: step.body.challengeToken, code: '123456' })
        ).status,
      ).toBe(401);
    }
    const sixth = await api()
      .post('/v2/auth/login/mfa')
      .send({ challengeToken: step.body.challengeToken, recoveryCode: 'AAAAA-BBBBB' });
    expect(sixth.body.code).toBe('AUTH_MFA_CHALLENGE_EXPIRED');
  });

  it('turns off only with the password AND a current code, and regenerates codes only with the password', async () => {
    const a = await signup();
    const factor = await enrol(a);
    const noPw = await api()
      .post('/v2/account/mfa/recovery-codes')
      .set(bearer(a.access))
      .send({ password: 'nope' });
    expect(noPw.body.code).toBe('AUTH_CURRENT_PASSWORD_WRONG');
    const fresh = await api()
      .post('/v2/account/mfa/recovery-codes')
      .set(bearer(a.access))
      .send({ password: PASSWORD });
    expect(fresh.body.recoveryCodes).toHaveLength(10);
    expect(
      (
        await api()
          .post('/v2/account/mfa/disable')
          .set(bearer(a.access))
          .send({ password: 'nope', code: '000000' })
      ).status,
    ).toBe(422);
    // The password alone is no longer enough: the factor being removed must be presented too.
    const noCode = await api()
      .post('/v2/account/mfa/disable')
      .set(bearer(a.access))
      .send({ password: PASSWORD });
    expect(noCode.status).toBe(422);
    const wrongCode = await api()
      .post('/v2/account/mfa/disable')
      .set(bearer(a.access))
      .send({ password: PASSWORD, code: '000000' });
    expect(wrongCode.status).toBe(422);
    expect(wrongCode.body.code).toBe('AUTH_MFA_INVALID_CODE');
    // regenerating the codes replaced the ones from enrolment: take one from the fresh set
    expect(
      (
        await api()
          .post('/v2/account/mfa/disable')
          .set(bearer(a.access))
          .send({ password: PASSWORD, code: fresh.body.recoveryCodes[0] })
      ).status,
    ).toBe(201);
    void factor;
    expect((await login({ ...a, ip: nextIp() }, PASSWORD)).body.status).toBe('authenticated');
  });
});

describe('account gates', () => {
  it('requires enrolment when policy says so, leaves the way to enrol open, and clears once enrolled', async () => {
    const a = await signup();
    await setPolicy({ requireMfaForAll: true });
    try {
      const blocked = await api().get('/v2/users/me').set(bearer(a.access));
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('AUTH_MFA_ENROLMENT_REQUIRED');
      const session = await api().get('/v2/auth/session').set(bearer(a.access));
      expect(session.body.flags.mfaEnrolmentRequired).toBe(true);

      const setup = await api().post('/v2/account/mfa/setup').set(bearer(a.access));
      expect(setup.status).toBe(201);
      await api()
        .post('/v2/account/mfa/enable')
        .set(bearer(a.access))
        .send({ code: totp(setup.body.secret) });
      expect((await api().get('/v2/users/me').set(bearer(a.access))).status).toBe(200);
    } finally {
      await setPolicy({ requireMfaForAll: false });
    }
  });

  it('forces a password change flagged by an operator and clears it once changed', async () => {
    const a = await signup();
    await h.owner.query(
      `UPDATE user_security SET force_password_change = true WHERE (org_id, user_id) IN (SELECT org_id, id FROM users WHERE email = $1)`,
      [a.email],
    );
    await h.redis.eval(
      `for _,k in ipairs(redis.call('keys','auth:gate:*')) do redis.call('del',k) end`,
      0,
    );
    const blocked = await api().get('/v2/users/me').set(bearer(a.access));
    expect(blocked.body.code).toBe('AUTH_PASSWORD_CHANGE_REQUIRED');
    const login2 = await login(a, PASSWORD);
    expect(login2.body.flags.passwordChangeRequired).toBe(true);
    const changed = await api()
      .post('/v2/account/password')
      .set(bearer(login2.body.tokens.accessToken))
      .send({ currentPassword: PASSWORD, newPassword: 'Fresh#Secret77' });
    expect(changed.status).toBe(201);
    expect(
      (await api().get('/v2/users/me').set(bearer(login2.body.tokens.accessToken))).status,
    ).toBe(200);
  });

  it('blocks unverified accounts only in block mode, and verification clears it', async () => {
    const a = await signup();
    expect((await api().get('/v2/users/me').set(bearer(a.access))).status).toBe(200);
    await op('patch', '/settings/registration').send({ emailVerification: 'block' });
    await h.redis.eval(
      `for _,k in ipairs(redis.call('keys','auth:gate:*')) do redis.call('del',k) end`,
      0,
    );
    try {
      const blocked = await api().get('/v2/users/me').set(bearer(a.access));
      expect(blocked.body.code).toBe('AUTH_EMAIL_UNVERIFIED');
      expect((await api().post('/v2/auth/verify-email/resend').set(bearer(a.access))).status).toBe(
        201,
      );
      await verifyEmail(a);
      await h.redis.eval(
        `for _,k in ipairs(redis.call('keys','auth:gate:*')) do redis.call('del',k) end`,
        0,
      );
      expect((await api().get('/v2/users/me').set(bearer(a.access))).status).toBe(200);
    } finally {
      await op('patch', '/settings/registration').send({ emailVerification: 'banner' });
    }
  });

  it('lets suspended users sign in, then locks every session down to sign-out', async () => {
    const a = await signup();
    await h.owner.query(`UPDATE users SET status = 'inactive' WHERE email = $1`, [a.email]);
    await h.redis.eval(
      `for _,k in ipairs(redis.call('keys','auth:gate:*')) do redis.call('del',k) end`,
      0,
    );
    // As in Reference, the sign-in itself succeeds and the lock screen takes over.
    const signedIn = await login({ ...a, ip: nextIp() }, PASSWORD);
    expect(signedIn.status).toBe(201);
    const fresh = signedIn.body.tokens.accessToken as string;
    const blocked = await api().get('/v2/users/me').set(bearer(fresh));
    expect(blocked.body.code).toBe('AUTH_ACCOUNT_SUSPENDED');
    const existing = await api().get('/v2/users/me').set(bearer(a.access));
    expect(existing.body.code).toBe('AUTH_ACCOUNT_SUSPENDED');
    const session = await api().get('/v2/auth/session').set(bearer(fresh));
    expect(session.body.flags.suspended).toBe(true);
    expect((await api().post('/v2/auth/logout').set(bearer(fresh)).send({})).status).toBe(201);
  });
});

describe('workspaces', () => {
  it('lists and switches between organizations that share a verified email, and refuses unverified ones', async () => {
    const email = uniqueEmail('multi');
    const one = await signup({ email, orgName: 'First Workspace' });
    const two = await anotherWorkspace(email, 'Second Workspace');
    expect(one.slug).not.toBe(two.slug);

    const alone = await api().get('/v2/auth/workspaces').set(bearer(one.access));
    expect(alone.body.data).toHaveLength(1);
    const refused = await api()
      .post('/v2/auth/workspaces/switch')
      .set(bearer(one.access))
      .send({ orgSlug: two.slug });
    expect(refused.status).toBe(403);
    expect(refused.body.code).toBe('AUTH_WORKSPACE_NOT_AVAILABLE');

    await verifyEmail(one);
    await new Promise((r) => setTimeout(r, 300));
    await verifyEmail(two);

    const both = await api().get('/v2/auth/workspaces').set(bearer(one.access));
    expect(both.body.data.map((w: { slug: string }) => w.slug).sort()).toEqual(
      [one.slug, two.slug].sort(),
    );
    expect(both.body.data.find((w: { current: boolean }) => w.current).slug).toBe(one.slug);

    const switched = await api()
      .post('/v2/auth/workspaces/switch')
      .set(bearer(one.access))
      .send({ orgSlug: two.slug });
    expect(switched.status).toBe(201);
    const now = await api().get('/v2/auth/session').set(bearer(switched.body.tokens.accessToken));
    expect(now.body.org.slug).toBe(two.slug);
    // No password was asked: the verified inbox is the identity.
  });
});

describe('social sign-in', () => {
  async function configureGoogle() {
    await op('patch', '/settings/social-captcha').send({
      google: { enabled: true, clientId: 'cid', clientSecret: 'csecret' },
    });
  }
  const start = (query: Record<string, string>) =>
    api()
      .get('/v2/auth/social/google/start')
      .query({ redirectUri: 'http://localhost:3001/auth/social/google/callback', ...query });
  const callback = (state: string, code: string, provider = 'google') =>
    api().post(`/v2/auth/social/${provider}/callback`).send({ state, code });
  const stateOf = (url: string) => new URL(url).searchParams.get('state')!;

  it('is unavailable until an operator configures it, and secrets are never echoed back', async () => {
    const off = await start({ orgSlug: 'xx', mode: 'login' });
    expect(off.status).toBe(400);
    expect(off.body.code).toBe('AUTH_SOCIAL_UNAVAILABLE');
    await configureGoogle();
    const settings = await op('get', '/settings/social-captcha');
    expect(JSON.stringify(settings.body)).not.toContain('csecret');
    expect(settings.body.google).toMatchObject({
      enabled: true,
      clientId: 'cid',
      hasSecret: true,
      live: true,
    });
    expect((await api().get('/v2/auth/registration-config')).body.social.google).toBe(true);
    // A blank secret keeps the stored one.
    await op('patch', '/settings/social-captcha').send({ google: { clientSecret: '' } });
    expect((await op('get', '/settings/social-captcha')).body.google.hasSecret).toBe(true);
    // An explicit clear removes it, and the button disappears.
    await op('patch', '/settings/social-captcha').send({ google: { clearSecret: true } });
    const cleared = (await op('get', '/settings/social-captcha')).body.google;
    expect(cleared).toMatchObject({ hasSecret: false, live: false });
    expect((await api().get('/v2/auth/registration-config')).body.social.google).toBe(false);
  });

  it('signs an existing verified user in by email, links the identity, and the state works once', async () => {
    await configureGoogle();
    const a = await signup();
    await verifyEmail(a);
    h.socialProfiles.set('code-1', {
      subject: 'g-sub-1',
      email: a.email,
      emailVerified: true,
      name: 'G',
      avatarUrl: null,
    });
    const s = await start({ orgSlug: a.slug, mode: 'login' });
    const state = stateOf(s.body.url);
    const done = await callback(state, 'code-1');
    expect(done.status).toBe(201);
    expect(done.body.status).toBe('authenticated');
    expect((await callback(state, 'code-1')).body.code).toBe('AUTH_SOCIAL_STATE_INVALID');

    // From now on the link is by identity, whatever email the provider reports.
    h.socialProfiles.set('code-2', {
      subject: 'g-sub-1',
      email: 'renamed@example.test',
      emailVerified: true,
      name: 'G',
      avatarUrl: null,
    });
    const again = await callback(
      stateOf((await start({ orgSlug: a.slug, mode: 'login' })).body.url),
      'code-2',
    );
    expect(again.body.status).toBe('authenticated');
  });

  it('never creates a user inside an existing workspace, and never links on an unverified provider email', async () => {
    await configureGoogle();
    const a = await signup();
    await verifyEmail(a);
    h.socialProfiles.set('stranger', {
      subject: 'g-new',
      email: 'stranger@example.test',
      emailVerified: true,
      name: 'S',
      avatarUrl: null,
    });
    const refused = await callback(
      stateOf((await start({ orgSlug: a.slug, mode: 'login' })).body.url),
      'stranger',
    );
    expect(refused.status).toBe(401);
    expect(
      (await h.owner.query(`SELECT 1 FROM users WHERE email = 'stranger@example.test'`)).rowCount,
    ).toBe(0);

    h.socialProfiles.set('unverified', {
      subject: 'g-unv',
      email: a.email,
      emailVerified: false,
      name: 'U',
      avatarUrl: null,
    });
    expect(
      (
        await callback(
          stateOf((await start({ orgSlug: a.slug, mode: 'login' })).body.url),
          'unverified',
        )
      ).status,
    ).toBe(401);
  });

  it('creates a brand-new workspace in sign-up mode, and refuses a provider that shares no email', async () => {
    await configureGoogle();
    h.socialProfiles.set('new-owner', {
      subject: 'g-owner',
      email: uniqueEmail('social'),
      emailVerified: true,
      name: 'Social Owner',
      avatarUrl: null,
    });
    const s = await start({ mode: 'signup', orgName: 'Social Co' });
    const done = await callback(stateOf(s.body.url), 'new-owner');
    expect(done.status).toBe(201);
    expect(done.body.landing).toBe('onboarding');
    const session = await api().get('/v2/auth/session').set(bearer(done.body.tokens.accessToken));
    expect(session.body.user.emailVerified).toBe(true);

    h.socialProfiles.set('no-email', {
      subject: 'g-none',
      email: null,
      emailVerified: false,
      name: 'N',
      avatarUrl: null,
    });
    const none = await callback(
      stateOf((await start({ mode: 'signup', orgName: 'Nope Co' })).body.url),
      'no-email',
    );
    expect(none.body.code).toBe('AUTH_SOCIAL_NO_EMAIL');
  });

  it('refuses a redirect address outside the web origin and a state minted for another provider', async () => {
    await configureGoogle();
    const bad = await api()
      .get('/v2/auth/social/google/start')
      .query({ mode: 'signup', orgName: 'X Co', redirectUri: 'https://evil.test/cb' });
    expect(bad.status).toBe(422);
    const s = await start({ mode: 'signup', orgName: 'Y Co' });
    const wrongProvider = await callback(stateOf(s.body.url), 'whatever', 'facebook');
    expect(wrongProvider.body.code).toBe('AUTH_SOCIAL_STATE_INVALID');
  });
});

describe('captcha', () => {
  it('gates login, sign-up and forgot-password before any credential check, and only when fully configured', async () => {
    const a = await signup();
    await op('patch', '/settings/social-captcha').send({
      recaptcha: { enabled: true, version: 'v2', siteKey: 'site' },
    });
    expect((await login(a)).status).toBe(201); // no secret yet: treated as off
    await op('patch', '/settings/social-captcha').send({ recaptcha: { secret: 'shh' } });
    try {
      expect((await api().get('/v2/auth/registration-config')).body.captcha).toEqual({
        version: 'v2',
        siteKey: 'site',
      });
      const missing = await login(a);
      expect(missing.status).toBe(400);
      expect(missing.body.code).toBe('AUTH_CAPTCHA_FAILED');
      expect((await login(a, PASSWORD, { captchaToken: 'bad' })).body.code).toBe(
        'AUTH_CAPTCHA_FAILED',
      );
      // The refusal comes before the password check: a wrong password still reports the captcha.
      expect((await login(a, 'wrong')).body.code).toBe('AUTH_CAPTCHA_FAILED');
      expect((await login(a, PASSWORD, { captchaToken: h.captchaValid.token })).status).toBe(201);
      const signupNo = await api().post('/v2/auth/signup').set('x-forwarded-for', nextIp()).send({
        orgName: 'Cap Co',
        fullName: 'C',
        email: uniqueEmail(),
        password: PASSWORD,
        acceptTerms: true,
      });
      expect(signupNo.body.code).toBe('AUTH_CAPTCHA_FAILED');
      const forgotNo = await api()
        .post('/v2/auth/forgot-password')
        .send({ orgSlug: a.slug, email: a.email });
      expect(forgotNo.body.code).toBe('AUTH_CAPTCHA_FAILED');
    } finally {
      await op('patch', '/settings/social-captcha').send({ recaptcha: { enabled: false } });
    }
  });
});

describe('account screens and onboarding', () => {
  it('walks onboarding: profile, completion, then the normal landing', async () => {
    const a = await signup();
    const state = await api().get('/v2/onboarding').set(bearer(a.access));
    expect(state.body).toMatchObject({ step: 'workspace', plans: [] });
    expect(state.body.suggestedName).toContain('workspace');

    const badTz = await api()
      .post('/v2/onboarding/workspace')
      .set(bearer(a.access))
      .send({ name: 'Acme', timezone: 'Mars/Base' });
    expect(badTz.status).toBe(422);
    const saved = await api().post('/v2/onboarding/workspace').set(bearer(a.access)).send({
      name: 'Acme Corp',
      industry: 'saas',
      sizeRange: '6-20',
      timezone: 'Asia/Kolkata',
      currency: 'inr',
      phone: '+919811122233',
    });
    expect(saved.body.step).toBe('plan');
    expect(saved.body.workspace).toMatchObject({
      name: 'Acme Corp',
      industry: 'saas',
      timezone: 'Asia/Kolkata',
      currency: 'INR',
    });

    const done = await api().post('/v2/onboarding/complete').set(bearer(a.access));
    expect(done.body.step).toBe('done');
    const session = await api().get('/v2/auth/session').set(bearer(a.access));
    expect(session.body.landing).toBe('dashboard');
    expect(session.body.org).toMatchObject({ name: 'Acme Corp', timezone: 'Asia/Kolkata' });
  });

  it('edits the profile, phone verification resets on change, and only owners/admins touch the timezone', async () => {
    const a = await signup();
    const up = await api().patch('/v2/account/profile').set(bearer(a.access)).send({
      fullName: 'Renamed Person',
      displayName: 'Ren',
      phone: '+14155550123',
      locale: 'ar',
      theme: 'dark',
      workspaceTimezone: 'Europe/Paris',
    });
    expect(up.status).toBe(200);
    expect(up.body).toMatchObject({
      fullName: 'Renamed Person',
      displayName: 'Ren',
      phone: '+14155550123',
      locale: 'ar',
      theme: 'dark',
      workspaceTimezone: 'Europe/Paris',
      canEditWorkspaceTimezone: true,
    });
    const cleared = await api()
      .patch('/v2/account/profile')
      .set(bearer(a.access))
      .send({ displayName: '' });
    expect(cleared.body.displayName).toBeNull();
    const badTz = await api()
      .patch('/v2/account/profile')
      .set(bearer(a.access))
      .send({ workspaceTimezone: 'Nowhere/Land' });
    expect(badTz.status).toBe(422);
    const badPhone = await api()
      .patch('/v2/account/profile')
      .set(bearer(a.access))
      .send({ phone: '12345' });
    expect(badPhone.status).toBe(422);
  });

  it('stores, serves and removes an avatar, rejecting anything that is not a real image', async () => {
    const a = await signup();
    const png = pngOfSize(8 + 64);
    const ok = await api()
      .post('/v2/account/avatar')
      .set(bearer(a.access))
      .attach('file', png, 'me.png');
    expect(ok.status).toBe(201);
    expect(ok.body.avatarUrl).toMatch(/^\/api\/v2\/account\/avatar\?v=/);
    const img = await api().get('/v2/account/avatar').set(bearer(a.access));
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['x-content-type-options']).toBe('nosniff');
    expect(
      (await api().get('/v2/auth/session').set(bearer(a.access))).body.user.avatarUrl,
    ).toBeTruthy();

    for (const [name, bytes] of [
      ['evil.php', png],
      ['logo.svg', Buffer.from('<svg onload=alert(1)>')],
      ['fake.png', Buffer.from('<html>')],
    ] as const) {
      const bad = await api()
        .post('/v2/account/avatar')
        .set(bearer(a.access))
        .attach('file', Buffer.from(bytes), name);
      expect(bad.status, name).toBe(422);
      expect(bad.body.code).toBe('AUTH_UPLOAD_REJECTED');
    }
    expect((await api().delete('/v2/account/avatar').set(bearer(a.access))).status).toBe(200);
    expect((await api().get('/v2/account/avatar').set(bearer(a.access))).status).toBe(404);
  });

  it('sets, clears and resets the outgoing message footer within 60 characters', async () => {
    const a = await signup();
    const first = await api().get('/v2/account/branding').set(bearer(a.access));
    expect(first.body).toMatchObject({ messageFooter: null, canEdit: true });
    expect(
      (
        await api()
          .patch('/v2/account/branding')
          .set(bearer(a.access))
          .send({ messageFooter: 'x'.repeat(61) })
      ).status,
    ).toBe(422);
    expect(
      (
        await api()
          .patch('/v2/account/branding')
          .set(bearer(a.access))
          .send({ messageFooter: 'Sent by Acme' })
      ).body.messageFooter,
    ).toBe('Sent by Acme');
    expect(
      (await api().patch('/v2/account/branding').set(bearer(a.access)).send({ messageFooter: '' }))
        .body.messageFooter,
    ).toBe('');
    expect(
      (
        await api()
          .patch('/v2/account/branding')
          .set(bearer(a.access))
          .send({ messageFooter: null })
      ).body.messageFooter,
    ).toBeNull();
  });

  it('deletes an account only with the phrase and the password, and not when it is the only member or administrator', async () => {
    const a = await signup();
    const sole = await api()
      .delete('/v2/account')
      .set(bearer(a.access))
      .send({ confirmation: 'DELETE my account', password: PASSWORD });
    expect(sole.status).toBe(422);
    expect(sole.body.code).toBe('AUTH_DELETE_BLOCKED');
    expect(sole.body.errors[0].message).toBe('sole_member');

    // Add a second member with no admin role: the first is now the only administrator.
    const org = await h.owner.query(`SELECT org_id FROM users WHERE email = $1`, [a.email]);
    const orgId = org.rows[0].org_id;
    const member = await h.owner.query(
      `INSERT INTO users (org_id, email, full_name) VALUES ($1, 'member@x.test', 'M') RETURNING id`,
      [orgId],
    );
    const sole2 = await api()
      .delete('/v2/account')
      .set(bearer(a.access))
      .send({ confirmation: 'DELETE my account', password: PASSWORD });
    expect(sole2.body.errors[0].message).toBe('sole_admin');

    const adminRole = await h.owner.query(
      `SELECT id FROM roles WHERE org_id = $1 AND system_key = 'admin'`,
      [orgId],
    );
    await h.owner.query(`INSERT INTO user_roles (org_id, user_id, role_id) VALUES ($1,$2,$3)`, [
      orgId,
      member.rows[0].id,
      adminRole.rows[0].id,
    ]);

    const wrongPhrase = await api()
      .delete('/v2/account')
      .set(bearer(a.access))
      .send({ confirmation: 'delete my account', password: PASSWORD });
    expect(wrongPhrase.body.code).toBe('AUTH_CONFIRMATION_MISMATCH');
    const wrongPw = await api()
      .delete('/v2/account')
      .set(bearer(a.access))
      .send({ confirmation: 'DELETE my account', password: 'nope' });
    expect(wrongPw.body.code).toBe('AUTH_CURRENT_PASSWORD_WRONG');

    const gone = await api()
      .delete('/v2/account')
      .set(bearer(a.access))
      .send({ confirmation: 'DELETE my account', password: PASSWORD });
    expect(gone.status).toBe(200);
    expect((await h.owner.query(`SELECT 1 FROM users WHERE email = $1`, [a.email])).rowCount).toBe(
      0,
    );
    expect((await api().get('/v2/users/me').set(bearer(a.access))).status).toBe(401);
    const trail = await h.owner.query(
      `SELECT 1 FROM audit_log WHERE module = 'auth' AND action = 'auth.account_deleted' AND org_id = $1`,
      [orgId],
    );
    expect(trail.rowCount).toBe(1);
    expect((await login(a, PASSWORD)).status).toBe(401);
  });
});

describe('platform operators and the Security Center', () => {
  it('keeps operator and workspace identities apart in both directions', async () => {
    const a = await signup();
    expect((await api().get('/v2/platform/security').set(bearer(a.access))).status).toBe(401);
    expect((await api().get('/v2/users/me').set(bearer(opAccess))).status).toBe(401);
    expect((await api().get('/v2/platform/security')).status).toBe(401);
  });

  it('shows the overview with KPIs, risks and an honest enforcement matrix', async () => {
    const res = await op('get', '/security');
    expect(res.status).toBe(200);
    expect(res.body.kpis.score).toBeGreaterThanOrEqual(0);
    expect(res.body.kpis.blockedAttempts24h).toBeGreaterThan(0);
    expect(res.body.kpis.operatorMfa).toMatchObject({ total: 2, enrolled: 1 });
    expect(res.body.enforcement.some((e: { status: string }) => e.status === 'reserved')).toBe(
      true,
    );
    expect(res.body.coverage).toHaveLength(4);
    expect(res.body.policy.lockoutAfterFailures).toBe(5);
  });

  it('applies a partial policy change with one audit event carrying the diff, and rejects out-of-range values', async () => {
    const before = await h.owner.query(
      `SELECT count(*)::int AS n FROM security_events WHERE event = 'platform.security.policy_updated'`,
    );
    const res = await op('patch', '/security/policy').send({
      lockoutAfterFailures: 3,
      passwordMinLength: 10,
    });
    expect(res.body.policy).toMatchObject({ lockoutAfterFailures: 3, passwordMinLength: 10 });
    const evt = await h.owner.query(
      `SELECT payload FROM security_events WHERE event = 'platform.security.policy_updated' ORDER BY id DESC LIMIT 1`,
    );
    expect(evt.rows[0].payload.changes.lockoutAfterFailures).toEqual({ from: 5, to: 3 });
    expect(
      Number(
        (
          await h.owner.query(
            `SELECT count(*)::int AS n FROM security_events WHERE event = 'platform.security.policy_updated'`,
          )
        ).rows[0].n,
      ),
    ).toBe(before.rows[0].n + 1);

    expect((await op('patch', '/security/policy').send({ sessionTimeoutMinutes: 2 })).status).toBe(
      422,
    );
    expect((await op('patch', '/security/policy').send({ lockoutAfterFailures: 99 })).status).toBe(
      422,
    );
    await setPolicy({ lockoutAfterFailures: 5, passwordMinLength: 12 });
  });

  it('lets only super admins use the danger zone, and audits a refused attempt', async () => {
    const supportLogin = await h.owner.query(`SELECT 1`);
    void supportLogin;
    const login1 = await api()
      .post('/v2/platform/auth/login')
      .send({ email: 'support@platform.test', password: OPERATOR_PASSWORD });
    expect(login1.body.status).toBe('authenticated');
    const support = login1.body.tokens.accessToken as string;

    const denied = await api().post('/v2/platform/security/danger/halt-sends').set(bearer(support));
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('AUTH_OPERATOR_ROLE_REQUIRED');
    const audited = await h.owner.query(
      `SELECT 1 FROM security_events WHERE event = 'platform.security.danger_action_denied'`,
    );
    expect(audited.rowCount).toBeGreaterThan(0);
    // Support can read and edit the auth page copy, but not policy, registration or credentials.
    expect((await api().get('/v2/platform/security').set(bearer(support))).status).toBe(200);
    for (const [path, body] of [
      ['/v2/platform/security/policy', { lockoutAfterFailures: 5 }],
      ['/v2/platform/settings/registration', { publicRegistration: true }],
      ['/v2/platform/settings/social-captcha', { google: { enabled: false } }],
    ] as const) {
      const r = await api().patch(path).set(bearer(support)).send(body);
      expect(r.status, path).toBe(403);
      expect(r.body.code).toBe('AUTH_OPERATOR_ROLE_REQUIRED');
    }
    expect(
      (
        await api()
          .patch('/v2/platform/settings/auth-pages')
          .set(bearer(support))
          .send({ variant: 1 })
      ).status,
    ).toBe(200);
  });

  it('halts and resumes outbound sends platform-wide', async () => {
    const { EmergencyHaltService } =
      await import('../../../src/modules/auth/security/emergency-halt.service');
    const { SendPolicyService } =
      await import('../../../src/modules/auth/security/send-policy.service');
    const halt = h.app.get(EmergencyHaltService);
    const sends = h.app.get(SendPolicyService);

    expect((await op('post', '/security/danger/halt-sends')).body).toMatchObject({
      action: 'halt_sends',
    });
    expect((await op('get', '/security')).body.emergencyHalt).toBe(true);
    await expect(sends.screen(1, 'hello')).rejects.toMatchObject({ code: 'AUTH_SEND_HALTED' });
    await expect(sends.screenBulk(1, 'hello')).rejects.toMatchObject({ code: 'AUTH_SEND_HALTED' });
    expect(await halt.isHalted()).toBe(true);

    expect((await op('post', '/security/danger/resume-sends')).body).toMatchObject({
      action: 'resume_sends',
    });
    await expect(sends.screen(1, 'hello')).resolves.toBeUndefined();
  });

  it('enforces send guardrails in enforce mode and only logs in monitor mode', async () => {
    const { SendPolicyService } =
      await import('../../../src/modules/auth/security/send-policy.service');
    const sends = h.app.get(SendPolicyService);
    await setPolicy({ waGuardrailsMode: 'enforce', waHoldOnLinksCount: 1, waMaxSendsPerMinute: 2 });
    try {
      await expect(sends.screen(7, 'see https://a.test and https://b.test')).rejects.toMatchObject({
        code: 'AUTH_SEND_BLOCKED',
      });
      await sends.screen(7, 'one');
      await sends.screen(7, 'two');
      await expect(sends.screen(7, 'three')).rejects.toMatchObject({ code: 'AUTH_SEND_BLOCKED' });
      await setPolicy({ waGuardrailsMode: 'monitor' });
      await expect(
        sends.screen(7, 'see https://a.test and https://b.test'),
      ).resolves.toBeUndefined();
      const flagged = await h.owner.query(
        `SELECT 1 FROM security_events WHERE event = 'security.send_flagged'`,
      );
      expect(flagged.rowCount).toBeGreaterThan(0);
    } finally {
      await setPolicy({ waGuardrailsMode: 'off', waHoldOnLinksCount: 0, waMaxSendsPerMinute: 0 });
    }
  });

  it('applies the operator IP allowlist, refuses a self-lockout, and shows the blocked address', async () => {
    const mine = (await op('get', '/security')).body.yourIp as string;
    const lockout = await op('patch', '/security/policy').send({
      ipAllowlistEnabled: true,
      ipAllowlistCidrs: ['203.0.113.0/24'],
    });
    expect(lockout.status).toBe(422);
    expect(JSON.stringify(lockout.body.errors)).toContain(mine);
    expect(
      (await op('patch', '/security/policy').send({ ipAllowlistCidrs: ['not-an-ip'] })).status,
    ).toBe(422);

    await setPolicy({ ipAllowlistEnabled: true, ipAllowlistCidrs: [mine, '203.0.113.0/24'] });
    try {
      expect((await op('get', '/security')).status).toBe(200);
      const outside = await api()
        .get('/v2/platform/security')
        .set(bearer(opAccess))
        .set('x-forwarded-for', '198.51.100.4');
      expect(outside.status).toBe(403);
      expect(outside.body.code).toBe('AUTH_IP_BLOCKED');
      expect(outside.body.detail).toContain('198.51.100.4');
      const tenantStillFine = await signup();
      expect((await api().get('/v2/users/me').set(bearer(tenantStillFine.access))).status).toBe(
        200,
      );
    } finally {
      await setPolicy({ ipAllowlistEnabled: false, ipAllowlistCidrs: [] });
    }
  });

  it('describes controls structurally, hides internal ids, and keeps media to https', async () => {
    const overview = await op('get', '/security');
    for (const row of overview.body.enforcement) expect(row.controls.length).toBeGreaterThan(0);
    const events = await op('get', '/security/events').query({ limit: 50 });
    expect(events.status).toBe(200);
    for (const e of events.body.data) {
      expect(e.id).not.toMatch(/^\d+$/);
      if (e.orgId !== null) expect(e.orgId).toMatch(/^[0-9a-f-]{36}$/);
    }
    const pages = await op('get', '/settings/auth-pages');
    expect(pages.body.defaults.login.heading).toBeTruthy();
    expect(pages.body.defaults.login.accent).toBe('#25D366');
    expect(
      (
        await op('patch', '/settings/auth-pages').send({
          login: { mediaUrl: 'http://x.test/a.png' },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await op('patch', '/settings/auth-pages').send({
          login: { mediaUrl: 'javascript:alert(1)' },
        })
      ).status,
    ).toBe(422);
    // Defaults are code, never stored.
    const stored = await h.owner.query(
      `SELECT value FROM platform_settings WHERE key = 'auth.pages'`,
    );
    expect(stored.rows[0].value.defaults).toBeUndefined();
  });

  it('edits the auth page copy, restores defaults on empty values, and rejects unknown showcase fields', async () => {
    const saved = await op('patch', '/settings/auth-pages').send({
      variant: 3,
      login: { heading: 'Hello there', accent: '#ff0000' },
      extra: { login: { hero_title: 'Big title' } },
    });
    expect(saved.status).toBe(200);
    const cfg = await api().get('/v2/auth/registration-config');
    expect(cfg.body.authPages).toMatchObject({
      variant: 3,
      login: { heading: 'Hello there', accent: '#ff0000' },
      extra: { login: { hero_title: 'Big title' } },
    });
    expect(cfg.body.authPages.defaulted.login).not.toContain('heading');
    expect(
      (await op('patch', '/settings/auth-pages').send({ extra: { login: { evil_key: 'x' } } }))
        .status,
    ).toBe(422);
    await op('patch', '/settings/auth-pages').send({
      variant: 1,
      login: { heading: '', accent: '' },
      extra: { login: { hero_title: '' } },
    });
    const restored = await api().get('/v2/auth/registration-config');
    expect(restored.body.authPages.login.heading).not.toBe('Hello there');
    expect(restored.body.authPages.extra.login.hero_title).toBeUndefined();
  });

  it('records operator actions in the event stream with secrets redacted', async () => {
    await op('patch', '/settings/social-captcha').send({
      facebook: { enabled: true, clientId: 'fb', clientSecret: 'super-secret-value' },
    });
    const events = await op('get', '/security/events?limit=50');
    expect(events.status).toBe(200);
    expect(JSON.stringify(events.body)).not.toContain('super-secret-value');
    expect(
      events.body.data.some(
        (e: { event: string }) => e.event === 'platform.settings.social_login_updated',
      ),
    ).toBe(true);
    const filtered = await op('get', '/security/events?event=auth.failed&limit=5');
    expect(filtered.body.data.every((e: { event: string }) => e.event === 'auth.failed')).toBe(
      true,
    );
  });

  it('revokes every session and forces every user to reset when a super admin pulls the levers', async () => {
    const a = await signup();
    const revoke = await op('post', '/security/danger/revoke-sessions');
    expect(revoke.status).toBe(201);
    expect(revoke.body.affected).toBeGreaterThan(0);
    expect((await api().get('/v2/users/me').set(bearer(a.access))).status).toBe(401);
    expect((await api().get('/v2/platform/security').set(bearer(opAccess))).status).toBe(401);
    expect((await api().post('/v2/auth/refresh').send({ refreshToken: a.refresh })).status).toBe(
      401,
    );

    opAccess = await operatorLoginWithRecovery();
    const reset = await op('post', '/security/danger/force-password-reset');
    expect(reset.body).toMatchObject({ action: 'force_password_reset' });
    expect(reset.body.affected).toBeGreaterThan(0);
    const fresh = await login(a, PASSWORD);
    expect(fresh.body.flags.passwordChangeRequired).toBe(true);
    const hooks = await op('post', '/security/danger/rotate-webhook-secrets');
    expect(hooks.body.affected).toBe(0);
  });
});

describe('response hardening', () => {
  it('adds security headers everywhere and no-store on credential-bearing responses', async () => {
    const res = await api().get('/v2/auth/registration-config');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'self'");
    expect(res.headers['cache-control']).toContain('no-store');
    const health = await api().get('/health');
    expect(health.headers['x-content-type-options']).toBe('nosniff');
    expect(health.headers['cache-control'] ?? '').not.toContain('no-store');
  });
});
