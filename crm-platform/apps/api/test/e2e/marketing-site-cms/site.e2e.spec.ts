import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PlatformSettingsService } from '../../../src/modules/auth';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';

/**
 * Announcements and the contact page's company details, end to end through HTTP (WD-CMS-017, 039..041,
 * 044..050, 005). One app, one database; tests that need a clean slate empty the table they use first.
 */
let h: Harness;
const api = () => request(h.app.getHttpServer());
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const totp = (secret: string) => hotp(base32Decode(secret), totpStep(Date.now()));

let superToken = '';
let supportToken = '';
let user = '';
let ipCounter = 10;
const nextIp = () => `10.8.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`;

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
const ops = (method: Method, path: string) =>
  api()[method](`/v2/platform/cms${path}`).set(bearer(superToken));
const support = (method: Method, path: string) =>
  api()[method](`/v2/platform/cms${path}`).set(bearer(supportToken));
const as = (token: string, method: Method, path: string) =>
  api()[method](`/v2/cms${path}`).set(bearer(token));

const events = async (like: string) =>
  (
    await h.owner.query(
      `SELECT event, payload FROM security_events WHERE event LIKE $1 ORDER BY id`,
      [like],
    )
  ).rows as Array<{ event: string; payload: Record<string, unknown> }>;

async function signup(tag: string): Promise<string> {
  const res = await api()
    .post('/v2/auth/signup')
    .set('x-forwarded-for', nextIp())
    .send({
      orgName: `Site Org ${tag}`,
      fullName: 'Site Person',
      email: `site${tag}${Date.now()}@example.test`,
      password: 'Sup3r!Secret#2026',
      acceptTerms: true,
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.tokens.accessToken as string;
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
  superToken = token;
  const sup = await api()
    .post('/v2/platform/auth/login')
    .send({ email: 'support@platform.test', password: OPERATOR_PASSWORD });
  supportToken = sup.body.tokens.accessToken as string;
  user = await signup('a');
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

const hours = (n: number) => new Date(Date.now() + n * 3_600_000).toISOString();
const make = (body: Record<string, unknown>) => ops('post', '/announcements').send(body);

// ---------------------------------------------------------------------------------------------------------------------
describe('announcements (WD-CMS-017, 039..041)', () => {
  beforeEach(async () => {
    await h.owner.query(`DELETE FROM announcements`);
  });

  it('text only: tone info, active, dismissible and sort 0 are stored and it is live at once', async () => {
    const res = await make({ text: 'Hello' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      text: 'Hello',
      tone: 'info',
      isActive: true,
      dismissible: true,
      sortOrder: 0,
      status: 'live',
    });
    const live = await api().get('/v2/public/cms/announcements');
    expect(live.body.data).toHaveLength(1);
    expect(live.body.data[0]).toMatchObject({ text: 'Hello', tone: 'info', dismissible: true });
    // the in-app bar shows the same rows
    expect((await as(user, 'get', '/announcements')).body.data).toHaveLength(1);
  });

  it('refuses an expiry before the start, text over 500 characters and a javascript: link', async () => {
    const bad = await make({ text: 'x', startsAt: hours(5), expiresAt: hours(1) });
    expect(bad.status).toBe(422);
    expect(JSON.stringify(bad.body)).toContain('expiresAt');
    expect((await make({ text: 'x'.repeat(501) })).status).toBe(422);
    expect((await make({ text: 'x', linkUrl: 'javascript:alert(1)' })).status).toBe(422);
    expect((await make({ text: 'x', linkUrl: '/pricing', linkLabel: 'See' })).status).toBe(201);
  });

  it('a future start is Scheduled and not shown; an expired row is not shown; the order is sort_order then id', async () => {
    await make({ text: 'later', startsAt: hours(2) });
    await make({ text: 'gone', startsAt: hours(-5), expiresAt: hours(-1) });
    await make({ text: 'second', sortOrder: 5 });
    await make({ text: 'first', sortOrder: 1 });
    const live = (await api().get('/v2/public/cms/announcements')).body.data as Array<{
      text: string;
    }>;
    expect(live.map((a) => a.text)).toEqual(['first', 'second']);
    const list = (await ops('get', '/announcements')).body;
    expect(list.summary).toEqual({ total: 4, live: 2, scheduled: 1, expired: 1, switchedOn: 4 });
    expect(list.data.map((a: { text: string }) => a.text)).toEqual([
      'gone',
      'later',
      'first',
      'second',
    ]);
  });

  it('filters: Live now, Disabled and Expired (which ignores the switch, so a disabled expired row shows in both)', async () => {
    await make({ text: 'live one' });
    const off = (await make({ text: 'off one', isActive: false })).body;
    const both = (
      await make({ text: 'old', startsAt: hours(-5), expiresAt: hours(-1), isActive: false })
    ).body;
    const texts = async (status: string) =>
      ((await ops('get', `/announcements?status=${status}`)).body.data as Array<{ text: string }>)
        .map((a) => a.text)
        .sort();
    expect(await texts('active')).toEqual(['live one']);
    expect(await texts('inactive')).toEqual(['off one', 'old']);
    expect(await texts('expired')).toEqual(['old']);
    expect(off.status).toBe('disabled');
    expect(both.status).toBe('disabled');
    expect(await texts('bogus')).toHaveLength(3);
  });

  it('search matches text or link label literally and paginates by cursor', async () => {
    for (let i = 0; i < 5; i++) await make({ text: `n${i}`, sortOrder: i });
    await make({ text: '100% off', linkLabel: 'promo' });
    expect(
      (await ops('get', `/announcements?q=${encodeURIComponent('%')}`)).body.data,
    ).toHaveLength(1);
    expect((await ops('get', '/announcements?q=PROMO')).body.data).toHaveLength(1);
    const p1 = (await ops('get', '/announcements?limit=4')).body;
    expect(p1.data).toHaveLength(4);
    expect(p1.page.hasMore).toBe(true);
    const p2 = (await ops('get', `/announcements?limit=4&cursor=${p1.page.nextCursor}`)).body;
    expect(p2.data).toHaveLength(2);
    const ids = [...p1.data, ...p2.data].map((a: { id: string }) => a.id);
    expect(new Set(ids).size).toBe(6);
  });

  it('toggle takes it off the bar at once, edit is guarded by the row version, delete is audited', async () => {
    const a = (await make({ text: 'bar' })).body;
    const t = await ops('post', `/announcements/${a.id}/toggle`).send({ rowVersion: a.rowVersion });
    expect(t.body.isActive).toBe(false);
    expect((await api().get('/v2/public/cms/announcements')).body.data).toHaveLength(0);

    const stale = await ops('put', `/announcements/${a.id}`).send({
      text: 'edited',
      rowVersion: a.rowVersion,
    });
    expect(stale.status).toBe(409);
    const ok = await ops('put', `/announcements/${a.id}`).send({
      text: 'edited',
      isActive: true,
      rowVersion: t.body.rowVersion,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.text).toBe('edited');

    expect((await ops('delete', `/announcements/${a.id}`)).status).toBe(200);
    expect((await ops('get', `/announcements/${a.id}`)).status).toBe(404);
    const audit = (await events('platform.cms.announcement_changed')).map((e) => e.payload.action);
    expect(audit).toEqual(expect.arrayContaining(['created', 'disabled', 'updated', 'deleted']));
  });

  it('only a super admin writes; support reads; the in-app route needs a workspace user', async () => {
    expect((await support('get', '/announcements')).status).toBe(200);
    expect((await support('post', '/announcements').send({ text: 'x' })).status).toBe(403);
    expect((await api().get('/v2/cms/announcements')).status).toBe(401);
    expect((await api().get('/v2/platform/cms/announcements')).status).toBe(401);
  });

  it('the stored instant keeps its zone: a wall time in another zone is not shifted', async () => {
    const res = await make({ text: 'zone', startsAt: '2030-01-01T09:00:00+05:30' });
    expect(res.body.startsAt).toBe('2030-01-01T03:30:00.000Z');
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('contact page details (WD-CMS-005)', () => {
  it('the public site info carries only non-secret company fields and a support mailbox', async () => {
    await h.owner.query(
      `INSERT INTO platform_settings (key, value, is_secret) VALUES ('set.site', $1, false)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [
        JSON.stringify({
          companyName: 'Acme',
          whatsapp: '+91 98765-43210',
          emailSupport: 'help@acme.test',
          _rv: 1,
        }),
      ],
    );
    h.app.get(PlatformSettingsService, { strict: false }).invalidate();
    try {
      const res = await api().get('/v2/public/cms/site-info').set('x-forwarded-for', nextIp());
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        companyName: 'Acme',
        whatsapp: '919876543210',
        emailSupport: 'help@acme.test',
        address: '',
      });
      expect(Object.keys(res.body).sort()).toEqual([
        'address',
        'cityCountry',
        'companyName',
        'emailGeneral',
        'emailSupport',
        'phone',
        'whatsapp',
      ]);
    } finally {
      await h.owner.query(`DELETE FROM platform_settings WHERE key = 'set.site'`);
    }
  });
});
