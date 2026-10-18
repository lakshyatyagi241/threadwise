import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyticsPanelsSchema } from '@crm/contracts';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/** The analytics list panels end to end (TW-DASH-026, 028, 030): rows arranged with the owner connection, asserted through HTTP. */
let h: Harness;
let api: Api;
let t: Tenant;
const q = (text: string, p: unknown[]) => h.owner.query(text, p);
const get = (tok: string) => api.as(tok).get('/v2/analytics/panels?range=30d');

async function conversation(title: string, assignee: number | null): Promise<number> {
  const ch = await q(
    `INSERT INTO channels (org_id, kind, name) VALUES ($1, 'simulator', 'sim') RETURNING id`,
    [t.orgId],
  );
  const r = await q(
    `INSERT INTO conversations (org_id, channel_id, peer_key, title, assignee_user_id, created_at)
     VALUES ($1, $2, $3, $4, $5, now() - interval '2 days') RETURNING id`,
    [t.orgId, ch.rows[0].id, `peer-${title}`, title, assignee],
  );
  return Number(r.rows[0].id);
}

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  t = await api.signup('dpan');
  await q(`UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`, [
    t.orgId,
    JSON.stringify({ features: { analytics: true } }),
  ]);

  // templates: 10 exist, the 8 most recently edited are listed, busiest first
  for (let i = 1; i <= 10; i++) {
    await q(
      `INSERT INTO wa_templates (org_id, template_name, template_body, category, language, status, updated_at)
       VALUES ($1, $2, 'b', 'marketing', 'en', 'approved', now() - ($3 || ' hours')::interval)`,
      [t.orgId, `tpl${i}`, String(i)],
    );
  }
  const tpl = await q(`SELECT id FROM wa_templates WHERE org_id = $1 AND template_name = 'tpl3'`, [
    t.orgId,
  ]);

  // conversations: Ann 6 messages, Bob 2; Ann's carries 3 template sends
  const ann = await conversation('Ann', t.adminUserId);
  const bob = await conversation('Bob', t.adminUserId);
  await q(
    `INSERT INTO messages (org_id, conversation_id, seq, direction, sender_kind, status, kind, template_id, created_at)
     SELECT $1, $2, g, CASE WHEN g <= 3 THEN 'out' ELSE 'in' END, CASE WHEN g <= 3 THEN 'agent' ELSE 'customer' END, CASE WHEN g <= 3 THEN 'sent' ELSE 'received' END, CASE WHEN g <= 3 THEN 'template' ELSE 'text' END,
            CASE WHEN g <= 3 THEN $3::bigint END, now() - interval '1 day'
     FROM generate_series(1, 6) g`,
    [t.orgId, ann, tpl.rows[0].id],
  );
  await q(
    `INSERT INTO messages (org_id, conversation_id, seq, direction, sender_kind, status, kind, created_at)
     SELECT $1, $2, g, 'in', 'customer', 'received', 'text', now() - interval '1 day' FROM generate_series(1, 2) g`,
    [t.orgId, bob],
  );

  // team: Ann resolved after 60 min, first response after 12.5 min on average; two CSAT ratings 4 and 5
  await q(
    `UPDATE conversations SET first_response_at = created_at + interval '10 minutes', resolved_at = created_at + interval '60 minutes' WHERE id = $2 AND org_id = $1`,
    [t.orgId, ann],
  );
  await q(
    `UPDATE conversations SET first_response_at = created_at + interval '15 minutes' WHERE id = $2 AND org_id = $1`,
    [t.orgId, bob],
  );
  for (const [conv, rating] of [
    [ann, 4],
    [bob, 5],
  ] as const) {
    await q(
      `INSERT INTO csat_responses (org_id, conversation_id, agent_user_id, rating, responded_at) VALUES ($1, $2, $3, $4, now())`,
      [t.orgId, conv, t.adminUserId, rating],
    );
  }
  await q(
    `INSERT INTO devices (org_id, device_name, phone_number, country_code, status, active, sent_24h) VALUES ($1, 'Main', '9876543210', '91', 'connected', true, 7), ($1, 'Idle', '9000000000', '91', 'disconnected', false, 0)`,
    [t.orgId],
  );
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

describe('GET /v2/analytics/panels', () => {
  it('needs dash.analytics.read and the plan feature', async () => {
    const none = await api.member(t, 'nopanels', [['dash.dashboard.read']]);
    expect((await get(none.token)).status).toBe(403);
    expect((await api.http().get('/v2/analytics/panels')).status).toBe(401);
  });

  it('TW-DASH-028: at most 8 templates, busiest first; a quiet template is still listed', async () => {
    const res = await get(t.admin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const p = analyticsPanelsSchema.parse(res.body);
    expect(p.templates).toHaveLength(8);
    expect(p.templates[0]).toMatchObject({
      name: 'tpl3',
      sends: 3,
      category: 'marketing',
      language: 'en',
    });
    expect(p.templates.some((x) => x.name === 'tpl10')).toBe(false); // older than the latest 8
  });

  it('TW-DASH-028: top conversations by message count in the window', async () => {
    const p = analyticsPanelsSchema.parse((await get(t.admin)).body);
    expect(p.contacts.map((c) => [c.title, c.messages])).toEqual([
      ['Ann', 6],
      ['Bob', 2],
    ]);
  });

  it('TW-DASH-026: senders busiest first with the online flag', async () => {
    const p = analyticsPanelsSchema.parse((await get(t.admin)).body);
    expect(p.devices.total).toBe(2);
    expect(p.devices.online).toBe(1);
    expect(p.devices.rows[0]).toMatchObject({ sent: 7, online: true });
    expect(p.devices.rows[0]!.label).toContain('Main');
  });

  it('TW-DASH-030: per-agent conversations, resolved, averages and CSAT "4.50 (2)"', async () => {
    const p = analyticsPanelsSchema.parse((await get(t.admin)).body);
    expect(p.team).toHaveLength(1);
    expect(p.team[0]).toMatchObject({
      conversations: 2,
      resolved: 1,
      avgFirstResponseMin: 12.5,
      avgResolutionMin: 60,
      csatAvg: 4.5,
      csatCount: 2,
    });
  });

  it('TW-DASH-030: no assigned conversations in the window is an empty team', async () => {
    const empty = await api.signup('dpan2');
    await q(`UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`, [
      empty.orgId,
      JSON.stringify({ features: { analytics: true } }),
    ]);
    expect((await get(empty.admin)).body.team).toEqual([]);
  });

  it('login devices: workspace sessions in the window by browser, system and kind; counts only, never another workspace', async () => {
    const d = await api.signup('dpan4');
    await q(`UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`, [
      d.orgId,
      JSON.stringify({ features: { analytics: true } }),
    ]);
    const before = analyticsPanelsSchema.parse((await get(d.admin)).body).loginDevices;
    const CHROME_WIN =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
    const SAFARI_IPHONE =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
    const session = (org: number, ua: string | null, ago: string, revoked = false) =>
      q(
        `INSERT INTO auth_sessions (org_id, user_id, ip, user_agent, created_at, expires_at, revoked_at)
         VALUES ($1, $2, '203.0.113.9', $3, now() - $4::interval, now() + interval '7 days', CASE WHEN $5 THEN now() END)`,
        [org, d.adminUserId, ua, ago, revoked],
      );
    await session(d.orgId, CHROME_WIN, '2 days');
    await session(d.orgId, CHROME_WIN, '3 days', true); // signed out: counted, not active
    await session(d.orgId, SAFARI_IPHONE, '1 day');
    await session(d.orgId, null, '1 day'); // no agent: other / unknown
    await session(d.orgId, CHROME_WIN, '60 days'); // outside the 30d window
    // another workspace's sessions never show up here
    await session(t.orgId, SAFARI_IPHONE, '1 day');

    const res = await get(d.admin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const ld = analyticsPanelsSchema.parse(res.body).loginDevices;
    expect(ld.total - before.total).toBe(4);
    expect(ld.byBrowser.find((r) => r.key === 'chrome')).toMatchObject({
      count: before.byBrowser.find((r) => r.key === 'chrome')!.count + 2,
    });
    expect(ld.byOs.find((r) => r.key === 'iphone')?.count).toBe(1);
    expect(ld.byKind.map((r) => r.key).sort()).toEqual(['desktop', 'mobile', 'unknown']);
    // the 60-day-old session is live but outside the window: `active` counts live sessions of the workspace
    expect(ld.active - before.active).toBe(4);
    // counts only: no address, agent string or session id leaves the server
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain('203.0.113.9');
    expect(raw).not.toContain('Mozilla');
    expect(res.body.loginDevices).not.toHaveProperty('rows');
  });

  it('TW-DASH-029: geography groups conversations of the window by the country of the number; the stream lists both directions', async () => {
    const g = await api.signup('dpan3');
    await q(`UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`, [
      g.orgId,
      JSON.stringify({ features: { analytics: true } }),
    ]);
    const ch = await q(
      `INSERT INTO channels (org_id, kind, name) VALUES ($1, 'simulator', 'sim') RETURNING id`,
      [g.orgId],
    );
    let seq = 0;
    const chat = async (peer: string, ago: string, direction: 'in' | 'out') => {
      const c = await q(
        `INSERT INTO conversations (org_id, channel_id, peer_key, title) VALUES ($1, $2, $3, $3) RETURNING id`,
        [g.orgId, ch.rows[0].id, peer],
      );
      await q(
        `INSERT INTO messages (org_id, conversation_id, seq, direction, sender_kind, status, kind, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'text', now() - $7::interval)`,
        [
          g.orgId,
          c.rows[0].id,
          ++seq,
          direction,
          direction === 'in' ? 'customer' : 'agent',
          direction === 'in' ? 'received' : 'sent',
          ago,
        ],
      );
    };
    for (const [peer, ago, dir] of [
      ['919876543210', '1 minute', 'in'],
      ['+919876543211', '3 hours', 'in'],
      ['919876543212', '4 hours', 'in'],
      ['14155550100', '2 minutes', 'out'],
      ['14155550101', '5 hours', 'in'],
      ['447700900123', '6 hours', 'in'],
      ['9999999999', '7 hours', 'in'], // no known prefix
      ['ig_handle', '8 hours', 'in'], // not a phone number
    ] as const)
      await chat(peer, ago, dir);
    // a conversation with no message in the window is not counted
    await q(
      `INSERT INTO conversations (org_id, channel_id, peer_key, title) VALUES ($1, $2, '4915112345678', 'quiet')`,
      [g.orgId, ch.rows[0].id],
    );

    const res = await get(g.admin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = analyticsPanelsSchema.parse(res.body);
    expect(body.geo).toEqual([
      { code: 'IN', count: 3 },
      { code: null, count: 2 },
      { code: 'US', count: 2 },
      { code: 'GB', count: 1 },
    ]);
    expect(body.events).toHaveLength(6);
    expect(body.events[0]).toMatchObject({
      direction: 'in',
      peer: '919876543210',
      status: 'received',
    });
    expect(body.events[1]).toMatchObject({ direction: 'out', peer: '14155550100', status: 'sent' });
    expect(body.events.map((e) => e.at)).toEqual(
      [...body.events.map((e) => e.at)].sort().reverse(),
    );
  });

  it('TW-DASH-029: no activity reads empty geography and an empty stream', async () => {
    const empty = await api.signup('dpan4');
    await q(`UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`, [
      empty.orgId,
      JSON.stringify({ features: { analytics: true } }),
    ]);
    const b = (await get(empty.admin)).body;
    expect(b.geo).toEqual([]);
    expect(b.events).toEqual([]);
  });
});
