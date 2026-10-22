import { hash } from '@node-rs/argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { RequestContextStore } from '../../../src/common/context/request-context';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import {
  WHATSAPP_PROVIDER,
  type WhatsAppProvider,
} from '../../../src/infra/providers/whatsapp/whatsapp.port';
import { AuthSettingsService } from '../../../src/modules/auth/platform/auth-settings.service';
import { PlatformSettingsService } from '../../../src/modules/auth/platform/platform-settings.service';
import { reencryptSecrets } from '../../../src/modules/auth/maintenance/reencrypt-secrets';
import { AuthKeys, Ttl } from '../../../src/modules/auth/support/redis-keys';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import { OPERATOR_EMAIL, OPERATOR_PASSWORD, startHarness, type Harness } from './harness';
import { pngOfSize, gifOfSize } from '../../support/images';

/**
 * The account, security-center and secrets slice of the auth domain end to end:
 * profile, photo, password, devices, the outgoing message footer (and its
 * effect on a real send), platform footer, auth-page editor, the Security
 * Center's numbers and guards, the event viewer, and key rotation. One app,
 * one database; every scenario creates its own organization.
 */
let h: Harness;
const api = () => request(h.app.getHttpServer());
const PASSWORD = 'Str0ngPassw0rd#1';
let ipCounter = 10;
const nextIp = () => `10.8.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`;
let emailCounter = 0;
const uniqueEmail = (tag = 'sec') => `${tag}${Date.now()}${emailCounter++}@example.test`;
let slugCounter = 0;
const slugOf = (base: string) => `${base}_${++slugCounter}`;

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const totp = (secret: string) => hotp(base32Decode(secret), totpStep(Date.now()));

let superToken = '';
let supportToken = '';
let auditorToken = '';

type Method = 'get' | 'post' | 'patch' | 'delete';
const ops = (method: Method, path: string, token = superToken) =>
  api()[method](`/v2/platform${path}`).set(bearer(token));

interface Account {
  email: string;
  slug: string;
  access: string;
  ip: string;
  orgId: number;
  userId: number;
}

async function signup(): Promise<Account> {
  const ip = nextIp();
  const email = uniqueEmail();
  const res = await api()
    .post('/v2/auth/signup')
    .set('x-forwarded-for', ip)
    .send({
      orgName: `Sec Org ${emailCounter}`,
      fullName: 'Sec Person',
      email,
      password: PASSWORD,
      acceptTerms: true,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const access = res.body.tokens.accessToken as string;
  const session = await api().get('/v2/auth/session').set(bearer(access));
  const slug = session.body.org.slug as string;
  const org = await h.owner.query(`SELECT id FROM organizations WHERE slug = $1`, [slug]);
  const user = await h.owner.query(`SELECT id FROM users WHERE org_id = $1 AND email = $2`, [
    org.rows[0].id,
    email,
  ]);
  return {
    email,
    slug,
    access,
    ip,
    orgId: Number(org.rows[0].id),
    userId: Number(user.rows[0].id),
  };
}

/** A second person in the organization, signed in. `admin` gives them the Admin role. */
async function addMember(a: Account, opts: { admin?: boolean } = {}): Promise<Account> {
  const email = uniqueEmail('member');
  const row = await h.owner.query(
    `INSERT INTO users (org_id, email, full_name, password_hash) VALUES ($1, $2, 'Member Person', $3) RETURNING id`,
    [a.orgId, email, await hash(PASSWORD)],
  );
  const userId = Number(row.rows[0].id);
  await h.owner.query(
    `INSERT INTO user_security (org_id, user_id, email_verified_at, password_changed_at) VALUES ($1, $2, now(), now())`,
    [a.orgId, userId],
  );
  if (opts.admin) {
    await h.owner.query(
      `INSERT INTO user_roles (org_id, user_id, role_id)
       SELECT $1, $2, id FROM roles WHERE org_id = $1 AND system_key = 'admin'`,
      [a.orgId, userId],
    );
  }
  const ip = nextIp();
  const res = await api()
    .post('/v2/auth/login')
    .set('x-forwarded-for', ip)
    .send({ orgSlug: a.slug, email, password: PASSWORD });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { ...a, email, userId, ip, access: res.body.tokens.accessToken as string };
}

const putOnPlan = (orgId: number, planSlug: string) =>
  h.owner.query(`UPDATE organizations SET plan = $2 WHERE id = $1`, [orgId, planSlug]);

async function makePlan(slug: string, features: Record<string, boolean>) {
  const res = await ops('post', '/plans').send({ name: slug, slug, isFree: true, features });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}

async function outboxEvents(orgId: number, type: string) {
  const res = await h.owner.query(
    `SELECT payload FROM event_outbox WHERE org_id = $1 AND event_type = $2 ORDER BY created_at, id`,
    [orgId, type],
  );
  return res.rows.map((r) => r.payload as Record<string, unknown>);
}

async function securityEvents(event: string) {
  const res = await h.owner.query(
    `SELECT actor_type, actor_id, status, payload FROM security_events WHERE event = $1 ORDER BY id`,
    [event],
  );
  return res.rows as Array<{
    actor_type: string;
    actor_id: number | null;
    status: string;
    payload: Record<string, unknown>;
  }>;
}

const png = (extra = 64) =>
  pngOfSize(8 + extra);

async function setPolicy(patch: Record<string, unknown>, ip?: string) {
  const req = ops('patch', '/security/policy');
  if (ip) req.set('x-forwarded-for', ip);
  const res = await req.send(patch);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

beforeAll(async () => {
  h = await startHarness();

  // The super admin must enrol MFA at first sign-in before the console lets them in.
  const first = await api()
    .post('/v2/platform/auth/login')
    .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  expect(first.body).toMatchObject({ status: 'authenticated', mfaEnrolmentRequired: true });
  const token = first.body.tokens.accessToken as string;
  const setup = await api().post('/v2/platform/auth/mfa/setup').set(bearer(token));
  const enabled = await api()
    .post('/v2/platform/auth/mfa/enable')
    .set(bearer(token))
    .send({ code: totp(setup.body.secret) });
  expect(enabled.status).toBe(201);
  superToken = token;

  const supportLogin = await api()
    .post('/v2/platform/auth/login')
    .send({ email: 'support@platform.test', password: OPERATOR_PASSWORD });
  expect(supportLogin.body.status).toBe('authenticated');
  supportToken = supportLogin.body.tokens.accessToken as string;

  await h.owner.query(
    `INSERT INTO platform_operators (email, full_name, password_hash, role) VALUES ('auditor@platform.test', 'Auditor', $1, 'auditor')`,
    [await hash(OPERATOR_PASSWORD)],
  );
  const auditorLogin = await api()
    .post('/v2/platform/auth/login')
    .send({ email: 'auditor@platform.test', password: OPERATOR_PASSWORD });
  expect(auditorLogin.body.status).toBe('authenticated');
  auditorToken = auditorLogin.body.tokens.accessToken as string;
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

// --- profile -----------------------------------------------------------------------------------------------

describe('profile and the workspace timezone (TW-AUTH-025)', () => {
  it('lets the owner change the timezone and announces the save to the notification feed', async () => {
    const a = await signup();
    const res = await api()
      .patch('/v2/account/profile')
      .set(bearer(a.access))
      .send({ fullName: 'Owner Renamed', workspaceTimezone: 'Europe/Paris' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      fullName: 'Owner Renamed',
      workspaceTimezone: 'Europe/Paris',
      canEditWorkspaceTimezone: true,
    });
    const events = await outboxEvents(a.orgId, 'auth.user.profile_updated');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ fields: ['fullName', 'workspaceTimezone'] });
    // A bad zone from the owner is still a validation error, and saves nothing else.
    const bad = await api()
      .patch('/v2/account/profile')
      .set(bearer(a.access))
      .send({ fullName: 'Nope', workspaceTimezone: 'Nowhere/Land' });
    expect(bad.status).toBe(422);
    const after = await api().get('/v2/account/profile').set(bearer(a.access));
    expect(after.body.fullName).toBe('Owner Renamed');
  });

  it('silently ignores a timezone posted by anyone but the owner, saves the rest, and returns the unchanged zone', async () => {
    const owner = await signup();
    await api()
      .patch('/v2/account/profile')
      .set(bearer(owner.access))
      .send({ workspaceTimezone: 'Asia/Kolkata' });
    const member = await addMember(owner);
    const admin = await addMember(owner, { admin: true });

    for (const who of [member, admin]) {
      const res = await api()
        .patch('/v2/account/profile')
        .set(bearer(who.access))
        .send({ fullName: 'Renamed By Member', workspaceTimezone: 'Pacific/Auckland' });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body).toMatchObject({
        fullName: 'Renamed By Member',
        workspaceTimezone: 'Asia/Kolkata',
        canEditWorkspaceTimezone: false,
      });
      // Even an invalid zone from someone who may not change it is not an error.
      const junk = await api()
        .patch('/v2/account/profile')
        .set(bearer(who.access))
        .send({ workspaceTimezone: 'Nowhere/Land' });
      expect(junk.status).toBe(200);
      expect(junk.body.workspaceTimezone).toBe('Asia/Kolkata');
    }
    const row = await h.owner.query(
      `SELECT settings ->> 'timezone' AS tz FROM organizations WHERE id = $1`,
      [owner.orgId],
    );
    expect(row.rows[0].tz).toBe('Asia/Kolkata');

    const audit = await h.owner.query(
      `SELECT payload FROM security_events WHERE event = 'auth.profile_updated' AND subject_org_id = $1 AND actor_id = $2 ORDER BY id LIMIT 1`,
      [owner.orgId, member.userId],
    );
    expect(audit.rows[0].payload).toMatchObject({
      fields: ['fullName'],
      workspaceTimezoneIgnored: true,
    });
  });

  it('lets an administrator change it only when the workspace records no owner', async () => {
    const owner = await signup();
    const admin = await addMember(owner, { admin: true });
    await h.owner.query(
      `UPDATE organizations SET settings = settings - 'ownerUserId' WHERE id = $1`,
      [owner.orgId],
    );
    const res = await api()
      .patch('/v2/account/profile')
      .set(bearer(admin.access))
      .send({ workspaceTimezone: 'Asia/Tokyo' });
    expect(res.body).toMatchObject({
      workspaceTimezone: 'Asia/Tokyo',
      canEditWorkspaceTimezone: true,
    });
  });
});

describe("a person's own timezone", () => {
  it('shows UTC with no zone anywhere, the workspace zone by default, and the own zone over both', async () => {
    const a = await signup();
    await h.owner.query(`UPDATE organizations SET settings = settings - 'timezone' WHERE id = $1`, [
      a.orgId,
    ]);
    const none = await api().get('/v2/account/profile').set(bearer(a.access));
    expect(none.body).toMatchObject({ timezone: null, effectiveTimezone: 'UTC' });

    await api()
      .patch('/v2/account/profile')
      .set(bearer(a.access))
      .send({ workspaceTimezone: 'Asia/Kolkata' });
    const workspace = await api().get('/v2/account/profile').set(bearer(a.access));
    expect(workspace.body).toMatchObject({ timezone: null, effectiveTimezone: 'Asia/Kolkata' });

    const own = await api()
      .patch('/v2/account/profile')
      .set(bearer(a.access))
      .send({ timezone: 'America/New_York' });
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect(own.body).toMatchObject({
      timezone: 'America/New_York',
      effectiveTimezone: 'America/New_York',
      workspaceTimezone: 'Asia/Kolkata',
    });
    const session = await api().get('/v2/auth/session').set(bearer(a.access));
    expect(session.body.user.timezone).toBe('America/New_York');
    expect(session.body.effectiveTimezone).toBe('America/New_York');
    expect(session.body.org.timezone).toBe('Asia/Kolkata');

    // null goes back to the workspace's zone; an unrelated save leaves it alone.
    await api().patch('/v2/account/profile').set(bearer(a.access)).send({ fullName: 'Same Zone' });
    const kept = await api().get('/v2/account/profile').set(bearer(a.access));
    expect(kept.body.timezone).toBe('America/New_York');
    const cleared = await api()
      .patch('/v2/account/profile')
      .set(bearer(a.access))
      .send({ timezone: null });
    expect(cleared.body).toMatchObject({ timezone: null, effectiveTimezone: 'Asia/Kolkata' });
  });

  it('lets any member set their own zone (it is not the owner-only workspace zone) and refuses a bad one', async () => {
    const owner = await signup();
    const member = await addMember(owner);
    const ok = await api()
      .patch('/v2/account/profile')
      .set(bearer(member.access))
      .send({ timezone: 'Europe/London' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.timezone).toBe('Europe/London');
    const bad = await api()
      .patch('/v2/account/profile')
      .set(bearer(member.access))
      .send({ timezone: 'Nowhere/Land' });
    expect(bad.status).toBe(422);
    const after = await api().get('/v2/account/profile').set(bearer(member.access));
    expect(after.body.timezone).toBe('Europe/London');
    // The owner's own zone is untouched by a member's choice.
    const ownerView = await api().get('/v2/account/profile').set(bearer(owner.access));
    expect(ownerView.body.timezone).toBeNull();
  });
});

// --- photo -------------------------------------------------------------------------------------------------

describe('profile photo (TW-AUTH-026)', () => {
  it('replaces the previous photo, keeps a GIF exactly as uploaded, and states the limit', async () => {
    const a = await signup();
    const profile = await api().get('/v2/account/profile').set(bearer(a.access));
    expect(profile.body.avatarMaxBytes).toBe(1024 * 1024);

    const first = await api()
      .post('/v2/account/avatar')
      .set(bearer(a.access))
      .attach('file', png(10), 'a.png');
    expect(first.status).toBe(201);
    // An "animated" GIF: header plus extra frames. The server keeps the bytes it was given.
    const gif = gifOfSize(6 + 600);
    const second = await api()
      .post('/v2/account/avatar')
      .set(bearer(a.access))
      .attach('file', gif, 'loop.gif');
    expect(second.status).toBe(201);
    expect(second.body.avatarUrl).not.toBe(first.body.avatarUrl);
    const served = await api().get('/v2/account/avatar').set(bearer(a.access));
    expect(served.headers['content-type']).toBe('image/gif');
    expect(Buffer.from(served.body).equals(gif)).toBe(true);
    const rows = await h.owner.query(
      `SELECT count(*)::int AS n FROM user_avatars WHERE org_id = $1 AND user_id = $2`,
      [a.orgId, a.userId],
    );
    expect(rows.rows[0].n).toBe(1);
  });

  it('answers an oversize photo with the stable code, the reason and the limit, whether or not the transport cut it off', async () => {
    const a = await signup();
    // Just over 1 MB: reaches the upload policy.
    const slightly = await api()
      .post('/v2/account/avatar')
      .set(bearer(a.access))
      .attach('file', png(1024 * 1024 + 500), 'big.png');
    expect(slightly.status).toBe(422);
    expect(slightly.body.code).toBe('AUTH_UPLOAD_REJECTED');
    expect(slightly.body.errors).toEqual([
      { path: 'file', message: 'too_large' },
      { path: 'limitBytes', message: String(1024 * 1024) },
    ]);
    // Far over: cut off in transit (413), but with the same code and the same data.
    const huge = await api()
      .post('/v2/account/avatar')
      .set(bearer(a.access))
      .attach('file', png(3 * 1024 * 1024), 'huge.png');
    expect(huge.status).toBe(413);
    expect(huge.body.code).toBe('AUTH_UPLOAD_REJECTED');
    expect(huge.body.errors).toEqual([
      { path: 'file', message: 'too_large' },
      { path: 'limitBytes', message: String(1024 * 1024) },
    ]);
  });

  it('answers a name with no extension like any other forbidden type', async () => {
    const a = await signup();
    const res = await api()
      .post('/v2/account/avatar')
      .set(bearer(a.access))
      .attach('file', png(), 'photo');
    expect(res.status).toBe(422);
    expect(res.body.detail).toBe('This file type is not allowed.');
    expect(res.body.errors).toEqual([{ path: 'file', message: 'type_not_allowed' }]);
  });
});

// --- password ----------------------------------------------------------------------------------------------

describe('change password (TW-AUTH-027)', () => {
  it('signs in with the new password and not the old one, and raises the urgent notification event', async () => {
    const a = await signup();
    const NEXT = 'Another#Passw0rd9';
    const res = await api()
      .post('/v2/account/password')
      .set(bearer(a.access))
      .send({ currentPassword: PASSWORD, newPassword: NEXT });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const fresh = await api()
      .post('/v2/auth/login')
      .set('x-forwarded-for', a.ip)
      .send({ orgSlug: a.slug, email: a.email, password: NEXT });
    expect(fresh.status).toBe(201);
    const old = await api()
      .post('/v2/auth/login')
      .set('x-forwarded-for', a.ip)
      .send({ orgSlug: a.slug, email: a.email, password: PASSWORD });
    expect(old.status).toBe(401);

    const events = await outboxEvents(a.orgId, 'auth.user.password_changed');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ urgent: true });
    expect(JSON.stringify(events[0])).not.toContain(NEXT);
  });

  it('accepts an 8-character password when the administrator sets the minimum to 8, and enforces the stored policy', async () => {
    const a = await signup();
    await setPolicy({ passwordMinLength: 8, passwordRequireSymbol: false });
    try {
      const ok = await api()
        .post('/v2/account/password')
        .set(bearer(a.access))
        .send({ currentPassword: PASSWORD, newPassword: 'Ab1cdefg' });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);

      await setPolicy({ passwordMinLength: 12 });
      const short = await api()
        .post('/v2/account/password')
        .set(bearer(a.access))
        .send({ currentPassword: 'Ab1cdefg', newPassword: 'Ab1cdefghij' });
      expect(short.status).toBe(422);
      expect(short.body.code).toBe('AUTH_PASSWORD_POLICY');
    } finally {
      await setPolicy({ passwordMinLength: 12 });
    }
  });

  it('still refuses the current password again (kept stricter than the reference, pending the owner ruling)', async () => {
    const a = await signup();
    const same = await api()
      .post('/v2/account/password')
      .set(bearer(a.access))
      .send({ currentPassword: PASSWORD, newPassword: PASSWORD });
    expect(same.status).toBe(422);
  });
});

// --- devices -----------------------------------------------------------------------------------------------

describe('devices list (TW-AUTH-031)', () => {
  async function extraSession(a: Account) {
    const res = await api()
      .post('/v2/auth/login')
      .set('x-forwarded-for', nextIp())
      .send({ orgSlug: a.slug, email: a.email, password: PASSWORD });
    expect(res.status).toBe(201);
    return res.body.tokens.accessToken as string;
  }

  it('pages the list, leads with this device, counts them all and states how long a sign-in lasts', async () => {
    const a = await signup();
    for (let i = 0; i < 3; i++) await extraSession(a);

    const first = await api().get('/v2/account/sessions?limit=2').set(bearer(a.access));
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.total).toBe(4);
    expect(first.body.data).toHaveLength(2); // this device leads, and takes one of the two places
    expect(first.body.data[0].current).toBe(true);
    expect(first.body.page).toMatchObject({ hasMore: true, limit: 2 });
    expect(first.body.meta).toMatchObject({
      sessionLifetimeSeconds: Math.min(
        Ttl.sessionNoRememberSeconds,
        first.body.meta.rememberLifetimeSeconds,
      ),
      rememberLifetimeSeconds: expect.any(Number),
      idleTimeoutMinutes: 60,
    });
    expect(first.body.meta.rememberLifetimeSeconds).toBeGreaterThanOrEqual(
      first.body.meta.sessionLifetimeSeconds,
    );

    // Walk every page: each device appears exactly once, and only this one is "current".
    const ids: string[] = first.body.data.map((s: { id: string }) => s.id);
    let cursor: string | null = first.body.page.nextCursor;
    let pages = 1;
    while (cursor) {
      const next = await api()
        .get(`/v2/account/sessions?limit=2&cursor=${encodeURIComponent(cursor)}`)
        .set(bearer(a.access));
      expect(next.status).toBe(200);
      expect(next.body.data.every((s: { current: boolean }) => !s.current)).toBe(true);
      ids.push(...next.body.data.map((s: { id: string }) => s.id));
      cursor = next.body.page.nextCursor;
      pages++;
    }
    expect(pages).toBe(2);
    expect(new Set(ids).size).toBe(4);
    expect(ids).toHaveLength(4);
  });

  it('ends exactly the revoked device on its next request, and "sign out others" reports the true count', async () => {
    const a = await signup();
    const t1 = await extraSession(a);
    const t2 = await extraSession(a);
    const t3 = await extraSession(a);

    const list = await api().get('/v2/account/sessions?limit=100').set(bearer(a.access));
    const sessionOfT1 = await api().get('/v2/auth/session').set(bearer(t1));
    const target = sessionOfT1.body.sessionId as string;
    expect(list.body.data.some((s: { id: string }) => s.id === target)).toBe(true);

    expect(
      (await api().delete(`/v2/account/sessions/${target}`).set(bearer(a.access))).status,
    ).toBe(200);
    expect((await api().get('/v2/auth/session').set(bearer(t1))).status).toBe(401);
    expect((await api().get('/v2/auth/session').set(bearer(t2))).status).toBe(200);

    const others = await api().post('/v2/account/sessions/revoke-others').set(bearer(a.access));
    expect(others.body.revoked).toBe(2); // t2 and t3; t1 was already gone and this device stays
    expect((await api().get('/v2/auth/session').set(bearer(t2))).status).toBe(401);
    expect((await api().get('/v2/auth/session').set(bearer(t3))).status).toBe(401);
    expect((await api().get('/v2/auth/session').set(bearer(a.access))).status).toBe(200);
  });
});

// --- message footer ----------------------------------------------------------------------------------------

describe('outgoing message footer (TW-AUTH-029)', () => {
  const creds = { senderId: '1000', accessToken: 'x' };
  const sent: Array<Record<string, unknown>> = [];
  let provider: WhatsAppProvider;

  const as = <T>(orgId: number, fn: () => Promise<T>) =>
    RequestContextStore.run(
      { requestId: 'footer', orgId, actorType: 'user', actorId: 1, userId: 1 },
      fn,
    );
  const sendText = async (orgId: number, body: string) => {
    sent.length = 0;
    await as(orgId, () =>
      provider.sendText(creds, { to: '+14155550100', body, clientReference: 'r' }),
    );
    return (sent[0] as { text: { body: string } }).text.body;
  };
  const sendTemplate = async (orgId: number) => {
    sent.length = 0;
    await as(orgId, () =>
      provider.sendTemplate(creds, {
        to: '+14155550100',
        templateName: 'order_update',
        language: 'en',
        variables: { '1': 'Ann' },
        clientReference: 'r',
      }),
    );
    return sent[0] as Record<string, unknown>;
  };

  beforeAll(() => {
    provider = h.app.get<WhatsAppProvider>(WHATSAPP_PROVIDER);
    vi.spyOn(provider as unknown as { post: () => Promise<unknown> }, 'post').mockImplementation(
      async (...args: unknown[]) => {
        sent.push(args[1] as Record<string, unknown>);
        return { providerMessageId: 'wamid.test', acceptedAt: new Date() };
      },
    );
  });

  const setPlatformFooter = (footer: string, token = superToken) =>
    ops('patch', '/settings/branding-footer', token).send({ footer });

  it('has an operator-editable platform footer: "Sent via <app>" until saved, 60 characters, super admin only', async () => {
    const initial = await ops('get', '/settings/branding-footer');
    expect(initial.body).toEqual({ footer: 'Sent via Test CRM', isDefault: true });

    expect((await setPlatformFooter('x', supportToken)).status).toBe(403);
    expect((await setPlatformFooter('x', auditorToken)).status).toBe(403);
    expect((await setPlatformFooter('y'.repeat(61))).status).toBe(422);
    expect((await ops('get', '/settings/branding-footer', supportToken)).status).toBe(200);

    const saved = await setPlatformFooter('  Powered by Acme  ');
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ footer: 'Powered by Acme', isDefault: false });
    const audit = await securityEvents('platform.settings.branding_footer_updated');
    expect(audit.at(-1)).toMatchObject({
      actor_type: 'platform_operator',
      payload: { before: 'Sent via Test CRM', after: 'Powered by Acme' },
    });
    // 60 emoji fit (120 UTF-16 units): the limit counts characters.
    expect((await setPlatformFooter('😀'.repeat(60))).status).toBe(200);
    expect((await setPlatformFooter('😀'.repeat(61))).status).toBe(422);
    await setPlatformFooter('Powered by Acme');
  });

  it('sends the platform footer on a plan that cannot remove branding, whatever the workspace saved, and never on a template', async () => {
    const locked = slugOf('footer_locked');
    await makePlan(locked, { remove_branding: false });
    const a = await signup();
    await putOnPlan(a.orgId, locked);

    const view = await api().get('/v2/account/branding').set(bearer(a.access));
    expect(view.body).toMatchObject({
      canEdit: false,
      platformDefault: 'Powered by Acme',
      effective: 'Powered by Acme',
    });
    expect(await sendText(a.orgId, 'Hello Ann')).toBe('Hello Ann\n\n_Powered by Acme_');
    // The same text again is not stamped twice.
    expect(await sendText(a.orgId, 'Hello Ann\n\n_Powered by Acme_')).toBe(
      'Hello Ann\n\n_Powered by Acme_',
    );

    const template = await sendTemplate(a.orgId);
    expect(template).toMatchObject({ type: 'template' });
    expect(JSON.stringify(template)).not.toContain('Powered by Acme');
  });

  it("sends the workspace's own footer, or none, on a plan that removes branding, and applies a save on the very next send", async () => {
    const open = slugOf('footer_open');
    await makePlan(open, { remove_branding: true });
    const a = await signup();
    await putOnPlan(a.orgId, open);

    // Nothing saved: no footer at all. The platform default is NOT a fallback on this plan.
    expect((await api().get('/v2/account/branding').set(bearer(a.access))).body).toMatchObject({
      canEdit: true,
      messageFooter: null,
      effective: null,
    });
    expect(await sendText(a.orgId, 'Hi')).toBe('Hi');

    const save = (messageFooter: string | null) =>
      api().patch('/v2/account/branding').set(bearer(a.access)).send({ messageFooter });
    const saved = await save('Our shop');
    expect(saved.body).toMatchObject({ messageFooter: 'Our shop', effective: 'Our shop' });
    expect(await sendText(a.orgId, 'Hi')).toBe('Hi\n\n_Our shop_');

    expect((await save('')).body).toMatchObject({ messageFooter: '', effective: null });
    expect(await sendText(a.orgId, 'Hi')).toBe('Hi');

    expect((await save('😀'.repeat(60))).status).toBe(200);
    expect(await sendText(a.orgId, 'Hi')).toBe(`Hi\n\n_${'😀'.repeat(60)}_`);
    expect((await save('😀'.repeat(61))).status).toBe(422);

    await save('Our shop');
    expect((await save(null)).body).toMatchObject({ messageFooter: null, effective: null });
    expect(await sendText(a.orgId, 'Hi')).toBe('Hi');
  });

  it('applies a new platform footer to every locked workspace on the next send, and "blank" removes it', async () => {
    const locked = slugOf('footer_locked2');
    await makePlan(locked, { remove_branding: false });
    const a = await signup();
    await putOnPlan(a.orgId, locked);

    expect(await sendText(a.orgId, 'Hi')).toBe('Hi\n\n_Powered by Acme_');
    await setPlatformFooter('Brand new line');
    expect(await sendText(a.orgId, 'Hi')).toBe('Hi\n\n_Brand new line_');
    expect(
      (await api().get('/v2/account/branding').set(bearer(a.access))).body.platformDefault,
    ).toBe('Brand new line');
    await setPlatformFooter('');
    expect(await sendText(a.orgId, 'Hi')).toBe('Hi');
    expect((await ops('get', '/settings/branding-footer')).body).toEqual({
      footer: '',
      isDefault: false,
    });
    await setPlatformFooter('Powered by Acme');
  });

  it('still halts and screens before it stamps anything', async () => {
    const a = await signup();
    await h.app.get(PlatformSettingsService).set('platform.emergency_send_halt', true, null);
    await h.redis.del(AuthKeys.halt);
    try {
      sent.length = 0;
      await expect(
        as(a.orgId, () => provider.sendText(creds, { to: '+1', body: 'x', clientReference: 'r' })),
      ).rejects.toMatchObject({ code: 'AUTH_SEND_HALTED' });
      expect(sent).toHaveLength(0);
    } finally {
      await h.app.get(PlatformSettingsService).set('platform.emergency_send_halt', false, null);
      await h.redis.del(AuthKeys.halt);
    }
  });
});

// --- auth page editor ----------------------------------------------------------------------------------------

describe('auth page editor (TW-AUTH-021/022)', () => {
  const patch = (body: Record<string, unknown>, token = superToken) =>
    ops('patch', '/settings/auth-pages', token).send(body);

  it('stores the showcase keys of the forgot page too, and publishes them to the guest page', async () => {
    const res = await patch({
      extra: { forgot: { footer: 'Need a hand? Ask us.', hero_title: 'Back soon' } },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.extra.forgot).toEqual({
      footer: 'Need a hand? Ask us.',
      hero_title: 'Back soon',
    });
    expect((await ops('get', '/settings/auth-pages')).body.extra.forgot.footer).toBe(
      'Need a hand? Ask us.',
    );
    const pub = await api().get('/v2/auth/registration-config');
    expect(pub.body.authPages.extra.forgot).toEqual({
      footer: 'Need a hand? Ask us.',
      hero_title: 'Back soon',
    });

    const cleared = await patch({ extra: { forgot: { hero_title: '' } } });
    expect(cleared.body.extra.forgot).toEqual({ footer: 'Need a hand? Ask us.' });
  });

  it('rejects an unknown showcase key on any page and stores nothing', async () => {
    const before = (await ops('get', '/settings/auth-pages')).body;
    const res = await patch({ extra: { forgot: { not_a_key: 'x', footer: 'changed' } } });
    expect(res.status).toBe(422);
    expect(res.body.errors[0].path).toBe('extra.forgot.not_a_key');
    expect((await ops('get', '/settings/auth-pages')).body).toEqual(before);
  });

  it('keeps both edits when two operators save different pages at the same moment', async () => {
    for (let round = 0; round < 6; round++) {
      const [a, b, c] = await Promise.all([
        patch({ login: { heading: `Login ${round}` } }),
        patch({ register: { heading: `Register ${round}` } }),
        patch({ extra: { forgot: { footer: `Forgot ${round}` } } }),
      ]);
      expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
      const now = (await ops('get', '/settings/auth-pages')).body;
      expect(now.login.heading).toBe(`Login ${round}`);
      expect(now.register.heading).toBe(`Register ${round}`);
      expect(now.extra.forgot.footer).toBe(`Forgot ${round}`);
    }
  });

  it('does not let a stale media kind follow a new address', async () => {
    const set = async (login: Record<string, unknown>) => (await patch({ login })).body.login;
    expect(await set({ mediaUrl: 'https://cdn.test/a.mp4' })).toMatchObject({
      mediaUrl: 'https://cdn.test/a.mp4',
      mediaType: 'video',
    });
    // Only the address changes: the old "video" would have stuck before.
    expect(await set({ mediaUrl: 'https://cdn.test/b.png' })).toMatchObject({
      mediaUrl: 'https://cdn.test/b.png',
      mediaType: 'image',
    });
    expect(await set({ mediaUrl: 'https://cdn.test/loop.gif' })).toMatchObject({
      mediaType: 'gif',
    });
    // An explicit kind wins over the guess.
    expect(await set({ mediaUrl: 'https://cdn.test/x', mediaType: 'video' })).toMatchObject({
      mediaType: 'video',
    });
    const cleared = await set({ mediaUrl: '' });
    expect(cleared.mediaUrl).toBeUndefined();
    expect(cleared.mediaType).toBeUndefined();
  });

  it('records who may edit what: support may edit the pages, only a super admin the social and captcha keys, an auditor neither', async () => {
    expect((await patch({ login: { eyebrow: 'By support' } }, supportToken)).status).toBe(200);
    expect((await patch({ login: { eyebrow: 'By auditor' } }, auditorToken)).status).toBe(403);
    for (const token of [supportToken, auditorToken]) {
      const res = await ops('patch', '/settings/social-captcha', token).send({
        google: { enabled: true },
      });
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('AUTH_OPERATOR_ROLE_REQUIRED');
    }
    expect((await ops('get', '/settings/auth-pages', auditorToken)).status).toBe(200);
  });
});

describe('captcha settings reach the verifier (TW-AUTH-023)', () => {
  it('stores the v3 threshold where the live check reads it, and keeps a blank secret', async () => {
    const res = await ops('patch', '/settings/social-captcha').send({
      recaptcha: {
        enabled: true,
        version: 'v3',
        siteKey: 'site-key',
        secret: 's3cret',
        v3Threshold: 0.7,
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const settings = h.app.get(AuthSettingsService);
    expect(await settings.captchaConfig()).toMatchObject({
      version: 'v3',
      siteKey: 'site-key',
      secret: 's3cret',
      threshold: 0.7,
    });
    await ops('patch', '/settings/social-captcha').send({
      recaptcha: { secret: '', v3Threshold: 0.4 },
    });
    expect(await settings.captchaConfig()).toMatchObject({ secret: 's3cret', threshold: 0.4 });
    await ops('patch', '/settings/social-captcha').send({
      recaptcha: { enabled: false, clearSecret: true },
    });
    expect(await settings.captchaConfig()).toBeNull();
  });
});

// --- security centre ----------------------------------------------------------------------------------------

describe('Security Center numbers (TW-AUTH-036)', () => {
  it('scores the defaults at exactly 50 and counts coverage as enabled/total per bucket', async () => {
    const res = await ops('get', '/security');
    expect(res.status).toBe(200);
    expect(res.body.appName).toBe('Test CRM');
    expect(res.body.kpis.score).toBe(50);
    expect(res.body.coverage).toEqual([
      { key: 'admin_access', percent: 75, enabled: 3, total: 4 },
      { key: 'send_abuse', percent: 0, enabled: 0, total: 4 },
      { key: 'api_hardening', percent: 100, enabled: 3, total: 3 },
      { key: 'incident_readiness', percent: 100, enabled: 3, total: 3 },
    ]);

    // Webhook failure rate: failures / all webhook events in 24h, two decimals.
    expect(res.body.kpis.webhookFailurePct).toBe(0);
    await h.owner.query(
      `INSERT INTO security_events (actor_type, event, status) VALUES
         ('system', 'webhook.delivered', 'success'), ('system', 'webhook.delivered', 'success'),
         ('system', 'webhook.failed', 'failure')`,
    );
    expect((await ops('get', '/security')).body.kpis.webhookFailurePct).toBe(33.33);

    await setPolicy({
      requireMfaForAdmins: true,
      waHoldOnScamPattern: true,
      abuseBlockShortLinks: true,
    });
    const more = await ops('get', '/security');
    expect(more.body.kpis.score).toBe(80);
    expect(more.body.coverage[0]).toMatchObject({ percent: 100, enabled: 4, total: 4 });
    expect(more.body.coverage[1]).toMatchObject({ percent: 50, enabled: 2, total: 4 });
    await setPolicy({
      requireMfaForAdmins: false,
      waHoldOnScamPattern: false,
      abuseBlockShortLinks: false,
    });
  });

  it('counts blocked attempts, orders the risk queue and names the owner of each row', async () => {
    const a = await signup();
    const before = (await ops('get', '/security')).body.kpis;
    for (let i = 0; i < 3; i++) {
      const bad = await api()
        .post('/v2/auth/login')
        .set('x-forwarded-for', nextIp())
        .send({ orgSlug: a.slug, email: a.email, password: 'WrongPassword#1' });
      expect(bad.status).toBe(401);
    }
    const denied = await ops('post', '/security/danger/halt-sends', supportToken);
    expect(denied.status).toBe(403);

    const after = (await ops('get', '/security')).body;
    expect(after.kpis.blockedAttempts24h - before.blockedAttempts24h).toBe(3);
    expect(after.kpis.openRisks - before.openRisks).toBeGreaterThanOrEqual(4);
    expect(after.kpis.highPriorityRisks - before.highPriorityRisks).toBeGreaterThanOrEqual(4);

    const risks = after.risks as Array<Record<string, unknown>>;
    expect(risks.length).toBeLessThanOrEqual(4);
    // Newest first: the operator's refused danger action, then the three failed sign-ins.
    expect(risks[0]).toMatchObject({
      signal: 'platform.security.danger_action_denied',
      severity: 'high',
      actor: 'Support',
      actorKind: 'platform_operator',
      workspace: null,
      scope: 'platform',
    });
    expect(risks[0]!.detail).toContain('/halt-sends');
    expect(risks[1]).toMatchObject({
      signal: 'auth.failed',
      severity: 'high',
      detail: a.email,
      workspace: expect.stringMatching(/^Sec Org/),
      scope: 'workspace',
      actor: 'Sec Person', // the person's name, not "user"
      actorKind: 'user',
    });
    // A row never repeats its own event name as the detail.
    for (const r of risks) expect(r.detail).not.toBe(r.signal);
  });

  it('tells the truth about what each control does', async () => {
    const matrix = (await ops('get', '/security')).body.enforcement as Array<{
      controls: string[];
      status: string;
      consumer: string;
    }>;
    const row = (control: string) => matrix.find((m) => m.controls.includes(control))!;
    expect(row('webhookSignatureRequired').status).toBe('reserved');
    expect(row('apiRateLimitPerMinute').consumer).toMatch(/ceiling/i);
    expect(row('apiRateLimitPerMinute').consumer).not.toMatch(/override/i);
  });
});

describe('policy store (TW-AUTH-037/038)', () => {
  it('refuses 0 for the idle timeout, the session cap and the lockout, like the reference form', async () => {
    for (const key of ['sessionTimeoutMinutes', 'maxConcurrentSessions', 'lockoutAfterFailures']) {
      const res = await ops('patch', '/security/policy').send({ [key]: 0 });
      expect(res.status, key).toBe(422);
    }
  });

  it('defaults the allowed second-factor methods to app + email, and keeps a long keyword list up to 5000 characters', async () => {
    expect((await ops('get', '/security')).body.policy.allowedMfaMethods).toEqual([
      'totp',
      'email',
    ]);
    const words = Array.from({ length: 400 }, (_, i) => `kw${i}`);
    expect(
      (await ops('patch', '/security/policy').send({ abuseBlockKeywordList: words })).status,
    ).toBe(200);
    expect(
      (await ops('patch', '/security/policy').send({ abuseBlockKeywordList: ['x'.repeat(5001)] }))
        .status,
    ).toBe(422);
    await setPolicy({ abuseBlockKeywordList: [] });
  });

  it('writes the password-policy changes into the audit diff readable, not as [REDACTED]', async () => {
    await setPolicy({
      passwordMinLength: 11,
      passwordRequireSymbol: true,
      webhookReplayWindowSec: 400,
    });
    const diff = (await securityEvents('platform.security.policy_updated')).at(-1)!.payload as {
      changes: Record<string, { from: unknown; to: unknown }>;
    };
    expect(diff.changes.passwordMinLength).toEqual({ from: 12, to: 11 });
    expect(diff.changes.passwordRequireSymbol).toEqual({ from: false, to: true });
    expect(diff.changes.webhookReplayWindowSec).toEqual({ from: 300, to: 400 });
    await setPolicy({
      passwordMinLength: 12,
      passwordRequireSymbol: false,
      webhookReplayWindowSec: 300,
    });
  });

  it('refuses malformed allowlist entries instead of widening to every address, and keeps the self-lockout guard', async () => {
    const ip = '203.0.113.9';
    for (const bad of [
      'x/',
      '10.0.0.5/',
      '10.0.0.5//8',
      '10.0.0.5/8/9',
      '10.0.0.5/0x8',
      '10.0.0.5/33',
    ]) {
      const res = await ops('patch', '/security/policy')
        .set('x-forwarded-for', ip)
        .send({ ipAllowlistEnabled: true, ipAllowlistCidrs: ['203.0.113.0/24', bad] });
      expect(res.status, bad).toBe(422);
    }
    expect((await ops('get', '/security')).body.policy).toMatchObject({
      ipAllowlistEnabled: false,
      ipAllowlistCidrs: [],
    });
    // A valid list that leaves the caller out is still refused.
    const lockout = await ops('patch', '/security/policy')
      .set('x-forwarded-for', ip)
      .send({ ipAllowlistEnabled: true, ipAllowlistCidrs: ['198.51.100.0/24'] });
    expect(lockout.status).toBe(422);
    expect(JSON.stringify(lockout.body)).toContain('203.0.113.9');
  });

  it('shows a signed-in operator whose address is no longer allowed the address that was refused', async () => {
    const mine = '203.0.113.9';
    await setPolicy({ ipAllowlistEnabled: true, ipAllowlistCidrs: ['203.0.113.0/24'] }, mine);
    try {
      const outsider = '198.51.100.4';
      for (const path of ['/auth/session', '/security']) {
        const res = await ops('get', path).set('x-forwarded-for', outsider);
        expect(res.status, path).toBe(403);
        expect(res.body.code).toBe('AUTH_IP_BLOCKED');
        expect(res.body.errors).toEqual([{ path: 'ip', message: outsider }]);
      }
      expect((await ops('get', '/security').set('x-forwarded-for', mine)).status).toBe(200);
      const blocked = await securityEvents('platform.access.blocked_by_ip');
      expect(blocked.length).toBeGreaterThanOrEqual(2);
    } finally {
      await setPolicy({ ipAllowlistEnabled: false, ipAllowlistCidrs: [] }, mine);
    }
  });

  it('keeps every valid setting when one stored value is bad, and never lets a malformed stored entry match everyone', async () => {
    const settings = h.app.get(PlatformSettingsService);
    await h.owner.query(
      `INSERT INTO platform_settings (key, value, is_secret) VALUES ('security.policy', $1::jsonb, false)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [
        JSON.stringify({
          requireMfaForAll: true,
          waGuardrailsMode: 'enforce',
          abuseBlockKeywordList: ['lottery'],
          lockoutAfterFailures: 0, // out of range
          sessionTimeoutMinutes: 'soon', // wrong type
        }),
      ],
    );
    settings.invalidate();
    try {
      const view = (await ops('get', '/security')).body.policy;
      expect(view).toMatchObject({
        requireMfaForAll: true,
        waGuardrailsMode: 'enforce',
        abuseBlockKeywordList: ['lottery'],
        lockoutAfterFailures: 5,
        sessionTimeoutMinutes: 60,
      });
      // Saving the defaulted key repairs the stored value.
      await setPolicy({ lockoutAfterFailures: 5 });
      const stored = await h.owner.query(
        `SELECT value FROM platform_settings WHERE key = 'security.policy'`,
      );
      expect(stored.rows[0].value.lockoutAfterFailures).toBe(5);
      expect(stored.rows[0].value.requireMfaForAll).toBe(true);

      // A malformed allowlist entry left in storage must narrow access, not widen it.
      await h.owner.query(
        `UPDATE platform_settings SET value = value || '{"ipAllowlistEnabled": true, "ipAllowlistCidrs": ["10.0.0.5/"]}'::jsonb WHERE key = 'security.policy'`,
      );
      settings.invalidate();
      const blocked = await ops('get', '/security').set('x-forwarded-for', '198.51.100.77');
      expect(blocked.status).toBe(403);
      expect(blocked.body.code).toBe('AUTH_IP_BLOCKED');
    } finally {
      await h.owner.query(`DELETE FROM platform_settings WHERE key = 'security.policy'`);
      settings.invalidate();
    }
  });

  it('does not lose a setting saved at the same moment as another', async () => {
    await Promise.all([
      ops('patch', '/security/policy').send({ passwordMinLength: 14 }),
      ops('patch', '/security/policy').send({ webhookReplayWindowSec: 600 }),
      ops('patch', '/security/policy').send({ deviceLogoutOnInactiveDays: 45 }),
    ]);
    expect((await ops('get', '/security')).body.policy).toMatchObject({
      passwordMinLength: 14,
      webhookReplayWindowSec: 600,
      deviceLogoutOnInactiveDays: 45,
    });
    await setPolicy({
      passwordMinLength: 12,
      webhookReplayWindowSec: 300,
      deviceLogoutOnInactiveDays: 30,
    });
  });
});

describe('event viewer identity (TW-AUTH-046)', () => {
  it('names who did it, which workspace, from where and under which request', async () => {
    const a = await signup();
    await api()
      .post('/v2/account/password')
      .set(bearer(a.access))
      .set('user-agent', 'ViewerTest/1.0')
      .set('x-forwarded-for', '192.0.2.44')
      .send({ currentPassword: PASSWORD, newPassword: 'Different#Pass77' });
    await setPolicy({ passwordMinLength: 9 });

    const tenant = await ops('get', '/security/events?event=auth.password_changed&limit=50');
    const mine = tenant.body.data.find((e: { orgSlug: string }) => e.orgSlug === a.slug);
    expect(mine).toMatchObject({
      event: 'auth.password_changed',
      actorType: 'user',
      actorName: 'Sec Person',
      actorEmail: a.email,
      orgName: expect.stringMatching(/^Sec Org/),
      ip: '192.0.2.44',
      userAgent: 'ViewerTest/1.0',
    });
    expect(mine.actorId).toMatch(/^[0-9a-f-]{36}$/);
    expect(mine.orgId).toMatch(/^[0-9a-f-]{36}$/);
    expect(mine.requestId).toBeTruthy();
    // The internal numeric ids never leave.
    expect(JSON.stringify(mine)).not.toMatch(new RegExp(`"(actorId|orgId)":${a.userId}\\b`));

    const op = (await ops('get', '/security/events?event=platform.security.policy_updated&limit=1'))
      .body.data[0];
    expect(op).toMatchObject({
      actorType: 'platform_operator',
      actorName: 'Ops',
      actorEmail: OPERATOR_EMAIL,
      orgId: null,
      orgSlug: null,
    });
    await setPolicy({ passwordMinLength: 12 });
  });

  it('searches event names by text', async () => {
    const res = await ops('get', '/security/events?q=PASSWORD_CH&limit=50');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data.every((e: { event: string }) => /password_ch/i.test(e.event))).toBe(true);
    // Wildcard characters in the search are plain text.
    const literal = await ops('get', '/security/events?q=%25&limit=5');
    expect(literal.body.data).toEqual([]);
  });
});

describe('emergency halt mirror (TW-AUTH-040)', () => {
  it('keeps the Redis copy on a short expiry', async () => {
    expect([200, 201]).toContain((await ops('post', '/security/danger/halt-sends')).status);
    try {
      const ttl = await h.redis.ttl(AuthKeys.halt);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(30);
      expect(await h.redis.get(AuthKeys.halt)).toBe('1');
    } finally {
      expect([200, 201]).toContain((await ops('post', '/security/danger/resume-sends')).status);
    }
    expect(await h.redis.get(AuthKeys.halt)).toBe('0');
  });
});

// --- encryption -----------------------------------------------------------------------------------------------

describe('key rotation (TW-AUTH-047)', () => {
  const keyOf = (fill: number) => Buffer.alloc(32, fill).toString('base64');
  const cryptoWith = (current: string, previous?: string) =>
    new CryptoService({
      get: (k: string) =>
        k === 'CREDENTIALS_ENCRYPTION_KEY'
          ? current
          : k === 'CREDENTIALS_ENCRYPTION_PREVIOUS_KEYS'
            ? previous
            : undefined,
    } as never);

  it('lets a secret sealed with a retired key be moved onto the live key without downtime', async () => {
    const settings = h.app.get(PlatformSettingsService);
    // The running app seals with key 7. A secret sealed with a retired key (3) is unreadable to it.
    const retired = cryptoWith(keyOf(3));
    const blob = retired.encrypt('whsec_old_world');
    await h.owner.query(
      `INSERT INTO platform_settings (key, value, is_secret) VALUES ('rotation.test', $1::jsonb, true)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify(blob)],
    );
    settings.invalidate();
    expect(await settings.getSecret('rotation.test')).toBeNull();

    // The operator's step: previous list = [retired key], current = the live key (7).
    const rotated = cryptoWith(keyOf(7), keyOf(3));
    const dry = await reencryptSecrets(h.owner, rotated, { dryRun: true });
    expect(dry[0]!.rewritten).toBe(1);
    expect(dry.flatMap((r) => r.failed)).toEqual([]);
    const real = await reencryptSecrets(h.owner, rotated);
    expect(real[0]).toMatchObject({ rewritten: 1, failed: [] });

    settings.invalidate();
    expect(await settings.getSecret('rotation.test')).toBe('whsec_old_world');
    const stored = await h.owner.query(
      `SELECT value #>> '{}' AS blob FROM platform_settings WHERE key = 'rotation.test'`,
    );
    expect(rotated.isCurrent(stored.rows[0].blob)).toBe(true);
    // A second run finds nothing left to move.
    expect((await reencryptSecrets(h.owner, rotated)).map((r) => r.rewritten)).toEqual([0, 0, 0]);
    await h.owner.query(`DELETE FROM platform_settings WHERE key = 'rotation.test'`);
  });
});
