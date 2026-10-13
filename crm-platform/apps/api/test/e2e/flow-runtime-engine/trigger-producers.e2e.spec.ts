import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addFlow,
  eventsConsumer,
  graph,
  node,
  openChannel,
  runsOf,
  sentTo,
  simChannel,
  startFlowPipeline,
  system,
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
beforeAll(async () => {
  p = await startFlowPipeline();
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
