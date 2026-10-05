import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { flbDefaultNodeData, flbNormalizeGraph } from '@crm/contracts';
import { until } from './support';
import { simInbound } from '../chat-conversations/pipeline-support';
import { PLATFORM_KEY, setPlatformKey, startStubModel, type StubModel } from './ai-support';
import { addTemplate } from './commerce-support';
import {
  openChannel,
  sentTo,
  startFlowPipeline,
  untilRun,
  untilSent,
  type FlowPipeline,
  type SimChannel,
  type Tenant,
} from './support';

/**
 * Flows saved by the flow builder editor run correctly in the flow runtime engine (TW-FLB-070 + TW-FLR-013). Every flow here is
 * created through the editor's own API (`POST /v2/flows`, then publish), with the field names the inspector forms save (`save`,
 * `lat` / `lng`, `multi`, `flow`, `tplId` as a uuid, `assistant` as a uuid), and then driven by a customer message through the real
 * engine: run store, step queue, sender, sweeper. Providers are fixtures: a local OpenAI-compatible stub, a local HTTP server, the
 * simulator channel. The only direct SQL is arranging rows the editor does not create (templates, AI assistants) and stamping the
 * flow's engine as the simulator, since the editor's engine pick is a real connected sender.
 */
let p: FlowPipeline;
let model: StubModel;
let server: Server;
let base = '';
const hits: Array<{ url?: string; body: string }> = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      hits.push({ url: req.url, body: Buffer.concat(chunks).toString() });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ greeting: 'hola', user: { tier: 'gold' } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  p = await startFlowPipeline();
  model = await startStubModel();
  await setPlatformKey(p, true);
  const { ChannelDispatcher } = await import('../../../src/modules/chat-conversations');
  const dispatcher = p.h.app.get(ChannelDispatcher, { strict: false });
  const send = dispatcher.send.bind(dispatcher);
  dispatcher.send = (async (input: Parameters<typeof send>[0]) => {
    envelopes.push(input.envelope as (typeof envelopes)[number]);
    return send(input);
  }) as typeof dispatcher.send;
}, 300_000);
afterAll(async () => {
  await model?.stop();
  await p?.stop();
  await new Promise<void>((r) => server.close(() => r()));
});

/** Every envelope the engine hands the channel dispatcher: what really leaves, with the pin's coordinates and the template's name. */
const envelopes: Array<{
  to?: string;
  kind?: string;
  location?: Record<string, unknown>;
  template?: Record<string, unknown>;
}> = [];

let counter = 0;
const nextPeer = () => `9197${String(20000000 + counter++).padStart(8, '0')}`;

type EditorNode = { id: string; type: string; data?: Record<string, unknown> };

/** A graph as the editor saves it: every node starts from the inspector's defaults, then the author's choices. */
const editorGraph = (nodes: EditorNode[], edges: Array<[string, string, string?]>) =>
  flbNormalizeGraph({
    flowNodes: [
      {
        id: 'trig',
        type: 'trigger',
        x: 0,
        y: 0,
        isStart: true,
        data: { ...flbDefaultNodeData('trigger') },
      },
      ...nodes.map((n, i) => ({
        id: n.id,
        type: n.type,
        x: 300 * (i + 1),
        y: 0,
        data: { ...flbDefaultNodeData(n.type), ...n.data },
      })),
    ],
    flowEdges: [
      ['trig', nodes[0]!.id, 'out'] as [string, string, string],
      ...edges.map(([s, t, h]) => [s, t, h ?? 'out'] as [string, string, string]),
    ].map(([source, target, sourceHandle], i) => ({ id: `e${i}`, source, sourceHandle, target })),
  });

interface Saved {
  uuid: string;
  id: number;
}

/** Create through the editor API, set the keyword trigger on the Trigger node, publish, and point the flow at the simulator channel. */
async function saveFlow(
  t: Tenant,
  name: string,
  keyword: string | null,
  nodes: EditorNode[],
  edges: Array<[string, string, string?]>,
): Promise<Saved> {
  const g = editorGraph(nodes, edges);
  const trig = g.flowNodes.find((n) => n.id === 'trig')!;
  trig.data = { ...trig.data, kind: 'keyword', keywords: keyword ?? 'never-typed-' + name };
  const created = await p.api.as(t.admin).post('/v2/flows').send({ name, graph: g });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const published = await p.api.as(t.admin).post(`/v2/flows/${created.body.id}/publish`);
  expect(published.status, JSON.stringify(published.body)).toBe(200);
  const row = await p.h.owner.query(
    `UPDATE flows SET provider = 'simulator' WHERE org_id = $1 AND uuid = $2 RETURNING id`,
    [t.orgId, created.body.id],
  );
  return { uuid: String(created.body.id), id: Number(row.rows[0].id) };
}

const say = (t: Tenant, ch: SimChannel, peer: string, text: string) =>
  simInbound(p as never, t, ch, { from: peer, name: 'Asha', text });

async function arrangeOrg(label: string) {
  const t = await p.api.signup(label);
  const ch = await openChannel(p, t);
  return { t, ch };
}

describe('the AI node from the editor', () => {
  it('saves the reply into the variable the author typed (`save`), not the default one', async () => {
    const { t, ch } = await arrangeOrg('flbai');
    model.calls.length = 0;
    model.answer = () => 'Hello from the model';
    const f = await saveFlow(
      t,
      'ai reply',
      'ask me',
      [
        { id: 'ai', type: 'ai', data: { model: 'gpt-4o', prompt: 'Be brief', save: 'answer' } },
        { id: 'm', type: 'message', data: { text: 'Got: {{answer}}' } },
      ],
      [['ai', 'm']],
    );
    const peer = nextPeer();
    await say(t, ch, peer, 'ask me');
    expect(await untilSent(p, t, ch, peer, 2)).toEqual([
      'Hello from the model',
      'Got: Hello from the model',
    ]);
    const run = await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
    expect(run.vars.answer).toBe('Hello from the model');
    expect(model.calls[0]).toMatchObject({ authorization: `Bearer ${PLATFORM_KEY}` });
  });

  it('extraction fields typed as a comma string reach the model as the field list', async () => {
    const { t, ch } = await arrangeOrg('flbaix');
    model.calls.length = 0;
    model.answer = () => '{"NAME":"Asha","CITY":"Pune"}';
    await saveFlow(
      t,
      'ai extract',
      'extract me',
      [
        {
          id: 'ai',
          type: 'ai',
          data: { save: 'info', extract: true, fields: 'NAME, CITY', silent: true },
        },
        { id: 'm', type: 'message', data: { text: '{{info.NAME}} from {{info.CITY}}' } },
      ],
      [['ai', 'm']],
    );
    const peer = nextPeer();
    await say(t, ch, peer, 'extract me');
    expect(await untilSent(p, t, ch, peer, 1)).toEqual(['Asha from Pune']);
    expect(model.calls[0]!.jsonMode).toBe(true);
    expect(model.calls[0]!.system).toContain('NAME');
    expect(model.calls[0]!.system).toContain('CITY');
  });

  it('an assistant picked by uuid adds its knowledge base; another workspace assistant adds nothing', async () => {
    const mine = await arrangeOrg('flbasa');
    const theirs = await p.api.signup('flbasb');
    const addAssistant = async (t: Tenant, name: string, fact: string) => {
      const a = await p.h.owner.query(
        `INSERT INTO ai_chat_assistants (org_id, name, slug) VALUES ($1, $2, $3) RETURNING id, uuid`,
        [t.orgId, name, `${name}-${counter++}`],
      );
      await p.h.owner.query(
        `INSERT INTO ai_training_sources (org_id, assistant_id, kind, label, content, status) VALUES ($1, $2, 'text', 'Facts', $3, 'ready')`,
        [t.orgId, a.rows[0].id, fact],
      );
      return String(a.rows[0].uuid);
    };
    const own = await addAssistant(mine.t, 'own', 'Our shop opens at nine sharp.');
    const foreign = await addAssistant(theirs, 'foreign', 'SECRET of the other workspace.');
    model.answer = () => 'ok';

    for (const [label, uuid] of [
      ['own', own],
      ['foreign', foreign],
    ] as const) {
      model.calls.length = 0;
      await saveFlow(
        mine.t,
        `kb ${label}`,
        `kb ${label}`,
        [
          { id: 'ai', type: 'ai', data: { assistant: uuid, save: 'r' } },
          { id: 'm', type: 'message', data: { text: 'done' } },
        ],
        [['ai', 'm']],
      );
      const peer = nextPeer();
      await say(mine.t, mine.ch, peer, `kb ${label}`);
      await untilSent(p, mine.t, mine.ch, peer, 2);
      const sys = model.calls[0]!.system;
      if (label === 'own') expect(sys).toContain('Our shop opens at nine sharp.');
      else {
        expect(sys).not.toContain('SECRET');
        expect(sys).not.toContain('Knowledge base');
      }
    }
  });
});

describe('the Webhook node from the editor', () => {
  it('saves the response into `save` and the next message reads it', async () => {
    const { t, ch } = await arrangeOrg('flbwh');
    const nodes =
      await import('../../../src/modules/flow-runtime-engine/runtime/nodes/integrations/integrations-nodes');
    const exec = p.h.app.get(nodes.IntegrationNodes, { strict: false }) as unknown as {
      safeFetch: { isBlocked: (a: string) => boolean };
    };
    const original = exec.safeFetch.isBlocked;
    exec.safeFetch.isBlocked = () => false; // the fixture server is on loopback
    try {
      const f = await saveFlow(
        t,
        'webhook',
        'whgo',
        [
          {
            id: 'w',
            type: 'webhook',
            data: {
              method: 'post',
              url: `${base}/hook?who={{name}}`,
              body: '{"n":"{{name}}"}',
              save: 'api',
            },
          },
          { id: 'm', type: 'message', data: { text: '{{api.greeting}} {{api.user.tier}}' } },
        ],
        [['w', 'm']],
      );
      const peer = nextPeer();
      await say(t, ch, peer, 'whgo');
      expect(await untilSent(p, t, ch, peer, 1)).toEqual(['hola gold']);
      const run = await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
      expect(run.vars['api.greeting']).toBe('hola');
      expect(hits.find((h) => h.url?.startsWith('/hook'))?.url).toBe('/hook?who=Asha');
    } finally {
      exec.safeFetch.isBlocked = original;
    }
  });
});

describe('the Poll and Location nodes from the editor', () => {
  it('a poll with `multi` takes several answers: numbered choices, then the numbers picked', async () => {
    const { t, ch } = await arrangeOrg('flbpoll');
    const f = await saveFlow(
      t,
      'poll multi',
      'pollgo',
      [
        {
          id: 'pl',
          type: 'poll',
          data: { question: 'Toppings?', options: ['Cheese', 'Olives', 'Basil'], multi: true },
        },
        { id: 'm', type: 'message', data: { text: 'Thanks for voting' } },
      ],
      [['pl', 'm']],
    );
    const peer = nextPeer();
    await say(t, ch, peer, 'pollgo');
    const first = (await untilSent(p, t, ch, peer, 1))[0]!;
    expect(first).toContain('Reply with the numbers (comma-separated)');
    expect(first).toContain('3. Basil');
    await say(t, ch, peer, '1, 3');
    expect(await untilSent(p, t, ch, peer, 2)).toContain('Thanks for voting');
    const run = await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
    expect(run.vars.poll_response).toEqual(['Cheese', 'Basil']);
  });

  it('a poll without `multi` stays a single choice (a list)', async () => {
    const { t, ch } = await arrangeOrg('flbpol1');
    await saveFlow(
      t,
      'poll single',
      'pollone',
      [
        {
          id: 'pl',
          type: 'poll',
          data: { question: 'Pick one', options: ['A', 'B'], multi: false },
        },
      ],
      [],
    );
    const peer = nextPeer();
    await say(t, ch, peer, 'pollone');
    const first = (await untilSent(p, t, ch, peer, 1))[0]!;
    expect(first).not.toContain('comma-separated');
  });

  it('a location sends the real coordinates, not 0,0', async () => {
    const { t, ch } = await arrangeOrg('flbloc');
    await saveFlow(
      t,
      'location',
      'whereto',
      [
        {
          id: 'l',
          type: 'location',
          data: { lat: '12.9716', lng: '77.5946', title: 'HQ', address: 'MG Road' },
        },
      ],
      [],
    );
    const peer = nextPeer();
    await say(t, ch, peer, 'whereto');
    const pin = await until('the location envelope', async () =>
      envelopes.find((e) => e.to === peer && e.kind === 'location'),
    );
    expect(pin.location).toMatchObject({
      latitude: 12.9716,
      longitude: 77.5946,
      name: 'HQ',
      address: 'MG Road',
    });
  });
});

describe('the Template node from the editor', () => {
  it('a template picked by uuid (`tplId`) is resolved inside the workspace and sent, even if its name changed since', async () => {
    const { t, ch } = await arrangeOrg('flbtpl');
    const tpl = await addTemplate(p, t, {
      name: 'order_ready',
      body: 'Hi {{1}}, your order is ready.',
      variableMap: { body: [{ num: 1, key: 'name' }] },
    });
    const f = await saveFlow(
      t,
      'template uuid',
      'tplgo',
      [
        { id: 'tp', type: 'template', data: { tpl: 'a_stale_name', tplId: tpl.uuid } },
        { id: 'm', type: 'message', data: { text: 'Anything else?' } },
      ],
      [['tp', 'm']],
    );
    const peer = nextPeer();
    await say(t, ch, peer, 'tplgo');
    expect(await untilSent(p, t, ch, peer, 2)).toEqual([
      'Hi Asha, your order is ready.',
      'Anything else?',
    ]);
    await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
    // the envelope carries the template the uuid found (the name saved with it was stale)
    const tplEnvelope = envelopes.find((e) => e.to === peer && e.kind === 'template');
    expect(tplEnvelope?.template).toMatchObject({ name: 'order_ready' });
  });

  it('another workspace template uuid resolves to nothing: nothing is sent, the flow carries on', async () => {
    const mine = await arrangeOrg('flbtpa');
    const theirs = await p.api.signup('flbtpb');
    const foreign = await addTemplate(p, theirs, { name: 'their_secret', body: 'Not for you.' });
    const f = await saveFlow(
      mine.t,
      'template foreign',
      'tplforeign',
      [
        { id: 'tp', type: 'template', data: { tpl: '', tplId: foreign.uuid } },
        { id: 'm', type: 'message', data: { text: 'carried on' } },
      ],
      [['tp', 'm']],
    );
    const peer = nextPeer();
    await say(mine.t, mine.ch, peer, 'tplforeign');
    await untilRun(p, mine.t, f.id, 'completed', (r) => r.status === 'completed');
    expect(await sentTo(p, mine.t, mine.ch, peer)).toEqual(['carried on']);
  });
});

describe('the Sub-flow node from the editor', () => {
  it('runs the target flow picked by uuid (`flow`)', async () => {
    const { t, ch } = await arrangeOrg('flbsub');
    const child = await saveFlow(
      t,
      'child',
      null,
      [{ id: 'cm', type: 'message', data: { text: 'from the child flow' } }],
      [],
    );
    const parent = await saveFlow(
      t,
      'parent',
      'subgo',
      [
        { id: 'a1', type: 'message', data: { text: 'in the parent' } },
        { id: 'sub', type: 'subflow', data: { flow: child.uuid } },
        { id: 'a2', type: 'message', data: { text: 'never reached' } },
      ],
      [
        ['a1', 'sub'],
        ['sub', 'a2'],
      ],
    );
    const peer = nextPeer();
    await say(t, ch, peer, 'subgo');
    expect(await untilSent(p, t, ch, peer, 2)).toEqual(['in the parent', 'from the child flow']);
    await untilRun(p, t, parent.id, 'completed', (r) => r.status === 'completed');
  });
});
