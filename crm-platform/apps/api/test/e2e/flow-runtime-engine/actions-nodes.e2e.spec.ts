import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conversationOf, simInbound } from '../chat-conversations/pipeline-support';
import {
  addFlow,
  edge,
  graph,
  node,
  openChannel,
  simChannel,
  startFlowPipeline,
  untilRun,
  untilSent,
  type FlowPipeline,
  type SimChannel,
  type Tenant,
} from './support';

/** The actions node group (TW-FLR-035 to 039) through the real pipeline: queue, engine, CRM, inbox and channel. */
let p: FlowPipeline;
let redis: Redis;
beforeAll(async () => {
  p = await startFlowPipeline();
  redis = new Redis(process.env.REDIS_URL!);
  redis.on('error', () => undefined);
}, 300_000);
afterAll(async () => {
  redis?.disconnect();
  await p?.stop();
});

let counter = 0;
let flowCounter = 0;
const nextPeer = () => `9197${String(10000000 + counter++).padStart(8, '0')}`;

const say = (t: Tenant, ch: SimChannel, peer: string, text: string) =>
  simInbound(p as never, t, ch, { from: peer, name: 'Asha', text });

/** One flow `trigger -> nodes... -> end`, started by the word `go`. */
async function startFlow(
  t: Tenant,
  nodes: Array<ReturnType<typeof node>>,
  edges: Array<ReturnType<typeof edge>> = [],
) {
  const ids = ['t', ...nodes.map((n) => n.id), 'z'];
  const chain = ids.slice(1).map((id, i) => edge(ids[i]!, id));
  const word = `go${flowCounter++}`;
  const flow = await addFlow(p, t, {
    graph: graph(
      [node('t', 'trigger', {}, { isStart: true }), ...nodes, node('z', 'end')],
      edges.length > 0 ? edges : chain,
    ),
    trigger: { kind: 'keyword', keywords: word },
  });
  return { ...flow, word };
}

const stepNotes = async (runId: number): Promise<string> => {
  const r = await p.h.owner.query(
    `SELECT detail::text AS d FROM flow_run_steps WHERE run_id = $1 ORDER BY seq, id`,
    [runId],
  );
  return r.rows.map((x) => String(x.d)).join('\n');
};

const eventsOf = async (orgId: number, convId: number) =>
  (
    await p.h.owner.query(
      `SELECT type, actor_type, payload FROM conversation_events WHERE org_id = $1 AND conversation_id = $2 ORDER BY id`,
      [orgId, convId],
    )
  ).rows as Array<{ type: string; actor_type: string; payload: Record<string, unknown> }>;

describe('Tag node (TW-FLR-035)', () => {
  let t: Tenant;
  let ch: SimChannel;
  beforeAll(async () => {
    t = await p.api.signup('flrtag');
    ch = await simChannel(p as never, t);
  });

  it('adds a tag by name (created on the fly), puts a flow line on the timeline, and starts no tag_added flow', async () => {
    const f = await startFlow(t, [node('a', 'tag', { action: 'add', tag: 'VIP' })]);
    const peer = nextPeer();
    await say(t, ch, peer, f.word);
    const run = await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
    const tagged = await p.h.owner.query(
      `SELECT tg.name FROM contact_tags ct JOIN tags tg ON tg.org_id = ct.org_id AND tg.id = ct.tag_id
       JOIN flow_runs r ON r.org_id = ct.org_id AND r.contact_id = ct.contact_id
       WHERE r.id = $1`,
      [run.id],
    );
    expect(tagged.rows.map((x) => x.name)).toEqual(['VIP']);
    const conv = await conversationOf(p as never, t, ch, peer);
    expect(
      (await eventsOf(t.orgId, Number(conv.id))).filter((e) => e.type === 'tag_added'),
    ).toEqual([
      expect.objectContaining({
        actor_type: 'flow',
        payload: expect.objectContaining({ tagName: 'VIP' }),
      }),
    ]);
    // Reference's Tag step never fired tag_added flows, and neither does this one.
    expect(await p.api.events(t.orgId, 'contact.tag_added')).toEqual([]);
  });

  it('removes it again, and an unresolvable tag is a note that does not stop the flow', async () => {
    const f = await startFlow(t, [
      node('a', 'tag', { action: 'remove', tag: 'VIP' }),
      node('b', 'tag', { action: 'remove', tag: 'never-existed' }),
      node('c', 'tag', {}),
    ]);
    const peer = nextPeer();
    await say(t, ch, peer, f.word);
    const run = await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
    expect(await stepNotes(run.id)).toContain('could not be resolved');
  });

  it('cannot touch another workspace', async () => {
    const other = await p.api.signup('flrtag2');
    const otherCh = await simChannel(p as never, other);
    const f = await startFlow(other, [node('a', 'tag', { action: 'add', tag: 'VIP' })]);
    await say(other, otherCh, nextPeer(), f.word);
    await untilRun(p, other, f.id, 'completed', (r) => r.status === 'completed');
    const mine = await p.h.owner.query(
      `SELECT count(*)::int AS n FROM contact_tags WHERE org_id = $1`,
      [t.orgId],
    );
    expect(mine.rows[0].n).toBe(1);
  });
});

describe('Assign node (TW-FLR-036)', () => {
  let t: Tenant;
  let ch: SimChannel;
  let agentUuid: string;
  let teamUuid: string;
  beforeAll(async () => {
    t = await p.api.signup('flrassign');
    ch = await simChannel(p as never, t);
    const agent = await p.api.member(t, 'agent', [['inbox.conversation.read']]);
    agentUuid = String(
      (await p.h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [agent.userId])).rows[0].uuid,
    );
    teamUuid = String(
      (
        await p.h.owner.query(
          `INSERT INTO teams (org_id, name) VALUES ($1, 'Support') RETURNING uuid`,
          [t.orgId],
        )
      ).rows[0].uuid,
    );
  });

  it('hands the conversation to the member and the team, with the note on the timeline', async () => {
    const f = await startFlow(t, [
      node('a', 'assign', { userId: agentUuid, team: teamUuid, message: 'Lead from {{name}}' }),
    ]);
    const peer = nextPeer();
    await say(t, ch, peer, f.word);
    await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
    const conv = await conversationOf(p as never, t, ch, peer);
    const row = (
      await p.h.owner.query(
        `SELECT u.uuid AS u, tm.uuid AS t FROM conversations c
         LEFT JOIN users u ON u.org_id = c.org_id AND u.id = c.assignee_user_id
         LEFT JOIN teams tm ON tm.org_id = c.org_id AND tm.id = c.assignee_team_id
         WHERE c.org_id = $1 AND c.id = $2`,
        [t.orgId, conv.id],
      )
    ).rows[0];
    expect(row).toEqual({ u: agentUuid, t: teamUuid });
    const ev = await eventsOf(t.orgId, Number(conv.id));
    expect(ev.map((e) => e.type)).toEqual(expect.arrayContaining(['assigned', 'note_added']));
    expect(ev.find((e) => e.type === 'note_added')).toMatchObject({
      actor_type: 'flow',
      payload: { note: 'Lead from Asha', source: 'flow' },
    });
  });

  it('an unknown member, or one of another workspace, is a note: nothing is assigned and the flow ends normally', async () => {
    const stranger = await p.api.signup('flrstranger');
    const strangerUuid = String(
      (await p.h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [stranger.adminUserId]))
        .rows[0].uuid,
    );
    for (const userId of [randomUUID(), strangerUuid, 'not-a-uuid']) {
      const f = await startFlow(t, [node('a', 'assign', { userId })]);
      const peer = nextPeer();
      await say(t, ch, peer, f.word);
      const run = await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
      const conv = await conversationOf(p as never, t, ch, peer);
      expect(conv.assignee_user_id).toBeNull();
      expect(await stepNotes(run.id)).toContain('assignment failed');
    }
  });
});

describe('Deal node (TW-FLR-037)', () => {
  let t: Tenant;
  let ch: SimChannel;
  let stages: Array<{ id: string; name: string }>;
  beforeAll(async () => {
    t = await p.api.signup('flrdeal');
    ch = await simChannel(p as never, t);
    const res = await p.api.as(t.admin).get('/v2/pipelines');
    expect(res.status).toBe(200);
    stages = (res.body as Array<{ isDefault: boolean; stages: typeof stages }>).find(
      (x) => x.isDefault,
    )!.stages;
  });

  const dealGraph = (data: Record<string, unknown>) =>
    startFlow(
      t,
      [
        node('d', 'deal', data),
        node('ok', 'message', { text: 'deal ok' }),
        node('bad', 'message', { text: 'deal failed' }),
      ],
      [
        edge('t', 'd'),
        edge('d', 'ok', 'created'),
        edge('d', 'bad', 'error'),
        edge('ok', 'z'),
        edge('bad', 'z'),
      ],
    );

  it('creates a deal for the contact and leaves by the created port, keeping the id in a variable', async () => {
    const f = await dealGraph({
      action: 'create',
      stageId: stages[0]!.id,
      dealName: '{{contact_name}} lead',
      value: '1,250.50',
      saveAs: 'lead_id',
    });
    const peer = nextPeer();
    await say(t, ch, peer, f.word);
    expect(await untilSent(p, t, ch, peer, 1)).toEqual(['deal ok']);
    const run = await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
    const deal = (
      await p.h.owner.query(
        `SELECT d.uuid, d.title, d.value_minor::text AS v, d.source, d.stage_id, d.contact_id FROM deals d
         WHERE d.org_id = $1 AND d.source = 'flow' ORDER BY d.id DESC LIMIT 1`,
        [t.orgId],
      )
    ).rows[0];
    expect(deal).toMatchObject({ title: 'Asha lead', v: '125050', source: 'flow' });
    expect(deal.contact_id).not.toBeNull();
    expect(run.vars.lead_id).toBe(deal.uuid);
  });

  it('move re-stages the contact open deal (no second deal), and creates one when there is none', async () => {
    const make = await dealGraph({ action: 'create', stageId: stages[0]!.id });
    const move = await dealGraph({ action: 'move', stageId: stages[1]!.id });
    const peer = nextPeer();
    await say(t, ch, peer, make.word);
    await untilSent(p, t, ch, peer, 1);
    await untilRun(p, t, make.id, 'created', (r) => r.status === 'completed');
    await say(t, ch, peer, move.word);
    await untilSent(p, t, ch, peer, 2);
    await untilRun(p, t, move.id, 'moved', (r) => r.status === 'completed');
    const rows = (
      await p.h.owner.query(
        `SELECT s.name AS stage FROM deals d
         JOIN pipeline_stages s ON s.org_id = d.org_id AND s.id = d.stage_id
         JOIN flow_runs r ON r.org_id = d.org_id AND r.contact_id = d.contact_id
         WHERE r.flow_id = $1 AND d.source = 'flow'`,
        [move.id],
      )
    ).rows;
    expect(rows.map((r) => r.stage)).toEqual([stages[1]!.name]);

    // A contact with no open deal: move creates one, so the flow never dead-ends.
    const peer2 = nextPeer();
    await say(t, ch, peer2, move.word);
    await untilSent(p, t, ch, peer2, 1);
    const fresh = (
      await p.h.owner.query(
        `SELECT s.name AS stage FROM deals d JOIN pipeline_stages s ON s.org_id = d.org_id AND s.id = d.stage_id
         JOIN contacts c ON c.org_id = d.org_id AND c.id = d.contact_id
         WHERE d.org_id = $1 AND c.phone LIKE $2`,
        [t.orgId, `%${peer2.slice(-8)}`],
      )
    ).rows;
    expect(fresh.map((r) => r.stage)).toEqual([stages[1]!.name]);
  });

  it('a stage that is not this workspace is the error port, and the flow carries on', async () => {
    const other = await p.api.signup('flrdeal2');
    const otherStage = (
      (await p.api.as(other.admin).get('/v2/pipelines')).body as Array<{
        isDefault: boolean;
        stages: Array<{ id: string }>;
      }>
    ).find((x) => x.isDefault)!.stages[0]!.id;
    const before = await p.h.owner.query(`SELECT count(*)::int AS n FROM deals WHERE org_id = $1`, [
      t.orgId,
    ]);
    for (const stageId of [otherStage, randomUUID(), 'junk', '']) {
      const f = await dealGraph({ action: 'create', stageId });
      const peer = nextPeer();
      await say(t, ch, peer, f.word);
      expect(await untilSent(p, t, ch, peer, 1)).toEqual(['deal failed']);
      await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
    }
    const after = await p.h.owner.query(`SELECT count(*)::int AS n FROM deals WHERE org_id = $1`, [
      t.orgId,
    ]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});

describe('Copy-to-number node (TW-FLR-038)', () => {
  let t: Tenant;
  let ch: SimChannel;
  beforeAll(async () => {
    t = await p.api.signup('flrnotify');
    ch = await openChannel(p, t);
  });

  /** What the dispatcher kept for the copy of a run (one stored answer per client reference). */
  const copiesOf = async (runUuid: string) => {
    const keys = await redis.keys(`chat:dispatch:${t.orgId}:${ch.id}:flow:${runUuid}:*:copy`);
    return keys.filter((k) => !k.endsWith(':lock'));
  };

  it('sends the last message the customer got to the number, and records nothing on the customer thread or the number', async () => {
    const f = await startFlow(t, [
      node('a', 'message', { text: 'Your code is 42' }),
      node('n', 'notify_number', { copyNumber: '+91 90000 00001' }),
    ]);
    const peer = nextPeer();
    await say(t, ch, peer, f.word);
    const run = await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
    expect(await untilSent(p, t, ch, peer, 1)).toEqual(['Your code is 42']);
    expect(await copiesOf(run.uuid)).toHaveLength(1);
    const ghost = await p.h.owner.query(
      `SELECT count(*)::int AS n FROM conversations WHERE org_id = $1 AND peer_key = '919000000001'`,
      [t.orgId],
    );
    expect(ghost.rows[0].n).toBe(0);
    expect(await stepNotes(run.id)).not.toContain('copy to');
  });

  it('custom text is rendered; no number and nothing-to-copy are skipped; a refused copy never fails the flow', async () => {
    const custom = await startFlow(t, [
      node('n', 'notify_number', {
        copyNumber: '919000000002',
        source: 'custom',
        text: 'New lead {{name}}',
      }),
    ]);
    await say(t, ch, nextPeer(), custom.word);
    const r1 = await untilRun(p, t, custom.id, 'completed', (r) => r.status === 'completed');
    expect(await copiesOf(r1.uuid)).toHaveLength(1);

    const skipped = await startFlow(t, [
      node('n1', 'notify_number', { copyNumber: 'abc' }),
      node('n2', 'notify_number', { copyNumber: '919000000003' }),
    ]);
    await say(t, ch, nextPeer(), skipped.word);
    const r2 = await untilRun(p, t, skipped.id, 'completed', (r) => r.status === 'completed');
    expect(await copiesOf(r2.uuid)).toHaveLength(0);
    expect(await stepNotes(r2.id)).toContain('copy to number skipped');

    const refused = await startFlow(t, [
      node('n', 'notify_number', {
        copyNumber: '919000000004',
        source: 'custom',
        text: '/fail nope',
      }),
    ]);
    await say(t, ch, nextPeer(), refused.word);
    const r3 = await untilRun(p, t, refused.id, 'completed', (r) => r.status === 'completed');
    expect(await stepNotes(r3.id)).toContain('copy to 919000000004 failed');
  });
});

describe('WhatsApp to Instagram node (TW-FLR-039)', () => {
  it('sends the customer the intro and the ig.me link; no username moves on without a send', async () => {
    const t = await p.api.signup('flrig');
    const ch = await simChannel(p as never, t);
    const f = await startFlow(t, [
      node('a', 'wa_to_instagram', {
        igUsername: '@acme.shop',
        introText: 'Chat with us, {{name}}',
      }),
      node('b', 'wa_to_instagram', {}),
    ]);
    const peer = nextPeer();
    await say(t, ch, peer, f.word);
    expect(await untilSent(p, t, ch, peer, 1)).toEqual([
      'Chat with us, Asha\nhttps://ig.me/m/acme.shop',
    ]);
    const run = await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
    expect(await stepNotes(run.id)).toContain('no Instagram username');
  });
});
