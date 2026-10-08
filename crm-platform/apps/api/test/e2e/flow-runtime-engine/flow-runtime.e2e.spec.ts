import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { simInbound } from '../chat-conversations/pipeline-support';
import {
  addFlow,
  edge,
  engineOf,
  eventsConsumer,
  graph,
  ingestService,
  node,
  openChannel,
  runsOf,
  sentTo,
  simChannel,
  startFlowPipeline,
  sweeper,
  system,
  until,
  untilRun,
  untilSent,
  type FlowPipeline,
  type SimChannel,
  type Tenant,
} from './support';

let p: FlowPipeline;
beforeAll(async () => {
  p = await startFlowPipeline();
}, 300_000);
afterAll(async () => {
  await p?.stop();
});

let counter = 0;
const nextPeer = () => `9198${String(70000000 + counter++).padStart(8, '0')}`;

/** An interactive reply (a button or list tap) straight into the inbound pipeline: the simulator door sends text only. */
const tap = async (t: Tenant, ch: SimChannel, peer: string, id: string, title: string) => {
  const ingest = await ingestService(p);
  return system(t.orgId, () =>
    ingest.ingest({
      orgId: t.orgId,
      channelUuid: ch.id,
      message: {
        providerMessageId: `spec.${randomUUID()}`,
        peerKey: peer,
        kind: 'interactive',
        body: title,
        meta: { interactive: { type: 'button_reply', id, title } },
        providerTimestamp: new Date().toISOString(),
      } as never,
    }),
  );
};

const say = (t: Tenant, ch: SimChannel, peer: string, text: string) =>
  simInbound(p, t, ch, { from: peer, name: 'Asha', text });

describe('a keyword starts a flow', () => {
  let t: Tenant;
  let ch: SimChannel;
  beforeAll(async () => {
    t = await p.api.signup('flrkw');
    ch = await simChannel(p as never, t);
  });

  it('sends the messages in order, ends at the End node, and records the run', async () => {
    const f = await addFlow(p, t, {
      graph: graph(
        [
          node('t', 'trigger', {}, { isStart: true }),
          node('a', 'message', { text: 'Hello {{name}}!' }),
          node('b', 'message', { text: 'We are open 9 to 5.' }),
          node('z', 'end'),
        ],
        [edge('t', 'a'), edge('a', 'b'), edge('b', 'z')],
      ),
      trigger: { kind: 'keyword', keywords: 'hello, hi there' },
    });
    const peer = nextPeer();
    await say(t, ch, peer, 'Hello');
    const sent = await untilSent(p, t, ch, peer, 2);
    expect(sent).toEqual(['Hello Asha!', 'We are open 9 to 5.']);
    const run = await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
    expect(run).toMatchObject({ source: 'keyword', end_reason: 'end_node' });
    const log = await p.h.owner.query(
      `SELECT event FROM flow_run_steps WHERE run_id = $1 ORDER BY seq, id`,
      [run.id],
    );
    expect(log.rows.map((r) => r.event)).toContain('end');
  });

  it('does nothing for a message that matches no flow, and for a paused or draft flow', async () => {
    await addFlow(p, t, {
      graph: graph([node('a', 'message', { text: 'draft' })], []),
      trigger: { kind: 'keyword', keywords: 'draftword' },
      published: false,
    });
    await addFlow(p, t, {
      graph: graph([node('a', 'message', { text: 'off' })], []),
      trigger: { kind: 'keyword', keywords: 'offword' },
      active: false,
    });
    const peer = nextPeer();
    await say(t, ch, peer, 'draftword');
    await say(t, ch, peer, 'offword');
    await say(t, ch, peer, 'nothing at all');
    await new Promise((r) => setTimeout(r, 1500));
    expect(await sentTo(p, t, ch, peer)).toEqual([]);
  });

  it('the default route fires only when no keyword flow matched', async () => {
    const t2 = await p.api.signup('flrany');
    const ch2 = await simChannel(p as never, t2);
    await addFlow(p, t2, {
      graph: graph([node('a', 'message', { text: 'default route' })], []),
      trigger: { kind: 'keyword', keywords: 'any' },
    });
    await addFlow(p, t2, {
      graph: graph([node('a', 'message', { text: 'pricing info' })], []),
      trigger: { kind: 'keyword', keywords: 'price' },
    });
    const a = nextPeer();
    await say(t2, ch2, a, 'what is the price');
    expect(await untilSent(p, t2, ch2, a, 1)).toEqual(['pricing info']);
    const b = nextPeer();
    await say(t2, ch2, b, 'random words');
    expect(await untilSent(p, t2, ch2, b, 1)).toEqual(['default route']);
  });
});

describe('a flow that asks, and a customer who answers', () => {
  let t: Tenant;
  let ch: SimChannel;
  beforeAll(async () => {
    t = await p.api.signup('flrask');
    ch = await simChannel(p as never, t);
  });

  it('parks on the question, takes the answer, and carries on with it', async () => {
    const f = await addFlow(p, t, {
      graph: graph(
        [
          node('q', 'ask', { prompt: 'Your email?', var: '{{email_in}}' }),
          node('m', 'message', { text: 'Thanks, we will write to {{email_in}}.' }),
          node('z', 'end'),
        ],
        [edge('q', 'm'), edge('m', 'z')],
      ),
      trigger: { kind: 'keyword', keywords: 'signup' },
    });
    const peer = nextPeer();
    await say(t, ch, peer, 'signup');
    await untilRun(p, t, f.id, 'waiting', (r) => r.status === 'waiting' && r.wait?.nodeId === 'q');
    expect(await sentTo(p, t, ch, peer)).toEqual(['Your email?']);

    await say(t, ch, peer, 'asha@example.test');
    const run = await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
    expect(run.vars.email_in).toBe('asha@example.test');
    expect(await untilSent(p, t, ch, peer, 2)).toEqual([
      'Your email?',
      'Thanks, we will write to asha@example.test.',
    ]);
  });

  it('typing the trigger keyword again restarts the flow instead of answering the question', async () => {
    const f = await addFlow(p, t, {
      graph: graph([node('q', 'ask', { prompt: 'Which city?', var: 'city' })], []),
      trigger: { kind: 'keyword', keywords: 'city' },
    });
    const peer = nextPeer();
    await say(t, ch, peer, 'city');
    await untilRun(p, t, f.id, 'waiting', (r) => r.status === 'waiting');
    await say(t, ch, peer, 'city');
    await until('two runs, the first replaced', async () => {
      const runs = await runsOf(p, t, f.id);
      return runs.length === 2 &&
        runs[0]!.status === 'cancelled' &&
        runs[0]!.end_reason === 'replaced'
        ? runs
        : undefined;
    });
    expect((await untilSent(p, t, ch, peer, 2)).filter((m) => m === 'Which city?').length).toBe(2);
  });
});

describe('buttons', () => {
  let t: Tenant;
  let ch: SimChannel;
  beforeAll(async () => {
    t = await p.api.signup('flrbtn');
    ch = await simChannel(p as never, t);
  });

  const menu = () =>
    graph(
      [
        node('b1', 'buttons', { prompt: 'Pick one', options: ['Docs', 'Price'] }),
        node('d', 'message', { text: 'Docs are at example.test/docs' }),
        node('b2', 'buttons', { prompt: 'Which plan?', options: ['Pro', 'Basic'] }),
        node('pro', 'message', { text: 'Pro is 49' }),
      ],
      [edge('b1', 'd', 'p0'), edge('b1', 'b2', 'p1'), edge('b2', 'pro', 'p0')],
    );

  it('routes a tap to its branch, keeps the menu tappable, and routes a tap on an older menu', async () => {
    const f = await addFlow(p, t, {
      graph: menu(),
      trigger: { kind: 'keyword', keywords: 'menu' },
    });
    const peer = nextPeer();
    await say(t, ch, peer, 'menu');
    await untilRun(
      p,
      t,
      f.id,
      'waiting b1',
      (r) => r.status === 'waiting' && r.wait?.nodeId === 'b1',
    );

    await tap(t, ch, peer, 'b_b1_p0', 'Docs');
    await untilSent(p, t, ch, peer, 2);
    // The branch ended without an End node: the menu is back, so the second button still works.
    await untilRun(
      p,
      t,
      f.id,
      'waiting again',
      (r) => r.status === 'waiting' && r.wait?.nodeId === 'b1',
    );
    await tap(t, ch, peer, 'b_b1_p1', 'Price');
    await untilRun(
      p,
      t,
      f.id,
      'waiting b2',
      (r) => r.status === 'waiting' && r.wait?.nodeId === 'b2',
    );
    // Now an old button of the first menu.
    await tap(t, ch, peer, 'b_b1_p0', 'Docs');
    await until('docs sent twice', async () => {
      const got = await sentTo(p, t, ch, peer);
      return got.filter((m) => m.startsWith('Docs are at')).length === 2 ? got : undefined;
    });
    const run = (await runsOf(p, t, f.id)).slice(-1)[0]!;
    expect(run.vars.choice).toBeDefined();
  });

  it('an option that matches nothing leaves the run waiting and sends nothing', async () => {
    const f = await addFlow(p, t, {
      graph: menu(),
      trigger: { kind: 'keyword', keywords: 'burger' },
    });
    const peer = nextPeer();
    await say(t, ch, peer, 'burger');
    await untilRun(p, t, f.id, 'waiting', (r) => r.status === 'waiting');
    const before = (await sentTo(p, t, ch, peer)).length;
    await say(t, ch, peer, 'banana');
    await new Promise((r) => setTimeout(r, 1500));
    expect((await sentTo(p, t, ch, peer)).length).toBe(before);
    expect((await runsOf(p, t, f.id)).slice(-1)[0]!.status).toBe('waiting');
  });
});

describe('a delay survives a lost job', () => {
  it('sleeps in the database and the sweeper wakes it when its job is gone', async () => {
    const t = await p.api.signup('flrdelay');
    const ch = await simChannel(p as never, t);
    const f = await addFlow(p, t, {
      graph: graph(
        [
          node('a', 'message', { text: 'before' }),
          node('d', 'delay', { amount: 2, unit: 'day' }),
          node('b', 'message', { text: 'after two days' }),
        ],
        [edge('a', 'd'), edge('d', 'b')],
      ),
      trigger: { kind: 'keyword', keywords: 'later' },
    });
    const peer = nextPeer();
    await say(t, ch, peer, 'later');
    const sleeping = await untilRun(p, t, f.id, 'sleeping', (r) => r.status === 'sleeping');
    expect(await sentTo(p, t, ch, peer)).toEqual(['before']);

    // The queue forgot the job (a flushed Redis, a deploy): the run is only a row. Two days pass.
    await p.h.owner.query(
      `UPDATE flow_runs SET resume_at = now() - interval '1 minute' WHERE id = $1`,
      [sleeping.id],
    );
    const sw = await sweeper(p);
    await system(t.orgId, () => sw.tickOnce());
    const done = await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
    expect(done.id).toBe(sleeping.id);
    expect(await untilSent(p, t, ch, peer, 2)).toEqual(['before', 'after two days']);
  });
});

describe('giving up', () => {
  it('an idle wait expires, and a reply that comes after it starts nothing', async () => {
    const t = await p.api.signup('flridle');
    const ch = await simChannel(p as never, t);
    const f = await addFlow(p, t, {
      graph: graph(
        [
          node('q', 'ask', { prompt: 'Still there?', var: 'x' }),
          node('m', 'message', { text: 'thanks' }),
        ],
        [edge('q', 'm')],
      ),
      trigger: { kind: 'keyword', keywords: 'idle' },
    });
    const peer = nextPeer();
    await say(t, ch, peer, 'idle');
    const waiting = await untilRun(p, t, f.id, 'waiting', (r) => r.status === 'waiting');
    await p.h.owner.query(
      `UPDATE flow_runs SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [waiting.id],
    );
    const sw = await sweeper(p);
    await system(t.orgId, () => sw.tickOnce());
    const run = await untilRun(p, t, f.id, 'expired', (r) => r.status === 'expired');
    expect(run.end_reason).toBe('idle_timeout');
    await say(t, ch, peer, 'yes');
    await new Promise((r) => setTimeout(r, 1200));
    expect(await sentTo(p, t, ch, peer)).toEqual(['Still there?']);
  });

  it('a flow that loops stops at 20 visits and records why', async () => {
    const t = await p.api.signup('flrloop');
    const ch = await simChannel(p as never, t);
    const f = await addFlow(p, t, {
      graph: graph(
        [node('a', 'message', { text: 'x' }), node('b', 'message', { text: 'y' })],
        [edge('a', 'b'), edge('b', 'a')],
      ),
      trigger: { kind: 'keyword', keywords: 'loop' },
    });
    await say(t, ch, nextPeer(), 'loop');
    const run = await untilRun(p, t, f.id, 'failed', (r) => r.status === 'failed', 40_000);
    expect(run.end_reason).toBe('loop_guard');
    expect(run.failure_reason).toMatch(/more than 20 times/);
  });
});

describe('enrolling contacts', () => {
  let t: Tenant;
  let ch: SimChannel;
  let flowUuid: string;
  let flowId: number;
  let contacts: string[];
  beforeAll(async () => {
    t = await p.api.signup('flrenr');
    ch = await openChannel(p, t);
    const f = await addFlow(p, t, {
      graph: graph(
        [node('a', 'message', { text: 'Hi {{first_name}}, you are in.' }), node('z', 'end')],
        [edge('a', 'z')],
      ),
      trigger: { kind: 'manual_enroll' },
    });
    flowUuid = f.uuid;
    flowId = f.id;
    contacts = await p.api.seedContacts(t, [
      { name: 'Ravi Kumar', phone: '+919811100001' },
      { name: 'Meena Rao', phone: '+919811100002' },
    ]);
  });

  it('starts a run per contact, once, and marks the subscribers completed', async () => {
    const res = await p.api
      .as(t.admin)
      .post(`/v2/flow-runtime/flows/${flowUuid}/enroll`)
      .send({ contactIds: contacts });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ enrolled: 2, alreadyEnrolled: 0, failed: 0 });
    expect(await untilSent(p, t, ch, '919811100001', 1)).toEqual(['Hi Ravi, you are in.']);
    await untilRun(p, t, flowId, 'both done', () => true);
    await until('subscribers completed', async () => {
      const r = await p.h.owner.query(
        `SELECT status FROM flow_subscribers WHERE org_id = $1 AND flow_id = $2`,
        [t.orgId, flowId],
      );
      return r.rows.length === 2 && r.rows.every((x) => x.status === 'completed')
        ? true
        : undefined;
    });

    const again = await p.api
      .as(t.admin)
      .post(`/v2/flow-runtime/flows/${flowUuid}/enroll`)
      .send({ contactIds: contacts });
    expect(again.body).toMatchObject({ enrolled: 0, alreadyEnrolled: 2 });
    const subs = await p.api.as(t.admin).get(`/v2/flow-runtime/flows/${flowUuid}/subscribers`);
    expect(subs.body.counts).toMatchObject({ completed: 2, active: 0, failed: 0 });
    expect(subs.body.items).toHaveLength(2);
  });

  it('refuses an inactive flow, ignores a contact of another workspace, and does not leak flows across workspaces', async () => {
    const off = await addFlow(p, t, {
      graph: graph([node('a', 'message', { text: 'x' })], []),
      active: false,
      trigger: { kind: 'manual_enroll' },
    });
    const r1 = await p.api
      .as(t.admin)
      .post(`/v2/flow-runtime/flows/${off.uuid}/enroll`)
      .send({ contactIds: contacts });
    expect(r1.status).toBe(422);
    expect(r1.body.code).toBe('FLR_FLOW_INACTIVE');

    const other = await p.api.signup('flrother');
    const foreign = await p.api.seedContacts(other, [{ name: 'Not Ours', phone: '+919811100099' }]);
    const r2 = await p.api
      .as(t.admin)
      .post(`/v2/flow-runtime/flows/${flowUuid}/enroll`)
      .send({ contactIds: foreign });
    expect(r2.status).toBe(200);
    expect(r2.body).toMatchObject({ enrolled: 0, failed: 0, alreadyEnrolled: 0, results: [] });

    const r3 = await p.api.as(other.admin).get(`/v2/flow-runtime/flows/${flowUuid}/subscribers`);
    expect(r3.status).toBe(404);
    const runs = await p.api.as(t.admin).get('/v2/flow-runtime/runs');
    const otherRuns = await p.api.as(other.admin).get('/v2/flow-runtime/runs');
    expect(runs.body.items.length).toBeGreaterThan(0);
    expect(otherRuns.body.items).toHaveLength(0);
  });

  it('a workspace with no connected sender gets a failed subscriber with the reason, and a retry works once one exists', async () => {
    const t3 = await p.api.signup('flrnosend');
    const f = await addFlow(p, t3, {
      graph: graph([node('a', 'message', { text: 'hello again' })], []),
      trigger: { kind: 'manual_enroll' },
    });
    const [cid] = await p.api.seedContacts(t3, [{ name: 'Late Joiner', phone: '+919811100007' }]);
    const res = await p.api
      .as(t3.admin)
      .post(`/v2/flow-runtime/flows/${f.uuid}/enroll`)
      .send({ contactIds: [cid] });
    expect(res.body).toMatchObject({ enrolled: 0, failed: 1 });
    expect(res.body.results[0].reason).toBe('No connected simulator sender for this workspace');
    const subs = await p.api
      .as(t3.admin)
      .get(`/v2/flow-runtime/flows/${f.uuid}/subscribers?status=failed`);
    expect(subs.body.counts.failed).toBe(1);
    expect(subs.body.items[0].failureReason).toContain('No connected simulator sender');

    const ch3 = await openChannel(p, t3);
    const retry = await p.api
      .as(t3.admin)
      .post(`/v2/flow-runtime/subscribers/${subs.body.items[0].id}/retry`);
    expect(retry.status, JSON.stringify(retry.body)).toBe(200);
    expect(retry.body).toEqual({ retried: 1, skipped: 0, outcome: 'queued', reason: null });
    expect(await untilSent(p, t3, ch3, '919811100007', 1)).toEqual(['hello again']);
    const logs = await p.h.owner.query(
      `SELECT outcome, previous_status FROM flow_retry_logs WHERE org_id = $1`,
      [t3.orgId],
    );
    expect(logs.rows).toEqual([{ outcome: 'queued', previous_status: 'failed' }]);

    const notFailed = await p.api
      .as(t3.admin)
      .post(`/v2/flow-runtime/subscribers/${subs.body.items[0].id}/retry`);
    // The cooldown is checked before the state, as Reference does: a second press right away reads "just retried".
    expect(notFailed.status).toBe(429);
    expect(notFailed.body.code).toBe('FLR_RETRY_TOO_SOON');
  });

  it('only people who may manage runs can enrol', async () => {
    const reader = await p.api.member(t, 'reader', [['flr.runs.read']]);
    const denied = await p.api
      .as(reader.token)
      .post(`/v2/flow-runtime/flows/${flowUuid}/enroll`)
      .send({ contactIds: contacts });
    expect(denied.status).toBe(403);
    const ok = await p.api.as(reader.token).get('/v2/flow-runtime/runs');
    expect(ok.status).toBe(200);
    const nobody = await p.api.member(t, 'nobody', []);
    expect((await p.api.as(nobody.token).get('/v2/flow-runtime/runs')).status).toBe(403);
  });
});

describe('pause and resume', () => {
  it('a paused run keeps its place and goes on where it left off', async () => {
    const t = await p.api.signup('flrpause');
    const ch = await openChannel(p, t);
    const f = await addFlow(p, t, {
      graph: graph(
        [
          node('q', 'ask', { prompt: 'Name?', var: 'who' }),
          node('m', 'message', { text: 'Hi {{who}}' }),
        ],
        [edge('q', 'm')],
      ),
      trigger: { kind: 'manual_enroll' },
    });
    const [cid] = await p.api.seedContacts(t, [{ name: 'Pauser', phone: '+919811100031' }]);
    await p.api
      .as(t.admin)
      .post(`/v2/flow-runtime/flows/${f.uuid}/enroll`)
      .send({ contactIds: [cid] });
    await untilRun(p, t, f.id, 'waiting', (r) => r.status === 'waiting');
    const subs = await p.api.as(t.admin).get(`/v2/flow-runtime/flows/${f.uuid}/subscribers`);
    const sid = subs.body.items[0].id as string;

    expect((await p.api.as(t.admin).post(`/v2/flow-runtime/subscribers/${sid}/pause`)).status).toBe(
      204,
    );
    const paused = (await runsOf(p, t, f.id))[0]!;
    expect(paused.status).toBe('halted');
    await say(t, ch, '919811100031', 'Asha');
    await new Promise((r) => setTimeout(r, 1200));
    expect((await runsOf(p, t, f.id))[0]!.status).toBe('halted');

    expect(
      (await p.api.as(t.admin).post(`/v2/flow-runtime/subscribers/${sid}/resume`)).status,
    ).toBe(204);
    await untilRun(p, t, f.id, 'waiting again', (r) => r.status === 'waiting');
    await say(t, ch, '919811100031', 'Asha');
    await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
    expect((await untilSent(p, t, ch, '919811100031', 2))[1]).toBe('Hi Asha');
  });
});

describe('domain events start flows', () => {
  it('a tag on a contact starts the flow bound to that tag, once', async () => {
    const t = await p.api.signup('flrtag');
    const ch = await openChannel(p, t);
    const tag = await p.api
      .as(t.admin)
      .post('/v2/tags')
      .set('idempotency-key', `tag-${Math.random()}`)
      .send({ name: 'VIP' });
    expect(tag.status, JSON.stringify(tag.body)).toBeLessThan(300);
    const tagRow = await p.h.owner.query(`SELECT id FROM tags WHERE uuid = $1`, [tag.body.id]);
    await addFlow(p, t, {
      graph: graph([node('a', 'message', { text: 'Welcome to VIP' })], []),
      trigger: { kind: 'tag_added', value: Number(tagRow.rows[0].id) },
    });
    const [cid] = await p.api.seedContacts(t, [{ name: 'Vip Person', phone: '+919811100041' }]);
    const res = await p.api
      .as(t.admin)
      .post('/v2/tags/attach')
      .set('idempotency-key', `att-${Math.random()}`)
      .send({ contactIds: [cid], tagIds: [tag.body.id] });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);

    const ev = await p.h.owner.query(
      `SELECT id, org_id, aggregate_module, aggregate_id, event_type, payload FROM event_outbox WHERE org_id = $1 AND event_type = 'contact.tag_added'`,
      [t.orgId],
    );
    expect(ev.rows.length).toBeGreaterThan(0);
    const consumer = await eventsConsumer(p);
    const deliver = () =>
      system(t.orgId, () =>
        consumer.handle({
          id: String(ev.rows[0].id),
          orgId: t.orgId,
          aggregateModule: ev.rows[0].aggregate_module,
          aggregateId: String(ev.rows[0].aggregate_id),
          eventType: 'contact.tag_added',
          payload: ev.rows[0].payload,
        }),
      );
    await deliver();
    expect(await untilSent(p, t, ch, '919811100041', 1)).toEqual(['Welcome to VIP']);
    await deliver(); // at-least-once delivery: the same event again changes nothing
    await new Promise((r) => setTimeout(r, 1000));
    expect(await sentTo(p, t, ch, '919811100041')).toEqual(['Welcome to VIP']);
  });

  it('an order starts the order flow with its tags, and a second order runs it again', async () => {
    const t = await p.api.signup('flrorder');
    const ch = await openChannel(p, t);
    const f = await addFlow(p, t, {
      graph: graph(
        [node('a', 'message', { text: 'Order {{order_number}} for {{total}} received' })],
        [],
      ),
      trigger: { kind: 'order_placed', value: 0 },
    });
    await p.api.seedContacts(t, [{ name: 'Buyer', phone: '+919811100051' }]);
    const consumer = await eventsConsumer(p);
    const place = (orderId: string, n: string) =>
      system(t.orgId, () =>
        consumer.handle({
          id: `o-${orderId}`,
          orgId: t.orgId,
          aggregateModule: 'orders',
          aggregateId: orderId,
          eventType: 'order.placed',
          payload: {
            orderId,
            phone: '+919811100051',
            orderNumber: n,
            totalMinor: 12500,
            currency: 'USD',
          },
        }),
      );
    await place('1', '1001');
    await untilSent(p, t, ch, '919811100051', 1);
    await untilRun(p, t, f.id, 'first done', (r) => r.status === 'completed');
    await place('2', '1002');
    expect(await untilSent(p, t, ch, '919811100051', 2)).toEqual([
      'Order 1001 for 125.00 USD received',
      'Order 1002 for 125.00 USD received',
    ]);
    await place('2', '1002'); // the same order delivered twice is not a new reason
    await new Promise((r) => setTimeout(r, 800));
    expect((await sentTo(p, t, ch, '919811100051')).length).toBe(2);
  });

  it('a store checkout and a WhatsApp catalog cart both start the order flow, once per order', async () => {
    const t = await p.api.signup('flrorder3');
    const ch = await openChannel(p, t);
    const f = await addFlow(p, t, {
      graph: graph(
        [node('a', 'message', { text: 'Order {{order_number}} for {{total}} received' })],
        [],
      ),
      trigger: { kind: 'order_placed', value: 0 },
    });
    await p.api.seedContacts(t, [{ name: 'Buyer', phone: '+919811100061' }]);
    const orderRow = async (source: string) =>
      (
        await p.h.owner.query(
          `INSERT INTO wa_orders (org_id, source, customer_phone, customer_name, items_json, total_minor, currency_code)
           VALUES ($1, $2, '919811100061', 'Buyer', '[]', 4999, 'INR') RETURNING id, uuid`,
          [t.orgId, source],
        )
      ).rows[0] as { id: string; uuid: string };
    const consumer = await eventsConsumer(p);
    const fire = (
      eventType: string,
      o: { id: string; uuid: string },
      payload: Record<string, unknown>,
    ) =>
      system(t.orgId, () =>
        consumer.handle({
          id: `${eventType}-${o.id}`,
          orgId: t.orgId,
          aggregateModule: 'wa_orders',
          aggregateId: o.id,
          eventType,
          payload: { orderId: o.uuid, ...payload },
        }),
      );
    const store = await orderRow('storefront');
    await fire('store.order_placed', store, { customerPhone: '919811100061', totalMinor: 4999 });
    await untilSent(p, t, ch, '919811100061', 1);
    await untilRun(p, t, f.id, 'first done', (r) => r.status === 'completed');
    await fire('store.order_placed', store, {}); // at-least-once: the same order again
    const cart = await orderRow('waba');
    await fire('whatsapp.order.received', cart, { phone: '919811100061' });
    expect(await untilSent(p, t, ch, '919811100061', 2)).toEqual([
      `Order ${store.id} for 49.99 INR received`,
      `Order ${cart.id} for 49.99 INR received`,
    ]);
    await new Promise((r) => setTimeout(r, 800));
    expect((await sentTo(p, t, ch, '919811100061')).length).toBe(2);
    expect((await runsOf(p, t, f.id)).length).toBe(2);
  });

  it('an order for a phone nobody saved starts nothing', async () => {
    const t = await p.api.signup('flrorder2');
    await simChannel(p as never, t);
    const f = await addFlow(p, t, {
      graph: graph([node('a', 'message', { text: 'x' })], []),
      trigger: { kind: 'order_placed', value: 0 },
    });
    const consumer = await eventsConsumer(p);
    await system(t.orgId, () =>
      consumer.handle({
        id: 'x',
        orgId: t.orgId,
        aggregateModule: 'orders',
        aggregateId: '9',
        eventType: 'order.placed',
        payload: { orderId: '9', phone: '+919000000000' },
      }),
    );
    expect(await runsOf(p, t, f.id)).toHaveLength(0);
  });
});

describe('an Instagram flow hands the chat to a WhatsApp flow (TW-FLR-010 rule 6)', () => {
  it('direct mode says the intro, then the consumer makes the contact and starts the chosen flow once', async () => {
    const t = await p.api.signup('flrhandoff');
    const ch = await openChannel(p, t);
    const target = await addFlow(p, t, {
      graph: graph([node('b', 'message', { text: 'Welcome from Instagram' })], []),
      trigger: { kind: 'keyword', keywords: 'never-typed' },
    });
    await addFlow(p, t, {
      graph: {
        flowNodes: [
          node('q', 'ig_ask', { question: 'Your WhatsApp number?', save: 'wa_number' }),
          node('h', 'ig_to_whatsapp', {
            mode: 'direct',
            numberVar: 'wa_number',
            waFlowId: target.uuid,
            introText: 'One moment, moving you to WhatsApp',
          }),
        ],
        flowEdges: [edge('q', 'h')],
        vars: {},
      },
      trigger: { kind: 'keyword', keywords: 'handoff' },
    });
    const peer = nextPeer();
    await say(t, ch, peer, 'handoff');
    await untilSent(p, t, ch, peer, 1);
    await say(t, ch, peer, '+91 98111 00071');
    expect(await untilSent(p, t, ch, peer, 2)).toEqual([
      'Your WhatsApp number?',
      'One moment, moving you to WhatsApp',
    ]);

    const ev = await p.h.owner.query(
      `SELECT id, aggregate_module, aggregate_id, payload FROM event_outbox
        WHERE org_id = $1 AND event_type = 'flow.whatsapp_handoff_requested'`,
      [t.orgId],
    );
    expect(ev.rows.length).toBe(1);
    const consumer = p.h.app.get(
      (
        await import('../../../src/modules/flow-runtime-engine/runtime/nodes/actions/social-handoff.consumer')
      ).SocialHandoffConsumer,
    );
    const deliver = () =>
      system(t.orgId, () =>
        consumer.handle({
          id: String(ev.rows[0].id),
          orgId: t.orgId,
          aggregateModule: ev.rows[0].aggregate_module,
          aggregateId: String(ev.rows[0].aggregate_id),
          eventType: 'flow.whatsapp_handoff_requested',
          payload: ev.rows[0].payload,
        }),
      );
    await deliver();
    await untilRun(p, t, target.id, 'target started', () => true);
    const contact = await p.h.owner.query(
      `SELECT name FROM contacts WHERE org_id = $1 AND normalized_phone = '+919811100071'`,
      [t.orgId],
    );
    expect(contact.rows[0].name).toBe('WhatsApp 919811100071');
    const runs = await runsOf(p, t, target.id);
    expect(runs.length).toBe(1);
    expect(runs[0].source).toBe('handoff');
    await deliver(); // at-least-once delivery: the same event again starts nothing
    expect((await runsOf(p, t, target.id)).length).toBe(1);
  });
});

describe('the numbers', () => {
  it('count completed, failed and where runs came from, for every launch path', async () => {
    const t = await p.api.signup('flrstat');
    const ch = await simChannel(p as never, t);
    const f = await addFlow(p, t, {
      graph: graph([node('a', 'message', { text: 'hi' }), node('z', 'end')], [edge('a', 'z')]),
      trigger: { kind: 'keyword', keywords: 'stat' },
    });
    await say(t, ch, nextPeer(), 'stat');
    await untilRun(p, t, f.id, 'done', (r) => r.status === 'completed');
    const res = await p.api.as(t.admin).get('/v2/flow-runtime/analytics');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.totals).toMatchObject({ enrolled: 1, completed: 1, failed: 0 });
    expect(res.body.completionRate).toBe(1);
    expect(res.body.bySource).toEqual([{ source: 'keyword', count: 1 }]);
    const list = await p.api.as(t.admin).get(`/v2/flow-runtime/runs?flowId=${f.uuid}`);
    expect(list.body.items).toHaveLength(1);
    const detail = await p.api.as(t.admin).get(`/v2/flow-runtime/runs/${list.body.items[0].id}`);
    expect(detail.body.log.map((s: { event: string }) => s.event)).toContain('end');
    expect(detail.body.variables).toBeDefined();
  });
});

describe('the engine on its own', () => {
  it('a step job for a run that already moved on does nothing', async () => {
    const t = await p.api.signup('flrstale');
    const ch = await simChannel(p as never, t);
    const f = await addFlow(p, t, {
      graph: graph([node('a', 'message', { text: 'once' }), node('z', 'end')], [edge('a', 'z')]),
      trigger: { kind: 'keyword', keywords: 'once' },
    });
    const peer = nextPeer();
    await say(t, ch, peer, 'once');
    const run = await untilRun(p, t, f.id, 'done', (r) => r.status === 'completed');
    const engine = await engineOf(p);
    expect(await system(t.orgId, () => engine.advance(t.orgId, run.id, 0))).toBe('stale');
    expect(await sentTo(p, t, ch, peer)).toEqual(['once']);
  });
});
