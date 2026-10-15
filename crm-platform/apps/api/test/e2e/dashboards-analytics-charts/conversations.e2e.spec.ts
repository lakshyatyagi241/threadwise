import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyticsConversationsSchema } from '@crm/contracts';
import { Api, startHarness, type Harness, type Tenant } from '../contacts-attributes-tags/support';

/** The Agent view's conversation numbers end to end: rows arranged with the owner connection, asserted through HTTP. */
let h: Harness;
let api: Api;
let t: Tenant;
const q = (text: string, p: unknown[]) => h.owner.query(text, p);
const get = (tok: string, extra = '') =>
  api.as(tok).get(`/v2/analytics/conversations?range=30d${extra}`);

async function conversation(
  title: string,
  status: string,
  assignee: number | null,
  extra = '',
): Promise<number> {
  const ch = await q(
    `INSERT INTO channels (org_id, kind, name) VALUES ($1, 'simulator', 'sim') RETURNING id`,
    [t.orgId],
  );
  const r = await q(
    `INSERT INTO conversations (org_id, channel_id, peer_key, title, status, assignee_user_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, now() - interval '2 days') RETURNING id`,
    [t.orgId, ch.rows[0].id, `peer-${title}`, title, status, assignee],
  );
  const id = Number(r.rows[0].id);
  if (extra)
    await q(`UPDATE conversations SET ${extra} WHERE org_id = $1 AND id = $2`, [t.orgId, id]);
  return id;
}

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  t = await api.signup('dconv');
  await q(`UPDATE org_plan_state SET overrides = $2::jsonb WHERE org_id = $1`, [
    t.orgId,
    JSON.stringify({ features: { analytics: true } }),
  ]);
  const me = t.adminUserId;
  // open, held by the admin, never answered: unattended
  await conversation('A', 'open', me);
  // open, held, answered after 10 min
  await conversation('B', 'open', me, `first_response_at = created_at + interval '10 minutes'`);
  // snoozed counts as open
  await conversation('C', 'snoozed', null);
  await conversation('D', 'pending', null);
  // resolved after 60 min, closed after 120 min; both count as closed
  await conversation(
    'E',
    'resolved',
    me,
    `resolved_at = created_at + interval '60 minutes', last_message_at = created_at + interval '30 minutes'`,
  );
  await conversation('F', 'closed', null, `resolved_at = created_at + interval '120 minutes'`);
  // spam is left out
  await conversation('G', 'spam', null);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

describe('GET /v2/analytics/conversations', () => {
  it('needs dash.analytics.read and the plan feature', async () => {
    const none = await api.member(t, 'noconv', [['dash.dashboard.read']]);
    expect((await get(none.token)).status).toBe(403);
    expect((await api.http().get('/v2/analytics/conversations')).status).toBe(401);
  });

  it('counts by status and by assignment, spam left out', async () => {
    const res = await get(t.admin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const c = analyticsConversationsSchema.parse(res.body);
    expect(c.counts).toEqual({
      open: 3,
      pending: 1,
      closed: 2,
      total: 6,
      assigned: 3,
      unassigned: 3,
      unattended: 1,
    });
  });

  it('averages resolution over resolved conversations and duration over those with a last message', async () => {
    const c = analyticsConversationsSchema.parse((await get(t.admin)).body);
    expect(c.avgResolutionMin).toBe(90);
    expect(c.avgDurationMin).toBe(30);
  });

  it('lists the team and narrows the headline to one person with ?agent=', async () => {
    const all = analyticsConversationsSchema.parse((await get(t.admin)).body);
    expect(all.agents).toHaveLength(1);
    expect(all.agents[0]!.counts).toMatchObject({ open: 2, closed: 1, unattended: 1, total: 3 });
    const one = analyticsConversationsSchema.parse(
      (await get(t.admin, `&agent=${all.agents[0]!.userUuid}`)).body,
    );
    expect(one.counts).toMatchObject({ total: 3, assigned: 3, unassigned: 0 });
    expect(one.agents).toHaveLength(1);
    const nobody = analyticsConversationsSchema.parse(
      (await get(t.admin, '&agent=00000000-0000-4000-8000-000000000000')).body,
    );
    expect(nobody.counts.total).toBe(0);
    expect(nobody.avgResolutionMin).toBeNull();
  });
});
