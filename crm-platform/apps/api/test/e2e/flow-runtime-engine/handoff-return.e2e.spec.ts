import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conversationOf, simInbound, until } from '../chat-conversations/pipeline-support';
import {
  addFlow,
  edge,
  graph,
  node,
  runsOf,
  sentTo,
  simChannel,
  startFlowPipeline,
  system,
  untilSent,
  type FlowPipeline,
  type SimChannel,
  type Tenant,
} from './support';

/**
 * Return to bot continues the flow (BL-410): a person gives a conversation back that a flow's Human handoff step handed over, and the
 * flow carries on at the step's `returned` exit, with the optional message to the customer first. Real API, real worker side (the
 * outbox consumer, the flow runtime, the dispatcher), real Postgres and Redis.
 */
let p: FlowPipeline;
/** The real outbox drain: an event a domain wrote is handed to the registered consumers exactly as the worker does it. */
let drainer: { drain(): Promise<void> };
beforeAll(async () => {
  p = await startFlowPipeline();
  const { OutboxDrainService } = await import('../../../src/workers/outbox-drain.service');
  const { DatabaseService } = await import('../../../src/infra/db/database.service');
  const { OutboxSubscriberRegistry } =
    await import('../../../src/kernel/outbox/outbox-subscribers');
  drainer = new OutboxDrainService(
    p.h.app.get(DatabaseService),
    p.h.app.get(OutboxSubscriberRegistry),
  );
}, 300_000);
afterAll(async () => {
  await p?.stop();
});

let counter = 0;
let flowCounter = 0;
const nextPeer = () => `9196${String(10000000 + counter++).padStart(8, '0')}`;
const say = (t: Tenant, ch: SimChannel, peer: string, text: string) =>
  simInbound(p as never, t, ch, { from: peer, name: 'Asha', text });

const consumer = async () =>
  p.h.app.get(
    (await import('../../../src/modules/flow-runtime-engine/triggers/handoff-return.consumer'))
      .HandoffReturnConsumer,
  );

interface Arranged {
  flow: { id: number; uuid: string };
  word: string;
}

/** `trigger -> "Hello from the bot" -> Human handoff`; the handoff waits in the queue and, when wired, `returned -> "Welcome back"`. */
async function arrange(
  t: Tenant,
  opts: { returned: boolean; returnMessage?: string; published?: boolean },
): Promise<Arranged> {
  const word = `ret${flowCounter++}`;
  const nodes = [
    node('t', 'trigger', {}, { isStart: true }),
    node('m1', 'message', { text: 'Hello from the bot' }),
    node('h', 'assign', {
      handoff: 2,
      destination: 'rules',
      reason: 'customer_asked',
      returnMessage: opts.returnMessage ?? '',
    }),
    node('z', 'end'),
    ...(opts.returned
      ? [node('back', 'message', { text: 'Welcome back' }), node('z2', 'end')]
      : []),
  ];
  const edges = [
    edge('t', 'm1'),
    edge('m1', 'h'),
    edge('h', 'z', 'waiting'),
    edge('h', 'z', 'assigned'),
    edge('h', 'z', 'unavailable'),
    ...(opts.returned ? [edge('h', 'back', 'returned'), edge('back', 'z2')] : []),
  ];
  const flow = await addFlow(p, t, {
    graph: graph(nodes, edges),
    trigger: { kind: 'keyword', keywords: word },
    published: opts.published ?? true,
  });
  return { flow, word };
}

/** The customer starts the flow; it hands the conversation over and the chat waits for a person. */
async function handedOver(t: Tenant, ch: SimChannel, a: Arranged) {
  const peer = nextPeer();
  await say(t, ch, peer, a.word);
  const conv = await until('the handoff', async () => {
    const c = await conversationOf(p as never, t, ch, peer);
    return c.handling === 'waiting' ? c : null;
  });
  await untilSent(p, t, ch, peer, 1);
  return { peer, uuid: String(conv.uuid), id: Number(conv.id) };
}

/** Hands pending outbox events to their consumers until `ready` finds what it waits for. */
const drained = <T>(
  label: string,
  ready: () => Promise<T | undefined | null | false>,
  ms = 30_000,
) =>
  until(
    label,
    async () => {
      await drainer.drain();
      return (await ready()) || undefined;
    },
    ms,
  );

const giveBack = (t: Tenant, uuid: string) =>
  p.api
    .as(t.admin)
    .post(`/v2/inbox/conversations/${uuid}/return-to-bot`)
    .set('idempotency-key', randomUUID())
    .send({});

const row = async (id: number) =>
  (await p.h.owner.query(`SELECT * FROM conversations WHERE id = $1`, [id])).rows[0] as Record<
    string,
    unknown
  >;
const lines = async (id: number) =>
  (
    await p.h.owner.query(
      `SELECT meta FROM messages WHERE conversation_id = $1 AND kind = 'system' ORDER BY seq`,
      [id],
    )
  ).rows.map((r) => r.meta as Record<string, unknown>);
const events = async (orgId: number, id: number) =>
  (
    await p.h.owner.query(
      `SELECT type, actor_type, payload FROM conversation_events WHERE org_id = $1 AND conversation_id = $2 ORDER BY id`,
      [orgId, id],
    )
  ).rows as Array<{ type: string; actor_type: string; payload: Record<string, unknown> }>;
const returnRuns = async (t: Tenant, flowId: number) =>
  (await runsOf(p, t, flowId)).filter((r) => r.source === 'handoff');

describe('Return to bot resumes the flow', () => {
  let t: Tenant;
  let ch: SimChannel;
  beforeAll(async () => {
    t = await p.api.signup('rtb');
    ch = await simChannel(p as never, t);
  });

  it('with a returned exit: the message to the customer, then the flow carries on there; the staff see the lines', async () => {
    const a = await arrange(t, { returned: true, returnMessage: 'Hi {{name}}, I am back' });
    const c = await handedOver(t, ch, a);

    const res = await giveBack(t, c.uuid);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ resumed: 'flow', alreadyWithBot: false, why: null });
    expect((await row(c.id)).handling).toBe('with_bot');

    const sent = await drained('the flow continues', async () => {
      const got = await sentTo(p, t, ch, c.peer);
      return got.length >= 3 ? got : undefined;
    });
    expect(sent.slice(1)).toEqual(['Hi Asha, I am back', 'Welcome back']);
    const runs = await returnRuns(t, a.flow.id);
    expect(runs).toHaveLength(1);

    const got = await drained('the result line', async () => {
      const l = await lines(c.id);
      return l.some((m) => m.botStage === 'result') ? l : null;
    });
    expect(got.find((m) => m.botStage === 'pressed')).toMatchObject({
      event: 'bot_returned',
      botResumed: 'flow',
    });
    expect(got.find((m) => m.botStage === 'result')).toMatchObject({
      botResult: 'continued',
      botCustomer: 'sent',
    });
    const ev = await events(t.orgId, c.id);
    expect(ev.map((e) => e.type)).toEqual(
      expect.arrayContaining(['handoff_returned', 'bot_resumed']),
    );
    expect(ev.find((e) => e.type === 'handoff_returned')!.payload).toMatchObject({
      resumed: 'flow',
    });
  });

  it('pressing twice, or a redelivered event, sends nothing twice and starts no second run', async () => {
    const a = await arrange(t, { returned: true, returnMessage: 'Back again' });
    const c = await handedOver(t, ch, a);
    expect((await giveBack(t, c.uuid)).body.resumed).toBe('flow');
    await drained('the flow continues', async () => {
      const got = await sentTo(p, t, ch, c.peer);
      return got.length >= 3;
    });

    const again = await giveBack(t, c.uuid);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ alreadyWithBot: true, resumed: 'next_message' });

    // the outbox delivers at least once: the same event again does nothing
    const handoffId = (
      await p.h.owner.query(
        `SELECT uuid FROM conversation_handoffs WHERE conversation_id = $1 ORDER BY id DESC LIMIT 1`,
        [c.id],
      )
    ).rows[0].uuid as string;
    const runId = Number((await runsOf(p, t, a.flow.id))[0]!.id);
    const out = await system(t.orgId, async () =>
      (await consumer()).resume(t.orgId, {
        conversationUuid: c.uuid,
        handoffUuid: handoffId,
        flowUuid: a.flow.uuid,
        nodeId: 'h',
        flowRunId: runId,
      }),
    );
    expect(out).toBe('duplicate');
    await new Promise((r) => setTimeout(r, 1500));
    expect(await sentTo(p, t, ch, c.peer)).toHaveLength(3);
    expect(await returnRuns(t, a.flow.id)).toHaveLength(1);
  });

  it('without a returned exit nothing is sent now: the bot waits for the next message, and the answer says so', async () => {
    const a = await arrange(t, { returned: false });
    const c = await handedOver(t, ch, a);
    const res = await giveBack(t, c.uuid);
    expect(res.body).toMatchObject({ resumed: 'next_message', why: 'no_returned_exit' });
    await new Promise((r) => setTimeout(r, 1500));
    expect(await sentTo(p, t, ch, c.peer)).toHaveLength(1);
    expect(await returnRuns(t, a.flow.id)).toHaveLength(0);
    expect((await row(c.id)).handling).toBe('with_bot');
    const l = await lines(c.id);
    expect(l.find((m) => m.botStage === 'pressed')).toMatchObject({ botResumed: 'next_message' });
    expect(
      (await events(t.orgId, c.id)).find((e) => e.type === 'handoff_returned')!.payload,
    ).toMatchObject({ resumed: 'next_message', why: 'no_returned_exit' });
  });

  it('a flow that was unpublished, or whose run is gone, is not resumed and the answer says why', async () => {
    const off = await arrange(t, { returned: true });
    const c1 = await handedOver(t, ch, off);
    await p.h.owner.query(`UPDATE flows SET is_published = false WHERE id = $1`, [off.flow.id]);
    expect((await giveBack(t, c1.uuid)).body).toMatchObject({
      resumed: 'next_message',
      why: 'flow_not_live',
    });

    const gone = await arrange(t, { returned: true });
    const c2 = await handedOver(t, ch, gone);
    await p.h.owner.query(
      `DELETE FROM flow_run_steps WHERE run_id IN (SELECT id FROM flow_runs WHERE flow_id = $1)`,
      [gone.flow.id],
    );
    await p.h.owner.query(`DELETE FROM flow_runs WHERE flow_id = $1`, [gone.flow.id]);
    expect((await giveBack(t, c2.uuid)).body).toMatchObject({
      resumed: 'next_message',
      why: 'run_gone',
    });
    await new Promise((r) => setTimeout(r, 1000));
    expect(await returnRuns(t, off.flow.id)).toHaveLength(0);
    expect(await returnRuns(t, gone.flow.id)).toHaveLength(0);
  });

  it('a chat nobody handed over by a flow (a person sent it to the queue) is back on for the next message only', async () => {
    const peer = nextPeer();
    await say(t, ch, peer, 'hello there');
    const conv = await until('thread', async () => {
      const c = await conversationOf(p as never, t, ch, peer);
      return c.last_message_at ? c : null;
    });
    const send = await p.api
      .as(t.admin)
      .post(`/v2/inbox/conversations/${conv.uuid}/handoff`)
      .set('idempotency-key', randomUUID())
      .send({ reason: 'other', destination: { kind: 'rules' } });
    expect(send.status, JSON.stringify(send.body)).toBe(200);
    const res = await giveBack(t, String(conv.uuid));
    expect(res.body).toMatchObject({ resumed: 'next_message', why: 'no_flow_handoff' });
  });

  it('a person who took the chat again meanwhile wins: the flow is not resumed, and the line says so', async () => {
    const a = await arrange(t, { returned: true, returnMessage: 'I am back' });
    const c = await handedOver(t, ch, a);
    const handoffId = (
      await p.h.owner.query(
        `SELECT uuid FROM conversation_handoffs WHERE conversation_id = $1 ORDER BY id DESC LIMIT 1`,
        [c.id],
      )
    ).rows[0].uuid as string;
    const runId = Number((await runsOf(p, t, a.flow.id))[0]!.id);
    // the chat is held by a person (as if a claim landed between the press and the worker)
    await p.h.owner.query(
      `UPDATE conversations SET handling = 'with_person', assignee_user_id = (SELECT id FROM users WHERE org_id = $1 ORDER BY id LIMIT 1) WHERE id = $2`,
      [t.orgId, c.id],
    );
    const out = await system(t.orgId, async () =>
      (await consumer()).resume(t.orgId, {
        conversationUuid: c.uuid,
        handoffUuid: handoffId,
        flowUuid: a.flow.uuid,
        nodeId: 'h',
        flowRunId: runId,
      }),
    );
    expect(out).toBe('claimed_again');
    expect(await returnRuns(t, a.flow.id)).toHaveLength(0);
    expect(await sentTo(p, t, ch, c.peer)).toHaveLength(1);
    const l = await lines(c.id);
    expect(l.find((m) => m.botStage === 'result')).toMatchObject({ botResult: 'claimed_again' });
    expect((await events(t.orgId, c.id)).map((e) => e.type)).toContain('bot_resume_skipped');
  });

  it('with the 24 hour window closed the message to the customer is skipped and said so; the flow still carries on', async () => {
    const a = await arrange(t, { returned: true, returnMessage: 'I am back' });
    const c = await handedOver(t, ch, a);
    await p.h.owner.query(
      `UPDATE conversations SET last_inbound_at = now() - interval '30 hours' WHERE id = $1`,
      [c.id],
    );
    const res = await giveBack(t, c.uuid);
    expect(res.body.resumed).toBe('flow');
    const got = await drained('the result line', async () => {
      const l = await lines(c.id);
      return l.find((m) => m.botStage === 'result') ?? null;
    });
    expect(got).toMatchObject({ botResult: 'continued', botCustomer: 'window_closed' });
    expect(await sentTo(p, t, ch, c.peer)).not.toContain('I am back');
    expect(await returnRuns(t, a.flow.id)).toHaveLength(1);
  });
});
