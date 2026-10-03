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
});
