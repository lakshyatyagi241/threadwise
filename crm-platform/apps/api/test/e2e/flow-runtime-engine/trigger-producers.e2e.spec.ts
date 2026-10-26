import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { simInbound } from '../chat-conversations/pipeline-support';
import { startHarness } from '../contacts-attributes-tags/support';
import {
  Api,
  addFlow,
  eventsConsumer,
  graph,
  node,
  openChannel,
  runsOf,
  sentTo,
  simChannel,
  system,
  until,
  untilRun,
  untilSent,
  type FlowPipeline,
  type Tenant,
} from './support';

/**
 * The producers of flow triggers (TW-FLR-005, 006, 010) and the guards every one of them shares: a start never repeats for one event, a
 * paused or draft flow and another workspace's flow never start, a chain of flows that start each other stops, and a free-form
 * message the 24 hour window refuses is a failed run, not a green one. Real Postgres, real BullMQ, the real consumer; the channel is
 * the simulator (its window is open or closed as the spec arranges it).
 */
let p: FlowPipeline;
/** The real outbox drain: an event a domain wrote is handed to the registered consumers exactly as the worker does it. */
let drainer: { drain(): Promise<void> };
beforeAll(async () => {
  process.env.CHANNEL_SIMULATOR_ENABLED = 'true';
  const h = await startHarness({
    loadModules: async () => [
      (await import('../../../src/modules/chat-conversations/chat-conversations-worker.module'))
        .ChatConversationsWorkerModule,
      (await import('../../../src/modules/flow-runtime-engine')).FlowRuntimeEngineWorkerModule,
      // The sources of the events these producers turn into starts: the STOP / START words and the routing rules.
      (await import('../../../src/modules/contact-consent/contact-consent-worker.module'))
        .ContactConsentWorkerModule,
      (
        await import('../../../src/modules/team-inbox-routing-sla/team-inbox-routing-sla-worker.module')
      ).TeamInboxRoutingSlaWorkerModule,
    ],
  });
  await h.app.listen(0, '127.0.0.1');
  p = { h, api: new Api(h), stop: () => h.stop() };
  const { OutboxDrainService } = await import('../../../src/workers/outbox-drain.service');
  const { DatabaseService } = await import('../../../src/infra/db/database.service');
  const { OutboxSubscriberRegistry } =
    await import('../../../src/kernel/outbox/outbox-subscribers');
  drainer = new OutboxDrainService(h.app.get(DatabaseService), h.app.get(OutboxSubscriberRegistry));
}, 300_000);
afterAll(async () => {
  await p?.stop();
});

let seq = 0;
const nextPhone = () => `91981110${String(9000 + seq++)}`;

interface Delivered {
  type: string;
  payload: Record<string, unknown>;
  /** The run whose step caused this event (the outbox stamps its request id as `flr-<run>-<seq>`). */
  causedByRun?: number;
  id?: string;
  aggregateId?: string;
}

/** Hands one event to the flow consumer, as the outbox drain does. */
async function deliver(t: Tenant, d: Delivered) {
  const consumer = await eventsConsumer(p);
  const id = d.id ?? `ev-${seq++}`;
  return system(t.orgId, () =>
    consumer.handle({
      id,
      orgId: t.orgId,
      aggregateModule: 'spec',
      aggregateId: d.aggregateId ?? id,
      eventType: d.type,
      payload: {
        ...d.payload,
        _meta: {
          requestId: d.causedByRun ? `flr-${d.causedByRun}-1` : 'spec',
          actorType: 'system',
          actorId: null,
        },
      },
    }),
  );
}

const subscribersOf = async (t: Tenant, flowId: number) =>
  (
    await p.h.owner.query(
      `SELECT status, failure_reason FROM flow_subscribers WHERE org_id = $1 AND flow_id = $2`,
      [t.orgId, flowId],
    )
  ).rows as Array<{ status: string; failure_reason: string | null }>;

const quiet = () => new Promise((r) => setTimeout(r, 800));

describe('the guards every trigger shares', () => {
  it('stops flows that start each other after five links, and shows why on the subscriber', async () => {
    const t = await p.api.signup('flrloop');
    const ch = await openChannel(p, t);
    const phone = nextPhone();
    const f = await addFlow(p, t, {
      graph: graph([node('a', 'message', { text: 'Thanks for order {{order_number}}' })], []),
      trigger: { kind: 'order_placed', value: 0 },
    });
    await p.api.seedContacts(t, [{ name: 'Looper', phone: `+${phone}` }]);
    const place = (n: number, causedByRun?: number) =>
      deliver(t, {
        type: 'order.placed',
        payload: { orderId: `loop-${n}`, phone: `+${phone}`, orderNumber: String(n) },
        ...(causedByRun ? { causedByRun } : {}),
      });

    // A person's order (no run caused it), then each run "places" the next order, as a flow with an order step would.
    await place(1);
    let last = await untilRun(p, t, f.id, 'run 1 done', (r) => r.status === 'completed');
    for (let n = 2; n <= 5; n++) {
      await place(n, last.id);
      last = await untilRun(
        p,
        t,
        f.id,
        `run ${n} done`,
        (r) => r.id !== last.id && r.status === 'completed',
      );
      expect(last.vars.__trigger_hops).toBe(n - 1);
    }
    expect(await untilSent(p, t, ch, phone, 5)).toHaveLength(5);

    // The sixth link is refused: no run, a failed subscriber with the reason.
    await place(6, last.id);
    await quiet();
    expect(await runsOf(p, t, f.id)).toHaveLength(5);
    const subs = await subscribersOf(t, f.id);
    expect(subs).toHaveLength(1);
    expect(subs[0]!.status).toBe('failed');
    expect(subs[0]!.failure_reason).toContain('started each other');
    expect(await sentTo(p, t, ch, phone)).toHaveLength(5);

    // The loop broken by something outside the runtime (a real order) starts the flow again.
    await place(7);
    await untilRun(
      p,
      t,
      f.id,
      'a real order after the stop',
      (r) => r.id !== last.id && r.status === 'completed',
    );
    expect(await runsOf(p, t, f.id)).toHaveLength(6);
  });

  it('an event caused by a run of another workspace is not counted against this one', async () => {
    const a = await p.api.signup('flrloopa');
    const b = await p.api.signup('flrloopb');
    await openChannel(p, a);
    await openChannel(p, b);
    const phone = nextPhone();
    const fa = await addFlow(p, a, {
      graph: graph([node('a', 'message', { text: 'a' })], []),
      trigger: { kind: 'order_placed', value: 0 },
    });
    await p.api.seedContacts(a, [{ name: 'A', phone: `+${phone}` }]);
    await p.api.seedContacts(b, [{ name: 'B', phone: `+${phone}` }]);
    const fb = await addFlow(p, b, {
      graph: graph([node('a', 'message', { text: 'b' })], []),
      trigger: { kind: 'order_placed', value: 0 },
    });
    await deliver(b, { type: 'order.placed', payload: { orderId: 'b-1', phone: `+${phone}` } });
    const runB = await untilRun(p, b, fb.id, 'b done', (r) => r.status === 'completed');
    // A's event names B's run as its cause: the lookup is scoped to A, finds nothing, and the event is a plain hop 0.
    await deliver(a, {
      type: 'order.placed',
      payload: { orderId: 'a-1', phone: `+${phone}` },
      causedByRun: runB.id,
    });
    const runA = await untilRun(p, a, fa.id, 'a done', (r) => r.status === 'completed');
    expect(runA.vars.__trigger_hops).toBeUndefined();
  });

  it('a paused flow, a draft and another workspace never start; redelivery of an event starts nothing twice', async () => {
    const t = await p.api.signup('flrlive');
    const other = await p.api.signup('flrliveo');
    await openChannel(p, t);
    await openChannel(p, other);
    const phone = nextPhone();
    const live = await addFlow(p, t, {
      graph: graph([node('a', 'message', { text: 'live' })], []),
      trigger: { kind: 'order_placed', value: 0 },
    });
    const paused = await addFlow(p, t, {
      graph: graph([node('a', 'message', { text: 'paused' })], []),
      trigger: { kind: 'order_placed', value: 0 },
      active: false,
    });
    const draft = await addFlow(p, t, {
      graph: graph([node('a', 'message', { text: 'draft' })], []),
      trigger: { kind: 'order_placed', value: 0 },
      published: false,
    });
    const foreign = await addFlow(p, other, {
      graph: graph([node('a', 'message', { text: 'foreign' })], []),
      trigger: { kind: 'order_placed', value: 0 },
    });
    await p.api.seedContacts(t, [{ name: 'Mine', phone: `+${phone}` }]);
    await p.api.seedContacts(other, [{ name: 'Theirs', phone: `+${phone}` }]);

    const event = {
      type: 'order.placed',
      payload: { orderId: 'live-1', phone: `+${phone}` },
      id: 'live-1',
    };
    await deliver(t, event);
    await untilRun(p, t, live.id, 'live done', (r) => r.status === 'completed');
    await deliver(t, event); // at-least-once: the same event again
    await quiet();
    expect(await runsOf(p, t, live.id)).toHaveLength(1);
    expect(await runsOf(p, t, paused.id)).toHaveLength(0);
    expect(await runsOf(p, t, draft.id)).toHaveLength(0);
    expect(await runsOf(p, other, foreign.id)).toHaveLength(0);
  });

  it('a flow started by an event whose message the 24 hour window refuses ends failed, with the reason', async () => {
    const t = await p.api.signup('flrwindow');
    // The simulator's window is closed until the customer writes: only a template may open the conversation.
    const ch = await simChannel(p as never, t);
    const phone = nextPhone();
    const f = await addFlow(p, t, {
      graph: graph([node('a', 'message', { text: 'Your order is confirmed' })], []),
      trigger: { kind: 'order_placed', value: 0 },
    });
    await p.api.seedContacts(t, [{ name: 'Late', phone: `+${phone}` }]);
    await deliver(t, { type: 'order.placed', payload: { orderId: 'w-1', phone: `+${phone}` } });
    const run = await untilRun(p, t, f.id, 'failed', (r) => r.status === 'failed');
    expect(run.end_reason).toBe('send_failed');
    expect(run.failure_reason).toContain('Nothing reached the customer');
    const detail = (
      await p.h.owner.query(`SELECT failure_code FROM flow_runs WHERE id = $1`, [run.id])
    ).rows[0];
    expect(detail.failure_code).toBe('SERVICE_WINDOW_CLOSED');
    expect(await sentTo(p, t, ch, phone)).toEqual([]);
    const subs = await subscribersOf(t, f.id);
    expect(subs[0]!.status).toBe('failed');
    expect(subs[0]!.failure_reason).toContain('Nothing reached the customer');
  });
});

describe('order.placed from a store sync (TW-FLR-006)', () => {
  it('starts the order flow once with the order as variables, for the contact the sync linked', async () => {
    const t = await p.api.signup('flrstoreord');
    const ch = await openChannel(p, t);
    const phone = nextPhone();
    const f = await addFlow(p, t, {
      graph: graph(
        [
          node('a', 'message', {
            text: 'Hi {{first_name}}, {{order_name}} is {{total}} ({{status}})',
          }),
        ],
        [],
      ),
      trigger: { kind: 'order_placed', value: 0 },
    });
    const [cid] = await p.api.seedContacts(t, [{ name: 'Ada Lovelace', phone: `+${phone}` }]);
    const internal = (await p.h.owner.query(`SELECT id FROM contacts WHERE uuid = $1`, [cid]))
      .rows[0].id;
    // Exactly what the store webhook pipeline writes (shopify-woocommerce `announceOrder`).
    const event = {
      type: 'order.placed',
      id: 'store-sync-1',
      payload: {
        orderId: '8f0c2f3e-1111-4222-8333-444455556666',
        via: 'shopify',
        contactId: Number(internal),
        phone,
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        orderNumber: '1001',
        totalMinor: 2500,
        currency: 'USD',
        status: 'paid',
      },
    };
    await deliver(t, event);
    expect(await untilSent(p, t, ch, phone, 1)).toEqual(['Hi Ada, #1001 is 25.00 USD (paid)']);
    await untilRun(p, t, f.id, 'done', (r) => r.status === 'completed');
    await deliver(t, event); // redelivery
    await quiet();
    expect(await runsOf(p, t, f.id)).toHaveLength(1);
    expect((await runsOf(p, t, f.id))[0]!.source).toBe('order_placed');
  });
});

// --- helpers of the producers below -----------------------------------------------------------------------------------------

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

const contactOf = async (t: Tenant, phone: string) =>
  (
    await p.h.owner.query(
      `SELECT id, uuid, is_unsubscribed, row_version FROM contacts WHERE org_id = $1 AND normalized_phone LIKE $2`,
      [t.orgId, `%${phone.slice(-10)}`],
    )
  ).rows[0] as
    { id: string; uuid: string; is_unsubscribed: boolean; row_version: string } | undefined;

interface OutboxRow {
  id: string;
  aggregate_module: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
}
const outboxOf = async (t: Tenant, type: string) =>
  (
    await p.h.owner.query(
      `SELECT id, aggregate_module, aggregate_id, payload FROM event_outbox WHERE org_id = $1 AND event_type = $2 ORDER BY id`,
      [t.orgId, type],
    )
  ).rows as OutboxRow[];

/** Every event of the workspace has been handed to its consumers. */
const outboxQuiet = async (t: Tenant) =>
  (
    await p.h.owner.query(
      `SELECT count(*)::int AS n FROM event_outbox WHERE org_id = $1 AND status <> 'done'`,
      [t.orgId],
    )
  ).rows[0].n === 0;

const setUnsubscribed = async (t: Tenant, uuid: string, value: boolean) => {
  const cur = await p.api.as(t.admin).get(`/v2/contacts/${uuid}`);
  return p.api
    .as(t.admin)
    .patch(`/v2/contacts/${uuid}`)
    .send({ isUnsubscribed: value, rowVersion: cur.body.rowVersion });
};

describe('contact.opt_in: a person coming back (TW-FLR-005)', () => {
  it('START starts the opt-in flow once; STOP starts nothing; stopping and starting again adds no second welcome', async () => {
    const t = await p.api.signup('flroptin');
    const other = await p.api.signup('flroptino');
    const ch = await simChannel(p as never, t);
    await openChannel(p, other);
    const phone = nextPhone();
    const welcome = {
      graph: graph([node('a', 'message', { text: 'Welcome back {{first_name}}' })], []),
      trigger: { kind: 'opt_in', value: 0 },
    };
    const f = await addFlow(p, t, welcome);
    const foreign = await addFlow(p, other, welcome);
    await p.api.seedContacts(other, [{ name: 'Same Number', phone: `+${phone}` }]);

    await simInbound(p as never, t, ch, { from: phone, name: 'Sara Ali', text: 'STOP' });
    await until('opted out', async () => (await contactOf(t, phone))?.is_unsubscribed || undefined);
    await drained('the opt-out delivered', () => outboxQuiet(t));
    await quiet();
    expect(await runsOf(p, t, f.id)).toHaveLength(0); // the opt-out event (optedIn: false) starts nothing

    await simInbound(p as never, t, ch, { from: phone, text: 'START' });
    await until('subscribed again', async () =>
      (await contactOf(t, phone))?.is_unsubscribed === false ? true : undefined,
    );
    const run = await drained('the welcome run', async () => (await runsOf(p, t, f.id))[0]);
    expect(run.source).toBe('opt_in');
    await untilRun(p, t, f.id, 'welcome done', (r) => r.status === 'completed');
    expect(await sentTo(p, t, ch, phone)).toContain('Welcome back Sara');

    // The event again (at-least-once), then a second stop and start: a contact is in an opt-in flow once, as in Reference.
    const ev = (await outboxOf(t, 'contact.opt_in')).filter((e) => e.payload.optedIn === true);
    expect(ev).toHaveLength(1);
    const consumer = await eventsConsumer(p);
    await system(t.orgId, () =>
      consumer.handle({
        id: ev[0]!.id,
        orgId: t.orgId,
        aggregateModule: ev[0]!.aggregate_module,
        aggregateId: ev[0]!.aggregate_id,
        eventType: 'contact.opt_in',
        payload: ev[0]!.payload,
      }),
    );
    await simInbound(p as never, t, ch, { from: phone, text: 'STOP' });
    await until(
      'opted out again',
      async () => (await contactOf(t, phone))?.is_unsubscribed || undefined,
    );
    await simInbound(p as never, t, ch, { from: phone, text: 'START' });
    await until('subscribed once more', async () =>
      (await contactOf(t, phone))?.is_unsubscribed === false ? true : undefined,
    );
    await drained('every event delivered', async () => {
      const again = (await outboxOf(t, 'contact.opt_in')).filter((e) => e.payload.optedIn === true);
      return again.length === 2 && (await outboxQuiet(t));
    });
    await quiet();
    expect(await runsOf(p, t, f.id)).toHaveLength(1);
    expect(await runsOf(p, other, foreign.id)).toHaveLength(0); // the other workspace's flow and contact are not touched
  });

  it('switching the flag back on at the contact record announces it once; switching it off announces nothing', async () => {
    const t = await p.api.signup('flroptin2');
    const ch = await openChannel(p, t);
    const phone = nextPhone();
    const f = await addFlow(p, t, {
      graph: graph([node('a', 'message', { text: 'Back with us, {{first_name}}' })], []),
      trigger: { kind: 'opt_in', value: 0 },
    });
    const [uuid] = await p.api.seedContacts(t, [
      { name: 'Omar Said', phone: `+${phone}`, isUnsubscribed: true },
    ]);
    const on = await setUnsubscribed(t, uuid!, false);
    expect(on.status, JSON.stringify(on.body)).toBe(200);
    const events = (await outboxOf(t, 'contact.opt_in')).filter((e) => e.payload.optedIn === true);
    expect(events).toHaveLength(1);
    expect(events[0]!.payload).toMatchObject({
      contactId: uuid,
      action: 'resubscribed',
      source: 'manual',
    });
    await drained('the run', async () => (await runsOf(p, t, f.id))[0]);
    expect(await untilSent(p, t, ch, phone, 1)).toEqual(['Back with us, Omar']);

    const before = (await outboxOf(t, 'contact.opt_in')).length;
    expect((await setUnsubscribed(t, uuid!, true)).status).toBe(200);
    expect((await outboxOf(t, 'contact.opt_in')).length).toBe(before); // an opt-out by hand is not announced
    expect((await setUnsubscribed(t, uuid!, false)).status).toBe(200); // back again: announced, but the contact is in the flow already
    await drained(
      'delivered',
      async () =>
        (await outboxOf(t, 'contact.opt_in')).length === before + 1 && (await outboxQuiet(t)),
    );
    await quiet();
    expect(await runsOf(p, t, f.id)).toHaveLength(1);
  });

  it('the Consent card re-subscribe starts the flow; with the 24 hour window closed the run fails visibly', async () => {
    const t = await p.api.signup('flroptin3');
    await simChannel(p as never, t); // the customer never wrote: the 24 hour window is closed
    const phone = nextPhone();
    const f = await addFlow(p, t, {
      graph: graph([node('a', 'message', { text: 'Welcome back' })], []),
      trigger: { kind: 'opt_in', value: 0 },
    });
    const [uuid] = await p.api.seedContacts(t, [
      { name: 'Late Reader', phone: `+${phone}`, isUnsubscribed: true },
    ]);
    // The ledger knows the withdrawal (a contact unsubscribed straight in the table has no history to grant over).
    const out = await p.api
      .as(t.admin)
      .post(`/v2/contact-consent/contacts/${uuid}/events`)
      .set('idempotency-key', `consent-out-${phone}`)
      .send({ action: 'withdrawn', note: 'Asked to stop' });
    expect(out.status, JSON.stringify(out.body)).toBe(201);
    const res = await p.api
      .as(t.admin)
      .post(`/v2/contact-consent/contacts/${uuid}/events`)
      .set('idempotency-key', `consent-${phone}`)
      .send({ action: 'granted', note: 'Asked to be added again, by phone' });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const run = await drained('the failed run', async () =>
      (await runsOf(p, t, f.id)).find((r) => r.status === 'failed'),
    );
    expect(run.failure_reason).toContain('Nothing reached the customer');
    const subs = await subscribersOf(t, f.id);
    expect(subs).toHaveLength(1);
    expect(subs[0]!.status).toBe('failed');
  });
});

describe('routing rule: start a flow (TW-TIB2-017, TW-FLR-010)', () => {
  const AGENT: Array<[string, 'all']> = [
    ['inbox.conversation.read', 'all'],
    ['inbox.conversation.reply', 'all'],
    ['inbox.conversation.assign_self', 'all'],
  ];

  it('a firing rule starts its flow once for the conversation, without a subscriber row; a busy agent does not stop it', async () => {
    const t = await p.api.signup('flrroute');
    const other = await p.api.signup('flrrouteo');
    const ch = await simChannel(p as never, t);
    const agent = await p.api.member(t, 'rtagent', AGENT);
    const agentUuid = (
      await p.h.owner.query(`SELECT uuid FROM users WHERE id = $1`, [agent.userId])
    ).rows[0].uuid as string;
    // A draft that is switched on: Reference only needed is_active.
    const f = await addFlow(p, t, {
      graph: graph([node('a', 'message', { text: 'Routing flow: how can we help?' })], []),
      trigger: { kind: 'manual_enroll' },
      published: false,
    });
    const foreign = await addFlow(p, other, {
      graph: graph([node('a', 'message', { text: 'x' })], []),
      trigger: { kind: 'manual_enroll' },
    });
    const rules = p.api.as(t.admin);

    // another workspace's flow is refused
    const bad = await rules
      .post('/v2/inbox/routing/rules')
      .set('idempotency-key', 'bad-flow')
      .send({
        name: 'Bad',
        conditions: { keywords: { words: ['refund'] } },
        assign: { strategy: 'specific', userIds: [agentUuid] },
        triggerFlowId: foreign.uuid,
      });
    expect(bad.status).toBe(422);

    const made = await rules
      .post('/v2/inbox/routing/rules')
      .set('idempotency-key', 'good-flow')
      .send({
        name: 'Refunds',
        conditions: { keywords: { words: ['refund'] } },
        assign: { strategy: 'specific', userIds: [agentUuid] },
        triggerFlowId: f.uuid,
      });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(made.body.triggerFlow).toEqual({ id: f.uuid, name: expect.any(String), isActive: true });
    const live = await rules
      .patch(`/v2/inbox/routing/rules/${made.body.id}`)
      .send({ rowVersion: made.body.rowVersion, isActive: true });
    expect(live.status, JSON.stringify(live.body)).toBe(200);

    const customer = async (text: string, from: string) => {
      await simInbound(p as never, t, ch, { from, text });
      return until(`routed ${from}`, async () => {
        const r = await p.h.owner.query(
          `SELECT id, assignee_user_id, routing_meta FROM conversations WHERE org_id = $1 AND channel_id = $2 AND peer_key = $3`,
          [t.orgId, ch.internalId, from],
        );
        return r.rows[0]?.routing_meta?.routedMessage ? r.rows[0] : undefined;
      });
    };

    const first = nextPhone();
    const conv = await customer('I need a refund', first);
    expect(Number(conv.assignee_user_id)).toBe(agent.userId);
    const run = await drained('the routing run', async () => (await runsOf(p, t, f.id))[0]);
    expect(run.source).toBe('routing');
    await untilRun(p, t, f.id, 'done', (r) => r.status === 'completed');
    expect(await sentTo(p, t, ch, first)).toContain('Routing flow: how can we help?');
    expect(
      (await p.h.owner.query(`SELECT conversation_id FROM flow_runs WHERE id = $1`, [run.id]))
        .rows[0],
    ).toMatchObject({ conversation_id: conv.id });
    expect(await subscribersOf(t, f.id)).toHaveLength(0); // Reference: no subscriber row

    // at-least-once: the same event again starts nothing
    const ev = (await outboxOf(t, 'routing.flow_requested'))[0]!;
    const { RoutingFlowConsumer } =
      await import('../../../src/modules/flow-runtime-engine/triggers/routing-flow.consumer');
    const consumer = p.h.app.get(RoutingFlowConsumer);
    const feed = (orgId: number, payload: Record<string, unknown>) =>
      system(orgId, () =>
        consumer.handle({
          id: ev.id,
          orgId,
          aggregateModule: ev.aggregate_module,
          aggregateId: ev.aggregate_id,
          eventType: 'routing.flow_requested',
          payload,
        }),
      );
    await feed(t.orgId, ev.payload);
    await quiet();
    expect(await runsOf(p, t, f.id)).toHaveLength(1);

    // the agent is busy: nobody to assign, the rule still fires and the flow answers the customer
    await p.h.owner.query(
      `INSERT INTO agent_statuses (org_id, user_id, status) VALUES ($1, $2, 'busy') ON CONFLICT (org_id, user_id) DO UPDATE SET status = 'busy'`,
      [t.orgId, agent.userId],
    );
    const second = nextPhone();
    const conv2 = await customer('refund again', second);
    expect(conv2.assignee_user_id).toBeNull();
    await drained('the second routing run', async () => (await runsOf(p, t, f.id)).length === 2);
    expect(await untilSent(p, t, ch, second, 1)).toContain('Routing flow: how can we help?');

    // switched off since the rule was saved: nothing starts, and the list says so
    await p.h.owner.query(`UPDATE flows SET is_active = false WHERE id = $1`, [f.id]);
    await customer('refund third', nextPhone());
    await drained('the third event delivered', () => outboxQuiet(t));
    await quiet();
    expect(await runsOf(p, t, f.id)).toHaveLength(2);
    const listed = await rules.get('/v2/inbox/routing/rules');
    expect(listed.body.data[0].triggerFlow).toMatchObject({ id: f.uuid, isActive: false });

    // an event naming this workspace's flow, delivered in another workspace, starts nothing anywhere
    await feed(other.orgId, { ...ev.payload, flowId: f.uuid });
    expect(await runsOf(p, t, f.id)).toHaveLength(2);
    expect(await runsOf(p, other, foreign.id)).toHaveLength(0);

    // taking the flow off the rule
    const cur = await rules.get(`/v2/inbox/routing/rules/${made.body.id}`);
    const cleared = await rules
      .patch(`/v2/inbox/routing/rules/${made.body.id}`)
      .send({ rowVersion: cur.body.rowVersion, triggerFlowId: null });
    expect(cleared.status, JSON.stringify(cleared.body)).toBe(200);
    expect(cleared.body.triggerFlow).toBeNull();
  });

  it('a rule that marks the thread spam and names a flow starts nothing: a spam thread gets no bot', async () => {
    const t = await p.api.signup('flrspam');
    const ch = await simChannel(p as never, t);
    const f = await addFlow(p, t, {
      graph: graph([node('a', 'message', { text: 'Spam flow: hello' })], []),
      trigger: { kind: 'manual_enroll' },
      published: false,
    });
    const rules = p.api.as(t.admin);
    const made = await rules
      .post('/v2/inbox/routing/rules')
      .set('idempotency-key', 'spam-flow')
      .send({
        name: 'Spam refunds',
        conditions: { keywords: { words: ['refund'] } },
        markSpam: true,
        triggerFlowId: f.uuid,
      });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const live = await rules
      .patch(`/v2/inbox/routing/rules/${made.body.id}`)
      .send({ rowVersion: made.body.rowVersion, isActive: true });
    expect(live.status, JSON.stringify(live.body)).toBe(200);

    const from = nextPhone();
    await simInbound(p as never, t, ch, { from, text: 'I need a refund' });
    const conv = await until(`spam-routed ${from}`, async () => {
      const r = await p.h.owner.query(
        `SELECT id, status FROM conversations WHERE org_id = $1 AND channel_id = $2 AND peer_key = $3`,
        [t.orgId, ch.internalId, from],
      );
      return r.rows[0]?.status === 'spam' ? r.rows[0] : undefined;
    });
    expect(conv.status).toBe('spam');
    await drained('the routing event delivered', () => outboxQuiet(t));
    await quiet();
    expect(await runsOf(p, t, f.id)).toHaveLength(0);
    expect(await sentTo(p, t, ch, from)).not.toContain('Spam flow: hello');
  });
});

describe('a lead source with a flow (TW-FLR-010 rule 4)', () => {
  let ip = 1;
  const hook = (path: string, body: object) =>
    p.api
      .http()
      .post(path)
      .set('x-forwarded-for', `10.77.0.${ip++ % 250}`)
      .send(body);

  it('puts a new lead into the flow once; a returning lead, a redelivery and a test lead add nothing', async () => {
    const t = await p.api.signup('flrlead');
    const other = await p.api.signup('flrleado');
    const ch = await openChannel(p, t);
    const f = await addFlow(p, t, {
      graph: graph(
        [
          node('a', 'message', {
            text: 'Hi {{first_name}}, thanks for writing via {{lead_source}}',
          }),
        ],
        [],
      ),
      trigger: { kind: 'manual_enroll' },
      published: false,
    });
    const foreign = await addFlow(p, other, {
      graph: graph([node('a', 'message', { text: 'x' })], []),
      trigger: { kind: 'manual_enroll' },
    });
    const refused = await p.api
      .as(t.admin)
      .post('/v2/lead-sources')
      .send({ name: 'Bad', defaults: { countryCode: '91', flowId: foreign.uuid } });
    expect(refused.status).toBe(422);

    const src = await p.api
      .as(t.admin)
      .post('/v2/lead-sources')
      .send({ name: 'Web form', defaults: { countryCode: '91', flowId: f.uuid } });
    expect(src.status, JSON.stringify(src.body)).toBe(201);
    await p.api
      .as(other.admin)
      .post('/v2/lead-sources')
      .send({ name: 'Theirs', defaults: { countryCode: '91' } });

    const res = await hook(src.body.hookPath, { name: 'Lead One', phone: '98000 20001' });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    const run = await drained('the lead run', async () => (await runsOf(p, t, f.id))[0]);
    expect(run.source).toBe('webhook_lead');
    await untilRun(p, t, f.id, 'done', (r) => r.status === 'completed');
    expect(await untilSent(p, t, ch, '919800020001', 1)).toEqual([
      'Hi Lead, thanks for writing via Web form',
    ]);
    expect((await subscribersOf(t, f.id))[0]!.status).toBe('completed');

    // the same person again (lead.updated), then the created event once more
    const again = await hook(src.body.hookPath, {
      name: 'Lead One',
      phone: '98000 20001',
      note: 'again',
    });
    expect(again.status).toBeLessThan(300);
    await drained(
      'the update delivered',
      async () => (await outboxOf(t, 'lead.updated')).length === 1 && (await outboxQuiet(t)),
    );
    const created = (await outboxOf(t, 'lead.created'))[0]!;
    const { LeadFlowConsumer } =
      await import('../../../src/modules/flow-runtime-engine/triggers/lead-flow.consumer');
    await system(t.orgId, () =>
      p.h.app.get(LeadFlowConsumer).handle({
        id: created.id,
        orgId: t.orgId,
        aggregateModule: created.aggregate_module,
        aggregateId: created.aggregate_id,
        eventType: 'lead.created',
        payload: created.payload,
      }),
    );
    await quiet();
    expect(await runsOf(p, t, f.id)).toHaveLength(1);

    // an admin's test lead is quiet
    const test = await p.api.as(t.admin).post(`/v2/lead-sources/${src.body.id}/test`).send({});
    expect(test.status, JSON.stringify(test.body)).toBeLessThan(300);
    await drained('the test lead delivered', () => outboxQuiet(t));
    await quiet();
    expect(await runsOf(p, t, f.id)).toHaveLength(1);
    expect(await runsOf(p, other, foreign.id)).toHaveLength(0);

    // switched off since: the lead is still a contact, nothing starts
    await p.h.owner.query(`UPDATE flows SET is_active = false WHERE id = $1`, [f.id]);
    expect(
      (await hook(src.body.hookPath, { name: 'Lead Two', phone: '98000 20002' })).status,
    ).toBeLessThan(300);
    await drained(
      'lead two delivered',
      async () => (await contactOf(t, '919800020002')) && (await outboxQuiet(t)),
    );
    await quiet();
    expect(await runsOf(p, t, f.id)).toHaveLength(1);
  });

  it('a lead the flow cannot reach is a failed subscriber with the reason, and a closed window fails the run', async () => {
    const t = await p.api.signup('flrlead2');
    await simChannel(p as never, t); // closed window: the lead never wrote
    const f = await addFlow(p, t, {
      graph: graph([node('a', 'message', { text: 'Welcome' })], []),
      trigger: { kind: 'manual_enroll' },
    });
    const src = await p.api
      .as(t.admin)
      .post('/v2/lead-sources')
      .send({ name: 'Ads', defaults: { countryCode: '91', flowId: f.uuid } });
    expect(
      (await hook(src.body.hookPath, { name: 'Email Only', email: 'only@example.com' })).status,
    ).toBeLessThan(300);
    expect(
      (await hook(src.body.hookPath, { name: 'Phone Lead', phone: '98000 30001' })).status,
    ).toBeLessThan(300);
    await drained('both leads settled', async () => {
      const rows = await subscribersOf(t, f.id);
      return rows.length === 2 && rows.every((r) => r.status === 'failed');
    });
    const subs = await subscribersOf(t, f.id);
    expect(subs.map((s) => s.status)).toEqual(['failed', 'failed']);
    expect(subs.some((s) => s.failure_reason?.includes('no usable mobile number'))).toBe(true);
    const run = await drained('the window failure', async () =>
      (await runsOf(p, t, f.id)).find((r) => r.status === 'failed'),
    );
    expect(run.failure_reason).toContain('Nothing reached the customer');
  });
});
