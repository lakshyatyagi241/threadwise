import { describe, expect, it } from 'vitest';
import { compileGraph } from '../../../src/modules/flow-runtime-engine/graph/compile-graph';
import {
  applyReply,
  executeCurrent,
  wakeFromSleep,
  type StepDeps,
  type Transition,
} from '../../../src/modules/flow-runtime-engine/runtime/engine-core';
import { decodeInbound } from '../../../src/modules/flow-runtime-engine/runtime/reply-router';
import type {
  InboundReply,
  OutboundMessage,
  RunState,
} from '../../../src/modules/flow-runtime-engine/runtime/types';

type Builder = { nodes: unknown[]; edges: unknown[] };
const n = (id: string, type: string, data: Record<string, unknown> = {}, extra = {}) => ({
  id,
  type,
  data,
  ...extra,
});
const e = (source: string, target: string, sourceHandle = 'out') => ({
  source,
  sourceHandle,
  target,
});

function newRun(b: Builder, vars: Record<string, unknown> = {}): RunState {
  const graph = compileGraph({ flowNodes: b.nodes, flowEdges: b.edges });
  return {
    id: 1,
    uuid: 'r',
    orgId: 1,
    flowId: 1,
    subscriberId: null,
    contactId: null,
    channelId: 1,
    channelUuid: 'c',
    channelKind: 'simulator',
    contactUuid: null,
    peerKey: '1',
    conversationId: null,
    source: 'keyword',
    triggerText: null,
    status: 'running',
    graph,
    currentNodeId: graph.nodes[0]!.id,
    stepSeq: 0,
    vars,
    visits: {},
    wait: null,
    menus: { latest: null, byNode: {} },
    lastOut: null,
    timeoutSeconds: 600,
    cooldownSeconds: 0,
    haltReason: null,
    startedAt: new Date(0),
    expiresAt: null,
    maxExpiresAt: new Date(1e13),
    resumeAt: null,
  };
}

/** Runs a flow like the engine: step until it parks, sleeps, halts or ends. Returns the sent messages and where it stopped. */
function harness(run: RunState, options: { sendFails?: boolean } = {}) {
  const sent: OutboundMessage[] = [];
  const deps: StepDeps = {
    send: async (_r, m) => {
      if (options.sendFails) return { ok: false, error: 'Meta said no', code: 'X', halt: false };
      sent.push(m);
      return { ok: true };
    },
    paceMs: () => 0,
    now: () => new Date(0),
  };
  const settle = async (first: Transition | null): Promise<Transition> => {
    let t: Transition = first ?? (await executeCurrent(run, deps).then((o) => o.transition));
    for (let guard = 0; guard < 500; guard++) {
      if (t.t === 'goto') {
        run.currentNodeId = t.nodeId;
        t = (await executeCurrent(run, deps)).transition;
        continue;
      }
      if (t.t === 'wait') {
        run.wait = t.wait;
        run.status = 'waiting';
      } else if (t.t === 'sleep') run.status = 'sleeping';
      else if (t.t === 'end') run.status = t.status;
      return t;
    }
    throw new Error('did not settle');
  };
  return {
    sent,
    start: () => settle(null),
    reply: (r: InboundReply) => settle(applyReply(run, r).transition),
    wake: () => settle(wakeFromSleep(run).transition),
  };
}

const text = (t: string): InboundReply => ({ kind: 'text', id: '', text: t });
const tap = (id: string, t: string): InboundReply => ({ kind: 'tap', id, text: t });
const bodies = (sent: OutboundMessage[]) => sent.map((m) => ('body' in m ? m.body : m.kind));

describe('walking a flow', () => {
  it('sends messages in order and ends at the End node', async () => {
    const run = newRun(
      {
        nodes: [
          n('t', 'trigger', {}, { isStart: true }),
          n('a', 'message', { text: 'Hi {{name}}' }),
          n('b', 'message', { text: 'Bye' }),
          n('z', 'end'),
        ],
        edges: [e('t', 'a'), e('a', 'b'), e('b', 'z')],
      },
      { name: 'Asha' },
    );
    const h = harness(run);
    const t = await h.start();
    expect(bodies(h.sent)).toEqual(['Hi Asha', 'Bye']);
    expect(t).toMatchObject({ t: 'end', status: 'completed', reason: 'end_node' });
  });

  it('a linear flow with no End node ends at its last node', async () => {
    const run = newRun({
      nodes: [n('a', 'message', { text: 'one' }), n('b', 'message', { text: 'two' })],
      edges: [e('a', 'b')],
    });
    const t = await harness(run).start();
    expect(t).toMatchObject({ t: 'end', status: 'completed', reason: 'dead_end' });
  });

  it('only the first edge on a port runs', async () => {
    const run = newRun({
      nodes: [
        n('a', 'message', { text: 'a' }),
        n('b', 'message', { text: 'b' }),
        n('c', 'message', { text: 'c' }),
      ],
      edges: [e('a', 'b'), e('a', 'c')],
    });
    const h = harness(run);
    await h.start();
    expect(bodies(h.sent)).toEqual(['a', 'b']);
  });

  it('a condition takes yes or no', async () => {
    const mk = (v: string) =>
      newRun(
        {
          nodes: [
            n('c', 'condition', {
              conditions: [{ variable: 'plan', operator: 'equals', value: 'pro' }],
            }),
            n('y', 'message', { text: 'welcome pro' }),
            n('x', 'message', { text: 'upgrade?' }),
          ],
          edges: [e('c', 'y', 'yes'), e('c', 'x', 'no')],
        },
        { plan: v },
      );
    const a = harness(mk('pro'));
    await a.start();
    expect(bodies(a.sent)).toEqual(['welcome pro']);
    const b = harness(mk('free'));
    await b.start();
    expect(bodies(b.sent)).toEqual(['upgrade?']);
  });

  it('a delay sleeps, then continues when woken', async () => {
    const run = newRun({
      nodes: [
        n('a', 'message', { text: 'before' }),
        n('d', 'delay', { amount: 2, unit: 'hour' }),
        n('b', 'message', { text: 'after' }),
      ],
      edges: [e('a', 'd'), e('d', 'b')],
    });
    const h = harness(run);
    const t = await h.start();
    expect(t).toEqual({ t: 'sleep', seconds: 7200 });
    expect(bodies(h.sent)).toEqual(['before']);
    await h.wake();
    expect(bodies(h.sent)).toEqual(['before', 'after']);
  });

  it('stops a loop at 20 visits without a message and records a failure', async () => {
    const run = newRun({
      nodes: [n('a', 'message', { text: 'x' }), n('b', 'message', { text: 'y' })],
      edges: [e('a', 'b'), e('b', 'a')],
    });
    const h = harness(run);
    const t = await h.start();
    expect(t).toMatchObject({ t: 'end', status: 'failed', reason: 'loop_guard' });
    expect(h.sent.length).toBe(40);
  });

  it('an unknown node type is passed over', async () => {
    const run = newRun({
      nodes: [n('a', 'mystery'), n('b', 'message', { text: 'still here' })],
      edges: [e('a', 'b')],
    });
    const h = harness(run);
    await h.start();
    expect(bodies(h.sent)).toEqual(['still here']);
  });
});

describe('Ask', () => {
  const flow = (data: Record<string, unknown> = {}) =>
    newRun({
      nodes: [
        n('q', 'ask', { prompt: 'Your email?', var: '{{email}}', ...data }),
        n('m', 'message', { text: 'Thanks {{email}}' }),
      ],
      edges: [e('q', 'm')],
    });

  it('waits, stores the answer under the variable and the node id, then goes on', async () => {
    const run = flow();
    const h = harness(run);
    expect((await h.start()).t).toBe('wait');
    await h.reply(text('a@b.co'));
    expect(run.vars.email).toBe('a@b.co');
    expect(run.vars.q).toBe('a@b.co');
    expect(run.vars.user_message).toBe('a@b.co');
    expect(bodies(h.sent)).toEqual(['Your email?', 'Thanks a@b.co']);
  });

  it('a blank prompt sends a visible fallback', async () => {
    const run = newRun({ nodes: [n('q', 'ask', { prompt: '{{nothing}}' })], edges: [] });
    const h = harness(run);
    await h.start();
    expect(bodies(h.sent)).toEqual(['Please reply to continue.']);
  });

  it('ignores a file with no caption unless the Ask accepts media', async () => {
    const run = flow();
    const h = harness(run);
    await h.start();
    const t = await h.reply({ kind: 'media', id: '', text: '', mediaUrl: 'https://x/f.jpg' });
    expect(t.t).toBe('none');
    expect(run.status).toBe('waiting');
    expect(run.vars.email).toBeUndefined();

    const run2 = flow({ acceptMedia: true });
    const h2 = harness(run2);
    await h2.start();
    await h2.reply({ kind: 'media', id: '', text: '', mediaUrl: 'https://x/f.jpg' });
    expect(run2.vars.email).toBe('https://x/f.jpg');
  });

  it('expected answers: a match routes, no match takes the else branch, else stays', async () => {
    const build = (withElse: boolean) =>
      newRun({
        nodes: [
          n('q', 'ask', { prompt: 'Yes or no?', options: ['Yes', 'No'] }),
          n('y', 'message', { text: 'great' }),
          n('o', 'message', { text: 'ok' }),
          n('x', 'message', { text: 'sorry?' }),
        ],
        edges: [e('q', 'y', 'p0'), e('q', 'o', 'p1'), ...(withElse ? [e('q', 'x', 'else')] : [])],
      });
    const a = build(true);
    const ha = harness(a);
    await ha.start();
    await ha.reply(text('yes'));
    expect(bodies(ha.sent).slice(-1)).toEqual(['great']);

    const b = build(true);
    const hb = harness(b);
    await hb.start();
    await hb.reply(text('banana'));
    expect(bodies(hb.sent).slice(-1)).toEqual(['sorry?']);

    const c = build(false);
    const hc = harness(c);
    await hc.start();
    const t = await hc.reply(text('banana'));
    expect(t.t).toBe('wait');
    expect(hc.sent.length).toBe(1); // nothing advanced and nothing re-sent
    await hc.reply(text('2')); // a typed number picks option 2
    expect(bodies(hc.sent).slice(-1)).toEqual(['ok']);
  });

  it('a prompt the customer never got ends the run', async () => {
    const run = flow();
    const t = await harness(run, { sendFails: true }).start();
    expect(t).toMatchObject({ t: 'end', status: 'failed', reason: 'send_failed' });
  });
});

describe('Buttons and old menus', () => {
  const flow = () =>
    newRun({
      nodes: [
        n('b1', 'buttons', { prompt: 'Pick', options: ['Docs', 'Price'] }),
        n('d', 'message', { text: 'docs here' }),
        n('b2', 'buttons', { prompt: 'Which plan?', options: ['Pro', 'Basic'] }),
        n('p', 'message', { text: 'pro plan' }),
        n('s', 'message', { text: 'basic plan' }),
      ],
      edges: [e('b1', 'd', 'p0'), e('b1', 'b2', 'p1'), e('b2', 'p', 'p0'), e('b2', 's', 'p1')],
    });

  it('a tap routes by option id and stores the label', async () => {
    const run = flow();
    const h = harness(run);
    await h.start();
    await h.reply(tap('b_b1_p0', 'Docs'));
    expect(run.vars.choice).toBe('Docs');
    expect(bodies(h.sent).slice(-1)).toEqual(['docs here']);
  });

  it('a leaf branch keeps the menu tappable, so a second tap works', async () => {
    const run = flow();
    const h = harness(run);
    await h.start();
    const t1 = await h.reply(tap('b_b1_p0', 'Docs'));
    expect(t1.t).toBe('wait'); // dead end after "docs here": the menu is re-armed
    await h.reply(tap('b_b1_p1', 'Price'));
    expect(bodies(h.sent).slice(-1)).toEqual(['Which plan?']);
  });

  it("a tap on an OLDER menu goes to that menu's branch", async () => {
    const run = flow();
    const h = harness(run);
    await h.start();
    await h.reply(tap('b_b1_p1', 'Price')); // now waiting on b2
    await h.reply(tap('b_b1_p0', 'Docs')); // old menu
    expect(bodies(h.sent).slice(-1)).toEqual(['docs here']);
  });

  it('routes a tap whose id was dropped by its unique label (first 20 characters)', async () => {
    const run = newRun({
      nodes: [
        n('b1', 'buttons', {
          prompt: 'Pick',
          options: ['A very long button label indeed', 'Short'],
        }),
        n('l', 'message', { text: 'long' }),
        n('s', 'message', { text: 'short' }),
      ],
      edges: [e('b1', 'l', 'p0'), e('b1', 's', 'p1')],
    });
    const h = harness(run);
    await h.start();
    await h.reply(tap('', 'A very long button l')); // Meta truncates to 20
    expect(bodies(h.sent).slice(-1)).toEqual(['long']);
  });

  it('an option with no wired branch stays on the menu', async () => {
    const run = newRun({
      nodes: [
        n('b1', 'buttons', { prompt: 'Pick', options: ['One', 'Two'] }),
        n('m', 'message', { text: 'two' }),
      ],
      edges: [e('b1', 'm', 'p1')],
    });
    const h = harness(run);
    await h.start();
    const t = await h.reply(tap('b_b1_p0', 'One'));
    expect(t.t).toBe('wait');
    await h.reply(tap('b_b1_p1', 'Two'));
    expect(bodies(h.sent).slice(-1)).toEqual(['two']);
  });
});

describe('List and Poll', () => {
  it('routes a list row by its id, by a digit in rendered order, and by title', async () => {
    const mk = () =>
      newRun({
        nodes: [
          n('l', 'list', {
            prompt: 'Choose',
            button: 'Open',
            options: [
              { title: 'Alpha', section: 'S1' },
              { title: 'Beta', section: 'S2' },
              { title: 'Gamma', section: 'S1' },
            ],
          }),
          n('a', 'message', { text: 'A' }),
          n('b', 'message', { text: 'B' }),
          n('g', 'message', { text: 'G' }),
        ],
        edges: [e('l', 'a', 'p0'), e('l', 'b', 'p1'), e('l', 'g', 'p2')],
      });
    const byId = harness(mk());
    await byId.start();
    await byId.reply(tap('list_l_p1', 'Beta'));
    expect(bodies(byId.sent).slice(-1)).toEqual(['B']);

    // Rendered order is S1: Alpha, Gamma then S2: Beta, so "2" is Gamma, not Beta.
    const byDigit = harness(mk());
    await byDigit.start();
    await byDigit.reply(text('2'));
    expect(bodies(byDigit.sent).slice(-1)).toEqual(['G']);

    const byTitle = harness(mk());
    await byTitle.start();
    await byTitle.reply(text('beta'));
    expect(bodies(byTitle.sent).slice(-1)).toEqual(['B']);
  });

  it('a poll routes the chosen option', async () => {
    const run = newRun({
      nodes: [
        n('p', 'poll', { question: 'Fav?', options: ['Red', 'Blue'] }),
        n('r', 'message', { text: 'red!' }),
        n('b', 'message', { text: 'blue!' }),
      ],
      edges: [e('p', 'r', 'p0'), e('p', 'b', 'p1')],
    });
    const h = harness(run);
    await h.start();
    await h.reply(text('2'));
    expect(run.vars.poll_response).toEqual(['Blue']);
    expect(bodies(h.sent).slice(-1)).toEqual(['blue!']);
  });

  it('a poll with one option fails', async () => {
    const run = newRun({
      nodes: [n('p', 'poll', { question: 'x', options: ['only'] })],
      edges: [],
    });
    expect(await harness(run).start()).toMatchObject({ t: 'end', status: 'failed' });
  });
});

describe('CTA and Location', () => {
  it('a CTA with a link becomes a button message, with the rest as text', async () => {
    const run = newRun({
      nodes: [
        n('c', 'cta', {
          valueText: 'Our site',
          ctaActions: [
            { type: 'phone', label: 'Call', value: 'tel:+911234' },
            { type: 'url', label: 'Visit', value: 'https://x.test' },
          ],
        }),
      ],
      edges: [],
    });
    const h = harness(run);
    await h.start();
    expect(h.sent[0]).toMatchObject({ kind: 'cta_url', text: 'Visit', url: 'https://x.test' });
    expect((h.sent[0] as { body: string }).body).toContain('☏ Call: +911234');
  });

  it('a location falls back to a maps link when the pin cannot be sent', async () => {
    const run = newRun({
      nodes: [n('l', 'location', { latitude: 1.5, longitude: 2.5, title: 'HQ' })],
      edges: [],
    });
    let calls = 0;
    const sent: OutboundMessage[] = [];
    const deps: StepDeps = {
      send: async (_r, m) => {
        calls++;
        if (m.kind === 'location') return { ok: false, error: 'no pins', code: 'X', halt: false };
        sent.push(m);
        return { ok: true };
      },
      paceMs: () => 0,
      now: () => new Date(0),
    };
    await executeCurrent(run, deps);
    expect(calls).toBe(2);
    expect((sent[0] as { body: string }).body).toContain('https://maps.google.com/?q=1.5,2.5');
  });
});

describe('decoding a customer message', () => {
  it('reads a tap, a location pin, a caption and ignores reactions', () => {
    expect(
      decodeInbound({
        kind: 'interactive',
        meta: { interactive: { type: 'button_reply', id: 'b_x_p0', title: 'Yes' } },
      }),
    ).toEqual({
      kind: 'tap',
      id: 'b_x_p0',
      text: 'Yes',
    });
    expect(
      decodeInbound({ kind: 'location', location: { latitude: 1, longitude: 2, name: 'Cafe' } }),
    ).toEqual({
      kind: 'location',
      id: '',
      text: 'Cafe https://www.google.com/maps?q=1,2',
      data: {
        latitude: 1,
        longitude: 2,
        name: 'Cafe',
        address: '',
        link: 'https://www.google.com/maps?q=1,2',
      },
    });
    expect(decodeInbound({ kind: 'media', body: 'confirm', mediaUrl: 'https://f' })).toMatchObject({
      kind: 'media',
      text: 'confirm',
    });
    expect(decodeInbound({ kind: 'reaction' })).toBeNull();
    expect(decodeInbound({ kind: 'text', body: '  hi  ' })).toEqual({
      kind: 'text',
      id: '',
      text: 'hi',
    });
    expect(decodeInbound({ kind: 'text', body: '   ' })).toBeNull();
  });
});

describe('compiling a builder graph', () => {
  it('maps ports, handles and the start node', () => {
    const g = compileGraph({
      flowNodes: [
        n('x', 'message', { text: 'x' }),
        n('s', 'trigger', {}, { isStart: true }),
        n('c', 'condition', {}),
        n('b', 'buttons', { options: ['a', 'b', 'c'] }),
      ],
      flowEdges: [
        e('s', 'x'),
        e('c', 'x', 'yes'),
        e('c', 'b', 'no'),
        e('b', 'x', 'p2'),
        e('b', 'x', 'else'),
      ],
    });
    expect(g.nodes[0]!.id).toBe('s');
    expect(g.edges.map((x) => x.from)).toEqual(['s_1', 'c_1', 'c_2', 'b_3', 'b_0']);
    const delay = compileGraph({ flowNodes: [n('d', 'delay', { amount: 3, unit: 'days' })] });
    expect(delay.nodes[0]!.props.delaySeconds).toBe(259200);
    const odd = compileGraph({ flowNodes: [n('d', 'delay', { unit: 'fortnights' })] });
    expect(odd.nodes[0]!.props.delaySeconds).toBe(300);
  });
});
