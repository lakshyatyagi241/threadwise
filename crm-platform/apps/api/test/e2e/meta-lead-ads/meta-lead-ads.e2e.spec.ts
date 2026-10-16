import { createHmac } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import {
  FACEBOOK_GRAPH,
  type FacebookGraphFactory,
} from '../../../src/infra/providers/channel-facebook/facebook.port';
import { QUEUES } from '../../../src/infra/queue/queues';
import { PageDisconnectConsumer } from '../../../src/modules/meta-lead-ads/page-disconnect.consumer';
import { LeadSweepService } from '../../../src/modules/meta-lead-ads/lead-sweep.service';
import { LeadgenService } from '../../../src/modules/meta-lead-ads/leadgen.service';
import { Api, bearer, startHarness, type Harness, type Tenant } from '../deals-pipelines/support';
import { aForm, aLead, FakeMetaLeadAds } from '../../support/fake-meta-lead-ads-graph';

/**
 * Meta lead ads (BL-011), against a real Postgres and Redis and a FAKE Meta: no request leaves the process. The worker module is loaded
 * next to the HTTP app, so the webhook -> queue -> lead worker -> lead pipeline path runs for real.
 */
let h: Harness;
let api: Api;
const meta = new FakeMetaLeadAds();
let graph: FacebookGraphFactory;

const FULL_SCOPES = ['pages_show_list', 'leads_retrieval', 'pages_manage_ads', 'pages_read_engagement'];

beforeAll(async () => {
  h = await startHarness({
    loadModules: async () => [
      (await import('../../../src/modules/meta-lead-ads')).MetaLeadAdsWorkerModule,
    ],
  });
  api = new Api(h);
  meta.install();
  graph = h.app.get<FacebookGraphFactory>(FACEBOOK_GRAPH);
  Object.assign(graph.settings, {
    appId: '1234',
    appSecret: 'app-secret',
    configId: null,
    verifyToken: 'verify-me',
    signingSecrets: [],
  });
}, 240_000);

afterAll(async () => {
  meta.uninstall();
  await h?.stop();
});

beforeEach(() => {
  meta.reset();
  Object.assign(graph.settings, { signingSecrets: [] });
});

let pageSeq = 0;
/** A connected Facebook Page of the workspace (the Facebook channel's row, its token sealed the way the app seals it). */
async function connectPage(
  t: Tenant,
  opts: { scopes?: string[]; status?: string; name?: string } = {},
): Promise<{ pageId: string; uuid: string; rowId: number }> {
  const pageId = `${700000 + ++pageSeq}${Date.now() % 1000}`;
  const token = h.app.get(CryptoService).encrypt(`page-token-${pageId}`);
  const r = await h.owner.query(
    `INSERT INTO facebook_pages (org_id, page_id, name, access_token, status, scopes)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb) RETURNING id, uuid`,
    [
      t.orgId,
      pageId,
      opts.name ?? `Shop ${pageSeq}`,
      token,
      opts.status ?? 'connected',
      JSON.stringify(opts.scopes ?? FULL_SCOPES),
    ],
  );
  return { pageId, uuid: r.rows[0].uuid as string, rowId: Number(r.rows[0].id) };
}

const get = (t: string, path: string) => api.http().get(path).set(bearer(t));
const post = (t: string, path: string) => api.http().post(path).set(bearer(t));

async function enable(t: Tenant, page: { uuid: string; pageId: string }) {
  const res = await post(t.admin, `/v2/meta-lead-ads/pages/${page.uuid}/enable`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

async function pick(t: Tenant, page: { uuid: string; pageId: string }, formId: string) {
  const res = await post(t.admin, `/v2/meta-lead-ads/pages/${page.uuid}/forms/${formId}/connect`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as { sourceId: string; connected: boolean };
}

const q = async (t: Tenant, sql: string, params: unknown[] = []) =>
  (await h.owner.query(sql, [t.orgId, ...params])).rows;

const leadgenBody = (pageId: string, leadgenId: string, formId: string) => ({
  object: 'page',
  entry: [
    {
      id: pageId,
      time: Math.floor(Date.now() / 1000),
      changes: [
        {
          field: 'leadgen',
          value: {
            leadgen_id: leadgenId,
            form_id: formId,
            ad_id: 'ad-77',
            page_id: pageId,
            created_time: Math.floor(Date.now() / 1000),
          },
        },
      ],
    },
  ],
});

const webhook = (body: unknown, secret?: string) => {
  const raw = JSON.stringify(body);
  const req = api.http().post('/v2/facebook/webhook').set('content-type', 'application/json');
  if (secret) {
    req.set('x-hub-signature-256', `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`);
  }
  return req.send(raw);
};

const waitFor = async <T>(fn: () => Promise<T | undefined | false>, ms = 20_000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > end) throw new Error('timed out waiting for the lead worker');
    await new Promise((r) => setTimeout(r, 150));
  }
};

describe('the overview and lead access', () => {
  it('lists the connected Pages with their lead access, and never a token or the app secret', async () => {
    const t = await api.signup('mla-ov');
    const lacking = await connectPage(t, { scopes: ['pages_show_list', 'pages_read_engagement'] });
    const full = await connectPage(t);
    const res = await get(t.admin, '/v2/meta-lead-ads');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      configured: true,
      verifyTokenConfigured: true,
      requiredScopes: ['leads_retrieval', 'pages_manage_ads', 'pages_read_engagement'],
    });
    const byId = new Map((res.body.pages as Array<{ pageId: string }>).map((p) => [p.pageId, p]));
    expect(byId.get(lacking.pageId)).toMatchObject({
      leadAccess: 'missing',
      missingScopes: ['leads_retrieval', 'pages_manage_ads'],
      sync: { enabled: false, state: 'off', formsConnected: 0 },
    });
    expect(byId.get(full.pageId)).toMatchObject({ leadAccess: 'granted', missingScopes: [] });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('app-secret');
    expect(text).not.toContain('verify-me');
    expect(text).not.toContain('page-token');
    expect(res.body.webhookUrl).toMatch(/\/v2\/facebook\/webhook$/);
  });

  it('is empty for another workspace: one workspace never sees the Pages, forms or sources of another', async () => {
    const a = await api.signup('mla-iso-a');
    const b = await api.signup('mla-iso-b');
    const page = await connectPage(a);
    meta.forms.set(page.pageId, [aForm('51001', 'Private form')]);
    await enable(a, page);
    await pick(a, page, '51001');
    const seen = await get(b.admin, '/v2/meta-lead-ads');
    expect(seen.body.pages).toEqual([]);
    expect((await get(b.admin, `/v2/meta-lead-ads/pages/${page.uuid}/forms`)).status).toBe(404);
    expect((await post(b.admin, `/v2/meta-lead-ads/pages/${page.uuid}/enable`)).status).toBe(404);
    const sources = await get(b.admin, '/v2/lead-sources');
    expect(sources.body.data).toEqual([]);
  });

  it('a role with only the read key sees the state but cannot change anything or read forms from Meta', async () => {
    const t = await api.signup('mla-rbac');
    const page = await connectPage(t);
    const reader = await api.member(t, 'reader', [['leads.sources.read']]);
    expect((await get(reader.token, '/v2/meta-lead-ads')).status).toBe(200);
    expect((await get(reader.token, `/v2/meta-lead-ads/pages/${page.uuid}/forms`)).status).toBe(403);
    expect((await post(reader.token, `/v2/meta-lead-ads/pages/${page.uuid}/enable`)).status).toBe(403);
    expect((await post(reader.token, '/v2/meta-lead-ads/connect/start')).status).toBe(403);
    expect(meta.calls).toHaveLength(0);
    const nobody = await api.member(t, 'nobody', [['record.contacts.read']]);
    expect((await get(nobody.token, '/v2/meta-lead-ads')).status).toBe(403);
  });

  it('the plan gate holds: a plan without lead sources gets 422 on every route', async () => {
    const t = await api.signup('mla-plan');
    await h.owner.query(
      `UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`,
      [t.orgId, JSON.stringify({ features: { lead_sources: false } })],
    );
    const res = await get(t.admin, '/v2/meta-lead-ads');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PLAN_FEATURE_LOCKED');
  });
});

describe('re-consent: the login that asks for the lead permissions', () => {
  it('needs the Facebook channel’s manage key too, and asks again for the lead scopes', async () => {
    const t = await api.signup('mla-login');
    const onlyLeads = await api.member(t, 'leadsonly', [['leads.sources.read'], ['leads.sources.manage']]);
    expect((await post(onlyLeads.token, '/v2/meta-lead-ads/connect/start')).status).toBe(403);

    const res = await post(t.admin, '/v2/meta-lead-ads/connect/start');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const url = new URL(res.body.url as string);
    expect(url.hostname).toBe('www.facebook.com');
    expect(url.searchParams.get('auth_type')).toBe('rerequest');
    const scopes = url.searchParams.get('scope')!.split(',');
    expect(scopes).toEqual(expect.arrayContaining(['leads_retrieval', 'pages_manage_ads', 'pages_read_engagement', 'pages_messaging']));
    expect(url.searchParams.get('redirect_uri')).toMatch(/\/v2\/facebook\/callback$/);
    expect(url.searchParams.get('state')).toBeTruthy();
  });

  it('comes back to the Social leads screen, and a Page connected without the lead scopes then has them', async () => {
    const t = await api.signup('mla-cb');
    const page = await connectPage(t, { scopes: ['pages_show_list'] });
    const start = await post(t.admin, '/v2/meta-lead-ads/connect/start');
    const state = new URL(start.body.url as string).searchParams.get('state')!;

    const original = graph.app;
    graph.app = () => ({
      exchangeCode: () => Promise.resolve({ ok: true, data: { accessToken: 'short' } }),
      extendUserToken: () => Promise.resolve({ ok: true, data: { accessToken: 'long' } }),
      listPages: () => Promise.resolve([{ id: page.pageId, name: 'Shop', access_token: 'fresh-token' }]),
      pageFromToken: () => Promise.resolve(null),
      debugToken: () => Promise.resolve({ is_valid: true, scopes: FULL_SCOPES }),
    });
    try {
      const cb = await api.http().get('/v2/facebook/callback').query({ code: 'c', state }).redirects(0);
      expect(cb.status).toBe(303);
      const to = new URL(cb.headers.location as string);
      expect(to.pathname).toBe('/lead-sources');
      expect(to.searchParams.get('tab')).toBe('ads');
      expect(to.searchParams.get('fb')).toBe('connected');
    } finally {
      graph.app = original;
    }
    const ov = await get(t.admin, '/v2/meta-lead-ads');
    expect(ov.body.pages[0]).toMatchObject({ pageId: page.pageId, leadAccess: 'granted' });
  });

  it('a refused dialog sends the person back to the same screen, and a forged state to the hub', async () => {
    const t = await api.signup('mla-cb2');
    const start = await post(t.admin, '/v2/meta-lead-ads/connect/start');
    const state = new URL(start.body.url as string).searchParams.get('state')!;
    const denied = await api
      .http()
      .get('/v2/facebook/callback')
      .query({ error: 'access_denied', error_description: 'The person said no', state })
      .redirects(0);
    expect(new URL(denied.headers.location as string).pathname).toBe('/lead-sources');
    expect(new URL(denied.headers.location as string).searchParams.get('fb')).toBe('error');
    const forged = await api.http().get('/v2/facebook/callback').query({ code: 'c', state: 'nope' }).redirects(0);
    expect(new URL(forged.headers.location as string).pathname).toBe('/facebook');
  });
});

describe('turning lead sync on for a Page', () => {
  it('refuses a Page connected without the lead permissions (422 MLA_LEAD_ACCESS_MISSING) and asks Meta nothing', async () => {
    const t = await api.signup('mla-en1');
    const page = await connectPage(t, { scopes: ['pages_show_list'] });
    const res = await post(t.admin, `/v2/meta-lead-ads/pages/${page.uuid}/enable`);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('MLA_LEAD_ACCESS_MISSING');
    expect(meta.calls).toHaveLength(0);
    expect(await q(t, `SELECT 1 FROM meta_lead_pages WHERE org_id = $1`)).toHaveLength(0);
  });

  it('refuses a Page whose token is no longer valid (422 MLA_PAGE_RECONNECT)', async () => {
    const t = await api.signup('mla-en2');
    const page = await connectPage(t, { status: 'expired' });
    const res = await post(t.admin, `/v2/meta-lead-ads/pages/${page.uuid}/enable`);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('MLA_PAGE_RECONNECT');
    expect(meta.calls).toHaveLength(0);
  });

  it('subscribes the Page to leadgen keeping its other fields, stores the state, audits and announces it', async () => {
    const t = await api.signup('mla-en3');
    const page = await connectPage(t);
    meta.fields.set(page.pageId, ['feed', 'messages']);
    const body = await enable(t, page);
    expect(body.sync).toMatchObject({ enabled: true, state: 'subscribed', lastError: null });
    expect(body.sync.subscribedAt).toBeTruthy();
    expect(meta.fields.get(page.pageId)).toEqual(['feed', 'messages', 'leadgen']);
    expect(meta.callsTo('subscribeLeadgen')[0]!.token).toBe(`page-token-${page.pageId}`);
    expect(await api.auditCount(t.orgId, 'meta_lead_pages', 'insert')).toBe(1);
    expect(await api.events(t.orgId, 'meta_lead_ads.page.enabled')).toHaveLength(1);
    // Turning it on again is harmless.
    expect((await post(t.admin, `/v2/meta-lead-ads/pages/${page.uuid}/enable`)).status).toBe(200);
    expect(await q(t, `SELECT 1 FROM meta_lead_pages WHERE org_id = $1`)).toHaveLength(1);
  });

  it('does not take Meta’s word for it: a subscribe that never shows the field is a refusal', async () => {
    const t = await api.signup('mla-en4');
    const page = await connectPage(t);
    meta.swallowSubscribe = true;
    const res = await post(t.admin, `/v2/meta-lead-ads/pages/${page.uuid}/enable`);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('MLA_SUBSCRIBE_FAILED');
    expect(await q(t, `SELECT 1 FROM meta_lead_pages WHERE org_id = $1`)).toHaveLength(0);
  });

  it('maps Meta’s own refusals: a revoked token, a withheld permission, anything else', async () => {
    const t = await api.signup('mla-en5');
    const page = await connectPage(t);
    meta.fail('subscribeLeadgen', 190);
    expect((await post(t.admin, `/v2/meta-lead-ads/pages/${page.uuid}/enable`)).body.code).toBe('MLA_PAGE_RECONNECT');
    meta.reset();
    meta.fail('subscribeLeadgen', 200);
    expect((await post(t.admin, `/v2/meta-lead-ads/pages/${page.uuid}/enable`)).body.code).toBe('MLA_LEAD_ACCESS_MISSING');
    meta.reset();
    meta.fail('subscribeLeadgen', 100, 'Param subscribed_fields is invalid');
    const other = await post(t.admin, `/v2/meta-lead-ads/pages/${page.uuid}/enable`);
    expect(other.body.code).toBe('MLA_SUBSCRIBE_FAILED');
    expect(other.body.detail ?? other.body.message).toContain('Param subscribed_fields is invalid');
  });

  it('turning it off removes only leadgen and keeps the picked forms', async () => {
    const t = await api.signup('mla-dis');
    const page = await connectPage(t);
    meta.forms.set(page.pageId, [aForm('52001', 'Form A')]);
    await enable(t, page);
    await pick(t, page, '52001');
    const res = await post(t.admin, `/v2/meta-lead-ads/pages/${page.uuid}/disable`);
    expect(res.status).toBe(200);
    expect(res.body.sync).toMatchObject({ enabled: false, state: 'off', formsConnected: 1 });
    expect(meta.fields.get(page.pageId)).not.toContain('leadgen');
    expect(meta.fields.get(page.pageId)).toContain('feed');
    expect(await api.events(t.orgId, 'meta_lead_ads.page.disabled')).toHaveLength(1);
  });
});

describe('choosing lead forms', () => {
  it('lists the Page’s forms with their questions, marks the picked ones, and needs sync on to pick', async () => {
    const t = await api.signup('mla-forms');
    const page = await connectPage(t);
    meta.forms.set(page.pageId, [aForm('53001', 'Form A'), aForm('53002', 'Form B', { checkboxes: [{ key: 'cb', text: 'I agree.', required: false }] })]);

    const early = await post(t.admin, `/v2/meta-lead-ads/pages/${page.uuid}/forms/53001/connect`);
    expect(early.status).toBe(422);
    expect(early.body.code).toBe('MLA_SYNC_OFF');

    await enable(t, page);
    const picked = await pick(t, page, '53001');
    expect(picked.connected).toBe(true);
    const list = await get(t.admin, `/v2/meta-lead-ads/pages/${page.uuid}/forms`);
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const [a, b] = list.body.data as Array<Record<string, unknown>>;
    expect(a).toMatchObject({ formId: '53001', name: 'Form A', connected: true, sourceId: picked.sourceId });
    expect(b).toMatchObject({ formId: '53002', connected: false, sourceId: null, hasConsentCheckbox: true });
    expect((a!.questions as Array<Record<string, unknown>>).map((x) => [x.key, x.suggestedTarget])).toEqual([
      ['full_name', 'name'],
      ['email', 'email'],
      ['phone_number', 'phone'],
      ['what_is_your_budget', null],
    ]);
    expect(list.body.page.sync.formsConnected).toBe(1);
  });

  it('a picked form is a lead source of kind meta_lead_ads (Facebook platform), idempotent, audited and announced', async () => {
    const t = await api.signup('mla-pick');
    const page = await connectPage(t, { name: 'Acme Realty' });
    meta.forms.set(page.pageId, [aForm('54001', 'Site visit')]);
    await enable(t, page);
    const first = await pick(t, page, '54001');
    const again = await pick(t, page, '54001');
    expect(again.sourceId).toBe(first.sourceId);

    const sources = await q(t, `SELECT uuid, kind, provider_key, name, token_hash, external_ref FROM lead_sources WHERE org_id = $1`);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      uuid: first.sourceId,
      kind: 'meta_lead_ads',
      provider_key: 'Facebook',
      name: 'Acme Realty - Site visit',
      token_hash: null,
      external_ref: `meta_lead_form:${page.pageId}:54001`,
    });
    expect(await q(t, `SELECT 1 FROM meta_lead_forms WHERE org_id = $1`)).toHaveLength(1);
    expect(await api.auditCount(t.orgId, 'meta_lead_forms', 'insert')).toBe(1);
    expect(await api.events(t.orgId, 'meta_lead_ads.form.connected')).toHaveLength(1);

    // The source is the pipeline's own: it is listed, has no URL token to rotate and is edited with the same mapping and rules.
    const listed = await get(t.admin, '/v2/lead-sources');
    expect(listed.body.data[0]).toMatchObject({ kind: 'meta_lead_ads', tokenHint: null });
    const rotate = await post(t.admin, `/v2/lead-sources/${first.sourceId}/rotate-token`);
    expect(rotate.status).toBe(422);
  });

  it('refuses a form that is not the Page’s (422 MLA_FORM_NOT_FOUND) and a bad id (422)', async () => {
    const t = await api.signup('mla-nf');
    const page = await connectPage(t);
    await enable(t, page);
    const res = await post(t.admin, `/v2/meta-lead-ads/pages/${page.uuid}/forms/99999999/connect`);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('MLA_FORM_NOT_FOUND');
    expect((await post(t.admin, `/v2/meta-lead-ads/pages/${page.uuid}/forms/not-a-number/connect`)).status).toBe(422);
  });

  it('respects the plan’s lead source cap with 422 PLAN_LIMIT_REACHED and stores nothing for the form', async () => {
    const t = await api.signup('mla-cap');
    await h.owner.query(`UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`, [
      t.orgId,
      JSON.stringify({ limits: { lead_sources: 1 } }),
    ]);
    const page = await connectPage(t);
    meta.forms.set(page.pageId, [aForm('55001', 'One'), aForm('55002', 'Two')]);
    await enable(t, page);
    await pick(t, page, '55001');
    const res = await post(t.admin, `/v2/meta-lead-ads/pages/${page.uuid}/forms/55002/connect`);
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('PLAN_LIMIT_REACHED');
    expect(await q(t, `SELECT 1 FROM meta_lead_forms WHERE org_id = $1`)).toHaveLength(1);
  });

  it('turns Meta’s refusals while listing into the right next step', async () => {
    const t = await api.signup('mla-listerr');
    const page = await connectPage(t);
    await enable(t, page);
    meta.fail('listForms', 190, 'Error validating access token');
    expect((await get(t.admin, `/v2/meta-lead-ads/pages/${page.uuid}/forms`)).body.code).toBe('MLA_PAGE_RECONNECT');
    // The Page now carries the error, so the screen shows it until the next success.
    const ov = await get(t.admin, '/v2/meta-lead-ads');
    expect(ov.body.pages.find((p: { pageId: string }) => p.pageId === page.pageId).sync).toMatchObject({ state: 'needs_reconnect' });
    meta.reset();
    meta.fail('listForms', 200);
    expect((await get(t.admin, `/v2/meta-lead-ads/pages/${page.uuid}/forms`)).body.code).toBe('MLA_LEAD_ACCESS_MISSING');
    meta.reset();
    meta.fail('listForms', 2, 'Service temporarily unavailable');
    expect((await get(t.admin, `/v2/meta-lead-ads/pages/${page.uuid}/forms`)).body.code).toBe('MLA_FORMS_UNAVAILABLE');
  });

  it('stopping a form removes its source and stored leads and keeps the contacts', async () => {
    const t = await api.signup('mla-stop');
    const page = await connectPage(t);
    meta.forms.set(page.pageId, [aForm('56001', 'Stop me')]);
    await enable(t, page);
    await pick(t, page, '56001');
    const lead = aLead('56001');
    meta.leads.set('56001', [lead]);
    const svc = h.app.get(LeadgenService, { strict: false });
    await svc.handleWebhook({ orgId: t.orgId, pageId: page.pageId, leadgenId: lead.id, formId: '56001', adId: null });
    expect(await q(t, `SELECT 1 FROM contacts WHERE org_id = $1 AND source = 'Facebook'`)).toHaveLength(1);

    const del = await api.http().delete(`/v2/meta-lead-ads/pages/${page.uuid}/forms/56001`).set(bearer(t.admin));
    expect(del.status).toBe(204);
    expect(await q(t, `SELECT 1 FROM lead_sources WHERE org_id = $1`)).toHaveLength(0);
    expect(await q(t, `SELECT 1 FROM lead_events WHERE org_id = $1`)).toHaveLength(0);
    expect(await q(t, `SELECT 1 FROM meta_lead_forms WHERE org_id = $1`)).toHaveLength(0);
    expect(await q(t, `SELECT 1 FROM contacts WHERE org_id = $1 AND source = 'Facebook'`)).toHaveLength(1);
    expect(await api.events(t.orgId, 'meta_lead_ads.form.disconnected')).toHaveLength(1);
    const again = await api.http().delete(`/v2/meta-lead-ads/pages/${page.uuid}/forms/56001`).set(bearer(t.admin));
    expect(again.status).toBe(404);
  });
});

describe('the leadgen webhook', () => {
  it('answers Meta’s handshake only for the right verify token', async () => {
    const ok = await api
      .http()
      .get('/v2/facebook/webhook')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': 'abc123' });
    expect(ok.status).toBe(200);
    expect(ok.text).toBe('abc123');
    const bad = await api
      .http()
      .get('/v2/facebook/webhook')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'abc123' });
    expect(bad.status).toBe(403);
  });

  it('refuses an unsigned or wrongly signed event when the app secret is set, and queues nothing', async () => {
    const t = await api.signup('mla-sig');
    const page = await connectPage(t);
    meta.forms.set(page.pageId, [aForm('57001', 'Signed')]);
    await enable(t, page);
    await pick(t, page, '57001');
    const lead = aLead('57001');
    meta.leads.set('57001', [lead]);
    Object.assign(graph.settings, { signingSecrets: ['app-secret'] });

    const body = leadgenBody(page.pageId, lead.id, '57001');
    expect((await webhook(body)).status).toBe(403);
    expect((await webhook(body, 'not-the-secret')).status).toBe(403);
    expect(meta.callsTo('getLead')).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 400));
    expect(await q(t, `SELECT 1 FROM lead_events WHERE org_id = $1`)).toHaveLength(0);
    const queue = h.app.get<Queue>(getQueueToken(QUEUES.META_LEADGEN), { strict: false });
    expect(await queue.getJob(`leadgen-${t.orgId}-${lead.id}`)).toBeUndefined();
  });

  it('acks at once, and the worker fetches the lead, maps it and creates ONE contact with structured attribution', async () => {
    const t = await api.signup('mla-hook');
    const page = await connectPage(t, { name: 'Acme Realty' });
    meta.forms.set(page.pageId, [aForm('58001', 'Site visit')]);
    await enable(t, page);
    const src = await pick(t, page, '58001');
    const lead = aLead('58001');
    meta.leads.set('58001', [lead]);
    Object.assign(graph.settings, { signingSecrets: ['app-secret'] });

    const res = await webhook(leadgenBody(page.pageId, lead.id, '58001'), 'app-secret');
    expect(res.status).toBe(200);
    // A redelivery of the same event (Meta retries) is the same job.
    expect((await webhook(leadgenBody(page.pageId, lead.id, '58001'), 'app-secret')).status).toBe(200);

    const event = await waitFor(async () => (await q(t, `SELECT * FROM lead_events WHERE org_id = $1`))[0]);
    expect(event).toMatchObject({ external_id: lead.id, status: 'created' });
    const contacts = await q(t, `SELECT id, name, source, owner_id FROM contacts WHERE org_id = $1 AND source = 'Facebook'`);
    expect(contacts).toHaveLength(1);
    expect(contacts[0]!.name).toContain('Lead Person');

    const attr = await q(t, `SELECT platform, campaign, adset, ad, form FROM contact_attributions WHERE org_id = $1`);
    expect(attr).toEqual([
      { platform: 'Facebook', campaign: 'Diwali 2026', adset: 'Mumbai 25-40', ad: 'Diwali offer', form: 'Site visit' },
    ]);
    // The payload kept for the retention period holds Meta's ids for later reporting.
    const stored = (await q(t, `SELECT payload FROM lead_events WHERE org_id = $1`))[0]!.payload as { fields: Record<string, string> };
    expect(stored.fields).toMatchObject({ meta_form_id: '58001', meta_ad_id: 'ad-77', meta_campaign_id: 'camp-77', meta_lead_id: lead.id });

    // Health: the Page and the form know a lead arrived.
    const health = await get(t.admin, `/v2/meta-lead-ads/sources/${src.sourceId}/health`);
    expect(health.body).toMatchObject({ connected: true, state: 'subscribed', formName: 'Site visit', lastError: null });
    expect(health.body.lastLeadAt).toBeTruthy();
    expect(meta.callsTo('getLead')).toHaveLength(1);
  });

  it('a lead from an Instagram placement arrives through the same Page and is labelled Instagram', async () => {
    const t = await api.signup('mla-ig');
    const page = await connectPage(t);
    meta.forms.set(page.pageId, [aForm('59001', 'IG form')]);
    await enable(t, page);
    await pick(t, page, '59001');
    const lead = aLead('59001', { platform: 'instagram' });
    meta.leads.set('59001', [lead]);
    const svc = h.app.get(LeadgenService, { strict: false });
    const out = await svc.handleWebhook({ orgId: t.orgId, pageId: page.pageId, leadgenId: lead.id, formId: '59001', adId: null });
    expect(out).toEqual({ kind: 'delivered', result: 'created' });
    expect(await q(t, `SELECT platform FROM contact_attributions WHERE org_id = $1`)).toEqual([{ platform: 'Instagram' }]);
    expect(await q(t, `SELECT 1 FROM contacts WHERE org_id = $1 AND source = 'Instagram'`)).toHaveLength(1);
  });

  it('is idempotent on the lead id: the same lead twice is one contact and one event', async () => {
    const t = await api.signup('mla-idem');
    const page = await connectPage(t);
    meta.forms.set(page.pageId, [aForm('60001', 'Idem')]);
    await enable(t, page);
    await pick(t, page, '60001');
    const lead = aLead('60001');
    meta.leads.set('60001', [lead]);
    const svc = h.app.get(LeadgenService, { strict: false });
    const job = { orgId: t.orgId, pageId: page.pageId, leadgenId: lead.id, formId: '60001', adId: null };
    expect(await svc.handleWebhook(job)).toEqual({ kind: 'delivered', result: 'created' });
    expect(await svc.handleWebhook(job)).toEqual({ kind: 'delivered', result: 'duplicate' });
    expect(await q(t, `SELECT 1 FROM lead_events WHERE org_id = $1`)).toHaveLength(1);
    expect(await q(t, `SELECT 1 FROM contacts WHERE org_id = $1 AND source = 'Facebook'`)).toHaveLength(1);
  });

  it('drops what it should not fetch: sync off, a form never picked, a paused source, a Page that is not connected', async () => {
    const t = await api.signup('mla-skip');
    const page = await connectPage(t);
    meta.forms.set(page.pageId, [aForm('61001', 'Picked'), aForm('61002', 'Not picked')]);
    const lead = aLead('61001');
    meta.leads.set('61001', [lead]);
    const svc = h.app.get(LeadgenService, { strict: false });
    const job = (formId: string) => ({ orgId: t.orgId, pageId: page.pageId, leadgenId: lead.id, formId, adId: null });

    expect(await svc.handleWebhook(job('61001'))).toEqual({ kind: 'skipped', reason: 'sync_off' });
    await enable(t, page);
    expect(await svc.handleWebhook(job('61002'))).toEqual({ kind: 'skipped', reason: 'form_not_picked' });
    const src = await pick(t, page, '61001');
    await h.owner.query(`UPDATE lead_sources SET status = 'paused' WHERE org_id = $1 AND uuid = $2::uuid`, [t.orgId, src.sourceId]);
    expect(await svc.handleWebhook(job('61001'))).toEqual({ kind: 'skipped', reason: 'source_paused' });
    await h.owner.query(`UPDATE lead_sources SET status = 'active' WHERE org_id = $1 AND uuid = $2::uuid`, [t.orgId, src.sourceId]);
    await h.owner.query(`UPDATE facebook_pages SET status = 'expired' WHERE org_id = $1`, [t.orgId]);
    expect(await svc.handleWebhook(job('61001'))).toEqual({ kind: 'skipped', reason: 'page_not_connected' });
    expect(meta.callsTo('getLead')).toHaveLength(0);
    expect(await q(t, `SELECT 1 FROM lead_events WHERE org_id = $1`)).toHaveLength(0);
  });

  it('a revoked token is written on the Page (needs reconnect) and not retried; the next good lead clears it', async () => {
    const t = await api.signup('mla-tok');
    const page = await connectPage(t);
    meta.forms.set(page.pageId, [aForm('62001', 'Tok')]);
    await enable(t, page);
    const src = await pick(t, page, '62001');
    const lead = aLead('62001');
    meta.leads.set('62001', [lead]);
    const svc = h.app.get(LeadgenService, { strict: false });
    const job = { orgId: t.orgId, pageId: page.pageId, leadgenId: lead.id, formId: '62001', adId: null };

    meta.fail('getLead', 190, 'Error validating access token: session expired');
    expect(await svc.handleWebhook(job)).toEqual({ kind: 'refused', reason: 'token' });
    const health = await get(t.admin, `/v2/meta-lead-ads/sources/${src.sourceId}/health`);
    expect(health.body).toMatchObject({ state: 'needs_reconnect', subscribed: false });
    expect(health.body.lastError).toContain('session expired');

    meta.reset();
    meta.leads.set('62001', [lead]);
    meta.forms.set(page.pageId, [aForm('62001', 'Tok')]);
    expect(await svc.handleWebhook(job)).toEqual({ kind: 'delivered', result: 'created' });
    const after = await get(t.admin, `/v2/meta-lead-ads/sources/${src.sourceId}/health`);
    expect(after.body).toMatchObject({ state: 'subscribed', lastError: null });
  });

  it('a withheld permission shows as "needs lead access"; Meta being slow throws so the queue retries', async () => {
    const t = await api.signup('mla-perm');
    const page = await connectPage(t);
    meta.forms.set(page.pageId, [aForm('63001', 'Perm')]);
    await enable(t, page);
    await pick(t, page, '63001');
    const svc = h.app.get(LeadgenService, { strict: false });
    const job = { orgId: t.orgId, pageId: page.pageId, leadgenId: 'L1', formId: '63001', adId: null };

    meta.fail('getLead', 200, '(#200) Requires leads_retrieval permission');
    expect(await svc.handleWebhook(job)).toEqual({ kind: 'refused', reason: 'permission' });
    const ov = await get(t.admin, '/v2/meta-lead-ads');
    expect(ov.body.pages.find((p: { pageId: string }) => p.pageId === page.pageId).sync).toMatchObject({ state: 'needs_lead_access' });

    meta.reset();
    meta.fail('getLead', 4, 'Application request limit reached');
    await expect(svc.handleWebhook(job)).rejects.toThrow(/could not be reached/);
    // Nothing was written for a lead that was never fetched.
    expect(await q(t, `SELECT 1 FROM lead_events WHERE org_id = $1`)).toHaveLength(0);
  });
});

describe('consent proof from the lead form', () => {
  async function setup(label: string) {
    const t = await api.signup(label);
    const page = await connectPage(t);
    const form = aForm(`64${Date.now() % 100000}`, 'Consent form', {
      checkboxes: [{ key: 'cb1', text: 'I agree to be contacted on WhatsApp about my enquiry.', required: false }],
    });
    meta.forms.set(page.pageId, [form]);
    await enable(t, page);
    await pick(t, page, form.id);
    return { t, page, form };
  }
  const run = (t: Tenant, pageId: string, formId: string, leadId: string) =>
    h.app.get(LeadgenService, { strict: false }).handleWebhook({ orgId: t.orgId, pageId, leadgenId: leadId, formId, adId: null });
  const granted = (t: Tenant) =>
    q(
      t,
      `SELECT e.channel, e.source, e.note, e.evidence FROM contact_consent_events e
        WHERE e.org_id = $1 AND e.action = 'granted' ORDER BY e.channel, e.id`,
    );

  it('a ticked disclaimer checkbox with its wording is recorded as consent for the channels the lead can be reached on', async () => {
    const { t, page, form } = await setup('mla-consent-yes');
    const lead = aLead(form.id, { disclaimerResponses: [{ key: 'cb1', checked: true }] });
    meta.leads.set(form.id, [lead]);
    expect(await run(t, page.pageId, form.id, lead.id)).toEqual({ kind: 'delivered', result: 'created' });
    const rows = await granted(t);
    // The lead has a phone and an email, so both channels are recorded; the proof names the form and the ad it was given on.
    expect(rows.map((r) => [r.channel, r.source])).toEqual([
      ['email', 'lead'],
      ['whatsapp', 'lead'],
    ]);
    for (const r of rows) {
      expect(r.evidence).toMatchObject({ leadFormId: form.id, adId: 'ad-77' });
    }
  });

  it('an unticked box, no box at all, or a lead whose form has no disclaimer grants nothing', async () => {
    const { t, page, form } = await setup('mla-consent-no');
    const unticked = aLead(form.id, { disclaimerResponses: [{ key: 'cb1', checked: false }] });
    const plain = aLead(form.id);
    meta.leads.set(form.id, [unticked, plain]);
    await run(t, page.pageId, form.id, unticked.id);
    await run(t, page.pageId, form.id, plain.id);
    expect(await q(t, `SELECT 1 FROM contacts WHERE org_id = $1 AND source = 'Facebook'`)).toHaveLength(2);
    expect(await granted(t)).toEqual([]);
  });
});

describe('the reconciliation sweep', () => {
  it('brings in the lead whose webhook was missed, once, and does not count leads it already holds as duplicates', async () => {
    const t = await api.signup('mla-sweep');
    const page = await connectPage(t);
    meta.forms.set(page.pageId, [aForm('65001', 'Sweep')]);
    await enable(t, page);
    await pick(t, page, '65001');
    const delivered = aLead('65001');
    const missed = aLead('65001');
    meta.leads.set('65001', [delivered, missed]);
    const svc = h.app.get(LeadgenService, { strict: false });
    await svc.handleWebhook({ orgId: t.orgId, pageId: page.pageId, leadgenId: delivered.id, formId: '65001', adId: null });

    const first = await svc.sweepPage(t.orgId, page.pageId);
    expect(first).toMatchObject({ forms: 1, delivered: 1, complete: 1, skipped: false });
    expect(await q(t, `SELECT 1 FROM contacts WHERE org_id = $1 AND source = 'Facebook'`)).toHaveLength(2);
    const events = await q(t, `SELECT external_id, status, duplicate_count FROM lead_events WHERE org_id = $1 ORDER BY id`);
    expect(events.map((e) => e.external_id).sort()).toEqual([delivered.id, missed.id].sort());
    expect(events.every((e) => e.duplicate_count === 0)).toBe(true);

    // A second sweep finds nothing new and writes nothing.
    const second = await svc.sweepPage(t.orgId, page.pageId);
    expect(second.delivered).toBe(0);
    expect((await q(t, `SELECT sum(duplicate_count)::int AS n FROM lead_events WHERE org_id = $1`))[0]!.n).toBe(0);
    expect(await q(t, `SELECT 1 FROM contacts WHERE org_id = $1 AND source = 'Facebook'`)).toHaveLength(2);

    const form = (await q(t, `SELECT last_sweep_at, sweep_checkpoint_at FROM meta_lead_forms WHERE org_id = $1`))[0]!;
    expect(form.last_sweep_at).toBeTruthy();
    const ov = await get(t.admin, '/v2/meta-lead-ads');
    expect(ov.body.pages[0].sync.lastSweepAt).toBeTruthy();
  });

  it('does not move the checkpoint past a failure, so the next run reads the window again', async () => {
    const t = await api.signup('mla-sweep2');
    const page = await connectPage(t);
    meta.forms.set(page.pageId, [aForm('66001', 'Sweep fail')]);
    await enable(t, page);
    await pick(t, page, '66001');
    meta.leads.set('66001', [aLead('66001')]);
    const svc = h.app.get(LeadgenService, { strict: false });
    const before = (await q(t, `SELECT sweep_checkpoint_at FROM meta_lead_forms WHERE org_id = $1`))[0]!.sweep_checkpoint_at as Date;
    meta.fail('listFormLeads', 2, 'Service temporarily unavailable');
    const out = await svc.sweepPage(t.orgId, page.pageId);
    expect(out.complete).toBe(0);
    const after = (await q(t, `SELECT sweep_checkpoint_at FROM meta_lead_forms WHERE org_id = $1`))[0]!.sweep_checkpoint_at as Date;
    expect(after.getTime()).toBe(before.getTime());
    meta.reset();
    meta.leads.set('66001', [aLead('66001')]);
    meta.forms.set(page.pageId, [aForm('66001', 'Sweep fail')]);
    expect((await svc.sweepPage(t.orgId, page.pageId)).complete).toBe(1);
  });

  it('reads leads created before the form was picked? No: the window starts when the form was picked', async () => {
    const t = await api.signup('mla-sweep3');
    const page = await connectPage(t);
    meta.forms.set(page.pageId, [aForm('67001', 'No backlog')]);
    await enable(t, page);
    await pick(t, page, '67001');
    const old = aLead('67001', { createdTime: new Date(Date.now() - 20 * 86_400_000).toISOString() });
    meta.leads.set('67001', [old]);
    const svc = h.app.get(LeadgenService, { strict: false });
    await svc.sweepPage(t.orgId, page.pageId);
    expect(await q(t, `SELECT 1 FROM lead_events WHERE org_id = $1`)).toHaveLength(0);
    const asked = meta.callsTo('listFormLeads')[0]!.args[1] as number;
    // Two hours of overlap before the pick, not twenty days.
    expect(Date.now() / 1000 - asked).toBeLessThan(3 * 3600);
  });

  it('skips a Page that is off, expired, lacks lead access or has only paused sources, and asks Meta nothing', async () => {
    const t = await api.signup('mla-sweep4');
    const page = await connectPage(t);
    const svc = h.app.get(LeadgenService, { strict: false });
    expect((await svc.sweepPage(t.orgId, page.pageId)).skipped).toBe(true);
    meta.forms.set(page.pageId, [aForm('68001', 'S')]);
    await enable(t, page);
    const src = await pick(t, page, '68001');
    await h.owner.query(`UPDATE lead_sources SET status = 'paused' WHERE org_id = $1 AND uuid = $2::uuid`, [t.orgId, src.sourceId]);
    expect((await svc.sweepPage(t.orgId, page.pageId)).skipped).toBe(true);
    await h.owner.query(`UPDATE lead_sources SET status = 'active' WHERE org_id = $1`, [t.orgId]);
    await h.owner.query(`UPDATE facebook_pages SET scopes = '["pages_show_list"]'::jsonb WHERE org_id = $1`, [t.orgId]);
    expect((await svc.sweepPage(t.orgId, page.pageId)).skipped).toBe(true);
    await h.owner.query(`UPDATE facebook_pages SET scopes = $2::jsonb, status = 'expired' WHERE org_id = $1`, [t.orgId, JSON.stringify(FULL_SCOPES)]);
    expect((await svc.sweepPage(t.orgId, page.pageId)).skipped).toBe(true);
    expect(meta.callsTo('listFormLeads')).toHaveLength(0);
  });

  it('the scheduler queues one job per Page that is on and has a form, across workspaces, and never twice', async () => {
    const a = await api.signup('mla-cron-a');
    const b = await api.signup('mla-cron-b');
    const c = await api.signup('mla-cron-c');
    for (const [t, withForm] of [[a, true], [b, true], [c, false]] as const) {
      const page = await connectPage(t);
      const id = `69${Date.now() % 100000}${t.orgId}`;
      meta.forms.set(page.pageId, [aForm(id, 'Cron')]);
      await enable(t, page);
      if (withForm) await pick(t, page, id);
    }
    const sweeper = h.app.get(LeadSweepService, { strict: false });
    const queued = await sweeper.run();
    expect(queued).toBeGreaterThanOrEqual(2);
    const queue = h.app.get<Queue>(getQueueToken(QUEUES.META_LEAD_SWEEP), { strict: false });
    // The worker in this process picks the jobs up and removes them; nothing is left behind to block the next tick.
    await waitFor(async () => (await queue.getJobCounts('waiting', 'active', 'delayed')).waiting === 0);
    expect(await sweeper.run()).toBeGreaterThanOrEqual(2);
  });
});

describe('a Page disconnected from the Facebook channel', () => {
  async function disconnectedEvent(t: Tenant, pageId: string) {
    return {
      id: '1',
      orgId: t.orgId,
      aggregateModule: 'facebook_pages',
      aggregateId: '1',
      eventType: 'facebook.page.disconnected',
      payload: { pageId },
    };
  }

  it('takes its lead sync with it: the sources of its forms are released, contacts stay', async () => {
    const t = await api.signup('mla-gone');
    const page = await connectPage(t);
    meta.forms.set(page.pageId, [aForm('70001', 'Gone')]);
    await enable(t, page);
    await pick(t, page, '70001');
    const lead = aLead('70001');
    meta.leads.set('70001', [lead]);
    await h.app.get(LeadgenService, { strict: false }).handleWebhook({ orgId: t.orgId, pageId: page.pageId, leadgenId: lead.id, formId: '70001', adId: null });

    await h.owner.query(`DELETE FROM facebook_pages WHERE org_id = $1`, [t.orgId]);
    await h.app.get(PageDisconnectConsumer, { strict: false }).handle(await disconnectedEvent(t, page.pageId));

    expect(await q(t, `SELECT 1 FROM meta_lead_pages WHERE org_id = $1`)).toHaveLength(0);
    expect(await q(t, `SELECT 1 FROM meta_lead_forms WHERE org_id = $1`)).toHaveLength(0);
    expect(await q(t, `SELECT 1 FROM lead_sources WHERE org_id = $1`)).toHaveLength(0);
    expect(await q(t, `SELECT 1 FROM contacts WHERE org_id = $1 AND source = 'Facebook'`)).toHaveLength(1);
    // Redelivered: nothing left to do, no error.
    await h.app.get(PageDisconnectConsumer, { strict: false }).handle(await disconnectedEvent(t, page.pageId));
  });

  it('leaves everything alone when the Page was connected again before the event ran', async () => {
    const t = await api.signup('mla-back');
    const page = await connectPage(t);
    meta.forms.set(page.pageId, [aForm('71001', 'Back')]);
    await enable(t, page);
    await pick(t, page, '71001');
    await h.app.get(PageDisconnectConsumer, { strict: false }).handle(await disconnectedEvent(t, page.pageId));
    expect(await q(t, `SELECT 1 FROM meta_lead_forms WHERE org_id = $1`)).toHaveLength(1);
    expect(await q(t, `SELECT 1 FROM lead_sources WHERE org_id = $1`)).toHaveLength(1);
  });
});

describe('tenant isolation of the lead worker', () => {
  it('a webhook for a Page connected by one workspace never writes into another', async () => {
    const a = await api.signup('mla-wiso-a');
    const b = await api.signup('mla-wiso-b');
    const page = await connectPage(a);
    meta.forms.set(page.pageId, [aForm('72001', 'A only')]);
    await enable(a, page);
    await pick(a, page, '72001');
    const lead = aLead('72001');
    meta.leads.set('72001', [lead]);
    const svc = h.app.get(LeadgenService, { strict: false });
    // Workspace B names A's Page and lead: B has no such Page, so nothing is read or written.
    expect(await svc.handleWebhook({ orgId: b.orgId, pageId: page.pageId, leadgenId: lead.id, formId: '72001', adId: null })).toEqual({ kind: 'skipped', reason: 'sync_off' });
    expect(await q(b, `SELECT 1 FROM lead_events WHERE org_id = $1`)).toHaveLength(0);
    expect(await q(b, `SELECT 1 FROM contacts WHERE org_id = $1`)).toHaveLength(0);
  });
});
