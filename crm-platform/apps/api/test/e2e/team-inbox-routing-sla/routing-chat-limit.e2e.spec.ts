import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Tenant } from '../contacts-attributes-tags/support';
import {
  conversationOf,
  simChannel,
  simInbound,
  startPipeline,
  until,
  type Pipeline,
  type SimChannel,
} from '../chat-conversations/pipeline-support';

/**
 * Automatic assignment honours each agent's Concurrent Chat limit (user_profiles.chat_limit) and Available / Offline switch
 * (agent_statuses): an agent who already holds that many open conversations is skipped by round robin and least busy, an agent who
 * is offline is skipped, and no limit means no cap. Real Postgres (restricted role) and Redis, the real ingest worker and routing.
 */
process.env.CHANNEL_SIMULATOR_ENABLED = 'true';

let p: Pipeline;
beforeAll(async () => {
  p = await startPipeline(async () => [
    (
      await import('../../../src/modules/team-inbox-routing-sla/team-inbox-routing-sla-worker.module')
    ).TeamInboxRoutingSlaWorkerModule,
  ]);
}, 600_000);
afterAll(async () => {
  await p?.stop();
});

const AGENT: Array<[string, 'all']> = [
  ['inbox.conversation.read', 'all'],
  ['inbox.conversation.reply', 'all'],
  ['inbox.conversation.assign_self', 'all'],
];
let phoneSeq = 0;
const phone = () => `9177${String(10_000_000 + phoneSeq++)}`;
const uuidOf = async (userId: number) =>
  (await p.h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [userId])).rows[0].uuid as string;

async function customer(t: Tenant, ch: SimChannel, text: string) {
  const from = phone();
  await simInbound(p, t, ch, { from, text });
  const conv = await until(`routed ${from}`, async () => {
    const c = await conversationOf(p, t, ch, from);
    const meta = c.routing_meta as { routedMessage?: string } | null;
    return meta?.routedMessage ? c : null;
  });
  return conv.assignee_user_id === null ? null : Number(conv.assignee_user_id);
}

describe('routing honours the chat limit and the availability switch', () => {
  let t: Tenant;
  let ch: SimChannel;
  let a1: { token: string; userId: number };
  let a2: { token: string; userId: number };

  const limit = (userId: number, value: number | null) =>
    p.h.owner.query(
      `INSERT INTO user_profiles (org_id, user_id, chat_limit) VALUES ($1,$2,$3)
       ON CONFLICT (org_id, user_id) DO UPDATE SET chat_limit = EXCLUDED.chat_limit`,
      [t.orgId, userId, value],
    );
  const openFor = async (userId: number) =>
    Number(
      (
        await p.h.owner.query(
          `SELECT count(*)::int AS n FROM conversations WHERE org_id = $1 AND assignee_user_id = $2 AND status = 'open' AND NOT archived`,
          [t.orgId, userId],
        )
      ).rows[0].n,
    );
  const closeAll = () =>
    p.h.owner.query(`UPDATE conversations SET status = 'resolved' WHERE org_id = $1`, [t.orgId]);

  beforeAll(async () => {
    t = await p.api.signup('rcl');
    ch = await simChannel(p, t);
    a1 = await p.api.member(t, 'rcl1', AGENT);
    a2 = await p.api.member(t, 'rcl2', AGENT);
    const create = async (strategy: 'round_robin' | 'least_busy', word: string) => {
      const r = (
        await p.api
          .as(t.admin)
          .post('/v2/inbox/routing/rules')
          .set('idempotency-key', randomUUID())
          .send({
            name: `Pool ${strategy}`,
            conditions: { keywords: { words: [word] } },
            assign: { strategy, userIds: [await uuidOf(a1.userId), await uuidOf(a2.userId)] },
          })
      ).body as { id: string; rowVersion: number };
      const live = await p.api
        .as(t.admin)
        .patch(`/v2/inbox/routing/rules/${r.id}`)
        .send({ rowVersion: r.rowVersion, isActive: true });
      expect(live.status).toBe(200);
    };
    await create('round_robin', 'rrword');
    await create('least_busy', 'lbword');
  });

  it('round robin skips an agent who already holds the limit, and takes them back with no limit', async () => {
    await limit(a1.userId, 1);
    // Nobody holds anything: the rotation starts with the lowest id and a1 reaches their limit of 1.
    expect(await customer(t, ch, 'rrword one')).toBe(a1.userId);
    expect(await openFor(a1.userId)).toBe(1);
    // a1 is full now: every following chat goes to a2 although the rotation would come back to a1.
    const next = [];
    for (let i = 0; i < 3; i += 1) next.push(await customer(t, ch, 'rrword more'));
    expect(next).toEqual([a2.userId, a2.userId, a2.userId]);
    expect(await openFor(a1.userId)).toBe(1);

    // Removing the limit puts a1 back in the rotation.
    await limit(a1.userId, null);
    const seen = new Set<number | null>();
    for (let i = 0; i < 4; i += 1) seen.add(await customer(t, ch, 'rrword again'));
    expect(seen.has(a1.userId)).toBe(true);
    await closeAll();
  });

  it('a conversation that is resolved no longer counts: the agent takes chats again', async () => {
    await limit(a1.userId, 1);
    await limit(a2.userId, 1);
    expect(await customer(t, ch, 'rrword x')).not.toBeNull();
    expect(await customer(t, ch, 'rrword y')).not.toBeNull();
    // both are at their limit: nobody can take the next chat
    expect(await customer(t, ch, 'rrword z')).toBeNull();
    await closeAll();
    expect(await customer(t, ch, 'rrword after')).not.toBeNull();
    await limit(a1.userId, null);
    await limit(a2.userId, null);
    await closeAll();
  });

  it('least busy skips a full agent too, even when they are the least busy', async () => {
    // Three chats no rule matches stay unassigned; hand one to a1 and two to a2 by hand, so a1 is the least busy (1 against 2).
    const held: unknown[] = [];
    for (let i = 0; i < 3; i += 1) {
      const from = phone();
      await simInbound(p, t, ch, { from, text: `nomatch ${i}` });
      held.push(await until(`chat ${from}`, async () => (await conversationOf(p, t, ch, from)) ?? null));
    }
    const ids = held.map((c) => Number((c as { id: number }).id));
    const give = (conv: number, user: number) =>
      p.h.owner.query(`UPDATE conversations SET assignee_user_id = $3 WHERE org_id = $1 AND id = $2`, [
        t.orgId,
        conv,
        user,
      ]);
    await give(ids[0]!, a1.userId);
    await give(ids[1]!, a2.userId);
    await give(ids[2]!, a2.userId);

    // Without a limit the least busy agent (a1) is chosen.
    expect(await customer(t, ch, 'lbword free')).toBe(a1.userId);
    await p.h.owner.query(`UPDATE conversations SET status = 'resolved' WHERE org_id = $1 AND assignee_user_id = $2 AND id NOT IN ($3)`, [
      t.orgId,
      a1.userId,
      ids[0],
    ]);

    // With a limit of 1 a1 is full, so a2 takes the chat although a2 holds more.
    await limit(a1.userId, 1);
    expect(await customer(t, ch, 'lbword limited')).toBe(a2.userId);
    await limit(a1.userId, null);
    await closeAll();
  });

  it('an agent who switched Offline is skipped, and Available puts them back', async () => {
    const off = await p.api
      .as(a2.token)
      .put('/v2/workspace/members/me/availability')
      .send({ status: 'offline' });
    expect(off.status).toBe(200);
    const got = [];
    for (let i = 0; i < 3; i += 1) got.push(await customer(t, ch, 'rrword offline'));
    expect(got).toEqual([a1.userId, a1.userId, a1.userId]);

    const on = await p.api
      .as(a2.token)
      .put('/v2/workspace/members/me/availability')
      .send({ status: 'online' });
    expect(on.status).toBe(200);
    const seen = new Set<number | null>();
    for (let i = 0; i < 4; i += 1) seen.add(await customer(t, ch, 'rrword online'));
    expect(seen.has(a2.userId)).toBe(true);
  });
});
