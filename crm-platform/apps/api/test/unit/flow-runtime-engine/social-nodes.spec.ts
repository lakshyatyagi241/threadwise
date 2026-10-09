import { describe, expect, it, vi } from 'vitest';
import { compileGraph } from '../../../src/modules/flow-runtime-engine/graph/compile-graph';
import { SocialHandoffNode } from '../../../src/modules/flow-runtime-engine/runtime/nodes/actions/social-handoff-node';
import { SocialHandoffConsumer } from '../../../src/modules/flow-runtime-engine/runtime/nodes/actions/social-handoff.consumer';
import { handoffPlan } from '../../../src/modules/flow-runtime-engine/runtime/nodes/actions/social-handoff-rules';

const render = (t: unknown) =>
  String(t ?? '').replace(
    /\{\{\s*(\w+)\s*\}\}/g,
    (_m, k: string) => ({ n: '919800000001' })[k] ?? '',
  );

describe('hand-off plan (WD-FLR-010 rule 6)', () => {
  it('deep link: a wa.me link with the URL-encoded pre-filled text, after the intro', () => {
    const plan = handoffPlan(
      {
        mode: 'deeplink',
        waNumber: '+91 98000-00001',
        prefillText: 'Hi there',
        introText: 'Chat here',
      },
      render,
      {},
    );
    expect(plan).toEqual({
      mode: 'link',
      text: 'Chat here\nhttps://wa.me/919800000001?text=Hi%20there',
    });
  });

  it('deep link without a number is skipped; without intro or text the bare link is sent', () => {
    expect(handoffPlan({ mode: 'deeplink' }, render, {}).mode).toBe('skip');
    expect(handoffPlan({ waNumber: '919800000001' }, render, {})).toEqual({
      mode: 'link',
      text: 'https://wa.me/919800000001',
    });
  });

  it('direct: number from the node variable, flow from waFlowId, variables carried across', () => {
    const plan = handoffPlan(
      { mode: 'direct', numberVar: 'phone', waFlowId: 'abc', introText: 'Hold on' },
      render,
      { phone: '+91 98000 00001', city: 'Pune', skip: { a: 1 } },
    );
    expect(plan).toEqual({
      mode: 'direct',
      intro: 'Hold on',
      number: '919800000001',
      flowRef: 'abc',
      variables: { phone: '+91 98000 00001', city: 'Pune' },
    });
  });

  it('direct without a number or a flow is skipped, never an error', () => {
    expect(handoffPlan({ mode: 'direct', waFlowId: '3' }, render, {}).mode).toBe('skip');
    expect(handoffPlan({ mode: 'direct' }, render, { wa_number: '919800000001' }).mode).toBe(
      'skip',
    );
    expect(handoffPlan({ mode: 'direct', waFlowId: '0' }, render, { wa_number: '9198' }).mode).toBe(
      'skip',
    );
  });
});

function node(data: Record<string, unknown>, vars: Record<string, unknown> = {}) {
  const sent: unknown[] = [];
  const notes: string[] = [];
  const emit = vi.fn().mockResolvedValue(undefined);
  const db = { txAs: vi.fn(async (_c: unknown, fn: (tx: unknown) => unknown) => fn({})) };
  const exec = new SocialHandoffNode(db as never, { emit } as never);
  const ctx = {
    run: { id: 5, orgId: 7, vars },
    stepKey: 'flow:u:3:n1',
    node: { id: 'n1', type: 'SocialHandoff', props: { data } },
    send: vi.fn(async (m: unknown) => {
      sent.push(m);
      return { ok: true };
    }),
    render,
    note: (t: string) => notes.push(t),
    now: () => new Date(),
  };
  return { exec, ctx, sent, notes, emit };
}

describe('the hand-off node', () => {
  it('deep link sends the link and moves on without a launch', async () => {
    const { exec, ctx, sent, emit } = node({ mode: 'deeplink', waNumber: '919800000001' });
    expect(await exec.execute(ctx as never)).toEqual({ kind: 'advance', port: 1 });
    expect(sent).toEqual([{ kind: 'text', body: 'https://wa.me/919800000001' }]);
    expect(emit).not.toHaveBeenCalled();
  });

  it('direct says the intro and announces the launch once, keyed by the step', async () => {
    const { exec, ctx, sent, emit } = node(
      { mode: 'direct', waFlowId: '9', introText: 'On it' },
      { wa_number: '919800000001' },
    );
    expect(await exec.execute(ctx as never)).toEqual({ kind: 'advance', port: 1 });
    expect(sent).toEqual([{ kind: 'text', body: 'On it' }]);
    expect(emit).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        orgId: 7,
        eventType: 'flow.whatsapp_handoff_requested',
        payload: expect.objectContaining({
          number: '919800000001',
          flowRef: '9',
          key: 'flow:u:3:n1',
        }),
      }),
    );
  });

  it('a skipped node leaves a line in the run log and moves on; a down channel halts', async () => {
    const skipped = node({ mode: 'direct' });
    expect(await skipped.exec.execute(skipped.ctx as never)).toEqual({ kind: 'advance', port: 1 });
    expect(skipped.notes[0]).toMatch(/skipped/);
    const down = node({ mode: 'deeplink', waNumber: '9198' });
    down.ctx.send = vi.fn().mockResolvedValue({ ok: false, error: 'down', code: 'x', halt: true });
    expect(await down.exec.execute(down.ctx as never)).toEqual({ kind: 'halt', reason: 'down' });
  });
});

describe('the hand-off consumer', () => {
  function consumer(opts: { flow?: unknown; link?: unknown } = {}) {
    const db = { txAs: vi.fn(async (_c: unknown, fn: (tx: unknown) => unknown) => fn({})) };
    const runs = {
      flowForSubflow: vi
        .fn()
        .mockResolvedValue(
          'flow' in opts ? opts.flow : { id: 12, isActive: true, isPublished: true, data: {} },
        ),
    };
    const launch = { start: vi.fn().mockResolvedValue({ outcome: 'started' }) };
    const contacts = {
      findOrCreateByPhone: vi
        .fn()
        .mockResolvedValue(opts.link ?? { outcome: 'created', contactId: 40, contactUuid: 'u' }),
    };
    const c = new SocialHandoffConsumer(
      { register: vi.fn() } as never,
      db as never,
      runs as never,
      launch as never,
      contacts as never,
    );
    return { c, runs, launch, contacts };
  }
  const event = (payload: Record<string, unknown>) =>
    ({
      id: '1',
      orgId: 7,
      aggregateModule: 'flow_runtime_engine',
      aggregateId: '5',
      eventType: 'x',
      payload,
    }) as never;

  it('creates the contact "WhatsApp <digits>" and launches the flow with the variables', async () => {
    const { c, launch, contacts, runs } = consumer();
    await c.handle(event({ number: '919800000001', flowRef: '9', variables: { city: 'Pune' } }));
    expect(runs.flowForSubflow).toHaveBeenCalledWith(expect.anything(), 7, 9);
    expect(contacts.findOrCreateByPhone).toHaveBeenCalledWith(
      expect.anything(),
      7,
      expect.objectContaining({ phone: '+919800000001', name: 'WhatsApp 919800000001' }),
    );
    expect(launch.start).toHaveBeenCalledWith(7, {
      flowId: 12,
      contactId: 40,
      source: 'handoff',
      requirePublished: false,
      withSubscriber: true,
      variables: { city: 'Pune' },
    });
  });

  it('launches nothing for a missing flow, a flow that is off, a skipped contact or a bad payload', async () => {
    for (const [opts, payload] of [
      [{ flow: null }, { number: '9198', flowRef: '9' }],
      [{ flow: { id: 1, isActive: false } }, { number: '9198', flowRef: '9' }],
      [
        { link: { outcome: 'skipped', reason: 'plan_limit_reached' } },
        { number: '9198', flowRef: '9' },
      ],
      [{}, { number: '', flowRef: '9' }],
      [{}, { number: '9198', flowRef: 'nope' }],
    ] as const) {
      const { c, launch } = consumer(opts);
      await c.handle(event({ ...payload }));
      expect(launch.start).not.toHaveBeenCalled();
    }
  });
});

describe('Instagram nodes that are the shared nodes (compile)', () => {
  const graph = (
    nodes: Array<Record<string, unknown>>,
    edges: Array<Record<string, unknown>> = [],
  ) => compileGraph({ flowNodes: nodes, flowEdges: edges });

  it('maps send, ask, quick replies, buttons and AI onto the shared executors', () => {
    const g = graph([
      { id: 'a', type: 'ig_send_dm', data: { text: 'Hi {{name}}' } },
      { id: 'b', type: 'ig_ask', data: { question: 'Your name?', save: 'lead_name' } },
      {
        id: 'c',
        type: 'ig_quick',
        data: {
          text: 'Pick',
          options: [
            { title: 'Pricing', payload: 'P' },
            { title: 'Support', payload: 'S' },
          ],
        },
      },
      {
        id: 'd',
        type: 'ig_buttons',
        data: {
          text: 'Tap',
          buttons: [
            { type: 'web_url', title: 'Visit', url: 'https://x.test' },
            { type: 'postback', title: 'Talk', payload: 'T' },
          ],
        },
      },
      {
        id: 'e',
        type: 'ig_ai',
        data: { model: 'gpt-4o-mini', prompt: 'Be nice', save: 'ai_reply' },
      },
      { id: 'f', type: 'ig_to_whatsapp', data: { mode: 'direct', waFlowId: '3' } },
    ]);
    const by = Object.fromEntries(g.nodes.map((n) => [n.id, n]));
    expect(by.a).toMatchObject({
      type: 'Message',
      props: { replies: [{ type: 'Text', data: 'Hi {{name}}' }] },
    });
    expect(by.b).toMatchObject({
      type: 'Question',
      props: { question: 'Your name?', variable: 'lead_name' },
    });
    expect(by.c).toMatchObject({
      type: 'InteractiveButtons',
      props: {
        bodyText: 'Pick',
        buttons: [
          { id: 'p0', title: 'Pricing' },
          { id: 'p1', title: 'Support' },
        ],
      },
    });
    expect(by.d).toMatchObject({
      type: 'CTA',
      props: {
        bodyText: 'Tap',
        actions: [{ type: 'url', label: 'Visit', value: 'https://x.test' }],
      },
    });
    expect(by.e).toMatchObject({
      type: 'ChatGPT',
      props: { data: { variable: 'ai_reply', prompt: 'Be nice' } },
    });
    expect(by.f).toMatchObject({ type: 'SocialHandoff', props: { data: { waFlowId: '3' } } });
  });

  it('routes a quick reply tap by its option number', () => {
    const g = graph(
      [
        {
          id: 'c',
          type: 'ig_quick',
          data: { text: 'Pick', options: [{ title: 'A' }, { title: 'B' }] },
        },
        { id: 'x', type: 'ig_send_dm', data: { text: 'a' } },
        { id: 'y', type: 'ig_send_dm', data: { text: 'b' } },
      ],
      [
        { source: 'c', sourceHandle: 'p0', target: 'x' },
        { source: 'c', sourceHandle: 'p1', target: 'y' },
      ],
    );
    expect(g.edges).toEqual([
      { from: 'c_1', to: 'x' },
      { from: 'c_2', to: 'y' },
    ]);
  });
});
