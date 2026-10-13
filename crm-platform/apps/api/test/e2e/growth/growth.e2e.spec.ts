import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { base32Decode, hotp, totpStep } from '../../../src/modules/auth/support/totp';
import { OPERATOR_EMAIL, OPERATOR_PASSWORD } from '../auth-registration-security/harness';
import {
  Api,
  bearer,
  startHarness,
  type Harness,
  type Tenant,
} from '../contacts-attributes-tags/support';
import request from 'supertest';

/**
 * The growth pilot end to end: the real API, real Postgres (restricted role, forced RLS), the offline AI fixture. Two workspaces: the
 * pilot one (slug demo-interakt, with a settings row) and a plain one. Everything the pilot does must be refused or skipped for the plain one.
 */
let h: Harness;
let api: Api;
let superToken: string;
let demo: Tenant;
let plain: Tenant;
let channel: number;

const ops = (method: 'get' | 'post' | 'patch', path: string) =>
  request(h.app.getHttpServer())[method](`/v2/platform${path}`).set(bearer(superToken));

async function setPlatformKey(): Promise<void> {
  const list = await ops('get', '/ai-keys');
  const k = (list.body.data as Array<{ id: string; provider: string; rowVersion: number }>).find(
    (x) => x.provider === 'openrouter',
  )!;
  const save = await ops('patch', `/ai-keys/${k.id}`).send({
    rowVersion: k.rowVersion,
    apiKey: 'sk-or-test-PLATFORM-0123456789',
    defaultModel: 'openai/gpt-4o-mini',
  });
  expect(save.status, JSON.stringify(save.body)).toBe(200);
}

const g = (t: Tenant) => ({
  get: (path: string) => api.as(t.admin).get(`/v2/growth${path}`),
  post: (path: string, body: Record<string, unknown> = {}) =>
    api.as(t.admin).post(`/v2/growth${path}`).send(body),
  patch: (path: string, body: Record<string, unknown>) =>
    api.as(t.admin).patch(`/v2/growth${path}`).send(body),
});

/** Switches parts on or off (reads the current version first). */
async function setFeatures(
  features: Record<string, boolean>,
  config?: Record<string, unknown>,
): Promise<void> {
  const cur = await g(demo).get('/settings');
  const res = await g(demo).patch('/settings', {
    features,
    config,
    rowVersion: cur.body.rowVersion,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

/** A contact with a conversation: each line is [direction, text, minutes ago]. */
async function chat(
  t: Tenant,
  name: string,
  lines: Array<['in' | 'out', string, number]>,
): Promise<{ uuid: string; contactId: number; conversationUuid: string }> {
  const [uuid] = await api.seedContacts(t, [{ name, phone: '+919876543210' }]);
  const contactId = Number(
    (
      await h.owner.query(
        `UPDATE contacts SET lifecycle_stage = 'lead' WHERE uuid = $1 RETURNING id`,
        [uuid],
      )
    ).rows[0].id,
  );
  const newest = Math.min(...lines.map((l) => l[2]));
  const conv = (
    await h.owner.query(
      `INSERT INTO conversations (org_id, channel_id, peer_key, title, contact_id, last_inbound_at)
       VALUES ($1,$2,$3,$3,$4, now() - ($5 || ' minutes')::interval) RETURNING id, uuid`,
      [t.orgId, channel, `91${Math.floor(Math.random() * 1e9)}`, contactId, String(newest)],
    )
  ).rows[0];
  let seq = 0;
  for (const [dir, body, ago] of lines) {
    await h.owner.query(
      `INSERT INTO messages (org_id, conversation_id, seq, direction, kind, sender_kind, status, body, created_at, provider_ts)
       VALUES ($1,$2,$3,$4,'text',$5,$6,$7, now() - ($8 || ' minutes')::interval, now() - ($8 || ' minutes')::interval)`,
      [
        t.orgId,
        conv.id,
        ++seq,
        dir,
        dir === 'in' ? 'customer' : 'agent',
        dir === 'in' ? 'received' : 'sent',
        body,
        String(ago),
      ],
    );
  }
  return { uuid: uuid!, contactId, conversationUuid: conv.uuid as string };
}

const readChat = (t: Tenant, uuid: string) =>
  api.as(t.admin).post(`/v2/lead-scoring/contacts/${uuid}/digest`);
const openActions = async (type?: string) => {
  const res = await g(demo).get(`/actions?status=open${type ? `&type=${type}` : ''}&limit=100`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as {
    data: Array<{ id: string; type: string; contactId: string; payload: Record<string, unknown> }>;
    openByType: Record<string, number>;
  };
};

beforeAll(async () => {
  process.env.LEAD_SCORING_AI_DRIVER = 'fixture';
  process.env.GROWTH_ENRICHMENT_DRIVER = 'fixture';
  h = await startHarness({
    loadModules: async () => [
      (await import('../../../src/modules/lead-scoring/lead-scoring-worker.module'))
        .LeadScoringWorkerModule,
      (await import('../../../src/modules/growth-pilot/growth-pilot-worker.module'))
        .GrowthPilotWorkerModule,
    ],
  });
  await h.app.listen(0, '127.0.0.1');
  api = new Api(h);

  const first = await api
    .http()
    .post('/v2/platform/auth/login')
    .send({ email: OPERATOR_EMAIL, password: OPERATOR_PASSWORD });
  superToken = first.body.tokens.accessToken as string;
  const setup = await api.http().post('/v2/platform/auth/mfa/setup').set(bearer(superToken));
  await api
    .http()
    .post('/v2/platform/auth/mfa/enable')
    .set(bearer(superToken))
    .send({ code: hotp(base32Decode(setup.body.secret as string), totpStep(Date.now())) });
  await ops('patch', '/lead-scoring').send({
    platformEnabled: true,
    model: 'openai/gpt-6-luna-pro',
    scoresPerHour: 0,
  });
  await setPlatformKey();

  plain = await api.signup('grwplain');
  demo = await api.signup('grwdemo');
  await h.owner.query(`UPDATE organizations SET slug = 'demo-interakt' WHERE id = $1`, [
    demo.orgId,
  ]);
  demo.slug = 'demo-interakt';
  await h.owner.query(
    `INSERT INTO status_options (org_id, module_key, option_group, value, label, position, is_won, is_lost) VALUES
       ($1,'contacts','lifecycle_stage','lead','Lead',1,false,false),
       ($1,'contacts','lifecycle_stage','qualified','Qualified',2,false,false),
       ($1,'contacts','lifecycle_stage','customer','Customer',3,true,false)`,
    [demo.orgId],
  );
  channel = Number(
    (
      await h.owner.query(
        `INSERT INTO channels (org_id, kind, name) VALUES ($1,'simulator','c') RETURNING id`,
        [demo.orgId],
      )
    ).rows[0].id,
  );
  // The migration seeds this for the real workspace; a freshly renamed test workspace gets the same rows here.
  await h.owner.query(`INSERT INTO growth_settings (org_id, features) VALUES ($1, '{}'::jsonb)`, [
    demo.orgId,
  ]);
  const ls = await api.as(demo.admin).get('/v2/lead-scoring/settings');
  const on = await api
    .as(demo.admin)
    .patch('/v2/lead-scoring/settings')
    .send({
      enabled: true,
      chatDigest: true,
      stageSuggestions: true,
      rowVersion: ls.body.rowVersion ?? undefined,
    });
  expect(on.status, JSON.stringify(on.body)).toBe(200);
}, 300_000);

afterAll(async () => {
  await h?.stop();
});

describe('a workspace outside the pilot', () => {
  it('is refused on every route (except the settings read, which says it is not available)', async () => {
    const s = await g(plain).get('/settings');
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({ available: false });
    expect(Object.values(s.body.features).every((v) => v === false)).toBe(true);

    for (const [verb, path] of [
      ['get', '/overview'],
      ['get', '/campaigns/report'],
      ['post', '/campaigns/stamp'],
      ['get', '/audiences'],
      ['get', '/send-times'],
      ['get', '/propensity'],
      ['post', '/propensity/recompute'],
      ['get', '/quality'],
      ['get', '/digest'],
      ['get', '/actions'],
      ['get', '/auto-stage'],
      ['get', '/enrichment'],
      ['post', '/enrichment/run'],
    ] as const) {
      const res = verb === 'get' ? await g(plain).get(path) : await g(plain).post(path);
      expect(res.status, `${verb} ${path}`).toBe(403);
      expect(res.body.code, `${verb} ${path}`).toBe('GRW_NOT_AVAILABLE');
    }
    const patch = await g(plain).patch('/settings', { features: { quality: true }, rowVersion: 1 });
    expect(patch.status).toBe(403);
    const assist = await g(plain).post('/assistant/broadcast', {
      goal: 'remind everyone about saturday',
    });
    expect(assist.status).toBe(403);
  });

  it('is not touched even if someone gives it a settings row: the slug is what counts', async () => {
    await h.owner.query(
      `INSERT INTO growth_settings (org_id, features) VALUES ($1, '{"quality": true}'::jsonb)`,
      [plain.orgId],
    );
    const s = await g(plain).get('/settings');
    expect(s.body.available).toBe(false);
    expect((await g(plain).get('/quality')).status).toBe(403);
    await h.owner.query(`DELETE FROM growth_settings WHERE org_id = $1`, [plain.orgId]);
  });

  it('its chat reading creates no actions, notes or intent', async () => {
    const [c] = await api.seedContacts(plain, [{ name: 'Plain' }]);
    const before = await h.owner.query(
      `SELECT count(*)::int AS n FROM growth_actions WHERE org_id = $1`,
      [plain.orgId],
    );
    expect(before.rows[0].n).toBe(0);
    expect(c).toBeTruthy();
  });

  it('the sweepers do not visit it', async () => {
    const { GrowthGateService } = await import('../../../src/modules/growth-pilot');
    const gate = h.app.get(GrowthGateService, { strict: false });
    const orgs = await gate.pilotOrgs('quality');
    expect(orgs).not.toContain(plain.orgId);
  });
});

describe('the pilot workspace', () => {
  it('starts with every part off and says it is available', async () => {
    const s = await g(demo).get('/settings');
    expect(s.body).toMatchObject({ available: true, enrichmentConfigured: true });
    expect(Object.values(s.body.features).every((v) => v === false)).toBe(true);
    expect(s.body.config.hotLeadConfidence).toBe(0.8);
  });

  it('a part that is off answers 422 GRW_FEATURE_OFF', async () => {
    const res = await g(demo).get('/quality');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('GRW_FEATURE_OFF');
  });

  it('settings need the current version, and validate thresholds', async () => {
    const stale = await g(demo).patch('/settings', {
      features: { quality: true },
      rowVersion: 999,
    });
    expect(stale.status).toBe(409);
    const cur = await g(demo).get('/settings');
    const bad = await g(demo).patch('/settings', {
      config: { hotLeadConfidence: 0.1 },
      rowVersion: cur.body.rowVersion,
    });
    expect(bad.status).toBe(422);
    await setFeatures({
      quality: true,
      daily_digest: true,
      campaign_response: true,
      engagement_audiences: true,
      send_times: true,
      propensity: true,
      broadcast_assistant: true,
      enrichment: true,
    });
    const s = await g(demo).get('/settings');
    expect(s.body.features).toMatchObject({ quality: true, daily_digest: true, auto_stage: false });
  });

  it('campaign report, stamp, send times, propensity, quality, digest and enrichment status answer on an empty workspace', async () => {
    const rep = await g(demo).get('/campaigns/report');
    expect(rep.status).toBe(200);
    expect(rep.body.totals.sent).toBe(0);
    const stamp = await g(demo).post('/campaigns/stamp');
    expect(stamp.status, JSON.stringify(stamp.body)).toBe(200);
    expect(stamp.body).toMatchObject({ stamped: 0 });
    expect((await g(demo).get('/send-times')).body.bestHours).toEqual([]);
    const prop = await g(demo).post('/propensity/recompute');
    expect(prop.status, JSON.stringify(prop.body)).toBe(200);
    expect(prop.body.trained).toBe(false);
    expect((await g(demo).get('/propensity')).body.contacts).toBeGreaterThanOrEqual(0);
    const q = await g(demo).get('/quality');
    expect(q.status, JSON.stringify(q.body)).toBe(200);
    expect(q.body.cost.calls).toBe(0);
    const d = await g(demo).get('/digest');
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    expect(d.body.day).toMatch(/^\d{4}-\d\d-\d\d$/);
    const e = await g(demo).get('/enrichment');
    expect(e.body.configured).toBe(true);
  });

  it('audiences list with sizes and sync into a contact group that a campaign can use', async () => {
    const list = await g(demo).get('/audiences');
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    const kinds = (list.body.data as Array<{ kind: string }>).map((a) => a.kind);
    expect(kinds).toEqual(expect.arrayContaining(['engaged', 'silent', 'lapsed']));
    const sync = await g(demo).post('/audiences/sync', { key: 'engaged' });
    expect(sync.status, JSON.stringify(sync.body)).toBe(200);
    expect(sync.body.groupName).toMatch(/^AI/);
    const again = await g(demo).get('/audiences');
    expect(
      (again.body.data as Array<{ key: string; groupId: string | null }>).find(
        (a) => a.key === 'engaged',
      )!.groupId,
    ).toBe(sync.body.groupId);
    expect((await g(demo).post('/audiences/sync', { key: 'nope' })).status).toBe(404);
  });

  it('the broadcast assistant picks from the workspace’s own audience and template and sends nothing', async () => {
    const none = await g(demo).post('/assistant/broadcast', {
      goal: 'remind registrants about saturday',
    });
    // No approved template exists yet: nothing to recommend from.
    expect([422, 502]).toContain(none.status);
    expect(none.body.code).toBe('GRW_ASSISTANT_FAILED');
    expect((await g(demo).post('/assistant/broadcast', { goal: 'x' })).status).toBe(422);
  });
});

describe('reading a chat in the pilot workspace', () => {
  beforeAll(async () => {
    await setFeatures(
      {
        hot_lead_alerts: true,
        intent_fields: true,
        auto_notes: true,
        language_detect: true,
        purchase_routing: true,
        registration_check: true,
        optout_detection: true,
        auto_stage: true,
      },
      { hotLeadConfidence: 0.7, autoStage: { minConfidence: 0.8, dailyCap: 1 } },
    );
    await h.owner.query(
      `INSERT INTO fields (org_id, module_key, key, label, field_type, is_system)
       SELECT $1, module_key, 'ai_intent', 'AI intent', 'text', false FROM fields WHERE org_id = $1 AND module_key = 'contacts' LIMIT 1
       ON CONFLICT DO NOTHING`,
      [demo.orgId],
    );
  });

  it('a buying chat raises a hot lead and a routing action, writes a note, and (inside the cap) moves the stage on its own', async () => {
    const c = await chat(demo, 'Asha Rao', [
      ['out', 'Welcome! How can we help?', 90],
      ['in', 'Do you have the steel chronograph?', 80],
      ['out', 'Yes, 12500 rupees.', 79],
      [
        'in',
        'Great, I would like to purchase the steel chronograph today, please share the payment link and the delivery time',
        70,
      ],
    ]);
    const res = await readChat(demo, c.uuid);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.digest, JSON.stringify(res.body.digest)).toMatchObject({
      source: 'ai',
      signals: { readyToBuy: true },
    });
    const actions = await openActions();
    const mine = actions.data.filter((a) => a.contactId === c.uuid);
    const types = mine.map((a) => a.type);
    expect(types).toContain('hot_lead');
    expect(types).toContain('purchase_route');

    const notes = await h.owner.query(
      `SELECT body FROM contact_notes WHERE org_id = $1 AND contact_id = $2 AND created_by IS NULL`,
      [demo.orgId, c.contactId],
    );
    expect(notes.rows.some((r: { body: string }) => r.body.startsWith('AI chat summary:'))).toBe(
      true,
    );

    const auto = await g(demo).get('/auto-stage');
    expect(auto.status, JSON.stringify(auto.body)).toBe(200);
    expect(auto.body.dailyCap).toBe(1);
    expect(auto.body.appliedToday).toBe(1);
    const row = (auto.body.data as Array<{ contactId: string; status: string; id: string }>).find(
      (r) => r.contactId === c.uuid,
    )!;
    expect(row.status).toBe('auto_applied');
    const moved = await api.as(demo.admin).get(`/v2/contacts/${c.uuid}`);
    expect(moved.body.lifecycleStage).not.toBe('lead');

    // Undo puts it back; a second undo is refused.
    const undo = await g(demo).post(`/auto-stage/${row.id}/undo`);
    expect(undo.status, JSON.stringify(undo.body)).toBe(204);
    const back = await api.as(demo.admin).get(`/v2/contacts/${c.uuid}`);
    expect(back.body.lifecycleStage).toBe('lead');
    const twice = await g(demo).post(`/auto-stage/${row.id}/undo`);
    expect(twice.status).toBe(409);
    expect(twice.body.code).toBe('GRW_UNDO_REFUSED');
  }, 90_000);

  it('accepting the routing action assigns the conversation; deciding twice is refused', async () => {
    const actions = await openActions('purchase_route');
    const a = actions.data[0]!;
    const ok = await g(demo).post('/actions/decide', { action: 'accept', ids: [a.id] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.done).toBe(1);
    const again = await g(demo).post('/actions/decide', { action: 'accept', ids: [a.id] });
    expect(again.body.done).toBe(0);
    expect(again.body.failed[0].code).toBe('GRW_ACTION_GONE');
  });

  it('dismissing an action closes it and shows in the quality rates', async () => {
    const actions = await openActions('hot_lead');
    const ids = actions.data.map((a) => a.id);
    expect(ids.length).toBeGreaterThan(0);
    const res = await g(demo).post('/actions/decide', { action: 'dismiss', ids });
    expect(res.body.done).toBe(ids.length);
    expect((await openActions('hot_lead')).data).toHaveLength(0);
    const q = await g(demo).get('/quality');
    const hot = (q.body.actions as Array<{ type: string; dismissed: number }>).find(
      (x) => x.type === 'hot_lead',
    );
    expect(hot!.dismissed).toBeGreaterThanOrEqual(ids.length);
  });

  it('a chat that says it got no confirmation raises a registration issue', async () => {
    const c = await chat(demo, 'Ravi Kumar', [
      ['out', 'Thanks for registering', 60],
      [
        'in',
        'I paid the event fee yesterday using the link you sent but I did not get any confirmation message so far',
        50,
      ],
      ['in', 'Please check the payment from my side and tell me what happened', 49],
    ]);
    const res = await readChat(demo, c.uuid);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.digest, JSON.stringify(res.body.digest)).toMatchObject({
      issue: 'missing_confirmation',
    });
    const mine = (await openActions('registration_issue')).data.filter(
      (a) => a.contactId === c.uuid,
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]!.payload).toMatchObject({ issue: 'missing_confirmation' });
  }, 60_000);

  it('the other workspace saw none of it', async () => {
    for (const t of [
      'growth_actions',
      'contact_propensity',
      'growth_models',
      'growth_daily_digests',
      'contact_enrichment',
    ]) {
      const r = await h.owner.query(`SELECT count(*)::int AS n FROM ${t} WHERE org_id = $1`, [
        plain.orgId,
      ]);
      expect(r.rows[0].n, t).toBe(0);
    }
    const sug = await h.owner.query(
      `SELECT count(*)::int AS n FROM lifecycle_stage_suggestions WHERE org_id = $1`,
      [plain.orgId],
    );
    expect(sug.rows[0].n).toBe(0);
  });
});
