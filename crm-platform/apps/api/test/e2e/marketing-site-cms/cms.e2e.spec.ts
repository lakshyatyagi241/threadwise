import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  LEGAL_SLUGS,
  type OperatorContentResponse,
  type PublicContentResponse,
} from '@crm/contracts';
import { PlatformSettingsService } from '../../../src/modules/auth';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import {
  MAIL_PORT,
  type MailPort,
} from '../../../src/infra/providers/auth-registration-security/mail.port';
import {
  OPERATOR_EMAIL,
  OPERATOR_PASSWORD,
  startHarness,
  type Harness,
} from '../auth-registration-security/harness';

/**
 * The marketing-site domain end to end through HTTP: the page editor's draft/publish model, the homepage switch, legal
 * pages, the blog, the contact form and inbox, and the public pricing cards. One app, one database. Tests that need a
 * clean slate empty the tables they use first.
 */
let h: Harness;
const api = () => request(h.app.getHttpServer());
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const totp = (secret: string) => hotp(base32Decode(secret), totpStep(Date.now()));

let superToken = '';
let supportToken = '';

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
/** A request as the super admin to /v2/platform/cms/... */
const ops = (method: Method, path: string) =>
  api()[method](`/v2/platform/cms${path}`).set(bearer(superToken));
/** The same as the read-only support operator. */
const support = (method: Method, path: string) =>
  api()[method](`/v2/platform/cms${path}`).set(bearer(supportToken));
let ipCounter = 10;
const nextIp = () => `10.9.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}`;
/** A visitor request from its own address, so the contact throttle of one test never reaches another. */
const pub = (method: 'get' | 'post', path: string, ip = nextIp()) =>
  api()[method](`/v2/public/cms${path}`).set('x-forwarded-for', ip);

const publicContent = async () => (await pub('get', '/content')).body as PublicContentResponse;
const operatorContent = async () => (await ops('get', '/content')).body as OperatorContentResponse;
const entryOf = async (key: string) => (await operatorContent()).entries.find((e) => e.key === key);
const saveDraft = (entries: Array<{ key: string; value: string; rowVersion?: number }>) =>
  ops('put', '/content/draft').send({ entries });

const events = async (like: string) =>
  (
    await h.owner.query(
      `SELECT event, actor_type, status, payload FROM security_events WHERE event LIKE $1 ORDER BY id`,
      [like],
    )
  ).rows as Array<{
    event: string;
    actor_type: string;
    status: string;
    payload: Record<string, unknown>;
  }>;

const errorPaths = (body: { errors?: Array<{ path: string }> }) =>
  (body.errors ?? []).map((e) => e.path);

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
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

// ---------------------------------------------------------------------------------------------------------------------
describe('access', () => {
  it('operator routes refuse an anonymous caller and a workspace-less token', async () => {
    expect((await api().get('/v2/platform/cms/content')).status).toBe(401);
    expect((await api().get('/v2/platform/cms/blog')).status).toBe(401);
    expect((await api().get('/v2/platform/cms/legal')).status).toBe(401);
    expect((await api().get('/v2/platform/cms/contact-messages')).status).toBe(401);
  });

  it('every operator role reads; only a super admin writes', async () => {
    expect((await support('get', '/content')).status).toBe(200);
    const denied = await support('put', '/content/draft').send({
      entries: [{ key: 'home.hero.eyebrow', value: 'x' }],
    });
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('AUTH_OPERATOR_ROLE_REQUIRED');
    expect((await support('post', '/content/publish').send({})).status).toBe(403);
    expect((await support('put', '/content/homepage').send({ enabled: false })).status).toBe(403);
  });

  it('the public endpoints need no sign-in', async () => {
    for (const path of ['/content', '/pricing', '/legal', '/blog', '/sitemap']) {
      expect((await pub('get', path)).status, path).toBe(200);
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('content store: draft, publish, discard, reset (TW-CMS-008, 019, 024..026)', () => {
  beforeEach(async () => {
    await h.owner.query(`DELETE FROM frontend_content`);
    await h.owner.query(`DELETE FROM platform_settings WHERE key = 'cms.frontend_enabled'`);
  });

  it('with no rows, a visitor gets nothing stored (every page falls back to its shipped defaults)', async () => {
    const c = await publicContent();
    expect(c.values).toEqual({});
    expect(c.hidden).toEqual({});
    expect(c.order).toEqual({});
    expect(c.homepageEnabled).toBe(true);
    expect(c.brandName).toBe('Test CRM');
  });

  it('a draft is visible to the operator and not to visitors until it is published', async () => {
    const res = await saveDraft([{ key: 'home.hero.headline', value: '<b>New</b> headline' }]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.entries[0]).toMatchObject({
      key: 'home.hero.headline',
      draft: '<b>New</b> headline',
      published: null,
      rowVersion: 1,
    });

    expect((await publicContent()).values).toEqual({});
    const op = await operatorContent();
    expect(op.pending).toBe(1);
    expect(op.entries).toHaveLength(1);

    const pub1 = await ops('post', '/content/publish').send({});
    expect(pub1.body).toEqual({ count: 1 });
    expect((await publicContent()).values).toEqual({ 'home.hero.headline': '<b>New</b> headline' });
    expect((await operatorContent()).pending).toBe(0);
  });

  it('publishing with nothing pending reports 0 and changes nothing', async () => {
    expect((await ops('post', '/content/publish').send({})).body).toEqual({ count: 0 });
  });

  it('refuses an invalid colour, an unsafe link, an unknown key and a layout key, and saves nothing', async () => {
    const bad = await saveDraft([
      { key: 'theme.brand.deep', value: '#12' },
      { key: 'nav.link2_url', value: 'javascript:alert(1)' },
      { key: 'home.hero.nope', value: 'x' },
      { key: 'bad key!', value: 'x' },
      { key: 'home.__hidden', value: '["faq"]' },
    ]);
    expect(bad.status).toBe(422);
    expect(errorPaths(bad.body)).toEqual([
      'entries.0.value',
      'entries.1.value',
      'entries.2.value',
      'entries.3.value',
      'entries.4.value',
    ]);
    expect((await operatorContent()).entries).toHaveLength(0);
  });

  it('accepts a valid colour and a valid link and sanitises rich text', async () => {
    const res = await saveDraft([
      { key: 'theme.brand.deep', value: '#0A1B2C' },
      { key: 'nav.link2_url', value: 'https://example.com/features' },
      { key: 'home.hero.headline', value: 'Hi <script>alert(1)</script><em>there</em>' },
    ]);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const headline = res.body.entries.find((e: { key: string }) => e.key === 'home.hero.headline');
    expect(headline.draft).toBe('Hi <em>there</em>');
  });

  it('saving an empty value stores "use the default"; publishing it leaves no row behind', async () => {
    await saveDraft([{ key: 'home.hero.eyebrow', value: '   ' }]);
    expect((await entryOf('home.hero.eyebrow'))?.draft).toBe('');
    expect((await ops('post', '/content/publish').send({})).body).toEqual({ count: 0 });
    expect(await entryOf('home.hero.eyebrow')).toBeUndefined();
  });

  it('a stale rowVersion is a 409 and the newer value survives', async () => {
    await saveDraft([{ key: 'home.hero.eyebrow', value: 'one' }]);
    const e1 = (await entryOf('home.hero.eyebrow'))!;
    expect(
      (await saveDraft([{ key: 'home.hero.eyebrow', value: 'two', rowVersion: e1.rowVersion }]))
        .status,
    ).toBe(200);
    const stale = await saveDraft([
      { key: 'home.hero.eyebrow', value: 'three', rowVersion: e1.rowVersion },
    ]);
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ROW_VERSION_CONFLICT');
    expect((await entryOf('home.hero.eyebrow'))?.draft).toBe('two');
  });

  it('a page-scoped publish only publishes that page; "all" publishes everything', async () => {
    await saveDraft([
      { key: 'home.hero.eyebrow', value: 'H' },
      { key: 'features.hero.eyebrow', value: 'F' },
      { key: 'theme.brand.deep', value: '#111111' },
      { key: 'nav.cta_label', value: 'Join' },
    ]);
    expect((await ops('post', '/content/publish').send({ scope: 'home' })).body).toEqual({
      count: 1,
    });
    expect((await publicContent()).values).toEqual({ 'home.hero.eyebrow': 'H' });
    expect((await ops('post', '/content/publish').send({ scope: 'theme' })).body).toEqual({
      count: 1,
    });
    expect((await ops('post', '/content/publish').send({ scope: 'site' })).body).toEqual({
      count: 1,
    });
    expect((await ops('post', '/content/publish').send({})).body).toEqual({ count: 1 });
    expect(Object.keys((await publicContent()).values).sort()).toEqual([
      'features.hero.eyebrow',
      'home.hero.eyebrow',
      'nav.cta_label',
      'theme.brand.deep',
    ]);
  });

  it('an unknown scope is a 422', async () => {
    expect((await ops('post', '/content/publish').send({ scope: 'bogus' })).status).toBe(422);
    expect((await ops('post', '/content/discard').send({ scope: 'bogus' })).status).toBe(422);
  });

  it('discard puts a live key back to its live value and removes a never-published draft', async () => {
    await saveDraft([{ key: 'home.hero.eyebrow', value: 'live' }]);
    await ops('post', '/content/publish').send({});
    await saveDraft([
      { key: 'home.hero.eyebrow', value: 'edited' },
      { key: 'home.hero.subtitle', value: 'never published' },
    ]);
    expect((await ops('post', '/content/discard').send({})).body).toEqual({ count: 2 });
    expect(await entryOf('home.hero.subtitle')).toBeUndefined();
    expect(await entryOf('home.hero.eyebrow')).toMatchObject({ draft: 'live', published: 'live' });
    expect((await publicContent()).values).toEqual({ 'home.hero.eyebrow': 'live' });
    expect((await operatorContent()).pending).toBe(0);
  });

  it('reset is a draft: live copy stays until Publish, and Discard undoes it', async () => {
    await saveDraft([{ key: 'home.hero.eyebrow', value: 'live' }]);
    await ops('post', '/content/publish').send({});

    expect((await ops('post', '/content/reset').send({ key: 'home.hero.eyebrow' })).body).toEqual({
      count: 1,
    });
    expect((await publicContent()).values).toEqual({ 'home.hero.eyebrow': 'live' });
    expect((await operatorContent()).pending).toBe(1);

    await ops('post', '/content/discard').send({});
    expect(await entryOf('home.hero.eyebrow')).toMatchObject({ draft: 'live' });

    await ops('post', '/content/reset').send({ key: 'home.hero.eyebrow' });
    expect((await ops('post', '/content/publish').send({})).body).toEqual({ count: 1 });
    expect((await publicContent()).values).toEqual({});
    expect(await entryOf('home.hero.eyebrow')).toBeUndefined();
  });

  it('reset by scope covers only that scope; both a key and a scope, or neither, is a 422', async () => {
    await saveDraft([
      { key: 'theme.brand.deep', value: '#111111' },
      { key: 'theme.ink.900', value: '#222222' },
      { key: 'home.hero.eyebrow', value: 'x' },
    ]);
    expect((await ops('post', '/content/reset').send({ scope: 'theme' })).body).toEqual({
      count: 2,
    });
    expect((await entryOf('home.hero.eyebrow'))?.draft).toBe('x');
    expect((await ops('post', '/content/reset').send({ scope: 'theme', key: 'x.y' })).status).toBe(
      422,
    );
    expect((await ops('post', '/content/reset').send({})).status).toBe(422);
    expect((await ops('post', '/content/reset').send({ key: 'home.hero.unknown' })).status).toBe(
      422,
    );
  });

  it('brand presets write seven drafts and an unknown preset is a 422', async () => {
    const ocean = await ops('post', '/content/preset').send({ preset: 'ocean' });
    expect(ocean.status).toBe(201);
    expect(Object.keys(ocean.body.tokens)).toHaveLength(7);
    const op = await operatorContent();
    expect(op.entries).toHaveLength(7);
    expect(op.entries.every((e) => e.key.startsWith('theme.') && e.published === null)).toBe(true);
    expect((await publicContent()).values).toEqual({});
    const bad = await ops('post', '/content/preset').send({ preset: 'nope' });
    expect(bad.status).toBe(422);
    expect(JSON.stringify(bad.body)).toContain('Unknown preset');
  });

  it('every editor action leaves an audit event written by the operator', async () => {
    await h.owner.query(`DELETE FROM security_events WHERE event LIKE 'platform.cms.%'`);
    await saveDraft([{ key: 'home.hero.eyebrow', value: 'a' }]);
    await ops('post', '/content/publish').send({});
    await ops('post', '/content/reset').send({ scope: 'home' });
    await ops('post', '/content/discard').send({});
    const rows = await events('platform.cms.%');
    expect(rows.map((r) => r.event)).toEqual([
      'platform.cms.draft_saved',
      'platform.cms.published',
      'platform.cms.reset',
      'platform.cms.discarded',
    ]);
    expect(rows.every((r) => r.actor_type === 'platform_operator' && r.status === 'success')).toBe(
      true,
    );
    expect(rows[1]!.payload).toMatchObject({ scope: 'all', count: 1 });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('sections: hide and reorder (TW-CMS-009, 022, 023)', () => {
  beforeEach(async () => {
    await h.owner.query(`DELETE FROM frontend_content`);
  });

  it('hiding a section is a draft and applies publicly after publish', async () => {
    const res = await ops('put', '/content/layout').send({ page: 'home', hidden: ['highlights'] });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toEqual({ hidden: ['highlights'], order: [] });
    expect((await publicContent()).hidden).toEqual({});
    await ops('post', '/content/publish').send({});
    expect((await publicContent()).hidden).toEqual({ home: ['highlights'] });
  });

  it('the pinned hero cannot be hidden and a slug from another page is unknown', async () => {
    const hero = await ops('put', '/content/layout').send({ page: 'home', hidden: ['hero'] });
    expect(hero.status).toBe(422);
    expect(JSON.stringify(hero.body)).toContain('This section cannot be hidden');
    const other = await ops('put', '/content/layout').send({ page: 'home', hidden: ['pillars'] });
    expect(other.status).toBe(422);
    expect(JSON.stringify(other.body)).toContain('Unknown section');
    expect((await operatorContent()).entries).toHaveLength(0);
  });

  it('a reorder keeps only removable slugs of the page, once each', async () => {
    const res = await ops('put', '/content/layout').send({
      page: 'home',
      order: ['hero', 'faq', 'pillars', 'pricing-strip', 'faq'],
    });
    expect(res.body.order).toEqual(['faq', 'pricing-strip']);
    await ops('post', '/content/publish').send({});
    expect((await publicContent()).order).toEqual({ home: ['faq', 'pricing-strip'] });
  });

  it('an unknown page and an empty body are refused', async () => {
    expect((await ops('put', '/content/layout').send({ page: 'blog', hidden: [] })).status).toBe(
      422,
    );
    expect((await ops('put', '/content/layout').send({ page: 'home' })).status).toBe(422);
  });

  it('un-hiding saves an empty list and publishing it removes the layout row', async () => {
    await ops('put', '/content/layout').send({ page: 'home', hidden: ['faq'] });
    await ops('post', '/content/publish').send({});
    await ops('put', '/content/layout').send({ page: 'home', hidden: [] });
    await ops('post', '/content/publish').send({});
    expect((await publicContent()).hidden).toEqual({ home: [] });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('homepage switch (TW-CMS-001, 028)', () => {
  it('turning it off is live at once and does not touch the other pages; turning it on restores it', async () => {
    expect((await ops('put', '/content/homepage').send({ enabled: false })).body).toEqual({
      enabled: false,
    });
    expect((await publicContent()).homepageEnabled).toBe(false);
    expect((await operatorContent()).homepageEnabled).toBe(false);
    expect((await pub('get', '/pricing')).status).toBe(200);
    expect((await pub('get', '/legal/terms')).status).toBe(200);
    expect((await pub('get', '/blog')).status).toBe(200);
    expect((await ops('put', '/content/homepage').send({ enabled: true })).body).toEqual({
      enabled: true,
    });
    expect((await publicContent()).homepageEnabled).toBe(true);
    const log = await events('platform.cms.homepage_toggled');
    expect(log.map((e) => e.payload.enabled)).toEqual([false, true]);
  });

  it('refuses a non-boolean', async () => {
    expect((await ops('put', '/content/homepage').send({ enabled: 'no' })).status).toBe(422);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('legal pages (TW-CMS-013, 033..036)', () => {
  const get = async (slug: string) => (await ops('get', `/legal/${slug}`)).body;
  const body = (page: { sections: unknown[] }, over: Record<string, unknown> = {}) => ({
    title: 'Terms',
    subtitle: ' ',
    updatedLabel: ' March 14, 2026 ',
    effectiveLabel: '',
    isPublished: true,
    sections: page.sections,
    ...over,
  });

  it('the five canonical pages exist, seeded once at start-up from the templates, in order', async () => {
    const res = await ops('get', '/legal');
    expect(res.status).toBe(200);
    expect(res.body.data.map((p: { slug: string }) => p.slug)).toEqual([...LEGAL_SLUGS]);
    expect(res.body.data.map((p: { sections: unknown[] }) => p.sections.length)).toEqual([
      9, 7, 5, 5, 6,
    ]);
    expect(res.body.data.every((p: { isPublished: boolean }) => p.isPublished)).toBe(true);
    // Idempotent: a second seed creates nothing and never overwrites an edit.
    const before = await h.owner.query(`SELECT count(*)::int AS n FROM legal_pages`);
    expect(before.rows[0].n).toBe(5);
  });

  it('a visitor sees title, dates, numbered sections and a read time', async () => {
    const page = await get('terms');
    await ops('put', '/legal/terms').send(
      body(page, {
        subtitle: 'The rules',
        effectiveLabel: 'May 1, 2026',
        sections: [
          { n: 'A', title: 'First', body: '<p>one</p>' },
          { n: 'B', title: 'Second', body: '<p>two</p>' },
        ].map((s) => s),
        rowVersion: page.rowVersion,
      }),
    );
    const res = await pub('get', '/legal/terms');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      slug: 'terms',
      title: 'Terms',
      subtitle: 'The rules',
      updatedLabel: 'March 14, 2026',
      effectiveLabel: 'May 1, 2026',
      readMinutes: 3,
    });
    expect(res.body.sections.map((s: { n: string }) => s.n)).toEqual(['A', 'B']);
  });

  it('saving rebuilds sections: empty rows are dropped, blank numbers become 02, 03, bodies are sanitised', async () => {
    const page = await get('privacy');
    const res = await ops('put', '/legal/privacy').send(
      body(page, {
        title: 'Privacy',
        rowVersion: page.rowVersion,
        sections: [
          { n: '1', title: 'One', body: '<p>a</p><script>alert(1)</script>' },
          { n: '', title: 'Two', body: '<p>b</p>' },
          { n: '', title: '', body: '' },
          { n: '', title: 'Four', body: '<p onclick="x()">d</p>' },
        ],
      }),
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.sections).toEqual([
      { n: '1', title: 'One', body: '<p>a</p>' },
      { n: '02', title: 'Two', body: '<p>b</p>' },
      { n: '03', title: 'Four', body: '<p>d</p>' },
    ]);
    expect(res.body).toMatchObject({
      subtitle: null,
      effectiveLabel: null,
      updatedLabel: 'March 14, 2026',
    });
    expect(res.body.rowVersion).toBe(page.rowVersion + 1);
  });

  it('a stale rowVersion is a 409; an unknown slug is a 404; a non-super operator is a 403', async () => {
    const page = await get('refund');
    const ok = await ops('put', '/legal/refund').send(
      body(page, { title: 'Refunds', rowVersion: page.rowVersion }),
    );
    expect(ok.status).toBe(200);
    const stale = await ops('put', '/legal/refund').send(
      body(page, { title: 'Again', rowVersion: page.rowVersion }),
    );
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ROW_VERSION_CONFLICT');
    expect((await ops('get', '/legal/data-processing')).status).toBe(404);
    expect(
      (await ops('put', '/legal/data-processing').send(body(page, { rowVersion: 1 }))).status,
    ).toBe(404);
    expect(
      (await support('put', '/legal/refund').send(body(page, { rowVersion: ok.body.rowVersion })))
        .status,
    ).toBe(403);
  });

  it('refuses an empty title and more than 60 sections', async () => {
    const page = await get('cookies');
    expect(
      (
        await ops('put', '/legal/cookies').send(
          body(page, { title: '  ', rowVersion: page.rowVersion }),
        )
      ).status,
    ).toBe(422);
    const many = Array.from({ length: 61 }, (_, i) => ({ n: String(i), title: 't', body: '' }));
    expect(
      (
        await ops('put', '/legal/cookies').send(
          body(page, { sections: many, rowVersion: page.rowVersion }),
        )
      ).status,
    ).toBe(422);
  });

  it('unpublishing hides it publicly (404), is audited, and republishing brings it back', async () => {
    await h.owner.query(`DELETE FROM security_events WHERE event LIKE 'platform.cms.legal_%'`);
    const page = await get('acceptable-use');
    const off = await ops('put', '/legal/acceptable-use').send(
      body(page, { title: page.title, isPublished: false, rowVersion: page.rowVersion }),
    );
    expect(off.body.isPublished).toBe(false);
    expect((await pub('get', '/legal/acceptable-use')).status).toBe(404);
    expect(
      (await pub('get', '/legal')).body.data.map((p: { slug: string }) => p.slug),
    ).not.toContain('acceptable-use');
    const log = await events('platform.cms.legal_updated');
    expect(log).toHaveLength(1);
    expect(log[0]!.payload).toMatchObject({ slug: 'acceptable-use', isPublished: false });

    const on = await ops('post', '/legal/acceptable-use/toggle').send({});
    expect(on.body.isPublished).toBe(true);
    expect((await pub('get', '/legal/acceptable-use')).status).toBe(200);
    expect((await events('platform.cms.legal_toggled'))[0]!.payload).toMatchObject({
      slug: 'acceptable-use',
      isPublished: true,
    });
    expect((await ops('post', '/legal/nope/toggle').send({})).status).toBe(404);
  });

  it('only the five slugs are routable; a missing row falls back to the template, a hidden row is a 404', async () => {
    expect((await pub('get', '/legal/data-processing')).status).toBe(404);
    expect((await pub('get', '/legal/..%2Fadmin')).status).toBe(404);
    await h.owner.query(`DELETE FROM legal_pages WHERE slug = 'cookies'`);
    const res = await pub('get', '/legal/cookies');
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Cookie Policy');
    expect(res.body.sections.map((s: { n: string }) => s.n)).toEqual([
      '01',
      '02',
      '03',
      '04',
      '05',
    ]);
  });

  it('bodies written outside the API are sanitised again when served', async () => {
    await h.owner.query(`UPDATE legal_pages SET sections = $1::jsonb WHERE slug = 'terms'`, [
      JSON.stringify([
        {
          n: '1',
          title: 'x',
          body: '<p>ok</p><script>steal()</script><img src=x onerror=alert(1)>',
        },
      ]),
    ]);
    const res = await pub('get', '/legal/terms');
    const served = res.body.sections[0].body as string;
    expect(served).toContain('<p>ok</p>');
    expect(served).not.toMatch(/<script|onerror|steal/i);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('blog (TW-CMS-011, 012, 014, 029..032)', () => {
  beforeEach(async () => {
    await h.owner.query(`DELETE FROM blog_posts`);
    await h.owner.query(`DELETE FROM blog_categories`);
  });
  const DAY = 86_400_000;
  const post = async (over: Record<string, unknown> = {}) => {
    const res = await ops('post', '/blog').send({ title: 'A post', ...over });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  };

  it('a title only creates a draft with a generated slug and no public visibility', async () => {
    const p = await post({ title: 'Hello World' });
    expect(p).toMatchObject({
      slug: 'hello-world',
      status: 'draft',
      publishedAt: null,
      live: false,
      views: 0,
      tags: [],
      rowVersion: 1,
    });
    const list = await pub('get', '/blog');
    expect(list.body.data).toEqual([]);
    expect((await pub('get', '/blog/hello-world')).status).toBe(404);
  });

  it('the same title gets -2, -3; a supplied slug is slugified and also kept unique', async () => {
    expect((await post({ title: 'Same' })).slug).toBe('same');
    expect((await post({ title: 'Same' })).slug).toBe('same-2');
    expect((await post({ title: 'Same' })).slug).toBe('same-3');
    expect((await post({ title: 'X', slug: 'My Custom Slug!' })).slug).toBe('my-custom-slug');
    expect((await post({ title: 'Y', slug: 'my-custom-slug' })).slug).toBe('my-custom-slug-2');
    expect((await post({ title: '???' })).slug).toBe('post');
  });

  it('an inline category is created and assigned; typing an existing name reuses it', async () => {
    const a = await post({ title: 'One', newCategory: 'Guides' });
    expect(a.category).toMatchObject({ name: 'Guides', slug: 'guides' });
    const b = await post({ title: 'Two', newCategory: 'guides' });
    expect(b.category.id).toBe(a.category.id);
    const cats = await ops('get', '/blog/categories');
    expect(cats.body.data).toHaveLength(1);
    const c = await post({ title: 'Three', categoryId: a.category.id, newCategory: 'News' });
    expect(c.category.name).toBe('News');
    const unknown = await ops('post', '/blog').send({
      title: 'Four',
      categoryId: '00000000-0000-4000-8000-000000000000',
    });
    expect(unknown.status).toBe(422);
  });

  it('tags are stored as given, deduplicated; empty tags store nothing', async () => {
    expect((await post({ tags: ['a', 'b', 'a', 'c'] })).tags).toEqual(['a', 'b', 'c']);
    expect((await post({ tags: [] })).tags).toEqual([]);
    expect((await ops('post', '/blog').send({ title: 't', tags: [' '] })).status).toBe(422);
  });

  it('validates fields: title, image address, canonical url, status', async () => {
    expect((await ops('post', '/blog').send({ title: '' })).status).toBe(422);
    expect(
      (await ops('post', '/blog').send({ title: 'x', featuredImage: 'javascript:alert(1)' }))
        .status,
    ).toBe(422);
    expect(
      (await ops('post', '/blog').send({ title: 'x', featuredImage: 'data:image/png;base64,AAAA' }))
        .status,
    ).toBe(422);
    expect(
      (await ops('post', '/blog').send({ title: 'x', canonicalUrl: 'not a url' })).status,
    ).toBe(422);
    expect((await ops('post', '/blog').send({ title: 'x', status: 'archived' })).status).toBe(422);
    expect((await ops('post', '/blog').send({ title: 'x', excerpt: 'e'.repeat(501) })).status).toBe(
      422,
    );
    expect(
      (await post({ title: 'ok', featuredImage: 'https://cdn.example.com/a.png' })).featuredImage,
    ).toBe('https://cdn.example.com/a.png');
  });

  it('publishing stamps the date now and the post appears; the body is sanitised', async () => {
    const p = await post({
      title: 'Live',
      status: 'published',
      body: '<h2>Hi</h2><script>alert(1)</script><p>text</p>',
    });
    expect(p.live).toBe(true);
    expect(p.publishedAt).not.toBeNull();
    expect(p.body).toBe('<h2>Hi</h2><p>text</p>');
    const res = await pub('get', '/blog/live');
    expect(res.status).toBe(200);
    expect(res.body.body).toBe('<h2>Hi</h2><p>text</p>');
    expect((await pub('get', '/blog')).body.data.map((c: { slug: string }) => c.slug)).toEqual([
      'live',
    ]);
  });

  it('a future publish date schedules: saved as published, hidden until the time comes', async () => {
    const when = new Date(Date.now() + 2 * DAY).toISOString();
    const p = await post({ title: 'Soon', status: 'published', publishedAt: when });
    expect(p).toMatchObject({ status: 'published', live: false });
    expect((await pub('get', '/blog')).body.data).toEqual([]);
    expect((await pub('get', '/blog/soon')).status).toBe(404);
    expect((await pub('get', '/sitemap')).body.posts).toEqual([]);
    // The time passes: nothing runs, the read simply evaluates the date.
    await h.owner.query(
      `UPDATE blog_posts SET published_at = now() - interval '1 minute' WHERE slug = 'soon'`,
    );
    expect((await pub('get', '/blog/soon')).status).toBe(200);
    expect((await pub('get', '/blog')).body.data).toHaveLength(1);
  });

  it('toggle: publish stamps an empty date, unpublish keeps it, republish restores the original date', async () => {
    const d = await post({ title: 'Toggle' });
    const on = await ops('post', `/blog/${d.id}/toggle`).send({});
    expect(on.body).toMatchObject({ status: 'published', live: true });
    expect(on.body.publishedAt).not.toBeNull();
    expect((await pub('get', '/blog/toggle')).status).toBe(200);
    const off = await ops('post', `/blog/${d.id}/toggle`).send({});
    expect(off.body).toMatchObject({ status: 'draft', publishedAt: on.body.publishedAt });
    expect((await pub('get', '/blog/toggle')).status).toBe(404);
    const again = await ops('post', `/blog/${d.id}/toggle`).send({});
    expect(again.body.publishedAt).toBe(on.body.publishedAt);
    expect(
      (await ops('post', '/blog/00000000-0000-4000-8000-000000000000/toggle').send({})).status,
    ).toBe(404);
  });

  it('editing: a blank slug keeps the old one, a free slug renames, a taken slug is a 409, a stale version a 409', async () => {
    const a = await post({ title: 'Alpha' });
    const b = await post({ title: 'Beta' });
    const edit = (id: string, rowVersion: number, over: Record<string, unknown>) =>
      ops('put', `/blog/${id}`).send({ title: 'T', status: 'draft', rowVersion, ...over });

    const keep = await edit(a.id, a.rowVersion, { title: 'Alpha renamed', slug: '' });
    expect(keep.body).toMatchObject({ slug: 'alpha', title: 'Alpha renamed', rowVersion: 2 });

    const clash = await edit(a.id, 2, { slug: 'beta' });
    expect(clash.status).toBe(409);
    expect(clash.body.code).toBe('CMS_SLUG_TAKEN');

    const rename = await edit(a.id, 2, { slug: 'Alpha Two' });
    expect(rename.body.slug).toBe('alpha-two');

    const stale = await edit(a.id, 2, {});
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('ROW_VERSION_CONFLICT');

    expect(
      (await ops('put', `/blog/${b.id}`).send({ title: 'x', rowVersion: 1, status: 'draft' }))
        .status,
    ).toBe(200);
    expect(
      (
        await ops('put', '/blog/00000000-0000-4000-8000-000000000000').send({
          title: 'x',
          rowVersion: 1,
        })
      ).status,
    ).toBe(404);
  });

  it('an edit that publishes keeps an existing date, and an explicit date wins', async () => {
    const p = await post({
      title: 'Dates',
      status: 'published',
      publishedAt: '2026-01-02T03:04:05Z',
    });
    expect(p.publishedAt).toBe('2026-01-02T03:04:05.000Z');
    const keep = await ops('put', `/blog/${p.id}`).send({
      title: 'Dates',
      status: 'published',
      rowVersion: p.rowVersion,
    });
    expect(keep.body.publishedAt).toBe('2026-01-02T03:04:05.000Z');
    const move = await ops('put', `/blog/${p.id}`).send({
      title: 'Dates',
      status: 'published',
      publishedAt: '2026-02-03T00:00:00Z',
      rowVersion: keep.body.rowVersion,
    });
    expect(move.body.publishedAt).toBe('2026-02-03T00:00:00.000Z');
  });

  it('delete is permanent, audited, and the public URL becomes a 404', async () => {
    const p = await post({ title: 'Gone', status: 'published' });
    expect((await pub('get', '/blog/gone')).status).toBe(200);
    expect((await ops('delete', `/blog/${p.id}`)).body).toEqual({ ok: true });
    expect((await pub('get', '/blog/gone')).status).toBe(404);
    expect((await ops('delete', `/blog/${p.id}`)).status).toBe(404);
    expect((await events('platform.cms.blog_deleted'))[0]!.payload).toMatchObject({ slug: 'gone' });
    expect((await support('delete', `/blog/${p.id}`)).status).toBe(403);
  });

  it('the admin list pages by cursor, newest-created first, with KPIs, status and search filters', async () => {
    for (let i = 1; i <= 5; i++) {
      await post({ title: `Launch note ${i}`, status: i <= 2 ? 'published' : 'draft' });
    }
    await post({ title: 'Other topic', status: 'draft' });
    const first = await ops('get', '/blog?limit=4');
    expect(first.body.data.map((p: { title: string }) => p.title)).toEqual([
      'Other topic',
      'Launch note 5',
      'Launch note 4',
      'Launch note 3',
    ]);
    expect(first.body.page.hasMore).toBe(true);
    expect(first.body.summary).toEqual({ total: 6, published: 2, drafts: 4, views: 0 });
    const second = await ops(
      'get',
      `/blog?limit=4&cursor=${encodeURIComponent(first.body.page.nextCursor)}`,
    );
    expect(second.body.data.map((p: { title: string }) => p.title)).toEqual([
      'Launch note 2',
      'Launch note 1',
    ]);
    expect(second.body.page).toMatchObject({ hasMore: false, nextCursor: null });

    expect((await ops('get', '/blog?q=launch')).body.data).toHaveLength(5);
    expect((await ops('get', '/blog?q=launch-note-3')).body.data).toHaveLength(1);
    expect((await ops('get', '/blog?status=draft')).body.data).toHaveLength(4);
    // An invalid status is ignored (no filter).
    expect((await ops('get', '/blog?status=weird')).body.data).toHaveLength(6);
    // A search is literal: % matches nothing here.
    expect((await ops('get', '/blog?q=%25')).body.data).toHaveLength(0);
  });

  it('a scheduled post is "Published" by status but not live in the admin list', async () => {
    await post({
      title: 'Later',
      status: 'published',
      publishedAt: new Date(Date.now() + 3 * DAY).toISOString(),
    });
    const row = (await ops('get', '/blog')).body.data[0];
    expect(row).toMatchObject({ status: 'published', live: false });
  });

  it('the public index shows live posts newest first, the featured post, and every category; filters work', async () => {
    const guides = await post({
      title: 'G1',
      status: 'published',
      newCategory: 'Guides',
      publishedAt: '2026-01-01T00:00:00Z',
    });
    await post({
      title: 'N1',
      status: 'published',
      newCategory: 'News',
      isFeatured: true,
      publishedAt: '2026-02-01T00:00:00Z',
    });
    await post({
      title: 'G2 sale 50% off',
      status: 'published',
      categoryId: guides.category.id,
      publishedAt: '2026-03-01T00:00:00Z',
      excerpt: 'big sale',
    });
    await post({ title: 'Draft', newCategory: 'Empty' });
    await h.owner.query(`DELETE FROM blog_categories WHERE name = 'Empty'`);
    await post({ title: 'Hidden', newCategory: 'Unused' });

    const res = await pub('get', '/blog');
    expect(res.body.data.map((c: { title: string }) => c.title)).toEqual([
      'G2 sale 50% off',
      'N1',
      'G1',
    ]);
    expect(res.body.featured).toMatchObject({ title: 'N1', isFeatured: true });
    expect(res.body.categories.map((c: { slug: string }) => c.slug)).toEqual([
      'guides',
      'news',
      'unused',
    ]);

    const guidesOnly = await pub('get', '/blog?category=guides');
    expect(guidesOnly.body.data.map((c: { title: string }) => c.title)).toEqual([
      'G2 sale 50% off',
      'G1',
    ]);
    // An unknown category slug shows everything.
    expect((await pub('get', '/blog?category=nope')).body.data).toHaveLength(3);
    // Search matches title or excerpt, literally.
    expect((await pub('get', '/blog?q=50%25')).body.data).toHaveLength(1);
    expect((await pub('get', '/blog?q=big%20sale')).body.data).toHaveLength(1);
    expect((await pub('get', '/blog?q=%25')).body.data).toHaveLength(1);
  });

  it('the public index pages by cursor without repeating or dropping a post', async () => {
    for (let i = 1; i <= 5; i++) {
      await post({ title: `P${i}`, status: 'published', publishedAt: `2026-01-0${i}T00:00:00Z` });
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 5; page++) {
      const res = await pub(
        'get',
        `/blog?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
      );
      seen.push(...res.body.data.map((c: { title: string }) => c.title));
      if (!res.body.page.hasMore) break;
      cursor = res.body.page.nextCursor;
      // The featured card is only on the first page.
      expect(res.body.featured).toBeNull();
    }
    expect(seen).toEqual(['P5', 'P4', 'P3', 'P2', 'P1']);
  });

  it('a post page counts a view, without moving updated_at or the row version; drafts and future posts count nothing', async () => {
    const live = await post({ title: 'Counted', status: 'published' });
    const draft = await post({ title: 'Quiet' });
    const before = await h.owner.query(
      `SELECT views, updated_at, row_version FROM blog_posts WHERE slug = 'counted'`,
    );
    await pub('get', '/blog/counted');
    await pub('get', '/blog/counted');
    await pub('get', '/blog/quiet');
    const after = await h.owner.query(
      `SELECT views, updated_at, row_version FROM blog_posts WHERE slug = 'counted'`,
    );
    expect(Number(after.rows[0].views)).toBe(Number(before.rows[0].views) + 2);
    expect(after.rows[0].updated_at).toEqual(before.rows[0].updated_at);
    expect(after.rows[0].row_version).toBe(before.rows[0].row_version);
    expect(
      Number(
        (await h.owner.query(`SELECT views FROM blog_posts WHERE slug = 'quiet'`)).rows[0].views,
      ),
    ).toBe(0);
    // An editor holding the version they read can still save after the views moved.
    const saved = await ops('put', `/blog/${live.id}`).send({
      title: 'Counted',
      status: 'published',
      rowVersion: live.rowVersion,
    });
    expect(saved.status).toBe(200);
    expect(saved.body.views).toBe(2);
    expect(draft.views).toBe(0);
  });

  it('SEO: meta description falls back to the excerpt, then the body; image and noindex follow the post', async () => {
    await post({
      title: 'Seo',
      status: 'published',
      excerpt: 'The excerpt',
      body: '<p>Body text</p>',
      featuredImage: '/uploads/cover.png',
    });
    const a = await pub('get', '/blog/seo');
    expect(a.body.seo).toEqual({
      title: 'Seo',
      description: 'The excerpt',
      ogImage: '/uploads/cover.png',
      canonicalUrl: null,
      noindex: false,
    });
    await post({ title: 'Bare', status: 'published', body: '<p>Only the body here</p>' });
    expect((await pub('get', '/blog/bare')).body.seo.description).toBe('Only the body here');
    await post({
      title: 'Custom',
      status: 'published',
      metaTitle: 'Meta title',
      metaDescription: 'Meta desc',
      ogImage: 'https://cdn.example.com/og.png',
      canonicalUrl: 'https://example.com/canonical',
      noindex: true,
    });
    expect((await pub('get', '/blog/custom')).body.seo).toEqual({
      title: 'Meta title',
      description: 'Meta desc',
      ogImage: 'https://cdn.example.com/og.png',
      canonicalUrl: 'https://example.com/canonical',
      noindex: true,
    });
  });

  it('related posts: up to three other live posts of the same category, latest first', async () => {
    const first = await post({
      title: 'R0',
      status: 'published',
      newCategory: 'Cat',
      publishedAt: '2026-01-01T00:00:00Z',
    });
    for (let i = 1; i <= 4; i++) {
      await post({
        title: `R${i}`,
        status: 'published',
        categoryId: first.category.id,
        publishedAt: `2026-02-0${i}T00:00:00Z`,
      });
    }
    await post({
      title: 'Other',
      status: 'published',
      newCategory: 'Else',
      publishedAt: '2026-03-01T00:00:00Z',
    });
    await post({ title: 'Hidden sibling', categoryId: first.category.id });
    const res = await pub('get', '/blog/r0');
    expect(res.body.related.map((c: { title: string }) => c.title)).toEqual(['R4', 'R3', 'R2']);
    // A post with no category relates to any other posts.
    const loose = await post({
      title: 'Loose',
      status: 'published',
      publishedAt: '2026-04-01T00:00:00Z',
    });
    expect((await pub('get', `/blog/${loose.slug}`)).body.related).toHaveLength(3);
  });

  it('reading time follows the body', async () => {
    await post({ title: 'Long', status: 'published', body: `<p>${'word '.repeat(450)}</p>` });
    expect((await pub('get', '/blog/long')).body.readMinutes).toBe(3);
  });

  it('the sitemap lists live indexable posts, categories and published legal pages', async () => {
    await post({ title: 'In', status: 'published', newCategory: 'Cat' });
    await post({ title: 'Out noindex', status: 'published', noindex: true });
    await post({ title: 'Out draft' });
    const res = await pub('get', '/sitemap');
    expect(res.body.posts.map((p: { slug: string }) => p.slug)).toEqual(['in']);
    expect(res.body.categories).toEqual([{ slug: 'cat' }]);
    expect(res.body.legal.map((l: { slug: string }) => l.slug)).toEqual(
      expect.arrayContaining(['terms', 'privacy']),
    );
  });

  it('writes are audited and need a super admin', async () => {
    await h.owner.query(`DELETE FROM security_events WHERE event LIKE 'platform.cms.blog_%'`);
    const p = await post({ title: 'Audited' });
    await ops('put', `/blog/${p.id}`).send({
      title: 'Audited',
      rowVersion: p.rowVersion,
      status: 'draft',
    });
    await ops('post', `/blog/${p.id}/toggle`).send({});
    expect((await events('platform.cms.blog_%')).map((e) => e.event)).toEqual([
      'platform.cms.blog_created',
      'platform.cms.blog_updated',
      'platform.cms.blog_toggled',
    ]);
    expect((await support('post', '/blog').send({ title: 'x' })).status).toBe(403);
    expect((await support('get', '/blog')).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('contact form and inbox (TW-CMS-005, 006, 042, 043)', () => {
  beforeEach(async () => {
    await h.owner.query(`DELETE FROM contact_messages`);
    h.mail.length = 0;
  });
  const valid = {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    company: 'Analytical',
    topic: 'sales',
    message: 'Can you tell me about plans?',
  };
  const rows = async () => (await h.owner.query(`SELECT * FROM contact_messages ORDER BY id`)).rows;

  it('stores the message with the caller address and a truncated user agent, and mails the support inbox with Reply-To', async () => {
    const ua = 'U'.repeat(400);
    const res = await pub('post', '/contact', '203.0.113.7').set('user-agent', ua).send(valid);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    const [row] = await rows();
    expect(row).toMatchObject({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      company: 'Analytical',
      topic: 'sales',
      is_read: false,
      ip: '203.0.113.7',
    });
    expect(row.user_agent).toHaveLength(255);
    expect(h.mail).toHaveLength(1);
    expect(h.mail[0]).toMatchObject({ replyTo: 'ada@example.com' });
    expect(h.mail[0]!.subject).toBe('[Test CRM] Contact: sales from Ada Lovelace');
    expect(h.mail[0]!.text).toContain('Can you tell me about plans?');
  });

  it('the notification goes to the configured support email when there is one', async () => {
    await h.owner.query(
      `INSERT INTO platform_settings (key, value, is_secret) VALUES ('site.email_support', '"help@brand.test"', false)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    );
    const settings = h.app.get(PlatformSettingsService, { strict: false });
    settings.invalidate();
    try {
      await pub('post', '/contact').send({ name: 'A', email: 'a@b.co', message: 'hi' });
      expect(h.mail[0]).toMatchObject({ to: 'help@brand.test', replyTo: 'a@b.co' });
      expect(h.mail[0]!.subject).toBe('[Test CRM] Contact: enquiry from A');
    } finally {
      await h.owner.query(`DELETE FROM platform_settings WHERE key = 'site.email_support'`);
      settings.invalidate();
    }
  });

  it('a filled honeypot looks like success and stores nothing and sends nothing', async () => {
    const res = await pub('post', '/contact').send({ ...valid, website: 'http://spam.example' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(await rows()).toHaveLength(0);
    expect(h.mail).toHaveLength(0);
    // Even a junk body that would fail validation is answered the same way.
    expect((await pub('post', '/contact').send({ website: 'x' })).body).toEqual({ ok: true });
  });

  it('validates: name, email, message required; lengths; topic from the list', async () => {
    const bad = async (over: Record<string, unknown>) => {
      const res = await pub('post', '/contact').send({ ...valid, ...over });
      expect(res.status, JSON.stringify(over)).toBe(422);
      return errorPaths(res.body);
    };
    expect(await bad({ name: '' })).toEqual(['name']);
    expect(await bad({ email: 'not-an-email' })).toEqual(['email']);
    expect(await bad({ message: '   ' })).toEqual(['message']);
    expect(await bad({ message: 'm'.repeat(5001) })).toEqual(['message']);
    expect(await bad({ name: 'n'.repeat(121) })).toEqual(['name']);
    expect(await bad({ topic: 'jobs' })).toEqual(['topic']);
    expect(await rows()).toHaveLength(0);
    // Optional fields really are optional.
    expect(
      (await pub('post', '/contact').send({ name: 'A', email: 'a@b.co', message: 'hi' })).status,
    ).toBe(200);
  });

  it('the seventh post within a minute from one address is a 429; another address is unaffected', async () => {
    const ip = '198.51.100.20';
    for (let i = 0; i < 6; i++)
      expect((await pub('post', '/contact', ip).send(valid)).status).toBe(200);
    const seventh = await pub('post', '/contact', ip).send(valid);
    expect(seventh.status).toBe(429);
    expect(seventh.body.code).toBe('RATE_LIMITED');
    expect(await rows()).toHaveLength(6);
    expect((await pub('post', '/contact', '198.51.100.21').send(valid)).status).toBe(200);
  });

  it('with reCAPTCHA on, a missing or bad token is refused and nothing is stored; a good token passes', async () => {
    await ops('get', '/content'); // warm
    const op = (m: 'patch', path: string) =>
      api()[m](`/v2/platform${path}`).set(bearer(superToken));
    await op('patch', '/settings/social-captcha').send({
      recaptcha: { enabled: true, version: 'v2', siteKey: 'site' },
    });
    await op('patch', '/settings/social-captcha').send({ recaptcha: { secret: 'shh' } });
    try {
      const missing = await pub('post', '/contact').send(valid);
      expect(missing.status).toBe(400);
      expect(missing.body.code).toBe('AUTH_CAPTCHA_FAILED');
      const bad = await pub('post', '/contact').send({ ...valid, captchaToken: 'bad' });
      expect(bad.body.code).toBe('AUTH_CAPTCHA_FAILED');
      expect(await rows()).toHaveLength(0);
      const good = await pub('post', '/contact').send({
        ...valid,
        captchaToken: h.captchaValid.token,
      });
      expect(good.status).toBe(200);
      expect(await rows()).toHaveLength(1);
      // The honeypot still wins over the captcha.
      expect((await pub('post', '/contact').send({ website: 'x' })).status).toBe(200);
    } finally {
      await op('patch', '/settings/social-captcha').send({ recaptcha: { enabled: false } });
    }
  });

  it('a mail failure never reaches the visitor: the message is stored and the answer is success', async () => {
    const port = h.app.get<MailPort>(MAIL_PORT);
    const original = port.send;
    port.send = async () => {
      throw new Error('smtp down');
    };
    try {
      const res = await pub('post', '/contact').send(valid);
      expect(res.status).toBe(200);
      expect(await rows()).toHaveLength(1);
    } finally {
      port.send = original;
    }
  });

  it('the inbox lists newest first with an unread count, filters by state, searches, and pages by cursor', async () => {
    for (let i = 1; i <= 5; i++) {
      await pub('post', '/contact').send({
        ...valid,
        name: `Person ${i}`,
        message: i === 3 ? 'about a refund' : 'hello',
      });
    }
    const list = await ops('get', '/contact-messages?limit=3');
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.data.map((m: { name: string }) => m.name)).toEqual([
      'Person 5',
      'Person 4',
      'Person 3',
    ]);
    expect(list.body.summary).toEqual({ total: 5, unread: 5 });
    expect(list.body.page.hasMore).toBe(true);
    const next = await ops(
      'get',
      `/contact-messages?limit=3&cursor=${encodeURIComponent(list.body.page.nextCursor)}`,
    );
    expect(next.body.data.map((m: { name: string }) => m.name)).toEqual(['Person 2', 'Person 1']);

    expect((await ops('get', '/contact-messages?q=refund')).body.data).toHaveLength(1);
    expect((await ops('get', '/contact-messages?q=ada@example')).body.data).toHaveLength(5);
    expect((await ops('get', '/contact-messages?q=%25')).body.data).toHaveLength(0);

    const id = list.body.data[0].id as string;
    const read = await ops('patch', `/contact-messages/${id}/read`).send({ isRead: true });
    expect(read.body.isRead).toBe(true);
    expect((await ops('get', '/contact-messages?status=unread')).body.data).toHaveLength(4);
    expect((await ops('get', '/contact-messages?status=read')).body.data).toHaveLength(1);
    expect((await ops('get', '/contact-messages')).body.summary).toEqual({ total: 5, unread: 4 });
    expect(
      (await ops('patch', `/contact-messages/${id}/read`).send({ isRead: false })).body.isRead,
    ).toBe(false);
    expect(
      (await ops('patch', `/contact-messages/${id}/read`).send({ isRead: 'yes' })).status,
    ).toBe(422);
  });

  it('support may read and mark messages; only a super admin deletes; deletes are audited and permanent', async () => {
    await pub('post', '/contact').send(valid);
    const id = (await ops('get', '/contact-messages')).body.data[0].id as string;
    expect((await support('get', '/contact-messages')).status).toBe(200);
    expect(
      (await support('patch', `/contact-messages/${id}/read`).send({ isRead: true })).status,
    ).toBe(200);
    expect((await support('delete', `/contact-messages/${id}`)).status).toBe(403);
    expect((await ops('delete', `/contact-messages/${id}`)).body).toEqual({ ok: true });
    expect(await rows()).toHaveLength(0);
    expect((await ops('delete', `/contact-messages/${id}`)).status).toBe(404);
    expect((await events('platform.cms.contact_deleted')).length).toBeGreaterThan(0);
  });

  it('filters by topic and ignores an unknown topic; the topic combines with search and read state (TW-CMS-042)', async () => {
    const sent = ['sales', 'sales', 'support', 'partnership', 'other'];
    for (const [i, topic] of sent.entries()) {
      await pub('post', '/contact').send({
        ...valid,
        topic,
        message: i === 0 ? 'about acme' : 'hello',
      });
    }
    const topics = async (qs: string) =>
      ((await ops('get', `/contact-messages?${qs}`)).body.data as Array<{ topic: string }>).map(
        (m) => m.topic,
      );
    expect(await topics('topic=sales')).toEqual(['sales', 'sales']);
    expect(await topics('topic=support')).toEqual(['support']);
    expect(await topics('topic=jobs')).toHaveLength(5);
    expect(await topics('topic=sales&q=acme')).toEqual(['sales']);
    expect(await topics('topic=sales&status=read')).toEqual([]);
    // The header counts do not follow the filter.
    expect((await ops('get', '/contact-messages?topic=sales')).body.summary).toEqual({
      total: 5,
      unread: 5,
    });
  });

  it('mark all read clears the unread count, is idempotent and open to support (TW-CMS-043)', async () => {
    for (let i = 0; i < 5; i++) await pub('post', '/contact').send(valid);
    const first = (await ops('get', '/contact-messages')).body.data[0].id as string;
    await ops('patch', `/contact-messages/${first}/read`).send({ isRead: true });
    expect((await ops('get', '/contact-messages')).body.summary.unread).toBe(4);

    const all = await support('post', '/contact-messages/read-all');
    expect(all.status, JSON.stringify(all.body)).toBe(200);
    expect(all.body).toEqual({ updated: 4 });
    expect((await ops('get', '/contact-messages')).body.summary).toEqual({ total: 5, unread: 0 });
    expect((await ops('post', '/contact-messages/read-all')).body).toEqual({ updated: 0 });
  });

  it('the delete audit row records the sender address (TW-CMS-043 rule 3)', async () => {
    await pub('post', '/contact').send({ ...valid, email: 'sender.to.audit@example.com' });
    const id = (await ops('get', '/contact-messages')).body.data[0].id as string;
    expect((await ops('delete', `/contact-messages/${id}`)).status).toBe(200);
    const logged = await events('platform.cms.contact_deleted');
    expect(logged.at(-1)?.payload).toMatchObject({
      uuid: id,
      email: 'sender.to.audit@example.com',
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('public pricing (TW-CMS-003)', () => {
  beforeEach(async () => {
    await h.owner.query(`DELETE FROM plans`);
    await h.owner.query(`DELETE FROM platform_settings WHERE key LIKE 'pricing.%'`);
    const op = (m: 'patch', p: string) => api()[m](`/v2/platform${p}`).set(bearer(superToken));
    await op('patch', '/settings/registration').send({ defaultPlanId: null });
  });
  const mk = async (body: Record<string, unknown>) => {
    const res = await api().post('/v2/platform/plans').set(bearer(superToken)).send(body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body;
  };
  const cards = async () => (await pub('get', '/pricing')).body;

  it('with no plans the page gets an empty list (the page falls back to its editable tiers)', async () => {
    expect(await cards()).toMatchObject({ plans: [], yearlyToggle: false, yearlyDiscountPct: 20 });
  });

  it('lists exactly the active plans, in catalogue order, with real prices; add-ons and inactive plans are left out', async () => {
    await mk({ name: 'Scale', slug: 'scale', amount: '99', sortOrder: 3 });
    await mk({ name: 'Free', slug: 'free', isFree: true, sortOrder: 1 });
    await mk({
      name: 'Pro',
      slug: 'pro',
      amount: '29',
      offerAmount: '25',
      sortOrder: 2,
      isHighlighted: true,
    });
    await mk({ name: 'Old', slug: 'old', amount: '5', isActive: false, sortOrder: 0 });
    await h.owner.query(
      `INSERT INTO plans (slug, name, kind, amount, sort_order) VALUES ('addon_x', 'Add-on', 'addon', 10, 0)`,
    );
    const body = await cards();
    expect(body.plans.map((p: { slug: string }) => p.slug)).toEqual(['free', 'pro', 'scale']);
    expect(body.plans[1]).toMatchObject({
      name: 'Pro',
      kind: 'paid',
      highlighted: true,
      price: {
        amount: '29.00',
        offerAmount: '25.00',
        currency: 'USD',
        period: { unit: 'months', count: 1 },
      },
      lifetime: false,
      ctaUrl: '/register?plan=pro',
    });
    expect(body.plans[0]).toMatchObject({ kind: 'free', ctaUrl: '/register' });
    expect(body.plans[0]).not.toHaveProperty('current');
    expect(body.plans[0]).not.toHaveProperty('action');
    expect(
      body.plans.every((p: Record<string, unknown>) => !('id' in p) || typeof p.id === 'string'),
    ).toBe(true);
  });

  it('yearly price is twelve months of the effective monthly price at the discount; the switch needs one such plan', async () => {
    await mk({ name: 'Pro', slug: 'pro', amount: '29', offerAmount: '25', sortOrder: 2 });
    await mk({ name: 'Life', slug: 'life', amount: '300', isLifetime: true, sortOrder: 3 });
    await mk({ name: 'Free', slug: 'free', isFree: true, sortOrder: 1 });
    await mk({ name: 'Talk', slug: 'talk', amount: '0', isCustomQuote: true, sortOrder: 4 });
    const body = await cards();
    const by = (slug: string) => body.plans.find((p: { slug: string }) => p.slug === slug);
    expect(by('pro').yearlyAmount).toBe('240.00'); // 25 * 12 * 0.8
    expect(by('life').yearlyAmount).toBeNull();
    expect(by('free').yearlyAmount).toBeNull();
    expect(by('talk')).toMatchObject({
      yearlyAmount: null,
      kind: 'custom_quote',
      ctaUrl: '/contact',
    });
    expect(body).toMatchObject({ yearlyToggle: true, yearlyDiscountPct: 20 });

    await h.owner.query(
      `INSERT INTO platform_settings (key, value) VALUES ('pricing.yearly_toggle_enabled', 'false'), ('pricing.yearly_discount_pct', '15')`,
    );
    await new Promise((r) => setTimeout(r, 5200)); // the settings snapshot lasts five seconds
    const off = await cards();
    expect(off.yearlyToggle).toBe(false);
    expect(off.yearlyDiscountPct).toBe(15);
    expect(off.plans.find((p: { slug: string }) => p.slug === 'pro').yearlyAmount).toBe('255.00');
    await h.owner.query(`DELETE FROM platform_settings WHERE key LIKE 'pricing.%'`);
  }, 30_000);

  it('a plan that is not billed monthly gets no yearly price', async () => {
    await mk({
      name: 'Quarterly',
      slug: 'q',
      amount: '30',
      billingUnit: 'months',
      billingDuration: 3,
    });
    expect((await cards()).plans[0].yearlyAmount).toBeNull();
    expect((await cards()).yearlyToggle).toBe(false);
  });
});
