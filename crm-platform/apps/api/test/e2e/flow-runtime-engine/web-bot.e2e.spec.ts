import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WidgetApi, widgetBody, type Tenant } from '../chatbot-widget/support';
import { node, startFlowPipeline, until, type FlowPipeline } from './support';

/**
 * A published website chat bot answering a visitor, end to end: the editor API makes the bot and its widget, the visitor writes through
 * the public widget routes, the inbox's worker stores the line, the flow runtime answers, and the reply (with its buttons) comes back
 * through the history poll. Real Postgres, Redis and BullMQ.
 */
let p: FlowPipeline;
let api: WidgetApi;
let t: Tenant;

beforeAll(async () => {
  p = await startFlowPipeline();
  api = new WidgetApi(p.h);
  t = await api.signup('webbot');
}, 240_000);

afterAll(async () => {
  await p?.stop();
});

/** The editor's graph shape (the runtime specs' helper writes `vars` as an object and has no edge ids). */
const graph = (flowNodes: unknown[], flowEdges: unknown[]) => ({ flowNodes, flowEdges, vars: [] });
const edge = (source: string, target: string, sourceHandle = 'out') => ({
  id: `e_${source}_${sourceHandle}`,
  source,
  sourceHandle,
  target,
});

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

interface Line {
  id: number;
  body: string | null;
  buttons?: Array<{ id: string; title: string }>;
}

/** A website chat bot with its widget, published; returns the widget token. */
async function liveBot(
  name: string,
  flowGraph: unknown,
): Promise<{ flowId: string; token: string }> {
  const created = await api
    .as(t.admin)
    .post('/v2/flows')
    .send({ name, flowType: 'web', graph: flowGraph });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const flowId = created.body.id as string;
  const widget = await api.as(t.admin).put(`/v2/flows/${flowId}/widget`).send(look());
  expect(widget.status, JSON.stringify(widget.body)).toBe(200);
  const live = await api.as(t.admin).post(`/v2/flows/${flowId}/publish`).send({});
  expect(live.status, JSON.stringify(live.body)).toBe(200);
  return { flowId, token: widget.body.embedToken as string };
}

const trigger = () =>
  node('t', 'trigger', { kind: 'keyword', keywordMode: 'any' }, { isStart: true });

/** Every business line the visitor's poll has shown so far, once each. */
async function linesUntil(
  token: string,
  visitor: string,
  label: string,
  enough: (all: Line[]) => boolean,
): Promise<Line[]> {
  const seen = new Map<number, Line>();
  return until(
    label,
    async () => {
      const since = Math.max(0, ...seen.keys());
      const res = await api.pub(token).history(visitor, since);
      for (const m of (res.body.messages ?? []) as Line[]) seen.set(m.id, m);
      const all = [...seen.values()].sort((a, b) => a.id - b.id);
      return enough(all) ? all : undefined;
    },
    25_000,
  );
}

describe('a website chat bot answers its visitor', () => {
  it('starts on the first message, offers reply buttons, and routes the tap', async () => {
    const { token } = await liveBot(
      'Pricing bot',
      graph(
        [
          trigger(),
          node('b1', 'buttons', { prompt: 'Pick one', options: ['Docs', 'Price'] }),
          node('docs', 'message', { text: 'Docs are at example.test/docs' }),
          node('price', 'message', { text: 'Pro is 49' }),
        ],
        [edge('t', 'b1'), edge('b1', 'docs', 'p0'), edge('b1', 'price', 'p1')],
      ),
    );
    const visitor = await api.visitor(token);

    const sent = await api.pub(token).message({ body: 'hello there', visitor_uuid: visitor });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    expect(sent.body.reply).toBeNull();

    const first = await linesUntil(token, visitor, 'the bot asks', (all) =>
      all.some((l) => l.buttons?.length === 2),
    );
    const ask = first.find((l) => l.buttons?.length === 2)!;
    expect(ask.body).toBe('Pick one');
    expect(ask.buttons!.map((b) => b.title)).toEqual(['Docs', 'Price']);

    // The visitor taps "Price": the body is the title, the id is the button's.
    const price = ask.buttons!.find((b) => b.title === 'Price')!;
    const tap = await api
      .pub(token)
      .message({ body: price.title, tap_id: price.id, visitor_uuid: visitor });
    expect(tap.status, JSON.stringify(tap.body)).toBe(200);
    const after = await linesUntil(token, visitor, 'the bot answers the tap', (all) =>
      all.some((l) => l.body === 'Pro is 49'),
    );
    expect(after.some((l) => l.body === 'Docs are at example.test/docs')).toBe(false);

    // The thread holds the visitor's two lines once each, as the customer's.
    const thread = await api.thread(t.orgId, visitor);
    const mine = thread.filter((m) => m.direction === 'in').map((m) => m.body);
    expect(mine).toEqual(['hello there', 'Price']);
  });

  it("keeps one bot out of another bot's widget", async () => {
    const a = await liveBot(
      'Bot A',
      graph([trigger(), node('m', 'message', { text: 'I am bot A' })], [edge('t', 'm')]),
    );
    const b = await liveBot(
      'Bot B',
      graph([trigger(), node('m', 'message', { text: 'I am bot B' })], [edge('t', 'm')]),
    );
    const va = await api.visitor(a.token);
    const vb = await api.visitor(b.token);

    await api.pub(a.token).message({ body: 'hi', visitor_uuid: va });
    await api.pub(b.token).message({ body: 'hi', visitor_uuid: vb });

    const linesA = await linesUntil(a.token, va, 'bot A answers', (all) => all.length > 0);
    const linesB = await linesUntil(b.token, vb, 'bot B answers', (all) => all.length > 0);
    expect(linesA.map((l) => l.body)).toEqual(['I am bot A']);
    expect(linesB.map((l) => l.body)).toEqual(['I am bot B']);
  });
});
