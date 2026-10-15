import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RegistrationOtpService } from '../../../src/modules/auth/platform/registration-otp.service';
import { OtpTemplateService } from '../../../src/modules/auth/platform/otp-template.service';
import { PlatformSettingsService } from '../../../src/modules/auth/platform/platform-settings.service';
import { SocialAuthService } from '../../../src/modules/auth/flows/social-auth.service';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import { OPERATOR_EMAIL, OPERATOR_PASSWORD, startHarness, type Harness } from './harness';
import {
  BRIDGE_SENDER,
  BRIDGE_TOKEN,
  GRAPH_PHONE_NUMBER_ID,
  GRAPH_TOKEN,
  GRAPH_WABA_ID,
} from './stubs';

/**
 * Sign-up, the sign-up code, social sign-in, onboarding and workspace switch (TW-AUTH-004 to 010
 * and 019), through HTTP against real Postgres and Redis. Only the far ends are fake: mail, captcha,
 * the OAuth providers (a map of code -> profile), and local stand-ins for Meta, Twilio and the bridge.
 */
let h: Harness;
const api = () => request(h.app.getHttpServer());
const PASSWORD = 'Str0ngPassw0rd#1';
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const totp = (secret: string) => hotp(base32Decode(secret), totpStep(Date.now()));

let n = 0;
const nextIp = () => `10.51.${Math.floor(n / 250)}.${n++ % 250}`;
const nextPhone = () => `+9198${String(100000 + n++).padStart(8, '0')}`;
const uniqueEmail = (tag = 'u') => `${tag}${Date.now()}${n++}@example.test`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let opAccess = '';
let operatorId = 0;
const op = (method: 'get' | 'patch' | 'post' | 'delete', path: string) =>
  api()[method](`/v2/platform${path}`).set(bearer(opAccess));

async function patchRegistration(patch: Record<string, unknown>) {
  const res = await op('patch', '/settings/registration').send(patch);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

async function setPolicy(patch: Record<string, unknown>) {
  const res = await op('patch', '/security/policy').send(patch);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  await h.redis.eval(
    `for _,k in ipairs(redis.call('keys','auth:gate:*')) do redis.call('del',k) end`,
    0,
  );
}

interface Account {
  email: string;
  slug: string;
  access: string;
  refresh: string;
  ip: string;
  body: { flags: Record<string, boolean> } & Record<string, unknown>;
}

async function signup(over: Record<string, unknown> = {}, ip = nextIp()): Promise<Account> {
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
  return {
    email,
    slug: res.body.orgSlug,
    access: res.body.tokens.accessToken,
    refresh: res.body.tokens.refreshToken,
    ip,
    body: res.body,
  };
}

const sessionOf = (a: Pick<Account, 'access'>) =>
  api().get('/v2/auth/session').set(bearer(a.access));

/** The organization and user ids behind an address (one address, one account, in these tests). */
async function idsOf(email: string): Promise<{ org: number; user: number }> {
  const r = await h.owner.query(`SELECT org_id, id FROM users WHERE email = $1 ORDER BY org_id`, [
    email,
  ]);
  return { org: Number(r.rows[0].org_id), user: Number(r.rows[0].id) };
}

async function events(email: string, type: string): Promise<Array<Record<string, unknown>>> {
  const r = await h.owner.query(
    `SELECT e.payload FROM event_outbox e JOIN users u ON u.org_id = e.org_id
     WHERE u.email = $1 AND e.event_type = $2 ORDER BY e.id`,
    [email, type],
  );
  return r.rows.map((x) => x.payload as Record<string, unknown>);
}

async function lastSession(
  email: string,
): Promise<{ remember: boolean; revoked_reason: string | null }> {
  const r = await h.owner.query(
    `SELECT s.remember, s.revoked_reason FROM auth_sessions s
       JOIN users u ON u.org_id = s.org_id AND u.id = s.user_id
      WHERE u.email = $1 ORDER BY s.created_at DESC, s.id DESC LIMIT 1`,
    [email],
  );
  return r.rows[0];
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
  operatorId = Number(
    (await h.owner.query(`SELECT id FROM platform_operators WHERE email = $1`, [OPERATOR_EMAIL]))
      .rows[0].id,
  );
  // The scenarios below state the verification mode they need; start from a known one.
  await patchRegistration({ emailVerification: 'banner', publicRegistration: true });
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

// --- TW-AUTH-019: registration policy ------------------------------------------------------------

describe('registration policy', () => {
  it("'off' creates verified users: no verification mail, no banner, no gate", async () => {
    await patchRegistration({ emailVerification: 'off' });
    try {
      const a = await signup();
      expect(a.body.flags).toMatchObject({ emailUnverified: false, emailBlocked: false });
      const session = await sessionOf(a);
      expect(session.body.user.emailVerified).toBe(true);
      const row = await h.owner.query(
        `SELECT s.email_verified_at FROM user_security s JOIN users u ON u.org_id = s.org_id AND u.id = s.user_id WHERE u.email = $1`,
        [a.email],
      );
      expect(row.rows[0].email_verified_at).not.toBeNull();
      await sleep(300);
      expect(h.mail.some((m) => m.to === a.email && /verify|confirm/i.test(m.subject))).toBe(false);
    } finally {
      await patchRegistration({ emailVerification: 'banner' });
    }
  });

  it("'banner' creates an unverified user and mails the link", async () => {
    const a = await signup();
    expect(a.body.flags.emailUnverified).toBe(true);
    expect((await sessionOf(a)).body.user.emailVerified).toBe(false);
    for (let i = 0; i < 20 && !h.mail.some((m) => m.to === a.email); i++) await sleep(100);
    expect(h.mail.some((m) => m.to === a.email)).toBe(true);
  });
});

// --- TW-AUTH-005 / TW-AUTH-008: sign-up events, referral, concurrent addresses -----------------

describe('sign-up announces itself to the other domains', () => {
  it('emits the welcome event for NOTIF in the same transaction as the account', async () => {
    const a = await signup({ fullName: 'Priya Sharma' });
    const [welcome] = await events(a.email, 'auth.signup_completed');
    expect(welcome).toMatchObject({
      email: a.email,
      fullName: 'Priya Sharma',
      method: 'password',
      emailVerified: false,
      phoneVerified: false,
    });
    expect(welcome!.userUuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(welcome!.orgUuid).toMatch(/^[0-9a-f-]{36}$/);
    // the long-standing event is still there
    expect(await events(a.email, 'auth.user.registered')).toHaveLength(1);
  });

  it('attributes a referral once, naming the referrer and the referred, whatever the code case', async () => {
    const referrer = await signup();
    const r = await idsOf(referrer.email);
    await h.owner.query(
      `INSERT INTO referral_codes (owner_org_id, user_id, code) VALUES ($1, $2, 'ABCD1234EFGH5678')`,
      [r.org, r.user],
    );
    const referred = await signup({ referralCode: 'abcd1234efgh5678' });
    const [attributed, ...rest] = await events(referred.email, 'referral.attributed');
    expect(rest).toHaveLength(0);
    const referrerRow = await h.owner.query(
      `SELECT u.uuid AS user_uuid, o.uuid AS org_uuid FROM users u JOIN organizations o ON o.id = u.org_id WHERE u.email = $1`,
      [referrer.email],
    );
    const referredRow = await h.owner.query(
      `SELECT u.uuid AS user_uuid, o.uuid AS org_uuid FROM users u JOIN organizations o ON o.id = u.org_id WHERE u.email = $1`,
      [referred.email],
    );
    expect(attributed).toMatchObject({
      referrerUserUuid: referrerRow.rows[0].user_uuid,
      referrerOrgUuid: referrerRow.rows[0].org_uuid,
      referredUserUuid: referredRow.rows[0].user_uuid,
      referredOrgUuid: referredRow.rows[0].org_uuid,
      codeUsed: 'ABCD1234EFGH5678',
    });
    // the sign-up event keeps carrying the raw code for consumers that want it
    expect((await events(referred.email, 'auth.user.registered'))[0]!.referralCode).toBe(
      'abcd1234efgh5678',
    );
  });

  it('ignores an unknown code, an empty one, and a person referring themselves', async () => {
    const unknown = await signup({ referralCode: 'NOSUCHCODE0000' });
    expect(await events(unknown.email, 'referral.attributed')).toHaveLength(0);
    const blank = await signup({ referralCode: '' });
    expect(await events(blank.email, 'referral.attributed')).toHaveLength(0);

    const own = await signup();
    const o = await idsOf(own.email);
    await h.owner.query(
      `INSERT INTO referral_codes (owner_org_id, user_id, code) VALUES ($1, $2, 'SELF000000000001')`,
      [o.org, o.user],
    );
    // the same person signs up again, in another workspace, with their own code
    const again = await signup({ email: own.email, referralCode: 'SELF000000000001' });
    expect(again.slug).not.toBe(own.slug);
    const all = await h.owner.query(
      `SELECT 1 FROM event_outbox e JOIN users u ON u.org_id = e.org_id
       WHERE u.email = $1 AND e.event_type = 'referral.attributed'`,
      [own.email],
    );
    expect(all.rowCount).toBe(0);
  });
});

describe('two sign-ups choosing the same workspace address at once', () => {
  it('all succeed, each with its own address, instead of one answering 409', async () => {
    const name = `Same Name Co ${Date.now()}`;
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        api()
          .post('/v2/auth/signup')
          .set('x-forwarded-for', nextIp())
          .send({
            orgName: name,
            fullName: 'Racer',
            email: uniqueEmail('race'),
            password: PASSWORD,
            acceptTerms: true,
          }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201, 201]);
    const slugs = results.map((r) => r.body.orgSlug as string);
    expect(new Set(slugs).size).toBe(6);
  });

  it('still tells a person their typed address is taken while the form is on screen', async () => {
    const slug = `typed-${Date.now()}`;
    await signup({ orgSlug: slug });
    const second = await api().post('/v2/auth/signup').set('x-forwarded-for', nextIp()).send({
      orgName: 'Another',
      orgSlug: slug,
      fullName: 'B',
      email: uniqueEmail(),
      password: PASSWORD,
      acceptTerms: true,
    });
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('AUTH_SLUG_TAKEN');
    expect(second.body.errors[0].path).toBe('orgSlug');
  });
});

// --- TW-AUTH-008 / 009: onboarding ---------------------------------------------------------------

describe('onboarding', () => {
  const save = (a: Account, body: Record<string, unknown>) =>
    api()
      .post('/v2/onboarding/workspace')
      .set(bearer(a.access))
      .send({ name: 'Acme Corp', timezone: 'Asia/Kolkata', ...body });

  it('asks for a mobile number whenever the account has none, and refuses to save without it', async () => {
    const a = await signup();
    const state = await api().get('/v2/onboarding').set(bearer(a.access));
    expect(state.body.needsPhone).toBe(true);

    const refused = await save(a, {});
    expect(refused.status).toBe(422);
    expect(refused.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'phone' })]),
    );
    expect((await api().get('/v2/onboarding').set(bearer(a.access))).body.step).toBe('workspace');

    const ok = await save(a, { phone: '+919811122233' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body).toMatchObject({ step: 'plan', needsPhone: false });
  });

  it('never replaces a number the account already has', async () => {
    const a = await signup({ phone: '+919811100001' });
    expect((await api().get('/v2/onboarding').set(bearer(a.access))).body.needsPhone).toBe(false);
    // no number needed, and a different one sent is ignored
    const first = await save(a, { phone: '+919811100002' });
    expect(first.status).toBe(201);
    const stored = await h.owner.query(
      `SELECT p.phone_e164 FROM user_profiles p JOIN users u ON u.org_id = p.org_id AND u.id = p.user_id WHERE u.email = $1`,
      [a.email],
    );
    expect(stored.rows[0].phone_e164).toBe('+919811100001');
    const without = await save(a, {});
    expect(without.status).toBe(201);
  });

  it('saving the profile again after onboarding is complete does not reopen first-run setup', async () => {
    const a = await signup({ phone: '+919811100003' });
    expect((await save(a, {})).body.step).toBe('plan');
    const done = await api().post('/v2/onboarding/complete').set(bearer(a.access));
    expect(done.body.step).toBe('done');

    const again = await save(a, { name: 'Acme Renamed' });
    expect(again.status).toBe(201);
    expect(again.body.step).toBe('done');
    expect(again.body.workspace.name).toBe('Acme Renamed');
    expect((await sessionOf(a)).body.landing).toBe('dashboard');
  });

  it('prefills the name from the whole local part of the email, digits and dots kept', async () => {
    const a = await signup({ email: `priya.sharma+x${Date.now()}@example.test` });
    const state = await api().get('/v2/onboarding').set(bearer(a.access));
    expect(state.body.suggestedName).toMatch(/^Priya\.sharma\+X\d+'s workspace$/);
  });

  it('gives the plan step what it needs for the credits explainer and the top-up link', async () => {
    const a = await signup({ phone: '+919811100004' });
    const state = await api().get('/v2/onboarding').set(bearer(a.access));
    expect(state.body.billing).toEqual({
      creditsPerMessage: 1,
      displayCurrency: 'USD',
      topUpUrl: '/account/plans',
    });

    // the workspace currency, once chosen, is the one to show prices in
    await save(a, { currency: 'inr' });
    expect((await api().get('/v2/onboarding').set(bearer(a.access))).body.billing).toMatchObject({
      displayCurrency: 'INR',
    });

    // CPN's values win when it has set them; anything malformed falls back to the defaults
    const settings = h.app.get(PlatformSettingsService);
    const b = await signup({ phone: '+919811100005' });
    try {
      await settings.set(
        'onboarding.billing',
        { creditsPerMessage: 3, defaultCurrency: 'eur', topUpUrl: '/wallet/top-up' },
        null,
      );
      expect((await api().get('/v2/onboarding').set(bearer(b.access))).body.billing).toEqual({
        creditsPerMessage: 3,
        displayCurrency: 'EUR',
        topUpUrl: '/wallet/top-up',
      });
      await settings.set(
        'onboarding.billing',
        { creditsPerMessage: 0, defaultCurrency: 'euro', topUpUrl: 'https://evil.test/x' },
        null,
      );
      expect((await api().get('/v2/onboarding').set(bearer(b.access))).body.billing).toEqual({
        creditsPerMessage: 1,
        displayCurrency: 'USD',
        topUpUrl: '/account/plans',
      });
    } finally {
      await h.owner.query(`DELETE FROM platform_settings WHERE key = 'onboarding.billing'`);
      settings.invalidate();
    }
  });

  describe('country and billing currency', () => {
    const stored = async (a: Account) =>
      (
        await h.owner.query(`SELECT settings FROM organizations WHERE id = $1`, [
          (await idsOf(a.email)).org,
        ])
      ).rows[0].settings;

    it('offers the platform currency and every currency Meta rates are stored for', async () => {
      const a = await signup({ phone: nextPhone() });
      const state = await api().get('/v2/onboarding').set(bearer(a.access));
      expect(state.body.currencies.platform).toBe('USD');
      expect(state.body.currencies.available).toEqual(expect.arrayContaining(['INR', 'USD']));
      expect(state.body.workspace).toMatchObject({ country: null, currency: null });
    });

    it('bills India in INR and every other country in USD when no currency is picked', async () => {
      const india = await signup({ phone: nextPhone() });
      const saved = await save(india, { country: 'in' });
      expect(saved.status, JSON.stringify(saved.body)).toBe(201);
      expect(saved.body.workspace).toMatchObject({ country: 'IN', currency: 'INR' });
      expect(saved.body.billing.displayCurrency).toBe('INR');

      const uk = await signup({ phone: nextPhone() });
      const other = await save(uk, { country: 'GB' });
      expect(other.body.workspace).toMatchObject({ country: 'GB', currency: 'USD' });
    });

    it('lets the owner choose another billable currency than the country suggests', async () => {
      const a = await signup({ phone: nextPhone() });
      const saved = await save(a, { country: 'IN', currency: 'usd' });
      expect(saved.body.workspace).toMatchObject({ country: 'IN', currency: 'USD' });
      expect((await stored(a)).currency).toBe('USD');
    });

    it('refuses a country that does not exist and a currency the platform cannot bill', async () => {
      const a = await signup({ phone: nextPhone() });
      for (const [body, path] of [
        [{ country: 'ZZ' }, 'country'],
        [{ country: 'XX' }, 'country'],
        [{ country: 'IN', currency: 'XTS' }, 'currency'],
      ] as const) {
        const res = await save(a, body);
        expect(res.status, JSON.stringify(body)).toBe(422);
        expect(res.body.errors).toEqual(
          expect.arrayContaining([expect.objectContaining({ path })]),
        );
      }
      expect(await stored(a)).not.toHaveProperty('currency');
    });

    it('fixes the currency once the wallet has been used, but still lets the same one be saved', async () => {
      const a = await signup({ phone: nextPhone() });
      await save(a, { country: 'IN' });
      const { org } = await idsOf(a.email);
      await h.owner.query(
        `INSERT INTO wallet_transactions
           (org_id, kind, type, amount, balance_after, idempotency_key, direction, unit)
         VALUES ($1, 'credit', 'topup', 100, 100, $2, 'in', 'INR')`,
        [org, `onb-lock-${org}`],
      );
      const changed = await save(a, { country: 'IN', currency: 'USD' });
      expect(changed.status).toBe(422);
      expect(changed.body.errors).toEqual(
        expect.arrayContaining([expect.objectContaining({ path: 'currency' })]),
      );
      // renaming the workspace later is an ordinary profile save and must not trip the lock
      const same = await save(a, { name: 'Renamed Co', country: 'IN', currency: 'INR' });
      expect(same.status, JSON.stringify(same.body)).toBe(201);
      expect(same.body.workspace.currency).toBe('INR');
    });
  });
});

// --- TW-AUTH-004: social sign-in -----------------------------------------------------------------

describe('social sign-in', () => {
  const REDIRECT = (p: string) => `http://localhost:3001/auth/social/${p}/callback`;
  const start = (query: Record<string, string>, provider = 'google') =>
    api()
      .get(`/v2/auth/social/${provider}/start`)
      .query({ redirectUri: REDIRECT(provider), ...query });
  const callback = (state: string, code: string, provider = 'google') =>
    api().post(`/v2/auth/social/${provider}/callback`).send({ state, code });
  const stateOf = (url: string) => new URL(url).searchParams.get('state')!;
  const signIn = async (slug: string, code: string, provider = 'google') =>
    callback(
      stateOf((await start({ orgSlug: slug, mode: 'login' }, provider)).body.url),
      code,
      provider,
    );

  const PNG = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(32, 9),
  ]);
  const profile = (
    subject: string,
    over: Partial<{
      email: string | null;
      emailVerified: boolean;
      name: string | null;
      avatarUrl: string | null;
    }> = {},
  ) => ({
    subject,
    email: null,
    emailVerified: false,
    name: 'Social Person',
    avatarUrl: null,
    ...over,
  });

  beforeAll(async () => {
    const res = await op('patch', '/settings/social-captcha').send({
      google: { enabled: true, clientId: 'cid', clientSecret: 'csecret' },
      facebook: { enabled: true, clientId: 'fid', clientSecret: 'fsecret' },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  });

  it('signs a returning identity in even when the provider no longer shares an email', async () => {
    const a = await signup();
    h.socialProfiles.set('ret-1', profile('g-ret-1', { email: a.email, emailVerified: true }));
    expect((await signIn(a.slug, 'ret-1')).status).toBe(201);

    h.socialProfiles.set('ret-2', profile('g-ret-1', { email: null }));
    const again = await signIn(a.slug, 'ret-2');
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.body.status).toBe('authenticated');
  });

  it('refuses a first-time identity that shares no email, naming the provider', async () => {
    const a = await signup();
    h.socialProfiles.set('fb-none', profile('fb-1', { email: null }));
    const res = await signIn(a.slug, 'fb-none', 'facebook');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('AUTH_SOCIAL_NO_EMAIL');
    expect(res.body.errors).toEqual([{ path: 'provider', message: 'facebook' }]);
  });

  it('has its own code when no account matches, and names the provider', async () => {
    const a = await signup();
    h.socialProfiles.set(
      'stranger',
      profile('g-str', { email: 'nobody@example.test', emailVerified: true }),
    );
    const stranger = await signIn(a.slug, 'stranger');
    expect(stranger.status).toBe(401);
    expect(stranger.body.code).toBe('AUTH_SOCIAL_NO_ACCOUNT');
    expect(stranger.body.errors).toEqual([{ path: 'provider', message: 'google' }]);

    // an unknown workspace answers the same: no workspace oracle
    const unknownOrg = await signIn('no-such-workspace', 'stranger');
    expect(unknownOrg.status).toBe(401);
    expect(unknownOrg.body.code).toBe('AUTH_SOCIAL_NO_ACCOUNT');

    // the provider does not vouch for the address: it cannot link to the account
    h.socialProfiles.set('unverified', profile('g-unv', { email: a.email, emailVerified: false }));
    expect((await signIn(a.slug, 'unverified')).body.code).toBe('AUTH_SOCIAL_NO_ACCOUNT');
  });

  it('names the provider when the exchange fails or the state is stale', async () => {
    const a = await signup();
    const failed = await signIn(a.slug, 'code-nobody-registered');
    expect(failed.status).toBe(502);
    expect(failed.body.code).toBe('AUTH_SOCIAL_FAILED');
    expect(failed.body.errors).toEqual([{ path: 'provider', message: 'google' }]);

    const stale = await callback('not-a-real-state', 'x');
    expect(stale.body.code).toBe('AUTH_SOCIAL_STATE_INVALID');
    expect(stale.body.errors).toEqual([{ path: 'provider', message: 'google' }]);
  });

  it('remembers the session unless the administrator turned "keep me signed in" off', async () => {
    const a = await signup();
    h.socialProfiles.set('rem-1', profile('g-rem', { email: a.email, emailVerified: true }));
    expect((await signIn(a.slug, 'rem-1')).status).toBe(201);
    expect((await lastSession(a.email)).remember).toBe(true);

    await setPolicy({ rememberMeEnabled: false });
    try {
      expect((await signIn(a.slug, 'rem-1')).status).toBe(201);
      expect((await lastSession(a.email)).remember).toBe(false);
    } finally {
      await setPolicy({ rememberMeEnabled: true });
    }
  });

  it('refuses a social sign-up while a verified mobile number is required, and one from a free mail domain', async () => {
    const email = uniqueEmail('socpol');
    h.socialProfiles.set('pol-1', profile('g-pol-1', { email, emailVerified: true }));
    try {
      await patchRegistration({ requirePhoneVerification: true });
      const noPhone = await callback(
        stateOf((await start({ mode: 'signup', orgName: 'Policy Co' })).body.url),
        'pol-1',
      );
      expect(noPhone.status, JSON.stringify(noPhone.body)).toBe(422);
      expect(noPhone.body.errors[0]).toMatchObject({ path: 'phone' });

      await patchRegistration({ requirePhoneVerification: false, businessEmailOnly: true });
      h.socialProfiles.set(
        'pol-2',
        profile('g-pol-2', { email: 'someone@gmail.com', emailVerified: true }),
      );
      const free = await callback(
        stateOf((await start({ mode: 'signup', orgName: 'Policy Co' })).body.url),
        'pol-2',
      );
      expect(free.status, JSON.stringify(free.body)).toBe(422);
      expect(free.body.errors[0]).toMatchObject({ path: 'email' });
    } finally {
      await patchRegistration({ requirePhoneVerification: false, businessEmailOnly: false });
    }
  });

  it('remembers a social sign-up too, and records the sign-up as a social login', async () => {
    const email = uniqueEmail('soc');
    h.socialProfiles.set('new-soc', profile('g-new-soc', { email, emailVerified: true }));
    const s = await start({ mode: 'signup', orgName: 'Remembered Co' });
    const done = await callback(stateOf(s.body.url), 'new-soc');
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    expect(done.body.landing).toBe('onboarding');
    expect((await lastSession(email)).remember).toBe(true);
    const [welcome] = await events(email, 'auth.signup_completed');
    expect(welcome).toMatchObject({ method: 'google', emailVerified: true });
    const login = await h.owner.query(
      `SELECT l.delta FROM audit_log l JOIN users u ON u.org_id = l.org_id WHERE u.email = $1 AND l.action = 'auth.login' ORDER BY l.id DESC LIMIT 1`,
      [email],
    );
    expect(login.rows[0].delta).toMatchObject({ method: 'social', remember: true });
  });

  it('starts and completes a social sign-up with no workspace name at all, naming it from the profile', async () => {
    // The three-step sign-up redesign collects no workspace name up front (TW-AUTH-006): `start` no
    // longer requires one for mode=signup, and `callback` falls back to a provisional name.
    const email = uniqueEmail('soc-noorg');
    h.socialProfiles.set('no-org', profile('g-no-org', { email, emailVerified: true, name: 'Nia Noorg' }));
    const started = await start({ mode: 'signup' });
    expect(started.status, JSON.stringify(started.body)).toBe(200);
    const done = await callback(stateOf(started.body.url), 'no-org');
    expect(done.status, JSON.stringify(done.body)).toBe(201);
    expect(done.body.landing).toBe('onboarding');
    const session = await api().get('/v2/auth/session').set(bearer(done.body.tokens.accessToken));
    expect(session.body.org.name).toBe('Nia Noorg workspace');

    // a normal callback still completes afterwards: the provisional workspace is a real, usable one
    const again = await api().get('/v2/auth/session').set(bearer(done.body.tokens.accessToken));
    expect(again.status).toBe(200);
  });

  it('refuses a social sign-up whose email already has an account in another org', async () => {
    const existing = await signup();
    h.socialProfiles.set(
      'dup-1',
      profile('g-dup-1', { email: existing.email, emailVerified: true }),
    );
    const started = await start({ mode: 'signup', orgName: 'Dup Co' });
    const res = await callback(stateOf(started.body.url), 'dup-1');
    expect(res.status, JSON.stringify(res.body)).toBe(409);
    expect(res.body.code).toBe('AUTH_IDENTITY_EXISTS');
    expect(res.body.errors).toEqual([
      {
        path: 'email',
        message:
          'An account with this email already exists. Sign in, or ask a workspace admin to invite you.',
      },
    ]);
    const count = await h.owner.query(`SELECT count(*)::int AS c FROM users WHERE email = $1`, [
      existing.email,
    ]);
    expect(count.rows[0].c).toBe(1);

    // a returning user signing in via Google to their own org still works
    const login = await signIn(existing.slug, 'dup-1');
    expect(login.status, JSON.stringify(login.body)).toBe(201);
  });

  describe('profile picture', () => {
    const social = () => h.app.get(SocialAuthService);
    let original: SocialAuthService['avatarFetch'];
    beforeAll(() => {
      original = social().avatarFetch;
    });
    afterAll(() => {
      social().avatarFetch = original;
    });
    const avatarOf = async (email: string) =>
      (
        await h.owner.query(
          `SELECT a.mime, a.bytes FROM user_avatars a JOIN users u ON u.org_id = a.org_id AND u.id = a.user_id WHERE u.email = $1`,
          [email],
        )
      ).rows[0] as { mime: string; bytes: Buffer } | undefined;

    it('fills an empty avatar on sign-in, and leaves an existing one alone', async () => {
      const asked: Array<string | null | undefined> = [];
      social().avatarFetch = async (url) => {
        asked.push(url);
        return { mime: 'image/png', bytes: PNG, etag: 'abcdef0123456789' };
      };
      const a = await signup();
      h.socialProfiles.set(
        'av-1',
        profile('g-av-1', {
          email: a.email,
          emailVerified: true,
          avatarUrl: 'https://cdn.example.test/me.png',
        }),
      );
      expect((await signIn(a.slug, 'av-1')).status).toBe(201);
      expect(asked).toEqual(['https://cdn.example.test/me.png']);
      const stored = await avatarOf(a.email);
      expect(stored?.mime).toBe('image/png');
      expect(stored!.bytes.equals(PNG)).toBe(true);
      const second = await signIn(a.slug, 'av-1');
      const served = await api()
        .get('/v2/account/avatar')
        .set(bearer(second.body.tokens.accessToken));
      expect(served.status).toBe(200);
      expect(served.headers['content-type']).toContain('image/png');
      const audited = await h.owner.query(
        `SELECT l.delta FROM audit_log l JOIN users u ON u.org_id = l.org_id WHERE u.email = $1 AND l.action = 'auth.avatar_updated'`,
        [a.email],
      );
      expect(audited.rows.map((r) => r.delta)).toEqual([
        expect.objectContaining({ source: 'google' }),
      ]);

      // a person who already has a picture keeps it, and nothing is downloaded
      const b = await signup();
      const ids = await idsOf(b.email);
      await h.owner.query(
        `INSERT INTO user_avatars (org_id, user_id, mime, bytes, etag) VALUES ($1, $2, 'image/jpeg', $3, 'mine')`,
        [ids.org, ids.user, Buffer.from('their own picture')],
      );
      asked.length = 0;
      h.socialProfiles.set(
        'av-2',
        profile('g-av-2', {
          email: b.email,
          emailVerified: true,
          avatarUrl: 'https://cdn.example.test/other.png',
        }),
      );
      expect((await signIn(b.slug, 'av-2')).status).toBe(201);
      expect(asked).toEqual([]);
      expect((await avatarOf(b.email))!.bytes.toString()).toBe('their own picture');
    });

    it('stores the picture of a social sign-up with the account', async () => {
      social().avatarFetch = async () => ({
        mime: 'image/png',
        bytes: PNG,
        etag: 'abcdef0123456789',
      });
      const email = uniqueEmail('avs');
      h.socialProfiles.set(
        'av-3',
        profile('g-av-3', {
          email,
          emailVerified: true,
          avatarUrl: 'https://cdn.example.test/new.png',
        }),
      );
      const s = await start({ mode: 'signup', orgName: 'Pictured Co' });
      expect((await callback(stateOf(s.body.url), 'av-3')).status).toBe(201);
      expect((await avatarOf(email))?.mime).toBe('image/png');
    });

    it('signs the person in without a picture when it cannot be fetched', async () => {
      social().avatarFetch = async () => null;
      const a = await signup();
      h.socialProfiles.set(
        'av-4',
        profile('g-av-4', {
          email: a.email,
          emailVerified: true,
          avatarUrl: 'https://cdn.example.test/gone.png',
        }),
      );
      expect((await signIn(a.slug, 'av-4')).status).toBe(201);
      expect(await avatarOf(a.email)).toBeUndefined();
    });
  });

  it('lets a suspended person sign in, as Reference does; the account gate holds them afterwards', async () => {
    const a = await signup();
    h.socialProfiles.set('sus-1', profile('g-sus', { email: a.email, emailVerified: true }));
    expect((await signIn(a.slug, 'sus-1')).status).toBe(201);
    await h.owner.query(`UPDATE users SET status = 'suspended' WHERE email = $1`, [a.email]);
    await h.redis.eval(
      `for _,k in ipairs(redis.call('keys','auth:gate:*')) do redis.call('del',k) end`,
      0,
    );
    const res = await signIn(a.slug, 'sus-1');
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.flags.suspended).toBe(true);
  });

  it('closed registration refuses a social sign-up at both ends, and not a social sign-in', async () => {
    const email = uniqueEmail('closed');
    h.socialProfiles.set('closed-1', profile('g-closed', { email, emailVerified: true }));
    // a consent started while registration was still open ...
    const minted = await start({ mode: 'signup', orgName: 'Late Co' });
    const a = await signup();
    h.socialProfiles.set(
      'closed-in',
      profile('g-closed-in', { email: a.email, emailVerified: true }),
    );

    await patchRegistration({ publicRegistration: false });
    try {
      // ... cannot be finished once it is closed
      const late = await callback(stateOf(minted.body.url), 'closed-1');
      expect(late.status).toBe(403);
      expect(late.body.code).toBe('AUTH_SIGNUP_CLOSED');
      expect((await h.owner.query(`SELECT 1 FROM users WHERE email = $1`, [email])).rowCount).toBe(
        0,
      );
      // and a new one cannot start
      const fresh = await start({ mode: 'signup', orgName: 'Newer Co' });
      expect(fresh.status).toBe(403);
      expect(fresh.body.code).toBe('AUTH_SIGNUP_CLOSED');
      // signing in to an existing workspace is not sign-up
      const login = await signIn(a.slug, 'closed-in');
      expect(login.status, JSON.stringify(login.body)).toBe(201);
    } finally {
      await patchRegistration({ publicRegistration: true });
    }
  });
});

// --- TW-AUTH-010: workspace switch ---------------------------------------------------------------

describe('workspace switch', () => {
  async function twoWorkspaces() {
    await patchRegistration({ emailVerification: 'off' });
    try {
      const email = uniqueEmail('multi');
      const one = await signup({ email, orgName: 'First Workspace' });
      const two = await signup({ email, orgName: 'Second Workspace' });
      return { email, one, two };
    } finally {
      await patchRegistration({ emailVerification: 'banner' });
    }
  }
  const loginTo = (a: { email: string; slug: string; ip: string }, remember: boolean) =>
    api()
      .post('/v2/auth/login')
      .set('x-forwarded-for', a.ip)
      .send({ orgSlug: a.slug, email: a.email, password: PASSWORD, remember });
  const switchTo = (access: string, orgSlug: string) =>
    api().post('/v2/auth/workspaces/switch').set(bearer(access)).send({ orgSlug });
  const sessionRow = async (orgSlug: string, email: string) =>
    (
      await h.owner.query(
        `SELECT s.remember, s.revoked_at, s.revoked_reason FROM auth_sessions s
           JOIN users u ON u.org_id = s.org_id AND u.id = s.user_id
           JOIN organizations o ON o.id = s.org_id
          WHERE o.slug = $1 AND u.email = $2 ORDER BY s.id DESC LIMIT 1`,
        [orgSlug, email],
      )
    ).rows[0] as { remember: boolean; revoked_at: Date | null; revoked_reason: string | null };

  it('keeps the "keep me signed in" choice and ends the session it replaces', async () => {
    const { email, one, two } = await twoWorkspaces();
    const signedIn = await loginTo({ email, slug: one.slug, ip: one.ip }, true);
    expect(signedIn.status).toBe(201);
    const oldAccess = signedIn.body.tokens.accessToken as string;
    const oldRefresh = signedIn.body.tokens.refreshToken as string;

    const switched = await switchTo(oldAccess, two.slug);
    expect(switched.status, JSON.stringify(switched.body)).toBe(201);
    expect((await sessionRow(two.slug, email)).remember).toBe(true);

    const oldRow = await sessionRow(one.slug, email);
    expect(oldRow.revoked_at).not.toBeNull();
    expect(oldRow.revoked_reason).toBe('switch');
    // the old tokens are dead at once, the new ones work
    expect((await sessionOf({ access: oldAccess })).status).toBe(401);
    expect((await api().post('/v2/auth/refresh').send({ refreshToken: oldRefresh })).status).toBe(
      401,
    );
    const now = await sessionOf({ access: switched.body.tokens.accessToken });
    expect(now.status).toBe(200);
    expect(now.body.org.slug).toBe(two.slug);
  });

  it('a session that was not remembered stays that way', async () => {
    const { email, one, two } = await twoWorkspaces();
    const signedIn = await loginTo({ email, slug: one.slug, ip: one.ip }, false);
    const switched = await switchTo(signedIn.body.tokens.accessToken, two.slug);
    expect(switched.status).toBe(201);
    expect((await sessionRow(two.slug, email)).remember).toBe(false);
  });

  it('does not carry a remembered session over once the administrator turned remembering off', async () => {
    const { email, one, two } = await twoWorkspaces();
    const signedIn = await loginTo({ email, slug: one.slug, ip: one.ip }, true);
    await setPolicy({ rememberMeEnabled: false });
    try {
      const switched = await switchTo(signedIn.body.tokens.accessToken, two.slug);
      expect(switched.status).toBe(201);
      expect((await sessionRow(two.slug, email)).remember).toBe(false);
    } finally {
      await setPolicy({ rememberMeEnabled: true });
    }
  });

  it('leaves the old session alone when the switch is refused', async () => {
    const { email, one } = await twoWorkspaces();
    const signedIn = await loginTo({ email, slug: one.slug, ip: one.ip }, true);
    const refused = await switchTo(signedIn.body.tokens.accessToken, 'no-such-workspace');
    expect(refused.status).toBe(403);
    expect((await sessionOf({ access: signedIn.body.tokens.accessToken })).status).toBe(200);
  });
});

// --- TW-AUTH-006 / 007: the sign-up code and its admin setup ------------------------------------

describe('sign-up code', () => {
  let bridgeRef = '';
  let bridgeId = '';

  async function useOtp(over: Record<string, unknown> = {}) {
    await patchRegistration({
      otp: {
        enabled: true,
        sender: bridgeRef,
        ttlMinutes: 5,
        length: 6,
        resendCooldownSec: 15,
        maxAttempts: 3,
        ...over,
      },
    });
  }
  const stage = async (over: Record<string, unknown> = {}, ip = nextIp()) => {
    const email = (over.email as string) ?? uniqueEmail('otp');
    const res = await api()
      .post('/v2/auth/signup')
      .set('x-forwarded-for', ip)
      .send({
        orgName: `Otp Org ${email.slice(0, 10)}`,
        fullName: 'Otp Person',
        email,
        password: PASSWORD,
        acceptTerms: true,
        phone: nextPhone(),
        ...over,
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body.status).toBe('otp_required');
    return { email, challengeId: res.body.challengeId as string, res, code: h.otps.at(-1)!.code };
  };
  const verify = (challengeId: string, code: string, ip = nextIp()) =>
    api().post('/v2/auth/signup/verify-otp').set('x-forwarded-for', ip).send({ challengeId, code });
  const wrongOf = (code: string) => (code === '000000' ? '111111' : '000000');
  const countUsers = async (email: string) =>
    Number(
      (await h.owner.query(`SELECT count(*)::int AS c FROM users WHERE email = $1`, [email]))
        .rows[0].c,
    );
  /** Moves the staged send time back so the resend cooldown is over, as the delivery specs do. */
  async function waitOutCooldown(challengeId: string) {
    const key = `auth:signup:${challengeId}`;
    const staged = JSON.parse((await h.redis.get(key))!);
    staged.lastSentAt -= 120_000;
    await h.redis.setex(key, 1800, JSON.stringify(staged));
  }

  beforeAll(async () => {
    const added = await op('post', '/settings/senders').send({
      kind: 'device',
      label: 'Signup test bridge',
      bridgeUrl: h.stubs.bridge.url,
      senderNumber: BRIDGE_SENDER,
      secret: BRIDGE_TOKEN,
    });
    expect(added.status, JSON.stringify(added.body)).toBe(201);
    bridgeId = added.body.id;
    bridgeRef = `device:${bridgeId}`;
  });

  afterAll(async () => {
    await op('patch', '/settings/registration').send({ otp: { enabled: false } });
    await op('delete', `/settings/senders/${bridgeId}`);
  });

  describe('guessing', () => {
    it('parallel wrong guesses cannot beat the attempt limit', async () => {
      await useOtp({ maxAttempts: 3 });
      const { challengeId, code, email } = await stage();
      const wrong = wrongOf(code);

      const burst = await Promise.all(
        Array.from({ length: 12 }, (_, i) => verify(challengeId, wrong, `10.61.0.${i + 1}`)),
      );
      const codes = burst.map((r) => r.body.code as string);
      expect(codes.filter((c) => c === 'AUTH_OTP_INVALID')).toHaveLength(3);
      expect(codes.filter((c) => c === 'AUTH_OTP_TOO_MANY_ATTEMPTS')).toHaveLength(9);

      // the right code is refused too, until a new one is requested
      const late = await verify(challengeId, code);
      expect(late.status).toBe(429);
      expect(late.body.code).toBe('AUTH_OTP_TOO_MANY_ATTEMPTS');
      expect(await countUsers(email)).toBe(0);

      await waitOutCooldown(challengeId);
      const resent = await api().post('/v2/auth/signup/resend-otp').send({ challengeId });
      expect(resent.status, JSON.stringify(resent.body)).toBe(201);
      const fresh = h.otps.at(-1)!.code;
      const ok = await verify(challengeId, fresh);
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      expect(await countUsers(email)).toBe(1);
    });

    it('allows exactly the configured number of wrong tries before a correct one still works', async () => {
      await useOtp({ maxAttempts: 3 });
      const { challengeId, code, email } = await stage();
      for (let i = 0; i < 2; i++) {
        expect((await verify(challengeId, wrongOf(code))).body.code).toBe('AUTH_OTP_INVALID');
      }
      const ok = await verify(challengeId, code);
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      expect(await countUsers(email)).toBe(1);
    });

    it('two correct posts at once create one organization', async () => {
      await useOtp({ maxAttempts: 5 });
      const { challengeId, code, email } = await stage();
      const burst = await Promise.all(
        Array.from({ length: 4 }, (_, i) => verify(challengeId, code, `10.62.0.${i + 1}`)),
      );
      const statuses = burst.map((r) => r.status).sort();
      expect(statuses).toEqual([201, 400, 400, 400]);
      for (const loser of burst.filter((r) => r.status === 400)) {
        expect(loser.body.code).toBe('AUTH_SIGNUP_EXPIRED');
      }
      expect(await countUsers(email)).toBe(1);
      const orgs = await h.owner.query(
        `SELECT count(*)::int AS c FROM organizations o JOIN users u ON u.org_id = o.id WHERE u.email = $1`,
        [email],
      );
      expect(orgs.rows[0].c).toBe(1);
    });

    it('a code replaced by a resend cannot be used any more', async () => {
      await useOtp({ maxAttempts: 5 });
      const { challengeId, code, email } = await stage();
      await waitOutCooldown(challengeId);
      expect((await api().post('/v2/auth/signup/resend-otp').send({ challengeId })).status).toBe(
        201,
      );
      const fresh = h.otps.at(-1)!.code;
      expect(fresh).not.toBe(code);
      expect((await verify(challengeId, code)).body.code).toBe('AUTH_OTP_INVALID');
      expect((await verify(challengeId, fresh)).status).toBe(201);
      expect(await countUsers(email)).toBe(1);
    });

    it('a resend gives a fresh allowance of guesses', async () => {
      await useOtp({ maxAttempts: 2 });
      const { challengeId, code } = await stage();
      await verify(challengeId, wrongOf(code));
      await verify(challengeId, wrongOf(code));
      expect((await verify(challengeId, code)).body.code).toBe('AUTH_OTP_TOO_MANY_ATTEMPTS');
      await waitOutCooldown(challengeId);
      await api().post('/v2/auth/signup/resend-otp').send({ challengeId });
      expect((await verify(challengeId, wrongOf(h.otps.at(-1)!.code))).body.code).toBe(
        'AUTH_OTP_INVALID',
      );
    });

    it('limits the code page per client address: 10 verifies and 5 resends a minute', async () => {
      await useOtp({ maxAttempts: 20 });
      const { challengeId, code } = await stage();
      const ip = nextIp();
      const answers: Array<{ status: number; body: { code: string; errors?: unknown[] } }> = [];
      for (let i = 0; i < 11; i++) answers.push(await verify(challengeId, wrongOf(code), ip));
      expect(answers.slice(0, 10).every((r) => r.body.code === 'AUTH_OTP_INVALID')).toBe(true);
      expect(answers[10]!.status).toBe(429);
      expect(answers[10]!.body.code).toBe('RATE_LIMITED');
      expect(answers[10]!.body.errors).toEqual([
        { path: 'retryAfterSeconds', message: expect.stringMatching(/^\d+$/) },
      ]);

      const resendIp = nextIp();
      const resends: string[] = [];
      for (let i = 0; i < 6; i++) {
        const r = await api()
          .post('/v2/auth/signup/resend-otp')
          .set('x-forwarded-for', resendIp)
          .send({ challengeId });
        resends.push(r.body.code);
      }
      expect(resends.slice(0, 5).every((c) => c === 'AUTH_OTP_RESEND_COOLDOWN')).toBe(true);
      expect(resends[5]).toBe('RATE_LIMITED');
    });

    it('keeps the pending sign-up for as long as Reference keeps its session (7 days)', async () => {
      await useOtp();
      const { challengeId } = await stage();
      const ttl = await h.redis.ttl(`auth:signup:${challengeId}`);
      expect(ttl).toBeGreaterThan(6 * 24 * 3600);
    });
  });

  describe('the address is taken after the code was used', () => {
    it('does not strand the person: a derived address is drawn again', async () => {
      await useOtp({ maxAttempts: 5 });
      const stamp = Date.now();
      const { challengeId, code, email } = await stage({ orgName: `Late Race ${stamp}` });
      await h.owner.query(`INSERT INTO organizations (slug, name) VALUES ($1, 'Squatter')`, [
        `late-race-${stamp}`,
      ]);
      const ok = await verify(challengeId, code);
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      expect(ok.body.orgSlug).toMatch(new RegExp(`^late-race-${stamp}-[0-9a-f]{6}$`));
      expect(await countUsers(email)).toBe(1);
    });

    it('does not strand the person: an address they typed gets a suffix', async () => {
      await useOtp({ maxAttempts: 5 });
      const slug = `my-typed-${Date.now()}`;
      const { challengeId, code, email } = await stage({ orgSlug: slug });
      await h.owner.query(`INSERT INTO organizations (slug, name) VALUES ($1, 'Squatter')`, [slug]);
      const ok = await verify(challengeId, code);
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      expect(ok.body.orgSlug).toMatch(new RegExp(`^${slug}-[0-9a-f]{6}$`));
      expect(await countUsers(email)).toBe(1);
    });
  });

  describe('what the person sees', () => {
    it('masks the number with its real calling code', async () => {
      await useOtp({ maxAttempts: 5 });
      const us = await stage({ phone: '+14155550123' });
      expect(us.res.body.maskedPhone).toBe('+1 •••• ••23');
      const uae = await stage({ phone: '+971501234567' });
      expect(uae.res.body.maskedPhone).toBe('+971 •••• ••67');
      const uk = await stage({ phone: '+447911123456' });
      expect(uk.res.body.maskedPhone).toBe('+44 •••• ••56');
      const india = await stage({ phone: '+919876543210' });
      expect(india.res.body.maskedPhone).toBe('+91 •••• ••10');
    });

    it('delivers the fallback text with the code in bold', async () => {
      await useOtp({ maxAttempts: 5 });
      await stage();
      const sent = h.stubs.bridge.requests.at(-1)!.body as { message: string };
      expect(sent.message).toMatch(/^\*\d{6}\* is your Test CRM verification code\./);
      expect(sent.message).toContain('5 minutes');
    });
  });

  describe('operator setup', () => {
    it('lists whether each sender is connected, so the picker offers only the ones that can deliver', async () => {
      const added = await op('post', '/settings/senders').send({
        kind: 'device',
        label: 'Unfinished bridge',
        bridgeUrl: h.stubs.bridge.url,
        senderNumber: BRIDGE_SENDER,
        secret: BRIDGE_TOKEN,
      });
      const id = added.body.id as string;
      try {
        expect(added.body.connected).toBe(true);
        const list = await op('get', '/settings/senders');
        expect(list.body.senders.find((s: { id: string }) => s.id === id).connected).toBe(true);

        await op('patch', `/settings/senders/${id}`).send({ clearSecret: true });
        const after = await op('get', '/settings/senders');
        const row = after.body.senders.find((s: { id: string }) => s.id === id);
        expect(row).toMatchObject({ hasSecret: false, connected: false });
        // the others are unaffected
        expect(after.body.senders.find((s: { id: string }) => s.id === bridgeId).connected).toBe(
          true,
        );
      } finally {
        await op('delete', `/settings/senders/${id}`);
      }
    });

    it('saves the knobs on a plain save, and keeps them when only the switch changes', async () => {
      const saved = await patchRegistration({
        otp: {
          enabled: true,
          sender: bridgeRef,
          ttlMinutes: 12,
          length: 8,
          resendCooldownSec: 30,
          maxAttempts: 7,
        },
      });
      expect(saved.otp).toMatchObject({
        ttlMinutes: 12,
        length: 8,
        resendCooldownSec: 30,
        maxAttempts: 7,
      });
      const off = await patchRegistration({ otp: { enabled: false } });
      expect(off.otp).toMatchObject({
        ttlMinutes: 12,
        length: 8,
        resendCooldownSec: 30,
        maxAttempts: 7,
      });
      const read = await op('get', '/settings/registration');
      expect(read.body.otp).toMatchObject({ ttlMinutes: 12, length: 8 });
      // out of range is refused and nothing changes
      const bad = await op('patch', '/settings/registration').send({ otp: { ttlMinutes: 0 } });
      expect(bad.status).toBe(422);
      expect((await op('get', '/settings/registration')).body.otp.ttlMinutes).toBe(12);
    });

    it('an empty validity is saved as 5 minutes, and the other empty knobs as their defaults', async () => {
      await patchRegistration({
        otp: { ttlMinutes: 20, length: 8, resendCooldownSec: 90, maxAttempts: 9 },
      });
      const saved = await h.app
        .get(RegistrationOtpService)
        .patchRegistration(
          { otp: { ttlMinutes: null, length: '', resendCooldownSec: '  ', maxAttempts: null } },
          operatorId,
        );
      expect(saved.after.otp).toMatchObject({
        ttlMinutes: 5,
        length: 6,
        resendCooldownSec: 60,
        maxAttempts: 5,
      });
      const read = await op('get', '/settings/registration');
      expect(read.body.otp).toMatchObject({
        ttlMinutes: 5,
        length: 6,
        resendCooldownSec: 60,
        maxAttempts: 5,
      });
    });
  });
});

// --- TW-AUTH-007: the template picker's data ------------------------------------------------------

describe('OTP template picker data', () => {
  const templates = () => h.app.get(OtpTemplateService);
  let wabaId = '';
  let wabaRef = '';
  let bridgeId = '';

  const listed = (count: number, extra: Array<Record<string, unknown>> = []) => ({
    data: [
      ...Array.from({ length: count }, (_, i) => ({
        id: `m${i}`,
        name: `auth_tpl_${i}`,
        status: 'APPROVED',
        category: 'AUTHENTICATION',
        language: 'en_US',
        components: [
          { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE', text: 'Copy code' }] },
        ],
      })),
      ...extra,
    ],
  });

  beforeAll(async () => {
    const waba = await op('post', '/settings/senders').send({
      kind: 'waba',
      label: 'Meta number',
      phoneNumberId: GRAPH_PHONE_NUMBER_ID,
      wabaId: GRAPH_WABA_ID,
      graphBaseUrl: `${h.stubs.graph.url}/v23.0`,
      secret: GRAPH_TOKEN,
    });
    expect(waba.status, JSON.stringify(waba.body)).toBe(201);
    wabaId = waba.body.id;
    wabaRef = `waba:${wabaId}`;
    const bridge = await op('post', '/settings/senders').send({
      kind: 'device',
      label: 'Picker bridge',
      bridgeUrl: h.stubs.bridge.url,
      senderNumber: BRIDGE_SENDER,
      secret: BRIDGE_TOKEN,
    });
    bridgeId = bridge.body.id;
  });

  afterAll(async () => {
    await h.owner.query(`DELETE FROM platform_settings WHERE key = 'registration'`);
    h.app.get(PlatformSettingsService).invalidate();
    await op('delete', `/settings/senders/${wabaId}`);
    await op('delete', `/settings/senders/${bridgeId}`);
  });

  it('has nothing to list without a saved sender', async () => {
    await h.owner.query(`DELETE FROM platform_settings WHERE key = 'registration'`);
    h.app.get(PlatformSettingsService).invalidate();
    expect(await templates().options()).toEqual({
      sender: null,
      templates: [],
      unavailableReason: null,
    });
  });

  it('lists the saved template with its status first, then the approved authentication templates', async () => {
    const created = await op('post', '/settings/registration/otp-template').send({
      otp: { sender: wabaRef, ttlMinutes: 7 },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.outcome).toBe('submitted');
    expect(created.body.registration.otp.template.buttonLabel).toBe('Copy code');

    h.stubs.graph.queue.push({
      status: 200,
      body: listed(2, [
        {
          id: 'u1',
          name: 'utility_one',
          status: 'APPROVED',
          category: 'UTILITY',
          language: 'en_US',
        },
        {
          id: 'p1',
          name: 'pending_auth',
          status: 'PENDING',
          category: 'AUTHENTICATION',
          language: 'en_US',
        },
      ]),
    });
    const options = await templates().options();
    expect(options.sender).toBe(wabaRef);
    expect(options.unavailableReason).toBeNull();
    expect(options.templates.map((t) => t.name)).toEqual([
      'crm_signup_otp',
      'auth_tpl_0',
      'auth_tpl_1',
    ]);
    expect(options.templates[0]).toMatchObject({
      id: 'tpl_90001',
      kind: 'waba',
      status: 'pending',
      selected: true,
      buttonLabel: 'Copy code',
    });
    expect(options.templates[1]).toMatchObject({
      id: 'm0',
      status: 'approved',
      selected: false,
      buttonLabel: 'Copy code',
      language: 'en_US',
    });
    // the request asked Meta for approved authentication templates, up to 300
    const asked = h.stubs.graph.requests.at(-1)!;
    expect(asked.path).toBe(`/v23.0/${GRAPH_WABA_ID}/message_templates`);
    expect(asked.query).toContain('category=AUTHENTICATION');
    expect(asked.query).toContain('status=APPROVED');
    expect(asked.query).toContain('limit=300');
  });

  it('lists at most 300 of Meta’s templates, plus the saved one', async () => {
    h.stubs.graph.queue.push({ status: 200, body: listed(350) });
    const options = await templates().options();
    expect(options.templates).toHaveLength(301);
    expect(options.templates[0]!.selected).toBe(true);
  });

  it('does not list the saved template twice when Meta also approved it', async () => {
    h.stubs.graph.queue.push({
      status: 200,
      body: {
        data: [
          {
            id: 'tpl_90001',
            name: 'crm_signup_otp',
            status: 'APPROVED',
            category: 'AUTHENTICATION',
            language: 'en_US',
          },
        ],
      },
    });
    const options = await templates().options();
    expect(options.templates.filter((t) => t.name === 'crm_signup_otp')).toHaveLength(1);
  });

  it('still answers, with the saved template and the reason, when Meta cannot be read', async () => {
    h.stubs.graph.queue.push({ status: 500, body: { error: { message: 'boom' } } });
    const options = await templates().options();
    expect(options.templates.map((t) => t.name)).toEqual(['crm_signup_otp']);
    expect(options.unavailableReason).toMatch(/Meta/);
    expect(options.unavailableReason).not.toContain(GRAPH_TOKEN);
  });

  it('a local sender has only its own saved text, with no button', async () => {
    const created = await op('post', '/settings/registration/otp-template').send({
      otp: { sender: `device:${bridgeId}`, ttlMinutes: 9 },
    });
    expect(created.body.outcome).toBe('local_ready');
    const options = await templates().options();
    expect(options.sender).toBe(`device:${bridgeId}`);
    expect(options.templates).toEqual([
      expect.objectContaining({
        kind: 'local',
        status: 'local',
        selected: true,
        buttonLabel: null,
      }),
    ]);
  });
});
