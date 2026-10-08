import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addFlow,
  edge,
  eventsConsumer,
  graph,
  node,
  openChannel,
  runsOf,
  startFlowPipeline,
  system,
  untilSent,
  until,
  type FlowPipeline,
  type Tenant,
} from './support';
import { simInbound } from '../chat-conversations/pipeline-support';

let p: FlowPipeline;
beforeAll(async () => {
  p = await startFlowPipeline();
}, 300_000);
afterAll(async () => {
  await p?.stop();
});

/** Sets the trigger's own settings on a flow row, as the editor's save does. */
const setConfig = (t: Tenant, flowId: number, config: unknown) =>
  p.h.owner.query(`UPDATE flows SET trigger_config = $3::jsonb WHERE org_id = $1 AND id = $2`, [
    t.orgId,
    flowId,
    JSON.stringify(config),
  ]);

const contactId = async (t: Tenant, phone: string) =>
  Number(
    (
      await p.h.owner.query(`SELECT id FROM contacts WHERE org_id = $1 AND normalized_phone = $2`, [
        t.orgId,
        phone,
      ])
    ).rows[0].id,
  );

const fire = async (
  t: Tenant,
  id: string,
  eventType: string,
  aggregateId: number,
  payload: Record<string, unknown> = {},
) => {
  const consumer = await eventsConsumer(p);
  return system(t.orgId, () =>
    consumer.handle({
      id,
      orgId: t.orgId,
      aggregateModule: 'contacts',
      aggregateId: String(aggregateId),
      eventType,
      payload,
    }),
  );
};

const quiet = (ms = 900) => new Promise((r) => setTimeout(r, ms));
const msg = (text: string) => graph([node('a', 'message', { text })], []);

describe('list leave, contact update, field match and segment join start flows', () => {
  it('a contact leaving a list starts the flow bound to that list, but not when a flow took them out', async () => {
    const t = await p.api.signup('gapleave');
    const ch = await openChannel(p, t);
    const grp = await p.api.as(t.admin).post('/v2/contact-groups').send({ name: 'Trial' });
    expect(grp.status, JSON.stringify(grp.body)).toBeLessThan(300);
    const gid = Number(
      (await p.h.owner.query(`SELECT id FROM contact_groups WHERE uuid = $1`, [grp.body.id]))
        .rows[0].id,
    );
    await addFlow(p, t, {
      graph: msg('Sorry to see you go'),
      trigger: { kind: 'group_leave', value: gid },
    });
    await p.api.seedContacts(t, [{ name: 'Leaver', phone: '+919811200001' }]);
    const cid = await contactId(t, '+919811200001');

    await fire(t, 'l1', 'contact.group_removed', cid, { groupId: grp.body.id, via: 'flow' });
    await quiet();
    expect(
      await p.h.owner.query(`SELECT 1 FROM flow_runs WHERE org_id = $1`, [t.orgId]),
    ).toHaveProperty('rowCount', 0);

    await fire(t, 'l2', 'contact.group_removed', cid, { groupId: grp.body.id });
    expect(await untilSent(p, t, ch, '919811200001', 1)).toEqual(['Sorry to see you go']);
  });

  it('a contact update starts its flow each time, but an update a flow made does not', async () => {
    const t = await p.api.signup('gapupd');
    const ch = await openChannel(p, t);
    const f = await addFlow(p, t, {
      graph: msg('Profile changed'),
      trigger: { kind: 'contact_updated', value: 0 },
    });
    await p.api.seedContacts(t, [{ name: 'Editor', phone: '+919811200002' }]);
    const cid = await contactId(t, '+919811200002');

    await fire(t, 'u0', 'contact.updated', cid, { via: 'flow' });
    await quiet();
    expect((await runsOf(p, t, f.id)).length).toBe(0);

    await fire(t, 'u1', 'contact.updated', cid, {});
    await untilSent(p, t, ch, '919811200002', 1);
    await until(
      'first run done',
      async () => (await runsOf(p, t, f.id)).every((r) => r.status === 'completed') || undefined,
    );
    await fire(t, 'u2', 'contact.updated', cid, {});
    expect(await untilSent(p, t, ch, '919811200002', 2)).toEqual([
      'Profile changed',
      'Profile changed',
    ]);
    expect((await runsOf(p, t, f.id)).every((r) => r.source === 'contact_updated')).toBe(true);
  });

  it('a field match starts once per value, only when the field meets the operator', async () => {
    const t = await p.api.signup('gapfield');
    const ch = await openChannel(p, t);
    const f = await addFlow(p, t, {
      graph: msg('Welcome to Pune'),
      trigger: { kind: 'field_match', value: 0 },
    });
    await setConfig(t, f.id, { field: 'title', operator: 'equals', value: 'Pune' });
    await p.api.seedContacts(t, [{ name: 'Local', phone: '+919811200003' }]);
    const cid = await contactId(t, '+919811200003');

    await fire(t, 'f1', 'contact.updated', cid, {});
    await quiet();
    expect((await runsOf(p, t, f.id)).length).toBe(0);

    await p.h.owner.query(`UPDATE contacts SET title = 'pune' WHERE org_id = $1 AND id = $2`, [
      t.orgId,
      cid,
    ]);
    await fire(t, 'f2', 'contact.updated', cid, {});
    expect(await untilSent(p, t, ch, '919811200003', 1)).toEqual(['Welcome to Pune']);
    await until(
      'done',
      async () => (await runsOf(p, t, f.id)).every((r) => r.status === 'completed') || undefined,
    );
    await fire(t, 'f3', 'contact.updated', cid, {}); // the same value again
    await quiet();
    expect((await runsOf(p, t, f.id)).length).toBe(1);
  });

  it('a segment join starts the flow for a contact who is in the segment, once', async () => {
    const t = await p.api.signup('gapseg');
    const ch = await openChannel(p, t);
    const seg = await p.api
      .as(t.admin)
      .post('/v2/segments')
      .send({
        name: 'Zeds',
        rules: {
          type: 'group',
          combinator: 'and',
          children: [{ type: 'condition', field: 'name', operator: 'contains', value: 'Zed' }],
        },
      });
    expect(seg.status, JSON.stringify(seg.body)).toBeLessThan(300);
    const f = await addFlow(p, t, {
      graph: msg('You are a Zed'),
      trigger: { kind: 'segment_join', value: 0 },
    });
    await setConfig(t, f.id, { segmentId: seg.body.id });
    await p.api.seedContacts(t, [
      { name: 'Zed One', phone: '+919811200004' },
      { name: 'Other', phone: '+919811200005' },
    ]);

    await fire(t, 's1', 'contact.created', await contactId(t, '+919811200005'), {});
    await quiet();
    expect((await runsOf(p, t, f.id)).length).toBe(0);
    const zed = await contactId(t, '+919811200004');
    await fire(t, 's2', 'contact.created', zed, {});
    expect(await untilSent(p, t, ch, '919811200004', 1)).toEqual(['You are a Zed']);
    await fire(t, 's3', 'contact.updated', zed, {});
    await quiet();
    expect((await runsOf(p, t, f.id)).length).toBe(1);
  });
});

describe('the clock triggers', () => {
  it('a schedule fires once for its audience at its time, and a date match fires for the day its field says', async () => {
    const t = await p.api.signup('gapclock');
    const ch = await openChannel(p, t);
    const sched = await addFlow(p, t, {
      graph: msg('Good morning'),
      trigger: { kind: 'schedule', value: 0 },
    });
    await setConfig(t, sched.id, {
      frequency: 'daily',
      time: '09:00',
      timezone: 'UTC',
      date: '',
      weekdays: [],
      day: 1,
      audience: { kind: 'all', ref: '' },
    });
    const bday = await addFlow(p, t, {
      graph: msg('Happy birthday'),
      trigger: { kind: 'date_field_match', value: 0 },
    });
    await setConfig(t, bday.id, {
      field: 'dob',
      direction: 'on',
      days: 0,
      time: '09:00',
      yearly: true,
    });
    await p.api.seedContacts(t, [
      { name: 'Asha', phone: '+919811200006' },
      { name: 'Ravi', phone: '+919811200007' },
    ]);
    await p.h.owner.query(
      `UPDATE contacts SET data = data || '{"dob":"1990-10-08"}'::jsonb WHERE org_id = $1 AND normalized_phone = '+919811200006'`,
      [t.orgId],
    );
    const sweep = p.h.app.get(
      (await import('../../../src/modules/flow-runtime-engine/triggers/schedule.sweeper'))
        .FlowScheduleSweeper,
    );

    const early = await sweep.tickOnce(new Date('2026-10-08T08:00:00Z'));
    expect(early.fired).toBe(0);
    const first = await sweep.tickOnce(new Date('2026-10-08T09:05:00Z'));
    expect(first.fired).toBe(2);
    expect((await untilSent(p, t, ch, '919811200006', 2)).sort()).toEqual([
      'Good morning',
      'Happy birthday',
    ]);
    expect(await untilSent(p, t, ch, '919811200007', 1)).toEqual(['Good morning']);
    const again = await sweep.tickOnce(new Date('2026-10-08T09:30:00Z'));
    expect(again.fired).toBe(0);
    const next = await sweep.tickOnce(new Date('2026-10-09T09:01:00Z'));
    expect(next.fired).toBe(2); // a new day: the schedule runs again for the same people (a new reason)
    expect(next.started).toBe(2); // the date match finds nobody on the 9th
  });
});

describe('the new nodes in a live flow', () => {
  it('updates a contact field, adds to a list, and routes by list, segment and session', async () => {
    const t = await p.api.signup('gapnodes');
    const ch = await openChannel(p, t);
    const grp = await p.api.as(t.admin).post('/v2/contact-groups').send({ name: 'Insiders' });
    const seg = await p.api
      .as(t.admin)
      .post('/v2/segments')
      .send({
        name: 'Titled',
        rules: {
          type: 'group',
          combinator: 'and',
          children: [{ type: 'condition', field: 'name', operator: 'contains', value: 'Nina' }],
        },
      });
    await p.api.seedContacts(t, [{ name: 'Nina Nodes', phone: '+919811200008' }]);
    const f = await addFlow(p, t, {
      graph: graph(
        [
          node('u', 'update_contact', { field: 'title', value: 'VIP {{name}}' }),
          node('l', 'list_member', { action: 'add', listId: grp.body.id }),
          node('c', 'in_list', { listId: grp.body.id }),
          node('s', 'in_segment', { segmentId: seg.body.id }),
          node('w', 'wa_session', {}),
          node('y1', 'message', { text: 'in list' }),
          node('n1', 'message', { text: 'not in list' }),
          node('y2', 'message', { text: 'in segment' }),
          node('y3', 'message', { text: 'session open' }),
        ],
        [
          edge('u', 'l'),
          edge('l', 'c'),
          edge('c', 'y1', 'yes'),
          edge('c', 'n1', 'no'),
          edge('y1', 's'),
          edge('s', 'y2', 'yes'),
          edge('y2', 'w'),
          edge('w', 'y3', 'yes'),
        ],
      ),
      trigger: { kind: 'keyword', keywords: 'nodes' },
    });
    await simInbound(p, t, ch, { from: '919811200008', name: 'Nina', text: 'nodes' });
    expect(await untilSent(p, t, ch, '919811200008', 3)).toEqual([
      'in list',
      'in segment',
      'session open',
    ]);
    const row = (
      await p.h.owner.query(
        `SELECT title FROM contacts WHERE org_id = $1 AND normalized_phone = '+919811200008'`,
        [t.orgId],
      )
    ).rows[0];
    expect(row.title).toBe('VIP Nina Nodes');
    const member = await p.h.owner.query(
      `SELECT 1 FROM contact_group_members m JOIN contact_groups g ON g.org_id = m.org_id AND g.id = m.group_id WHERE g.uuid = $1`,
      [grp.body.id],
    );
    expect(member.rowCount).toBe(1);
    const ev = await p.h.owner.query(
      `SELECT payload FROM event_outbox WHERE org_id = $1 AND event_type IN ('contact.updated','contact.group_added')`,
      [t.orgId],
    );
    expect(ev.rows.some((r) => r.payload.via === 'flow')).toBe(true);
    expect((await runsOf(p, t, f.id))[0]!.status).toBe('completed');
  });
});

describe('store events start flows', () => {
  it('a Shopify event starts its flow; a product filter, the other store kind and a repeat do not', async () => {
    const t = await p.api.signup('gapstore');
    const ch = await openChannel(p, t);
    const any = await addFlow(p, t, {
      graph: msg('Thanks for the order'),
      trigger: { kind: 'shopify_event', value: 0 },
    });
    await setConfig(t, any.id, { event: 'ordered_product', productId: '' });
    const only = await addFlow(p, t, {
      graph: msg('Product 9 fan'),
      trigger: { kind: 'shopify_event', value: 0 },
    });
    await setConfig(t, only.id, { event: 'ordered_product', productId: '9' });
    const woo = await addFlow(p, t, {
      graph: msg('Woo flow'),
      trigger: { kind: 'woocommerce_event', value: 0 },
    });
    await setConfig(t, woo.id, { event: 'ordered_product', productId: '' });
    await p.api.seedContacts(t, [{ name: 'Shopper', phone: '+919811200009' }]);
    const store = async (id: string, extra: Record<string, unknown> = {}) => {
      const consumer = await eventsConsumer(p);
      await system(t.orgId, () =>
        consumer.handle({
          id,
          orgId: t.orgId,
          aggregateModule: 'ecom',
          aggregateId: '1',
          eventType: 'store.flow_event',
          payload: {
            kind: 'shopify',
            event: 'ordered_product',
            ref: id,
            phone: '919811200009',
            productIds: ['5'],
            variables: { order_number: '#1' },
            ...extra,
          },
        }),
      );
    };
    await store('o1');
    expect(await untilSent(p, t, ch, '919811200009', 1)).toEqual(['Thanks for the order']);
    await quiet();
    expect((await runsOf(p, t, only.id)).length).toBe(0);
    expect((await runsOf(p, t, woo.id)).length).toBe(0);
    await until(
      'first done',
      async () => (await runsOf(p, t, any.id)).every((r) => r.status === 'completed') || undefined,
    );
    await store('o1'); // the same delivery again
    await quiet();
    expect((await runsOf(p, t, any.id)).length).toBe(1);
    await store('o2', { productIds: ['9'] });
    expect(await untilSent(p, t, ch, '919811200009', 3)).toEqual(
      expect.arrayContaining(['Thanks for the order', 'Product 9 fan']),
    );
    await store('o3', { phone: '919899999999' }); // nobody with that number
    await quiet();
    expect((await runsOf(p, t, any.id)).length).toBe(2);
  });
});
