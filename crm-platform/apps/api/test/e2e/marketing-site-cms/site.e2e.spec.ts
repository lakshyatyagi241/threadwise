import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PlatformSettingsService } from '../../../src/modules/auth';
import { GuidebookService } from '../../../src/modules/marketing-site-cms/guidebook.service';
import { GUIDEBOOK_SEED } from '../../../src/modules/marketing-site-cms/guidebook-seed';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';

/**
 * Announcements, the guidebook and the contact page's company details, end to end through HTTP (WD-CMS-017, 039..041,
 * 044..050, 005). One app, one database; tests that need a clean slate empty the table they use first.
 */
let h: Harness;
const api = () => request(h.app.getHttpServer());
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const totp = (secret: string) => hotp(base32Decode(secret), totpStep(Date.now()));

let superToken = '';
let supportToken = '';
let user = '';
let other = '';
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
  other = await signup('b');
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
describe('guidebook, operator side (WD-CMS-044..046)', () => {
  beforeEach(async () => {
    await h.owner.query(`DELETE FROM guidebook_articles`);
  });
  const article = (body: Record<string, unknown>) => ops('post', '/guidebook').send(body);

  it('a blank slug is built from the title, made unique with -2, and the category defaults to general', async () => {
    const a = await article({ title: 'Reset password' });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(a.body).toMatchObject({
      slug: 'reset-password',
      category: 'general',
      isPublished: false,
    });
    expect((await article({ title: 'Reset password' })).body.slug).toBe('reset-password-2');
    expect((await article({ title: '!!!' })).body.slug).toMatch(/^article-[a-z0-9]{6}$/);
  });

  it('refuses a slug with uppercase letters', async () => {
    const res = await article({ title: 'T', slug: 'Has-Upper' });
    expect(res.status).toBe(422);
  });

  it('published_at is stamped on first publish and kept; the form clears it on unpublish, the toggle keeps it', async () => {
    const a = (await article({ title: 'Dates', isPublished: true })).body;
    expect(a.publishedAt).not.toBeNull();
    const stamped = a.publishedAt as string;
    const edit = (body: Record<string, unknown>, rv: number) =>
      ops('put', `/guidebook/${a.id}`).send({
        title: 'Dates',
        category: 'general',
        sortOrder: 0,
        ...body,
        rowVersion: rv,
      });
    const e1 = (await edit({ isPublished: true, excerpt: 'x' }, a.rowVersion)).body;
    expect(e1.publishedAt).toBe(stamped);
    const e2 = (await edit({ isPublished: false }, e1.rowVersion)).body;
    expect(e2.publishedAt).toBeNull();
    const t1 = (await ops('post', `/guidebook/${a.id}/toggle`).send({})).body;
    expect(t1.isPublished).toBe(true);
    expect(t1.publishedAt).not.toBeNull();
    const t2 = (await ops('post', `/guidebook/${a.id}/toggle`).send({})).body;
    expect(t2.isPublished).toBe(false);
    expect(t2.publishedAt).toBe(t1.publishedAt);
  });

  it('a stale row version is a 409; a changed slug that is taken gets a suffix, never an error', async () => {
    const a = (await article({ title: 'One' })).body;
    const b = (await article({ title: 'Two' })).body;
    const body = {
      title: 'Two',
      category: 'general',
      sortOrder: 0,
      isPublished: false,
      slug: 'one',
    };
    const ok = await ops('put', `/guidebook/${b.id}`).send({ ...body, rowVersion: b.rowVersion });
    expect(ok.body.slug).toBe('one-2');
    const stale = await ops('put', `/guidebook/${a.id}`).send({
      ...body,
      slug: 'one',
      rowVersion: 99,
    });
    expect(stale.status).toBe(409);
  });

  it('lists by category, sort order and title with KPIs, filters and a cursor', async () => {
    for (let i = 0; i < 5; i++) {
      await article({
        title: `A${i}`,
        category: i % 2 ? 'Billing' : 'Basics',
        isPublished: i < 3,
        sortOrder: i,
      });
    }
    const all = (await ops('get', '/guidebook?limit=3')).body;
    expect(all.summary).toMatchObject({ total: 5, published: 3, drafts: 2 });
    expect(all.categories).toEqual(['Basics', 'Billing']);
    expect(all.data.map((x: { category: string }) => x.category)).toEqual([
      'Basics',
      'Basics',
      'Basics',
    ]);
    const next = (await ops('get', `/guidebook?limit=3&cursor=${all.page.nextCursor}`)).body;
    expect(next.data).toHaveLength(2);
    expect((await ops('get', '/guidebook?category=Billing')).body.data).toHaveLength(2);
    expect((await ops('get', '/guidebook?q=A3')).body.data).toHaveLength(1);
  });

  it('delete is audited; writes need a super admin', async () => {
    const a = (await article({ title: 'Gone' })).body;
    expect((await support('delete', `/guidebook/${a.id}`)).status).toBe(403);
    expect((await ops('delete', `/guidebook/${a.id}`)).status).toBe(200);
    expect((await ops('get', `/guidebook/${a.id}`)).status).toBe(404);
    const audit = await events('platform.cms.guidebook_changed');
    expect(audit.some((e) => e.payload.action === 'deleted' && e.payload.title === 'Gone')).toBe(
      true,
    );
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('guidebook starter articles (WD-CMS-050)', () => {
  it('seeds only an empty help centre, once, and never puts back an edited or deleted article', async () => {
    await h.owner.query(`DELETE FROM guidebook_articles`);
    const svc = h.app.get(GuidebookService);
    expect(await svc.seed()).toBe(GUIDEBOOK_SEED.length);
    const rows = await h.owner.query(
      `SELECT is_published, body FROM guidebook_articles ORDER BY sort_order`,
    );
    expect(rows.rows).toHaveLength(GUIDEBOOK_SEED.length);
    expect(rows.rows.every((r: { is_published: boolean }) => r.is_published)).toBe(true);
    expect(rows.rows.some((r: { body: string }) => r.body.includes('{{app}}'))).toBe(false);
    // a second boot adds nothing, and a deleted article stays deleted
    expect(await svc.seed()).toBe(0);
    await h.owner.query(`DELETE FROM guidebook_articles WHERE sort_order = 0`);
    expect(await svc.seed()).toBe(0);
    expect(
      (await h.owner.query(`SELECT count(*)::int AS n FROM guidebook_articles`)).rows[0].n,
    ).toBe(GUIDEBOOK_SEED.length - 1);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('guidebook, in-app (WD-CMS-047..049)', () => {
  beforeEach(async () => {
    await h.owner.query(`DELETE FROM guidebook_articles`);
  });
  const publish = async (title: string, extra: Record<string, unknown> = {}) =>
    (await ops('post', '/guidebook').send({ title, isPublished: true, ...extra })).body as {
      id: string;
      slug: string;
    };

  it('a guest is refused; browse shows published articles, counts that ignore the filter and a search', async () => {
    await publish('Webhook basics', { category: 'Webhooks', body: 'How to verify a signature' });
    await publish('Pay invoices', { category: 'Billing', excerpt: 'Paying' });
    await ops('post', '/guidebook').send({ title: 'Hidden draft', category: 'Billing' });
    expect((await api().get('/v2/cms/guidebook')).status).toBe(401);
    const all = (await as(user, 'get', '/guidebook')).body;
    expect(all.data).toHaveLength(2);
    expect(all.totalPublished).toBe(2);
    const q = (await as(user, 'get', '/guidebook?q=webhook')).body;
    expect(q.data.map((a: { slug: string }) => a.slug)).toEqual(['webhook-basics']);
    expect(q.categories).toEqual([
      { name: 'Billing', count: 1 },
      { name: 'Webhooks', count: 1 },
    ]);
    const c = (await as(user, 'get', '/guidebook?category=Billing')).body;
    expect(c.data).toHaveLength(1);
    expect(c.data[0].readMinutes).toBe(1);
  });

  it('opening an article renders sanitised Markdown and counts a view without touching updated_at', async () => {
    const a = await publish('Safe', { body: '# Hi\n\nA **bold** <script>alert(1)</script> word' });
    const before = await h.owner.query(
      `SELECT updated_at, row_version FROM guidebook_articles WHERE slug = $1`,
      [a.slug],
    );
    const res = await as(user, 'get', `/guidebook/${a.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.bodyHtml).toContain('<h1>Hi</h1>');
    expect(res.body.bodyHtml).toContain('<strong>bold</strong>');
    expect(res.body.bodyHtml).not.toMatch(/<script/i);
    await as(user, 'get', `/guidebook/${a.slug}`);
    const after = await h.owner.query(
      `SELECT views_count, updated_at, row_version FROM guidebook_articles WHERE slug = $1`,
      [a.slug],
    );
    expect(after.rows[0].views_count).toBe(2);
    expect(after.rows[0].updated_at).toEqual(before.rows[0].updated_at);
    expect(after.rows[0].row_version).toBe(before.rows[0].row_version);
  });

  it('a draft or unknown slug is a 404 (the app sends the reader back to the list)', async () => {
    const d = (await ops('post', '/guidebook').send({ title: 'Draft' })).body;
    expect((await as(user, 'get', `/guidebook/${d.slug}`)).status).toBe(404);
    expect((await as(user, 'get', '/guidebook/nope')).status).toBe(404);
    expect(
      (await as(user, 'post', `/guidebook/${d.slug}/vote`).send({ vote: 'helpful' })).status,
    ).toBe(404);
  });

  it('related articles are the same category, other published, at most four', async () => {
    const first = await publish('R0', { category: 'Rel' });
    for (let i = 1; i < 7; i++) await publish(`R${i}`, { category: 'Rel' });
    await publish('Elsewhere', { category: 'Other' });
    const res = await as(user, 'get', `/guidebook/${first.slug}`);
    expect(res.body.related).toHaveLength(4);
    expect(res.body.related.every((r: { category: string }) => r.category === 'Rel')).toBe(true);
    expect(res.body.related.map((r: { slug: string }) => r.slug)).not.toContain(first.slug);
  });

  it('a vote is one per user: voting again changes it, the counters follow, another user adds their own', async () => {
    const a = await publish('Vote me');
    const vote = (token: string, v: string) =>
      as(token, 'post', `/guidebook/${a.slug}/vote`).send({ vote: v });
    const counts = async () =>
      (
        await h.owner.query(
          `SELECT helpful_count h, not_helpful_count n FROM guidebook_articles WHERE slug = $1`,
          [a.slug],
        )
      ).rows[0];
    expect((await vote(user, 'helpful')).body).toEqual({ vote: 'helpful' });
    expect(await counts()).toEqual({ h: 1, n: 0 });
    await vote(user, 'helpful');
    expect(await counts()).toEqual({ h: 1, n: 0 });
    await vote(user, 'not_helpful');
    expect(await counts()).toEqual({ h: 0, n: 1 });
    await vote(other, 'helpful');
    expect(await counts()).toEqual({ h: 1, n: 1 });
    expect((await as(user, 'get', `/guidebook/${a.slug}`)).body.myVote).toBe('not_helpful');
    expect((await as(other, 'get', `/guidebook/${a.slug}`)).body.myVote).toBe('helpful');
    expect((await vote(user, 'maybe')).status).toBe(422);
    const rows = await h.owner.query(`SELECT count(*)::int AS n FROM guidebook_votes`);
    expect(rows.rows[0].n).toBe(2);
  });

  it('votes live in the tenant: a workspace never sees another workspace vote', async () => {
    const a = await publish('Isolation');
    await as(user, 'post', `/guidebook/${a.slug}/vote`).send({ vote: 'helpful' });
    expect((await as(other, 'get', `/guidebook/${a.slug}`)).body.myVote).toBeNull();
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
