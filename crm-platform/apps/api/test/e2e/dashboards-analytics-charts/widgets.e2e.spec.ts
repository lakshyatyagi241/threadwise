import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dashWidgetsSchema } from '@crm/contracts';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/**
 * The dashboard's data cards end to end through HTTP (TW-DASH-006, 011, 013..016, 019). Rows are arranged with the owner connection
 * (other domains own these tables); everything asserted goes through the API as a signed-in user.
 */
let h: Harness;
let api: Api;
let t: Tenant;
let other: Tenant;
const get = (tok: string) => api.as(tok).get('/v2/dashboard/widgets?range=7d');
const q = (text: string, p: unknown[]) => h.owner.query(text, p);

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  t = await api.signup('dwid');
  other = await api.signup('dwid2');

  // contacts: 4 live (1 unsubscribed) and 1 archived; 2 of them older than the 7-day window
  for (const [i, unsub, archived, ago] of [
    [1, false, false, '30 days'],
    [2, false, false, '30 days'],
    [3, true, false, '1 day'],
    [4, false, false, '1 day'],
    [5, false, true, '1 day'],
  ] as const) {
    await q(
      `INSERT INTO contacts (org_id, name, is_unsubscribed, is_archived, created_at) VALUES ($1, $2, $3, $4, now() - $5::interval)`,
      [t.orgId, `c${i}`, unsub, archived, ago],
    );
  }
  await q(`INSERT INTO contacts (org_id, name) VALUES ($1, 'foreign')`, [other.orgId]);

  // broadcasts: 2 running, 1 scheduled, 1 failed, 3 completed
  const tpl = await q(
    `INSERT INTO wa_templates (org_id, template_name, template_body, category, status, language) VALUES ($1, 'welcome', 'hi', 'marketing', 'approved', 'en') RETURNING id`,
    [t.orgId],
  );
  for (const [name, status, total, ok] of [
    ['b1', 'processing', 200, 50],
    ['b2', 'processing', 10, 0],
    ['b3', 'scheduled', 10, 0],
    ['b4', 'failed', 10, 0],
    ['b5', 'completed', 10, 10],
    ['b6', 'completed', 10, 10],
    ['b7', 'completed', 10, 10],
  ] as const) {
    await q(
      `INSERT INTO broadcasts (org_id, name, status, total_recipients, success_count, template_id) VALUES ($1, $2, $3, $4, $5, $6)`,
      [t.orgId, name, status, total, ok, tpl.rows[0].id],
    );
  }

  // devices: one online, one connecting
  await q(
    `INSERT INTO devices (org_id, device_name, phone_number, country_code, status, active, sent_24h, failed_24h)
     VALUES ($1, 'Main', '9876543210', '91', 'connected', true, 10, 1), ($1, 'Spare', '9000000000', '91', 'connecting', true, 0, 0)`,
    [t.orgId],
  );

  // template sends: 10 sends, 9 delivered, 5 read
  const ch = await q(
    `INSERT INTO channels (org_id, kind, name) VALUES ($1, 'simulator', 'sim') RETURNING id`,
    [t.orgId],
  );
  const conv = await q(
    `INSERT INTO conversations (org_id, channel_id, peer_key, title) VALUES ($1, $2, 'tpl-peer', 'tpl') RETURNING id`,
    [t.orgId, ch.rows[0].id],
  );
  await q(
    `INSERT INTO messages (org_id, conversation_id, seq, direction, sender_kind, status, read_at, kind, template_id, created_at)
     SELECT $1, $2, g, 'out', 'agent',
            CASE WHEN g <= 5 THEN 'read' WHEN g <= 9 THEN 'delivered' ELSE 'failed' END,
            CASE WHEN g <= 5 THEN now() END, 'template', $3, now() - interval '1 day'
     FROM generate_series(1, 10) g`,
    [t.orgId, conv.rows[0].id, tpl.rows[0].id],
  );

  // inbox: 4 conversations, 2 unread, 1 archived with unread
  for (const [title, unread, archived, ago] of [
    ['Ann', 2, false, '3 hours'],
    ['Bob', 0, false, '1 hour'],
    ['Cy', 1, false, '5 hours'],
    ['Hidden', 4, true, '10 hours'],
  ] as const) {
    const c = await q(
      `INSERT INTO channels (org_id, kind, name) VALUES ($1, 'simulator', 'sim') RETURNING id`,
      [t.orgId],
    );
    await q(
      `INSERT INTO conversations (org_id, channel_id, peer_key, title, unread_count, archived, last_message_at, preview)
       VALUES ($1, $2, $3, $4, $5, $6, now() - $7::interval, 'hello there')`,
      [t.orgId, c.rows[0].id, `p-${title}`, title, unread, archived, ago],
    );
  }

  // pipeline: 2 open (100.00 + 50.00), 1 won this month (30.00), 1 lost
  // signup already made the default pipeline with its stages
  const pl = await q(`SELECT id FROM pipelines WHERE org_id = $1 AND is_default`, [t.orgId]);
  const st = await q(
    `SELECT id FROM pipeline_stages WHERE org_id = $1 AND pipeline_id = $2 ORDER BY id LIMIT 1`,
    [t.orgId, pl.rows[0].id],
  );
  for (const [title, status, value] of [
    ['d1', 'open', 10000],
    ['d2', 'open', 5000],
    ['d3', 'won', 3000],
    ['d4', 'lost', 1000],
  ] as const) {
    await q(
      `INSERT INTO deals (org_id, pipeline_id, stage_id, title, value_minor, currency, status, won_at, lost_at)
       VALUES ($1, $2, $3, $4, $5, 'USD', $6, CASE WHEN $6 = 'won' THEN now() END, CASE WHEN $6 = 'lost' THEN now() END)`,
      [t.orgId, pl.rows[0].id, st.rows[0].id, title, value, status],
    );
  }
  for (const [tenant, on] of [
    [t, true],
    [other, false],
  ] as const) {
    await q(`UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`, [
      tenant.orgId,
      JSON.stringify({ features: { sales_pipeline: on } }),
    ]);
  }
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

describe('GET /v2/dashboard/widgets', () => {
  it('is gated on dash.dashboard.read', async () => {
    const none = await api.member(t, 'nowidgets', [['record.contacts.read']]);
    expect((await get(none.token)).status).toBe(403);
    expect((await api.http().get('/v2/dashboard/widgets')).status).toBe(401);
  });

  it('TW-DASH-006: subscribed, blocked and growth against the contacts that existed before the window', async () => {
    const res = await get(t.admin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(dashWidgetsSchema.parse(res.body).contacts).toEqual({
      total: 4,
      subscribed: 3,
      blocked: 1,
      deltaPct: 100, // 2 before the window, 4 now
    });
  });

  it('TW-DASH-006: no contacts reads zero', async () => {
    const empty = await api.signup('dwid3');
    expect((await get(empty.admin)).body.contacts).toEqual({
      total: 0,
      subscribed: 0,
      blocked: 0,
      deltaPct: 0,
    });
  });

  it('TW-DASH-013: the status buckets, the total including completed, and per-row progress', async () => {
    const c = (await get(t.admin)).body.campaigns;
    expect(c).toMatchObject({ running: 2, scheduled: 1, paused: 1, total: 7 });
    expect(c.recent).toHaveLength(4);
    expect(c.recent[0].template).toBe('welcome');
    // 4 most recently updated first; b1 (50 of 200) is the oldest of the running pair
    await q(`UPDATE broadcasts SET updated_at = now() WHERE org_id = $1 AND name = 'b1'`, [
      t.orgId,
    ]);
    const again = (await get(t.admin)).body.campaigns.recent[0];
    expect(again).toMatchObject({ name: 'b1', done: 50, total: 200, pct: 25 });
  });

  it('TW-DASH-013: no broadcasts is an empty list', async () => {
    expect((await get(other.admin)).body.campaigns).toEqual({
      running: 0,
      scheduled: 0,
      paused: 0,
      total: 0,
      recent: [],
    });
  });

  it('TW-DASH-014: connecting is not online; slots never fall below the device count', async () => {
    const d = (await get(t.admin)).body.devices;
    expect(d.total).toBe(2);
    expect(d.online).toBe(1);
    expect(d.slotCap).toBeGreaterThanOrEqual(2);
    const main = d.rows.find((r: { label: string }) => r.label === 'Main');
    expect(main).toMatchObject({
      state: 'online',
      sent24h: 10,
      deliveryPct: 90,
      phone: '+91 9876543210',
    });
    expect(d.rows.find((r: { label: string }) => r.label === 'Spare').state).toBe('connecting');
  });

  it('TW-DASH-015: 10 sends, 9 delivered, 5 read shows 50.0% read and 90 performance', async () => {
    const tp = (await get(t.admin)).body.templates;
    expect(tp.count).toBe(1);
    expect(tp.rows[0]).toMatchObject({
      name: 'welcome',
      sent: 10,
      delivered: 9,
      read: 5,
      readRatePct: 50,
      performance: 90,
    });
  });

  it('TW-DASH-016: unread counts chats, never archived ones; the three most recent are listed', async () => {
    const i = (await get(t.admin)).body.inbox;
    expect(i.unread).toBe(2);
    expect(i.recent.map((r: { title: string }) => r.title)).toEqual(['Bob', 'Ann', 'Cy']);
    expect(i.recent[0].preview).toBe('hello there');
    expect(i.oldestUnreadAt).toBeTruthy();
  });

  it('TW-DASH-011: the pipeline strip needs the plan feature; open value, won this month, win rate', async () => {
    expect((await get(t.admin)).body.pipeline).toEqual({
      currency: 'INR', // the default pipeline's currency
      openValueMinor: '15000',
      openDeals: 2,
      wonThisMonthMinor: '3000',
      winRatePct: 50,
    });
    expect((await get(other.admin)).body.pipeline).toBeNull();
  });

  it('TW-DASH-019: the activity widget lists this workspace only', async () => {
    await q(
      `INSERT INTO audit_log (org_id, actor_type, module, record_id, action, at) VALUES ($1, 'user', 'contacts', 1, 'create', now()), ($2, 'user', 'deals', 1, 'update', now())`,
      [t.orgId, other.orgId],
    );
    const a = (await get(t.admin)).body.activity;
    expect(a.every((r: { module: string }) => r.module !== 'deals')).toBe(true);
    expect(a.some((r: { module: string }) => r.module === 'contacts')).toBe(true);
  });
});
