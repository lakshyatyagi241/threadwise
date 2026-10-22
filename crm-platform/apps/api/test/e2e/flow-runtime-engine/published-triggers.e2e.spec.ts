import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WidgetApi, widgetBody, type Tenant } from '../chatbot-widget/support';
import { eventsConsumer, node, startFlowPipeline, system, until, type FlowPipeline } from './support';

/**
 * A live flow keeps matching on the trigger it was published with. A keyword, a schedule and a contact event typed or saved into the
 * draft change nothing for customers until the next Publish (2029_flows_published_trigger_snapshot.sql). Real Postgres, Redis and BullMQ.
 */
let p: FlowPipeline;
let api: WidgetApi;

beforeAll(async () => {
  p = await startFlowPipeline();
  api = new WidgetApi(p.h);
}, 300_000);

afterAll(async () => {
  await p?.stop();
});

const graph = (flowNodes: unknown[], flowEdges: unknown[]) => ({ flowNodes, flowEdges, vars: [] });
const edge = (source: string, target: string, sourceHandle = 'out') => ({
  id: `e_${source}_${sourceHandle}`,
  source,
  sourceHandle,
  target,
});
const quiet = (ms = 1500) => new Promise((r) => setTimeout(r, ms));

const internalId = async (t: Tenant, uuid: string): Promise<number> =>
  Number(
    (await p.h.owner.query(`SELECT id FROM flows WHERE org_id = $1 AND uuid = $2`, [t.orgId, uuid]))
      .rows[0].id,
  );

const runTriggers = async (t: Tenant, flowId: string): Promise<string[]> =>
  (
    await p.h.owner.query(
      `SELECT trigger_text FROM flow_runs WHERE org_id = $1 AND flow_id = $2 ORDER BY id`,
      [t.orgId, await internalId(t, flowId)],
    )
  ).rows.map((r) => String(r.trigger_text));

/** Saves the draft as the editor does (whole graph, current row version). */
async function saveDraft(t: Tenant, flowId: string, name: string, flowGraph: unknown) {
  const current = await api.as(t.admin).get(`/v2/flows/${flowId}`);
  expect(current.status, JSON.stringify(current.body)).toBe(200);
  const saved = await api
    .as(t.admin)
    .put(`/v2/flows/${flowId}`)
    .send({ name, graph: flowGraph, rowVersion: current.body.rowVersion });
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
}

async function publish(t: Tenant, flowId: string) {
  const res = await api.as(t.admin).post(`/v2/flows/${flowId}/publish`).send({});
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

async function unpublish(t: Tenant, flowId: string) {
  const res = await api.as(t.admin).post(`/v2/flows/${flowId}/unpublish`).send({});
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

const look = () => {
  const {
    name: _n,
    mode: _m,
    targetWhatsappCc: _c,
    targetWhatsappNumber: _t,
    ...rest
  } = widgetBody();
  return rest;
};

describe('a keyword edited in the draft waits for Publish', () => {
  it('the live bot answers its published keyword only, until the draft is published again', async () => {
    const t = await api.signup('pubkw');
    const keywordGraph = (word: string) =>
      graph(
        [
          node('t', 'trigger', { kind: 'keyword', keywordMode: 'keywords', keywords: word }, { isStart: true }),
          node('m', 'message', { text: 'Version A' }),
        ],
        [edge('t', 'm')],
      );
    const created = await api
      .as(t.admin)
      .post('/v2/flows')
      .send({ name: 'Keyword bot', flowType: 'web', graph: keywordGraph('hi') });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const flowId = created.body.id as string;
    const widget = await api.as(t.admin).put(`/v2/flows/${flowId}/widget`).send(look());
    expect(widget.status, JSON.stringify(widget.body)).toBe(200);
    const token = widget.body.embedToken as string;
    await publish(t, flowId);

    const say = async (word: string) => {
      const visitor = await api.visitor(token);
      await api.pub(token).message({ body: word, visitor_uuid: visitor });
      return visitor;
    };
    const answered = async (visitor: string) =>
      until(
        'the bot answers',
        async () => {
          const res = await api.pub(token).history(visitor, 0);
          const lines = (res.body.messages ?? []) as Array<{ body: string | null }>;
          return lines.some((l) => l.body === 'Version A') ? true : undefined;
        },
        25_000,
      );

    await say('hi').then(answered);
    expect(await runTriggers(t, flowId)).toEqual(['hi']);

    await saveDraft(t, flowId, 'Keyword bot', keywordGraph('hello'));
    await say('hello');
    await quiet();
    expect(await runTriggers(t, flowId)).toEqual(['hi']); // the draft's word starts nothing

    await say('hi').then(answered);
    expect(await runTriggers(t, flowId)).toEqual(['hi', 'hi']); // the live word still starts it

    await publish(t, flowId);
    await say('hello').then(answered);
    expect(await runTriggers(t, flowId)).toEqual(['hi', 'hi', 'hello']);
    await say('hi');
    await quiet();
    expect(await runTriggers(t, flowId)).toEqual(['hi', 'hi', 'hello']);
  }, 120_000);
});

describe('a schedule edited in the draft fires at its published time', () => {
  it('moves to the draft time only at Publish, and a republish of the same settings does not fire twice', async () => {
    const t = await p.api.signup('pubsch');
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const hhmm = now.toISOString().slice(11, 16);
    const scheduleGraph = (date: string, time: string) =>
      graph(
        [
          node(
            't',
            'trigger',
            { kind: 'schedule', frequency: 'once', date, time, timezone: 'UTC' },
            { isStart: true },
          ),
          node('m', 'message', { text: 'Good morning' }),
        ],
        [edge('t', 'm')],
      );
    const created = await api
      .as(t.admin)
      .post('/v2/flows')
      .send({ name: 'Morning bot', flowType: 'chat', graph: scheduleGraph('2099-01-01', '00:00') });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const flowId = created.body.id as string;
    await publish(t, flowId);
    const sweep = p.h.app.get(
      (await import('../../../src/modules/flow-runtime-engine/triggers/schedule.sweeper'))
        .FlowScheduleSweeper,
    );

    expect((await sweep.tickOnce(now)).fired).toBe(0); // live: 2099

    await saveDraft(t, flowId, 'Morning bot', scheduleGraph(today, hhmm));
    expect((await sweep.tickOnce(now)).fired).toBe(0); // the draft's time is due, but not live

    await publish(t, flowId);
    expect((await sweep.tickOnce(now)).fired).toBe(1); // published now: fires for today

    await unpublish(t, flowId);
    await publish(t, flowId);
    expect((await sweep.tickOnce(now)).fired).toBe(0); // same settings republished: today already ran
  });
});

describe('a contact event matches the published trigger only', () => {
  it('enrols on the published contact event, not on the one the draft names', async () => {
    const t = await p.api.signup('pubenr');
    await p.api.seedContacts(t, [
      { name: 'Asha', phone: '+919811200301' },
      { name: 'Ravi', phone: '+919811200302' },
    ]);
    const contactOf = async (phone: string) =>
      Number(
        (
          await p.h.owner.query(`SELECT id FROM contacts WHERE org_id = $1 AND normalized_phone = $2`, [
            t.orgId,
            phone,
          ])
        ).rows[0].id,
      );
    const asha = await contactOf('+919811200301');
    const ravi = await contactOf('+919811200302');
    const eventGraph = (kind: string) =>
      graph([node('t', 'trigger', { kind }, { isStart: true }), node('m', 'message', { text: 'Welcome' })], [edge('t', 'm')]);
    const created = await api
      .as(t.admin)
      .post('/v2/flows')
      .send({ name: 'Welcome bot', flowType: 'chat', graph: eventGraph('contact_created') });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const flowId = created.body.id as string;
    await publish(t, flowId);
    await saveDraft(t, flowId, 'Welcome bot', eventGraph('contact_updated'));

    const fire = async (eventId: string, eventType: string, contactId: number) => {
      const consumer = await eventsConsumer(p);
      await system(t.orgId, () =>
        consumer.handle({
          id: eventId,
          orgId: t.orgId,
          aggregateModule: 'contacts',
          aggregateId: String(contactId),
          eventType,
          payload: {},
        } as never),
      );
    };
    const subscribers = async () =>
      (
        await p.h.owner.query(
          `SELECT contact_id, source FROM flow_subscribers WHERE org_id = $1 AND flow_id = $2 ORDER BY id`,
          [t.orgId, await internalId(t, flowId)],
        )
      ).rows;

    await fire('pub-upd-ravi', 'contact.updated', ravi);
    expect(await subscribers()).toEqual([]); // the draft's event does not enrol while live

    await fire('pub-new-asha', 'contact.created', asha);
    expect((await subscribers()).map((r) => Number(r.contact_id))).toEqual([asha]);

    await publish(t, flowId);
    await fire('pub-upd-ravi-2', 'contact.updated', ravi);
    expect((await subscribers()).map((r) => Number(r.contact_id))).toEqual([asha, ravi]);
  });
});
