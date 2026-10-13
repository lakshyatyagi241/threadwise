import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AGENT,
  Api,
  Inbox,
  startHarness,
  type Harness,
  type Tenant,
} from '../team-inbox-conversations/support';

/**
 * The Team Performance report (TW-TIB2-034): totals and one row per agent, the window, the channel filter, what is and is not a reply,
 * and who may read it.
 */
process.env.CHANNEL_SIMULATOR_ENABLED = 'true';

let h: Harness;
let api: Api;
let inbox: Inbox;

beforeAll(async () => {
  h = await startHarness();
  api = new Api(h);
  inbox = new Inbox(h, api);
}, 240_000);

afterAll(async () => {
  await h?.stop();
});

describe('GET /v2/inbox/analytics/team', () => {
  let t: Tenant;
  let a: { id: string };
  let b: { id: string };
  let mia: { token: string; userId: number };
  let plain: { token: string; userId: number };

  beforeAll(async () => {
    t = await api.signup('tpa');
    a = await inbox.channel(t.admin);
    b = await inbox.channel(t.admin);
    mia = await api.member(t, 'mia', [...AGENT, ['inbox.analytics.view', 'all']]);
    plain = await api.member(t, 'plain', AGENT);

    // Three conversations on channel A, one on B.
    const c1 = await inbox.conversation(t, a.id, { messages: 1, assigneeUserId: mia.userId });
    const c2 = await inbox.conversation(t, a.id, { messages: 2 });
    await inbox.conversation(t, b.id, { messages: 1 });
    // The owner replied twice and Mia once; a bot reply (an automatic one) must not count as anybody's.
    await inbox.message(t, c1.id, 2, { direction: 'out', senderUserId: t.adminUserId });
    await inbox.message(t, c1.id, 3, { direction: 'out', senderUserId: t.adminUserId });
    await inbox.message(t, c2.id, 3, { direction: 'out', senderUserId: mia.userId });
    await h.owner.query(
      `INSERT INTO messages (org_id, conversation_id, seq, direction, kind, sender_kind, sender_user_id, body, status)
       VALUES ($1, $2, 4, 'out', 'text', 'bot', $3, 'auto reply', 'sent')`,
      [t.orgId, c2.id, t.adminUserId],
    );
    // c1 was resolved by the owner 6 minutes after it started (first reply at 6 minutes), assigned to Mia.
    await h.owner.query(
      `UPDATE conversations SET status = 'resolved', resolved_at = now(), resolved_by = $2,
              created_at = now() - interval '10 minutes', first_response_at = now() - interval '4 minutes'
       WHERE id = $1`,
      [c1.id, t.adminUserId],
    );
  });

  const get = (token: string, qs = '') => api.as(token).get(`/v2/inbox/analytics/team${qs}`);

  it('counts human replies per agent, the resolved conversation and the first-reply average', async () => {
    const res = await get(t.admin);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.range).toBe('today');
    expect(res.body.totals).toMatchObject({ replies: 3, resolved: 1, avgFirstResponseMin: 6 });
    // inbound messages: c1 x1, c2 x2, channel B x1
    expect(res.body.totals.inbounds).toBe(4);
    const rows = res.body.agents as Array<{
      name: string | null;
      replies: number;
      resolved: number;
      avgResponseMin: number | null;
      status: string;
    }>;
    expect(rows[0]!.replies).toBe(2);
    expect(rows[0]!.resolved).toBe(1);
    // the average is credited to the assignee (Mia), not to whoever resolved it
    const miaRow = rows.find((r) => r.replies === 1)!;
    expect(miaRow.avgResponseMin).toBe(6);
    expect(rows[0]!.avgResponseMin).toBeNull();
    expect(['online', 'away', 'busy', 'offline']).toContain(rows[0]!.status);
    expect(rows).toHaveLength(2);
  });

  it('reads an unknown range as today and narrows every figure to one channel', async () => {
    expect((await get(t.admin, '?range=foo')).body.totals.replies).toBe(3);
    const week = await get(t.admin, '?range=week');
    expect(week.body.range).toBe('week');
    expect(week.body.totals.replies).toBe(3);

    const onB = await get(t.admin, `?channelId=${b.id}`);
    expect(onB.status).toBe(200);
    expect(onB.body.totals).toMatchObject({ replies: 0, resolved: 0, inbounds: 1 });
    expect(onB.body.agents).toEqual([]);

    expect((await get(t.admin, '?channelId=not-a-uuid')).status).toBe(422);
    expect((await get(t.admin, '?channelId=0b2f7a68-3c3e-4a9a-9d5b-6a1f0f3e1c11')).status).toBe(
      404,
    );
  });

  it('needs the report permission, and another workspace sees none of it', async () => {
    expect((await get(plain.token)).status).toBe(403);
    expect((await get(mia.token)).status).toBe(200);
    const other = await api.signup('tpb');
    const res = await get(other.admin);
    expect(res.status).toBe(200);
    expect(res.body.totals).toMatchObject({ replies: 0, resolved: 0, inbounds: 0 });
    expect(res.body.agents).toEqual([]);
  });
});
