import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ChannelIngestPublisher } from '../../../src/modules/chat-conversations/channel-ingest.publisher';
import type { Tenant } from '../contacts-attributes-tags/support';
import {
  conversationOf,
  messagesOf,
  simChannel,
  simInbound,
  startPipeline,
  until,
  type Pipeline,
  type SimChannel,
} from '../chat-conversations/pipeline-support';
import { ROUNDS, race, statuses } from './support';

/**
 * QA Sheet3 #15, queue side: the real BullMQ workers, the routing engine and the conversation assignment, with several messages and
 * several people acting at once. Scenarios: CC-RR (round robin), CC-ASG (two agents claim one conversation), CC-JOB (job id dedupe
 * and parallel consumers).
 */
process.env.CHANNEL_SIMULATOR_ENABLED = 'true';

let p: Pipeline;
beforeAll(async () => {
  p = await startPipeline(async () => [
    (
      await import('../../../src/modules/team-inbox-routing-sla/team-inbox-routing-sla-worker.module')
    ).TeamInboxRoutingSlaWorkerModule,
  ]);
}, 300_000);
afterAll(async () => {
  await p?.stop();
});

const AGENT: Array<[string, 'all']> = [
  ['inbox.conversation.read', 'all'],
  ['inbox.conversation.reply', 'all'],
  ['inbox.conversation.assign_self', 'all'],
];
let phoneSeq = 0;
const phone = () => `9188${String(10_000_000 + phoneSeq++)}`;
const uuidOf = async (userId: number) =>
  (await p.h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [userId])).rows[0].uuid as string;
const scalar = async (text: string, params: unknown[] = []) =>
  Number((await p.h.owner.query(text, params)).rows[0].n);

describe('CC-RR: round robin under parallel inbound messages', () => {
  it('CC-RR-01 12 new customers writing at once are split evenly between two agents, each routed once, and the rule counts every one', async () => {
    const t = await p.api.signup('crr');
    const ch = await simChannel(p, t);
    const a1 = await p.api.member(t, 'crr1', AGENT);
    const a2 = await p.api.member(t, 'crr2', AGENT);
    const [u1, u2] = await Promise.all([uuidOf(a1.userId), uuidOf(a2.userId)]);
    const created = await p.api
      .as(t.admin)
      .post('/v2/inbox/routing/rules')
      .set('idempotency-key', `crr-${Math.random()}`)
      .send({
        name: 'Refunds',
        conditions: { keywords: { mode: 'any', words: ['refund'] } },
        assign: { strategy: 'round_robin', userIds: [u1, u2] },
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const on = await p.api
      .as(t.admin)
      .patch(`/v2/inbox/routing/rules/${created.body.id}`)
      .send({ rowVersion: created.body.rowVersion, isActive: true });
    expect(on.status, JSON.stringify(on.body)).toBe(200);

    let total = 0;
    for (let round = 0; round < ROUNDS; round++) {
      const from = Array.from({ length: 12 }, () => phone());
      await race(12, (i) => simInbound(p, t, ch, { from: from[i], text: 'I want a refund' }));
      total += 12;
      const convs = await Promise.all(
        from.map((f) =>
          until(`routed ${f}`, async () => {
            const c = await conversationOf(p, t, ch, f);
            const meta = c.routing_meta as { routedMessage?: string } | null;
            return meta?.routedMessage ? c : null;
          }),
        ),
      );
      for (const c of convs) expect([a1.userId, a2.userId]).toContain(Number(c.assignee_user_id));
      const all = (
        await p.h.owner.query(
          `SELECT assignee_user_id, count(*)::int AS n FROM conversations WHERE org_id = $1 GROUP BY 1`,
          [t.orgId],
        )
      ).rows;
      const n1 = all.find((r) => Number(r.assignee_user_id) === a1.userId)?.n ?? 0;
      const n2 = all.find((r) => Number(r.assignee_user_id) === a2.userId)?.n ?? 0;
      expect(n1 + n2).toBe(total);
      expect(Math.abs(n1 - n2), `agent1=${n1} agent2=${n2}`).toBeLessThanOrEqual(1);
    }
    expect(
      await scalar(`SELECT fired_count AS n FROM routing_rules WHERE org_id = $1 AND name = 'Refunds'`, [t.orgId]),
    ).toBe(total);
    // One 'assigned' event per conversation: no thread was routed twice.
    expect(
      await scalar(
        `SELECT count(*)::int AS n FROM conversation_events e JOIN conversations c ON c.id = e.conversation_id
          WHERE c.org_id = $1 AND e.type = 'assigned'`,
        [t.orgId],
      ),
    ).toBe(total);
  }, 180_000);
});

describe('CC-ASG: two agents take the same conversation', () => {
  it('CC-ASG-01 three agents claiming one open conversation at once: one wins, the others get 409 ROW_VERSION_CONFLICT, one assigned event', async () => {
    const t = await p.api.signup('casg');
    const ch = await simChannel(p, t);
    const agents = await Promise.all([1, 2, 3].map((i) => p.api.member(t, `casg${i}`, AGENT)));
    const uuids = await Promise.all(agents.map((a) => uuidOf(a.userId)));
    for (let round = 0; round < ROUNDS; round++) {
      const from = phone();
      await simInbound(p, t, ch, { from, text: 'help' });
      // The pipeline and the routing listener bump the row version after the message lands: claim once it has stopped moving.
      let conv = await conversationOf(p, t, ch, from);
      for (let stable = 0; stable < 2; ) {
        await new Promise((r) => setTimeout(r, 300));
        const again = await conversationOf(p, t, ch, from);
        stable = again.row_version === conv.row_version ? stable + 1 : 0;
        conv = again;
      }
      const res = await race(3, (i) =>
        p.api
          .as(agents[i]!.token)
          .post(`/v2/inbox/conversations/${conv.uuid}/assign`)
          .send({ userId: uuids[i], rowVersion: Number(conv.row_version) }),
      );
      expect(res.filter((r) => r.status === 200), JSON.stringify(statuses(res))).toHaveLength(1);
      const lost = res.filter((r) => r.status === 409);
      expect(lost).toHaveLength(2);
      for (const l of lost) expect(l.body.code).toBe('ROW_VERSION_CONFLICT');
      const now = await conversationOf(p, t, ch, from);
      const winnerIdx = res.findIndex((r) => r.status === 200);
      expect(Number(now.assignee_user_id)).toBe(agents[winnerIdx]!.userId);
      expect(
        await scalar(`SELECT count(*)::int AS n FROM conversation_events WHERE conversation_id = $1 AND type = 'assigned'`, [conv.id]),
      ).toBe(1);
    }
  });
});

describe('CC-JOB: queue job ids and parallel consumers', () => {
  let t: Tenant;
  let ch: SimChannel;
  beforeAll(async () => {
    t = await p.api.signup('cjob');
    ch = await simChannel(p, t);
  });
  const msg = (providerMessageId: string, peerKey: string, body = 'hi') => ({
    providerMessageId,
    peerKey,
    kind: 'text' as const,
    body,
    providerTimestamp: new Date(),
  });

  it('CC-JOB-01 the same provider message queued 10 times at once (same job id) and 10 more times (distinct job ids) is stored once', async () => {
    const pub = p.h.app.get(ChannelIngestPublisher, { strict: false });
    for (let round = 0; round < ROUNDS; round++) {
      const peer = phone();
      const id = `cjob.${round}.${Math.random().toString(36).slice(2)}`;
      await race(10, () => pub.enqueueInbound(t.orgId, ch.id, msg(id, peer)));
      await race(10, (i) => pub.enqueueInbound(t.orgId, ch.id, msg(id, peer), i + 1));
      const conv = await conversationOf(p, t, ch, peer);
      await until('stored', async () => (await messagesOf(p, conv.id as number)).length >= 1);
      // The extra copies run through the same workers: give them time to finish before counting.
      await until(
        'queue idle',
        async () => (await p.h.redis.keys('bull:*:active')).length === 0 || undefined,
        20_000,
      ).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 600));
      expect(await messagesOf(p, conv.id as number)).toHaveLength(1);
      expect(
        await scalar(`SELECT count(*)::int AS n FROM contacts WHERE org_id = $1 AND phone = $2`, [t.orgId, `+${peer}`]),
      ).toBe(1);
    }
  }, 120_000);

  it('CC-JOB-02 60 messages from 12 customers queued at once and consumed by parallel workers: every message stored once, sequence numbers gap-free per thread', async () => {
    const peers = Array.from({ length: 12 }, () => phone());
    await race(60, (i) => simInbound(p, t, ch, { from: peers[i % 12], text: `m${i}` }), 30);
    await until(
      'all 60 stored',
      async () =>
        (await scalar(
          `SELECT count(*)::int AS n FROM messages m JOIN conversations c ON c.id = m.conversation_id
            WHERE c.org_id = $1 AND c.peer_key = ANY($2)`,
          [t.orgId, peers],
        )) === 60 || undefined,
      60_000,
    );
    for (const peer of peers) {
      const conv = await conversationOf(p, t, ch, peer);
      const seqs = (await messagesOf(p, conv.id as number)).map((m) => Number(m.seq));
      expect(seqs).toEqual(Array.from({ length: 5 }, (_, i) => i + 1));
    }
    expect(
      await scalar(
        `SELECT count(*)::int AS n FROM conversations WHERE org_id = $1 AND peer_key = ANY($2)`,
        [t.orgId, peers],
      ),
    ).toBe(12);
  }, 120_000);
});
