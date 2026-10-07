import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { flbDefaultNodeData, flbNormalizeGraph } from '@crm/contracts';
import { simInbound } from '../chat-conversations/pipeline-support';
import {
  openChannel,
  startFlowPipeline,
  untilRun,
  untilSent,
  type FlowPipeline,
  type SimChannel,
  type Tenant,
} from './support';

/**
 * The checked question (an Ask with "Validate as" set) and a flow shaped the way the Simple builder saves it (a chain of steps,
 * buttons that lead to a second chain), end to end: saved through the editor's own API, then driven by a customer on the simulator
 * channel through the real engine (reply router, run store, step queue, sender).
 */
let p: FlowPipeline;

beforeAll(async () => {
  p = await startFlowPipeline();
}, 300_000);
afterAll(async () => {
  await p?.stop();
});

let counter = 0;
const nextPeer = () => `9196${String(40000000 + counter++).padStart(8, '0')}`;

type EditorNode = { id: string; type: string; data?: Record<string, unknown> };

/** A graph as the editor saves it: the trigger, then each node from the inspector's defaults plus the author's choices. */
const graphOf = (nodes: EditorNode[], edges: Array<[string, string, string?]>) =>
  flbNormalizeGraph({
    flowNodes: [
      {
        id: 'trig',
        type: 'trigger',
        x: 0,
        y: 0,
        isStart: true,
        data: flbDefaultNodeData('trigger'),
      },
      ...nodes.map((n, i) => ({
        id: n.id,
        type: n.type,
        x: 300 * (i + 1),
        y: 0,
        data: { ...flbDefaultNodeData(n.type), ...n.data },
      })),
    ],
    flowEdges: edges.map(([source, target, sourceHandle], i) => ({
      id: `e${i}`,
      source,
      sourceHandle: sourceHandle ?? 'out',
      target,
    })),
  });

async function saveFlow(
  t: Tenant,
  name: string,
  keyword: string,
  nodes: EditorNode[],
  edges: Array<[string, string, string?]>,
): Promise<{ uuid: string; id: number }> {
  const g = graphOf(nodes, [['trig', nodes[0]!.id], ...edges]);
  const trig = g.flowNodes.find((n) => n.id === 'trig')!;
  trig.data = { ...trig.data, kind: 'keyword', keywords: keyword };
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

const waitingOn = (t: Tenant, flowId: number, nodeId: string) =>
  untilRun(
    p,
    t,
    flowId,
    `waiting on ${nodeId}`,
    (r) => r.status === 'waiting' && r.wait?.nodeId === nodeId,
  );

describe('a checked question', () => {
  it('an email: a wrong answer gets the console text and the question stays open; a good one is saved and the flow goes on', async () => {
    const { t, ch } = await arrangeOrg('ainp1');
    const f = await saveFlow(
      t,
      'email',
      'reg',
      [
        { id: 'a', type: 'ask', data: { prompt: 'Your email?', var: 'email', validate: 'email' } },
        { id: 'm', type: 'message', data: { text: 'Saved {{email}} ({{email_status}})' } },
      ],
      [['a', 'm']],
    );
    const peer = nextPeer();
    await say(t, ch, peer, 'reg');
    await waitingOn(t, f.id, 'a');
    await say(t, ch, peer, 'not an email');
    expect(await untilSent(p, t, ch, peer, 2)).toEqual([
      'Your email?',
      'Please enter a valid email id',
    ]);
    expect((await waitingOn(t, f.id, 'a')).status).toBe('waiting');
    await say(t, ch, peer, ' asha@example.com ');
    const run = await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
    expect(run.vars).toMatchObject({ email: 'asha@example.com', email_status: 'received' });
    expect(await untilSent(p, t, ch, peer, 3)).toEqual([
      'Your email?',
      'Please enter a valid email id',
      'Saved asha@example.com (received)',
    ]);
  });

  it("the author's own wrong-answer text is used; with a retry limit the flow moves on without an answer", async () => {
    const { t, ch } = await arrangeOrg('ainp2');
    const f = await saveFlow(
      t,
      'phone',
      'ph',
      [
        {
          id: 'a',
          type: 'ask',
          data: {
            prompt: 'Phone?',
            var: 'phone',
            validate: 'phone',
            retries: 2,
            wrongReply: 'Digits only, please',
          },
        },
        { id: 'm', type: 'message', data: { text: 'status={{phone_status}}' } },
      ],
      [['a', 'm']],
    );
    const peer = nextPeer();
    await say(t, ch, peer, 'ph');
    await waitingOn(t, f.id, 'a');
    await say(t, ch, peer, 'abc');
    await say(t, ch, peer, 'def');
    expect(await untilSent(p, t, ch, peer, 3)).toEqual([
      'Phone?',
      'Digits only, please',
      'Digits only, please',
    ]);
    await say(t, ch, peer, 'ghi');
    const run = await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
    expect(run.vars).toMatchObject({ phone: '', phone_status: 'failed' });
    expect((await untilSent(p, t, ch, peer, 4)).at(-1)).toBe('status=failed');
  });

  it('with the limit reached and "end the flow" chosen, the run ends', async () => {
    const { t, ch } = await arrangeOrg('ainp3');
    const f = await saveFlow(
      t,
      'end',
      'en',
      [
        {
          id: 'a',
          type: 'ask',
          data: { prompt: 'Number?', var: 'n', validate: 'number', retries: 1, onFail: 'end' },
        },
        { id: 'm', type: 'message', data: { text: 'never' } },
      ],
      [['a', 'm']],
    );
    const peer = nextPeer();
    await say(t, ch, peer, 'en');
    await waitingOn(t, f.id, 'a');
    await say(t, ch, peer, 'x');
    await say(t, ch, peer, 'y');
    const run = await untilRun(
      p,
      t,
      f.id,
      'ended',
      (r) => r.status !== 'waiting' && r.status !== 'running',
    );
    expect(run.status).not.toBe('waiting');
    expect(await untilSent(p, t, ch, peer, 2)).toEqual(['Number?', 'Please enter a valid number']);
  });

  it('a date: a real day in the chosen shape is taken, with an ISO copy; an impossible day is refused', async () => {
    const { t, ch } = await arrangeOrg('ainp4');
    const f = await saveFlow(
      t,
      'date',
      'dt',
      [
        {
          id: 'a',
          type: 'ask',
          data: { prompt: 'Date?', var: 'when', validate: 'date', dateFormat: 'dd-mm-yyyy' },
        },
        { id: 'm', type: 'message', data: { text: '{{when}} = {{when_iso}}' } },
      ],
      [['a', 'm']],
    );
    const peer = nextPeer();
    await say(t, ch, peer, 'dt');
    await waitingOn(t, f.id, 'a');
    await say(t, ch, peer, '31-02-2026');
    expect(await untilSent(p, t, ch, peer, 2)).toEqual([
      'Date?',
      'Please enter a valid date (DD-MM-YYYY)',
    ]);
    await say(t, ch, peer, '09-07-2026');
    await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
    expect((await untilSent(p, t, ch, peer, 3)).at(-1)).toBe('09-07-2026 = 2026-07-09');
  });

  it('a plain Ask (free text) still takes any answer: the checked question did not change it', async () => {
    const { t, ch } = await arrangeOrg('ainp5');
    const f = await saveFlow(
      t,
      'plain',
      'pl',
      [
        { id: 'a', type: 'ask', data: { prompt: 'Anything?', var: 'x', validate: 'text' } },
        { id: 'm', type: 'message', data: { text: 'got {{x}}' } },
      ],
      [['a', 'm']],
    );
    const peer = nextPeer();
    await say(t, ch, peer, 'pl');
    await waitingOn(t, f.id, 'a');
    await say(t, ch, peer, '!!! 42 ???');
    await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
    expect((await untilSent(p, t, ch, peer, 2)).at(-1)).toBe('got !!! 42 ???');
  });
});

describe('a flow shaped like a Simple builder flow', () => {
  it('buttons that lead to a second chain: the tapped one runs its chain, one that leads nowhere sends nothing more', async () => {
    const { t, ch } = await arrangeOrg('simp1');
    const f = await saveFlow(
      t,
      'simple menu',
      'menu',
      [
        { id: 'w', type: 'message', data: { text: 'Welcome' } },
        {
          id: 'b',
          type: 'buttons',
          data: { prompt: 'Pick one', options: ['Pricing', 'Talk'], var: 'choice' },
        },
        { id: 'p1', type: 'message', data: { text: 'Prices start at 999' } },
        { id: 'p2', type: 'ask', data: { prompt: 'Your name?', var: 'name', validate: 'name' } },
        { id: 'p3', type: 'message', data: { text: 'Thanks {{name}}' } },
      ],
      [
        ['w', 'b'],
        ['b', 'p1', 'p0'],
        ['p1', 'p2'],
        ['p2', 'p3'],
      ],
    );
    const peer = nextPeer();
    await say(t, ch, peer, 'menu');
    await waitingOn(t, f.id, 'b');
    // The simulator thread shows a buttons message as its text and the button labels.
    expect(await untilSent(p, t, ch, peer, 2)).toEqual(['Welcome', 'Pick one\n[Pricing | Talk]']);
    await say(t, ch, peer, 'Pricing');
    await waitingOn(t, f.id, 'p2');
    expect((await untilSent(p, t, ch, peer, 4)).slice(2)).toEqual([
      'Prices start at 999',
      'Your name?',
    ]);
    await say(t, ch, peer, 'Asha');
    expect((await untilSent(p, t, ch, peer, 5)).at(-1)).toBe('Thanks Asha');
    // The chain is done; the menu stays open (Reference keeps a buttons menu tappable), so the run waits on it again.
    const back = await waitingOn(t, f.id, 'b');
    expect(back.vars).toMatchObject({ name: 'Asha', name_status: 'received', choice: 'Pricing' });
    // The other button leads nowhere: nothing more is sent, and the menu stays open.
    await say(t, ch, peer, 'Talk');
    await new Promise((r) => setTimeout(r, 1500));
    expect(await untilSent(p, t, ch, peer, 5)).toHaveLength(5);
  });
});
