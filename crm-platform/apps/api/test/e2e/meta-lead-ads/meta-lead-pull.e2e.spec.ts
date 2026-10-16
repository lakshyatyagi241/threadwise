import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import {
  FACEBOOK_GRAPH,
  type FacebookGraphFactory,
} from '../../../src/infra/providers/channel-facebook/facebook.port';
import { LeadPullRegistry } from '../../../src/modules/leads/lead-pull.registry';
import { LeadSyncService } from '../../../src/modules/leads/lead-sync.service';
import { LeadgenService } from '../../../src/modules/meta-lead-ads/leadgen.service';
import { MetaLeadPullService } from '../../../src/modules/meta-lead-ads/meta-lead-pull.service';
import { Api, bearer, startHarness, type Harness, type Tenant } from '../deals-pipelines/support';
import { aForm, aLead, FakeMetaLeadAds } from '../../support/fake-meta-lead-ads-graph';

/**
 * "Sync now" and backfill for Meta lead forms (BL-204, BL-210), against a real Postgres and Redis and a FAKE Meta: no request leaves the
 * process and no second is waited (the pull's sleep is replaced). The path under test is the inbox's own: the HTTP ask, the run row, the
 * lead sync service running it as the worker does, the registry's Meta provider, the pull, the lead pipeline and the consent ledger.
 */
let h: Harness;
let api: Api;
let sync: LeadSyncService;
const meta = new FakeMetaLeadAds();
let graph: FacebookGraphFactory;
const sleeps: number[] = [];

const FULL_SCOPES = [
  'pages_show_list',
  'leads_retrieval',
  'pages_manage_ads',
  'pages_read_engagement',
];
const DAY = 86_400_000;

beforeAll(async () => {
  h = await startHarness({
    loadModules: async () => [
      (await import('../../../src/modules/meta-lead-ads')).MetaLeadAdsWorkerModule,
    ],
  });
  api = new Api(h);
  meta.install();
  sync = h.app.get(LeadSyncService, { strict: false });
  graph = h.app.get<FacebookGraphFactory>(FACEBOOK_GRAPH);
  Object.assign(graph.settings, {
    appId: '1234',
    appSecret: 'app-secret',
    configId: null,
    verifyToken: 'v',
    signingSecrets: [],
  });
}, 900_000);

afterAll(async () => {
  meta.uninstall();
  await h?.stop();
});

beforeEach(() => {
  meta.reset();
  sleeps.length = 0;
  vi.spyOn(MetaLeadPullService.prototype, 'sleep').mockImplementation(async (ms: number) => {
    sleeps.push(ms);
  });
});
afterEach(() => vi.restoreAllMocks());

let pageSeq = 0;
async function connectPage(t: Tenant): Promise<{ pageId: string; uuid: string }> {
  const pageId = `${810000 + ++pageSeq}${Date.now() % 1000}`;
  const token = h.app.get(CryptoService).encrypt(`page-token-${pageId}`);
  const r = await h.owner.query(
    `INSERT INTO facebook_pages (org_id, page_id, name, access_token, status, scopes)
     VALUES ($1,$2,$3,$4,'connected',$5::jsonb) RETURNING uuid`,
    [t.orgId, pageId, `Shop ${pageSeq}`, token, JSON.stringify(FULL_SCOPES)],
  );
  return { pageId, uuid: r.rows[0].uuid as string };
}

const get = (t: string, path: string) => api.http().get(path).set(bearer(t));
const post = (t: string, path: string, body: object = {}) =>
  api.http().post(path).set(bearer(t)).set('Idempotency-Key', randomUUID()).send(body);
const q = async (t: Tenant, sql: string, params: unknown[] = []) =>
  (await h.owner.query(sql, [t.orgId, ...params])).rows;

let formSeq = 0;
/** A workspace with a Page that has lead sync on and one picked form. */
async function setup(label: string, formOver: Parameters<typeof aForm>[2] = {}) {
  const t = await api.signup(label);
  const page = await connectPage(t);
  const formId = `${82000 + ++formSeq}${Date.now() % 100}`;
  const form = aForm(formId, 'Diwali form', formOver);
  meta.forms.set(page.pageId, [form]);
  const on = await post(t.admin, `/v2/meta-lead-ads/pages/${page.uuid}/enable`);
  expect(on.status, JSON.stringify(on.body)).toBe(200);
  const picked = await post(
    t.admin,
    `/v2/meta-lead-ads/pages/${page.uuid}/forms/${formId}/connect`,
  );
  expect(picked.status, JSON.stringify(picked.body)).toBe(200);
  return { t, page, form, formId, sourceId: picked.body.sourceId as string };
}

/** What the worker does with a queued run. */
async function runIt(t: Tenant, runUuid: string): Promise<Record<string, unknown>> {
  const [row] = await q(t, `SELECT id FROM lead_sync_runs WHERE org_id = $1 AND uuid = $2::uuid`, [
    runUuid,
  ]);
  await sync.execute(t.orgId, Number(row!.id));
  const [done] = await q(t, `SELECT * FROM lead_sync_runs WHERE org_id = $1 AND uuid = $2::uuid`, [
    runUuid,
  ]);
  return done!;
}

/** The cool-down between two asks of one source is the lead module's; a test ages the last ask instead of waiting for it. */
const ageRuns = (t: Tenant) =>
  h.owner.query(
    `UPDATE lead_sync_runs SET created_at = now() - interval '2 hours' WHERE org_id = $1`,
    [t.orgId],
  );

const aged = (formId: string, days: number, over: Parameters<typeof aLead>[1] = {}) =>
  aLead(formId, { createdTime: new Date(Date.now() - days * DAY).toISOString(), ...over });

describe('the Meta provider in the lead pipeline’s registry', () => {
  it('is registered once, whichever process registered it first', () => {
    const registry = h.app.get(LeadPullRegistry, { strict: false });
    const names = (registry as unknown as { providers: Array<{ name: string }> }).providers.map(
      (p) => p.name,
    );
    expect(names.filter((n) => n === 'meta_lead_ads')).toHaveLength(1);
  });

  it('offers Sync now and a backfill of up to ninety days for a picked form, and for nothing else', async () => {
    const { t, sourceId } = await setup('mlp-caps');
    const webhook = await api
      .http()
      .post('/v2/lead-sources')
      .set(bearer(t.admin))
      .send({ name: 'A webhook' });
    expect(webhook.status, JSON.stringify(webhook.body)).toBe(201);

    const res = await get(t.admin, '/v2/lead-inbox/sources');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const rows = res.body.data as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      sourceId,
      sourceKind: 'meta_lead_ads',
      canSync: true,
      canBackfill: true,
      maxBackfillDays: 90,
      minIntervalSeconds: 60,
      activeRun: null,
      lastRun: null,
    });
  });
});

describe('Sync now', () => {
  it('brings in the lead whose webhook never came, once, and counts what it already held as known', async () => {
    const { t, page, formId, sourceId } = await setup('mlp-sync');
    const held = aLead(formId, { createdTime: new Date(Date.now() - 20 * 60_000).toISOString() });
    const missed = aLead(formId, { createdTime: new Date(Date.now() - 10 * 60_000).toISOString() });
    meta.leads.set(formId, [held, missed]);
    // The webhook delivered one of them.
    const leadgen = h.app.get(LeadgenService, { strict: false });
    await leadgen.handleWebhook({
      orgId: t.orgId,
      pageId: page.pageId,
      leadgenId: held.id,
      formId,
      adId: null,
    });
    expect(
      await q(t, `SELECT 1 FROM contacts WHERE org_id = $1 AND source = 'Facebook'`),
    ).toHaveLength(1);

    const ask = await post(t.admin, `/v2/lead-inbox/sources/${sourceId}/sync`);
    expect(ask.status, JSON.stringify(ask.body)).toBe(202);
    const run = await runIt(t, ask.body.id);

    expect(run).toMatchObject({
      kind: 'sync',
      status: 'done',
      fetched: 2,
      accepted: 1,
      duplicates: 1,
      failed: 0,
      error: null,
    });
    expect(
      await q(t, `SELECT 1 FROM contacts WHERE org_id = $1 AND source = 'Facebook'`),
    ).toHaveLength(2);
    const events = await q(t, `SELECT external_id FROM lead_events WHERE org_id = $1 ORDER BY id`);
    expect(events.map((e) => e.external_id).sort()).toEqual([held.id, missed.id].sort());

    // the form reads as swept, like the sweep leaves it
    const [f] = await q(
      t,
      `SELECT last_sweep_at, last_lead_at FROM meta_lead_forms WHERE org_id = $1`,
    );
    expect(f!.last_sweep_at).toBeTruthy();
    expect(f!.last_lead_at).toBeTruthy();

    // and the run is on the screen's list with its counts
    const listed = (await get(t.admin, '/v2/lead-inbox/sources')).body.data[0];
    expect(listed.lastRun).toMatchObject({ status: 'done', accepted: 1, duplicates: 1 });
    expect(listed.nextSyncAt).not.toBeNull();
  });

  it('is audited and announced like every pull, and again within a minute is 429', async () => {
    const { t, sourceId, formId } = await setup('mlp-sync2');
    meta.leads.set(formId, [aLead(formId)]);
    const ask = await post(t.admin, `/v2/lead-inbox/sources/${sourceId}/sync`);
    expect(ask.status).toBe(202);
    await runIt(t, ask.body.id);
    const audit = await q(
      t,
      `SELECT action FROM audit_log WHERE org_id = $1 AND module = 'lead_sync_runs' ORDER BY id`,
    );
    expect(audit.map((a) => a.action)).toEqual(['insert', 'update']);
    const again = await post(t.admin, `/v2/lead-inbox/sources/${sourceId}/sync`);
    expect(again.status).toBe(429);
    expect(again.body.code).toBe('LEAD_SYNC_TOO_SOON');
  });

  it('does not pull another workspace’s source: it is not found', async () => {
    const a = await setup('mlp-iso-a');
    const b = await api.signup('mlp-iso-b');
    const res = await post(b.admin, `/v2/lead-inbox/sources/${a.sourceId}/sync`);
    expect(res.status).toBe(404);
    expect(meta.callsTo('pageFormLeads')).toHaveLength(0);
  });
});

describe('Backfill', () => {
  it('brings in leads from before the form was picked, oldest first, with the day they were submitted', async () => {
    const { t, formId, sourceId } = await setup('mlp-bf');
    const oldest = aged(formId, 18);
    const middle = aged(formId, 9);
    const recent = aged(formId, 1);
    const tooOld = aged(formId, 40);
    meta.leads.set(formId, [recent, tooOld, oldest, middle]);

    const res = await post(t.admin, '/v2/lead-inbox/backfill', {
      from: new Date(Date.now() - 20 * DAY).toISOString(),
      to: new Date().toISOString(),
      sourceIds: [sourceId],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body.runs).toHaveLength(1);
    const run = await runIt(t, res.body.runs[0].id);

    expect(run).toMatchObject({
      kind: 'backfill',
      status: 'done',
      fetched: 3,
      accepted: 3,
      duplicates: 0,
      failed: 0,
      error: null,
    });
    expect(run.windows_total).toBe(3);
    expect(run.windows_done).toBe(3);

    const events = await q(
      t,
      `SELECT external_id, received_at FROM lead_events WHERE org_id = $1 ORDER BY id`,
    );
    expect(events.map((e) => e.external_id)).toEqual([oldest.id, middle.id, recent.id]);
    // the lead event keeps the day the person applied, not the day it was pulled
    expect(
      Math.abs(
        new Date(events[0]!.received_at as string).getTime() - Date.parse(oldest.createdTime!),
      ),
    ).toBeLessThan(2000);
    expect(
      await q(t, `SELECT 1 FROM contacts WHERE org_id = $1 AND source = 'Facebook'`),
    ).toHaveLength(3);
  });

  it('is safe to run again: nothing is written twice, the second run only counts what is already known', async () => {
    const { t, formId, sourceId } = await setup('mlp-bf2');
    meta.leads.set(formId, [aged(formId, 5), aged(formId, 4), aged(formId, 3)]);
    const body = {
      from: new Date(Date.now() - 10 * DAY).toISOString(),
      to: new Date().toISOString(),
      sourceIds: [sourceId],
    };
    const first = await post(t.admin, '/v2/lead-inbox/backfill', body);
    await runIt(t, first.body.runs[0].id);
    await ageRuns(t);
    const second = await post(t.admin, '/v2/lead-inbox/backfill', body);
    expect(second.status, JSON.stringify(second.body)).toBe(202);
    const run = await runIt(t, second.body.runs[0].id);

    expect(run).toMatchObject({
      status: 'done',
      fetched: 3,
      accepted: 0,
      duplicates: 3,
      failed: 0,
    });
    expect(
      await q(t, `SELECT 1 FROM contacts WHERE org_id = $1 AND source = 'Facebook'`),
    ).toHaveLength(3);
    expect(await q(t, `SELECT 1 FROM lead_events WHERE org_id = $1`)).toHaveLength(3);
    // a lead already held is not even handed to the pipeline again
    expect(
      (
        await q(
          t,
          `SELECT coalesce(sum(duplicate_count), 0)::int AS n FROM lead_events WHERE org_id = $1`,
        )
      )[0]!.n,
    ).toBe(0);
  });

  it('reads a long list a hundred at a time and loses none of it', async () => {
    const { t, formId, sourceId } = await setup('mlp-bf3');
    const leads = Array.from({ length: 130 }, (_, i) =>
      aged(formId, 2, { createdTime: new Date(Date.now() - 2 * DAY + i * 1000).toISOString() }),
    );
    meta.leads.set(formId, leads);
    const res = await post(t.admin, '/v2/lead-inbox/backfill', {
      from: new Date(Date.now() - 3 * DAY).toISOString(),
      to: new Date().toISOString(),
      sourceIds: [sourceId],
    });
    const run = await runIt(t, res.body.runs[0].id);
    expect(run).toMatchObject({ status: 'done', fetched: 130, accepted: 130 });
    expect(meta.callsTo('pageFormLeads')).toHaveLength(2);
    expect(await q(t, `SELECT 1 FROM lead_events WHERE org_id = $1`)).toHaveLength(130);
  }, 120_000);

  it('does not move the sweep checkpoint: the sweep keeps reading its own window', async () => {
    const { t, formId, sourceId } = await setup('mlp-bf4');
    meta.leads.set(formId, [aged(formId, 2)]);
    const [before] = await q(
      t,
      `SELECT sweep_checkpoint_at FROM meta_lead_forms WHERE org_id = $1`,
    );
    const res = await post(t.admin, '/v2/lead-inbox/backfill', {
      from: new Date(Date.now() - 3 * DAY).toISOString(),
      to: new Date().toISOString(),
      sourceIds: [sourceId],
    });
    await runIt(t, res.body.runs[0].id);
    const [after] = await q(t, `SELECT sweep_checkpoint_at FROM meta_lead_forms WHERE org_id = $1`);
    expect(new Date(after!.sweep_checkpoint_at as string).getTime()).toBe(
      new Date(before!.sweep_checkpoint_at as string).getTime(),
    );
  });

  it('skips a range that reaches further back than Meta keeps, with its reason, and asks Meta nothing', async () => {
    const { t, sourceId } = await setup('mlp-bf5');
    const res = await post(t.admin, '/v2/lead-inbox/backfill', {
      from: new Date(Date.now() - 95 * DAY).toISOString(),
      to: new Date(Date.now() - 80 * DAY).toISOString(),
      sourceIds: [sourceId],
    });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body.runs).toEqual([]);
    expect(res.body.skipped).toEqual([{ sourceId, reason: 'range_too_old' }]);
    expect(meta.callsTo('pageFormLeads')).toHaveLength(0);
    expect(await q(t, `SELECT 1 FROM lead_sync_runs WHERE org_id = $1`)).toHaveLength(0);
  });

  it('a backfill over every source includes the Meta form, and skips a paused one with its reason', async () => {
    const { t, formId, sourceId } = await setup('mlp-bf6');
    meta.leads.set(formId, [aged(formId, 2)]);
    await h.owner.query(
      `UPDATE lead_sources SET status = 'paused' WHERE org_id = $1 AND uuid = $2::uuid`,
      [t.orgId, sourceId],
    );
    const res = await post(t.admin, '/v2/lead-inbox/backfill', {
      from: new Date(Date.now() - 3 * DAY).toISOString(),
      to: new Date().toISOString(),
    });
    expect(res.status, JSON.stringify(res.body)).toBe(202);
    expect(res.body.runs).toEqual([]);
    expect(res.body.skipped).toEqual([{ sourceId, reason: 'paused' }]);
  });
});

describe('consent is not changed by pulling', () => {
  const box = {
    key: 'cb1',
    text: 'I agree to be contacted on WhatsApp about my enquiry.',
    required: false,
  };
  const granted = (t: Tenant) =>
    q(
      t,
      `SELECT e.channel, e.source, e.evidence FROM contact_consent_events e WHERE e.org_id = $1 AND e.action = 'granted' ORDER BY e.channel`,
    );

  it('a backfilled lead that ticked the form’s disclaimer is recorded with its wording; one that did not grants nothing', async () => {
    const { t, formId, sourceId } = await setup('mlp-consent', { checkboxes: [box] });
    const yes = aged(formId, 5, { disclaimerResponses: [{ key: 'cb1', checked: true }] });
    const no = aged(formId, 4, { disclaimerResponses: [{ key: 'cb1', checked: false }] });
    const none = aged(formId, 3);
    meta.leads.set(formId, [yes, no, none]);
    const res = await post(t.admin, '/v2/lead-inbox/backfill', {
      from: new Date(Date.now() - 10 * DAY).toISOString(),
      to: new Date().toISOString(),
      sourceIds: [sourceId],
    });
    await runIt(t, res.body.runs[0].id);

    expect(
      await q(t, `SELECT 1 FROM contacts WHERE org_id = $1 AND source = 'Facebook'`),
    ).toHaveLength(3);
    const rows = await granted(t);
    // one lead granted, on the two channels it can be reached on; the other two granted nothing
    expect(rows.map((r) => [r.channel, r.source])).toEqual([
      ['email', 'lead'],
      ['whatsapp', 'lead'],
    ]);
    for (const r of rows) expect(r.evidence).toMatchObject({ leadFormId: formId });
  });

  it('a form whose wording is not known grants nothing, even for a ticked box', async () => {
    const { t, formId, sourceId } = await setup('mlp-consent2');
    meta.leads.set(formId, [
      aged(formId, 2, { disclaimerResponses: [{ key: 'cb1', checked: true }] }),
    ]);
    const res = await post(t.admin, '/v2/lead-inbox/backfill', {
      from: new Date(Date.now() - 5 * DAY).toISOString(),
      to: new Date().toISOString(),
      sourceIds: [sourceId],
    });
    await runIt(t, res.body.runs[0].id);
    expect(await q(t, `SELECT 1 FROM contacts WHERE org_id = $1`)).toHaveLength(1);
    expect(await granted(t)).toEqual([]);
  });
});

describe('when Meta slows us down or refuses', () => {
  it('waits out a rate limit and then finishes: nothing is lost', async () => {
    const { t, formId, sourceId } = await setup('mlp-rate');
    meta.leads.set(formId, [aLead(formId), aLead(formId)]);
    meta.fail('pageFormLeads', 613, 'Calls to this api have exceeded the rate limit.', 2);
    const ask = await post(t.admin, `/v2/lead-inbox/sources/${sourceId}/sync`);
    const run = await runIt(t, ask.body.id);
    expect(run).toMatchObject({ status: 'done', accepted: 2, error: null });
    expect(sleeps.filter((ms) => ms >= 5_000).reduce((a, b) => a + b, 0)).toBe(90_000);
  });

  it('stops when the limit does not lift: partly done with the code that says Meta asked us to wait, and a second run finishes it', async () => {
    const { t, formId, sourceId } = await setup('mlp-rate2');
    meta.leads.set(formId, [aLead(formId)]);
    meta.fail('pageFormLeads', 4, 'Application request limit reached');
    const ask = await post(t.admin, `/v2/lead-inbox/sources/${sourceId}/sync`);
    const run = await runIt(t, ask.body.id);
    expect(run).toMatchObject({ status: 'partial', error: 'too_soon', accepted: 0 });
    expect(JSON.stringify(run)).not.toContain('Application request limit');

    meta.reset();
    meta.leads.set(formId, [aLead(formId)]);
    await ageRuns(t);
    const again = await post(t.admin, `/v2/lead-inbox/sources/${sourceId}/sync`);
    expect(again.status, JSON.stringify(again.body)).toBe(202);
    expect(await runIt(t, again.body.id)).toMatchObject({ status: 'done', accepted: 1 });
  });

  it('a revoked token fails the run at once and the Page then says it needs to be reconnected', async () => {
    const { t, formId, sourceId } = await setup('mlp-token');
    meta.leads.set(formId, [aged(formId, 1)]);
    meta.fail('pageFormLeads', 190, 'Error validating access token: Session has expired');
    const ask = await post(t.admin, `/v2/lead-inbox/sources/${sourceId}/sync`);
    const run = await runIt(t, ask.body.id);
    expect(run).toMatchObject({ status: 'failed', error: 'credentials_refused' });
    expect(meta.callsTo('pageFormLeads')).toHaveLength(1);
    expect(JSON.stringify(run)).not.toContain('Session has expired');
    const overview = await get(t.admin, '/v2/meta-lead-ads');
    expect(overview.body.pages[0].sync.state).toBe('needs_reconnect');
  });

  it('a withheld permission fails the run with its own code and the Page says it needs lead access', async () => {
    const { t, formId, sourceId } = await setup('mlp-perm');
    meta.leads.set(formId, [aged(formId, 1)]);
    meta.fail('pageFormLeads', 200, '(#200) Requires leads_retrieval permission');
    const ask = await post(t.admin, `/v2/lead-inbox/sources/${sourceId}/sync`);
    const run = await runIt(t, ask.body.id);
    expect(run).toMatchObject({ status: 'failed', error: 'permission_missing' });
    const overview = await get(t.admin, '/v2/meta-lead-ads');
    expect(overview.body.pages[0].sync.state).toBe('needs_lead_access');
  });

  it('a Page with lead sync turned off, or no longer connected, is not pulled and Meta is not asked', async () => {
    const { t, page, formId, sourceId } = await setup('mlp-off');
    meta.leads.set(formId, [aged(formId, 1)]);
    await h.owner.query(`UPDATE meta_lead_pages SET enabled = false WHERE org_id = $1`, [t.orgId]);
    const ask = await post(t.admin, `/v2/lead-inbox/sources/${sourceId}/sync`);
    expect(ask.status, JSON.stringify(ask.body)).toBe(202);
    expect(await runIt(t, ask.body.id)).toMatchObject({ status: 'failed', error: 'not_active' });

    await h.owner.query(`UPDATE meta_lead_pages SET enabled = true WHERE org_id = $1`, [t.orgId]);
    await h.owner.query(
      `UPDATE facebook_pages SET status = 'expired' WHERE org_id = $1 AND page_id = $2`,
      [t.orgId, page.pageId],
    );
    await ageRuns(t);
    const again = await post(t.admin, `/v2/lead-inbox/sources/${sourceId}/sync`);
    expect(await runIt(t, again.body.id)).toMatchObject({ status: 'failed', error: 'not_active' });
    expect(meta.callsTo('pageFormLeads')).toHaveLength(0);
    expect(await q(t, `SELECT 1 FROM lead_events WHERE org_id = $1`)).toHaveLength(0);
  });
});
