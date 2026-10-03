import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { simInbound } from '../chat-conversations/pipeline-support';
import {
  PLATFORM_KEY,
  setPlatformKey,
  startStubModel,
  type ModelCall,
  type StubModel,
} from './ai-support';
import {
  addFlow,
  edge,
  graph,
  node,
  runsOf,
  sentTo,
  simChannel,
  startFlowPipeline,
  system,
  untilRun,
  untilSent,
  type FlowPipeline,
  type SimChannel,
  type Tenant,
} from './support';

/**
 * The AI node, the Chatbot hand-off and Sub-flow (WD-FLR-030, 031) and natural-language ordering (WD-FLR-042) through the real engine:
 * run store, step queue, sender, AI keys and token ledger, and a local stand-in for the model vendor.
 */
let p: FlowPipeline;
let model: StubModel;
let t: Tenant;
let ch: SimChannel;
beforeAll(async () => {
  p = await startFlowPipeline();
  model = await startStubModel();
  await setPlatformKey(p, true);
  t = await p.api.signup('flrai');
  ch = await simChannel(p as never, t);
}, 300_000);
afterAll(async () => {
  await model?.stop();
  await p?.stop();
});

let counter = 0;
const nextPeer = () => `9197${String(10000000 + counter++).padStart(8, '0')}`;
const say = (peer: string, text: string) =>
  simInbound(p as never, t, ch, { from: peer, name: 'Asha', text });
const lastRun = async (flowId: number) => (await runsOf(p, t, flowId)).slice(-1)[0]!;
const steps = async (runId: number) =>
  (
    await p.h.owner.query(
      `SELECT event, node_type, detail, error FROM flow_run_steps WHERE run_id = $1 ORDER BY seq, id`,
      [runId],
    )
  ).rows as Array<{
    event: string;
    node_type: string | null;
    detail: Record<string, unknown>;
    error: string | null;
  }>;

describe('the AI node', () => {
  it('answers the trigger message, sends it, keeps it in the variable and bills the platform key', async () => {
    model.calls.length = 0;
    model.answer = () => 'Hello from the model';
    const f = await addFlow(p, t, {
      graph: graph(
        [
          node('t', 'trigger', {}, { isStart: true }),
          node('ai', 'ai', { model: 'gpt-4o', prompt: 'Be brief', variable: 'answer' }),
          node('m', 'message', { text: 'Got: {{answer}}' }),
          node('z', 'end'),
        ],
        [edge('t', 'ai'), edge('ai', 'm'), edge('m', 'z')],
      ),
      trigger: { kind: 'keyword', keywords: 'ask me' },
    });
    const peer = nextPeer();
    await say(peer, 'ask me');
    expect(await untilSent(p, t, ch, peer, 2)).toEqual([
      'Hello from the model',
      'Got: Hello from the model',
    ]);
    await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
    expect(model.calls[0]).toMatchObject({
      authorization: `Bearer ${PLATFORM_KEY}`,
      model: 'gpt-4o',
      system: 'Be brief',
      user: 'ask me',
      maxTokens: 350,
    });
    const used = await p.h.owner.query(
      `SELECT provider, model, prompt_tokens, completion_tokens, billed_against FROM ai_token_usage WHERE org_id = $1`,
      [t.orgId],
    );
    expect(used.rows[0]).toMatchObject({
      provider: 'openai',
      model: 'gpt-4o',
      prompt_tokens: 11,
      completion_tokens: 7,
      billed_against: 'admin',
    });
  });

  it('conversation mode keeps the chat going until the exit keyword, then extracts from the transcript', async () => {
    model.calls.length = 0;
    model.answer = (c: ModelCall) =>
      c.jsonMode
        ? '{"NAME":"Asha","PHONE":"555"}'
        : `reply to: ${c.user.split('Customer: ').pop()?.split('\n')[0]}`;
    const f = await addFlow(p, t, {
      graph: graph(
        [
          node('t', 'trigger', {}, { isStart: true }),
          node('ai', 'ai', {
            conversational: true,
            exit_keyword: 'finish',
            extract: true,
            fields: ['NAME', 'PHONE'],
            variable: 'reply',
          }),
          node('m', 'message', { text: 'Bye {{reply.NAME}} on {{reply.PHONE}}' }),
          node('z', 'end'),
        ],
        [edge('t', 'ai'), edge('ai', 'm'), edge('m', 'z')],
      ),
      trigger: { kind: 'keyword', keywords: 'start chat' },
    });
    const peer = nextPeer();
    await say(peer, 'start chat');
    await untilSent(p, t, ch, peer, 1);
    const parked = await untilRun(p, t, f.id, 'waiting', (r) => r.status === 'waiting');
    expect(parked.wait).toMatchObject({ nodeId: 'ai' });

    await say(peer, 'my name is Asha');
    await untilSent(p, t, ch, peer, 2);
    await say(peer, 'my number is 555');
    await untilSent(p, t, ch, peer, 3);
    // Each later turn carried the transcript so far.
    const turn3 = model.calls.filter((c) => !c.jsonMode).pop()!;
    expect(turn3.user).toContain('Customer: my name is Asha');
    expect(turn3.user).toContain('Customer: my number is 555');

    await say(peer, 'FINISH');
    const sent = await untilSent(p, t, ch, peer, 4);
    expect(sent[3]).toBe('Bye Asha on 555');
    const run = await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
    expect(run.end_reason).toBe('end_node');
    expect(model.calls.filter((c) => c.jsonMode)).toHaveLength(1);
  });

  it('a provider failure never fails the run: the customer gets the apology and the flow goes on', async () => {
    model.answer = () => 500;
    const f = await addFlow(p, t, {
      graph: graph(
        [
          node('t', 'trigger', {}, { isStart: true }),
          node('ai', 'ai', {}),
          node('m', 'message', { text: 'next step' }),
          node('z', 'end'),
        ],
        [edge('t', 'ai'), edge('ai', 'm'), edge('m', 'z')],
      ),
      trigger: { kind: 'keyword', keywords: 'boom' },
    });
    const peer = nextPeer();
    await say(peer, 'boom');
    expect(await untilSent(p, t, ch, peer, 2)).toEqual([
      "Sorry, I couldn't generate a reply right now. Please try again.",
      'next step',
    ]);
    expect((await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed')).status).toBe(
      'completed',
    );
  });

  it('with no AI key anywhere the step still completes, and the vendor is never called', async () => {
    await setPlatformKey(p, false);
    model.calls.length = 0;
    model.answer = () => 'never';
    try {
      const f = await addFlow(p, t, {
        graph: graph(
          [node('t', 'trigger', {}, { isStart: true }), node('ai', 'ai', {}), node('z', 'end')],
          [edge('t', 'ai'), edge('ai', 'z')],
        ),
        trigger: { kind: 'keyword', keywords: 'nokey' },
      });
      const peer = nextPeer();
      await say(peer, 'nokey');
      const run = await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
      expect(await sentTo(p, t, ch, peer)).toEqual([
        "Sorry, I couldn't generate a reply right now. Please try again.",
      ]);
      expect(model.calls).toHaveLength(0);
      expect((await steps(run.id)).some((s) => JSON.stringify(s.detail).includes('no_key'))).toBe(
        true,
      );
    } finally {
      await setPlatformKey(p, true);
    }
  });

  it('extraction in silent mode sends nothing and spreads the JSON for later nodes (multi-record)', async () => {
    model.answer = () => '{"rows":[{"item":"a"},{"item":"b"}]}';
    const f = await addFlow(p, t, {
      graph: graph(
        [
          node('t', 'trigger', {}, { isStart: true }),
          node('ai', 'ai', { extract: true, silent: true, fields: ['item'], variable: 'parse' }),
          node('m', 'message', { text: 'first={{parse.item}}' }),
          node('z', 'end'),
        ],
        [edge('t', 'ai'), edge('ai', 'm'), edge('m', 'z')],
      ),
      trigger: { kind: 'keyword', keywords: 'rowsplease' },
    });
    const peer = nextPeer();
    await say(peer, 'rowsplease');
    await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
    // The model sent {"rows":[...]} so the first record is only reachable under __rows; the wrapper keys are spread as JSON text.
    const run = await lastRun(f.id);
    expect(Array.isArray(run.vars['parse.__rows'])).toBe(true);
    expect(await sentTo(p, t, ch, peer)).toEqual(['first=']);
    expect(model.calls.at(-1)!.jsonMode).toBe(true);
    expect(model.calls.at(-1)!.maxTokens).toBe(4000);
  });
});

describe('Sub-flow', () => {
  it('swaps the graph in the same run, keeps the variables, and never comes back', async () => {
    const b = await addFlow(p, t, {
      graph: graph(
        [
          node('b1', 'message', { text: 'in B for {{name}}' }),
          node('b2', 'message', { text: 'B done' }),
          node('bz', 'end'),
        ],
        [edge('b1', 'b2'), edge('b2', 'bz')],
      ),
      trigger: { kind: 'keyword', keywords: 'bonly' },
    });
    const a = await addFlow(p, t, {
      graph: graph(
        [
          node('t', 'trigger', {}, { isStart: true }),
          node('a1', 'message', { text: 'in A' }),
          node('sub', 'subflow', { flowId: b.id }),
          node('a2', 'message', { text: 'back in A' }),
        ],
        [edge('t', 'a1'), edge('a1', 'sub'), edge('sub', 'a2')],
      ),
      trigger: { kind: 'keyword', keywords: 'runsub' },
    });
    const peer = nextPeer();
    await say(peer, 'runsub');
    const sent = await untilSent(p, t, ch, peer, 3);
    expect(sent).toEqual(['in A', 'in B for Asha', 'B done']);
    const run = await untilRun(p, t, a.id, 'completed', (r) => r.status === 'completed');
    expect(run.end_reason).toBe('end_node');
    // The run row keeps the graph it ended on, and the log names the sub flow.
    const row = await p.h.owner.query(`SELECT graph, flow_id FROM flow_runs WHERE id = $1`, [
      run.id,
    ]);
    expect((row.rows[0].graph.nodes as Array<{ id: string }>).map((n) => n.id)).toEqual([
      'b1',
      'b2',
      'bz',
    ]);
    expect(Number(row.rows[0].flow_id)).toBe(a.id);
    const log = await steps(run.id);
    expect(log.some((s) => s.detail.flow_id === b.id)).toBe(true);
    expect(await sentTo(p, t, ch, peer)).not.toContain('back in A');
  });

  it('refuses a draft flow, a paused flow, a missing flow and another workspace flow: the node is passed', async () => {
    const t2 = await p.api.signup('flrai2');
    const foreign = await addFlow(p, t2, {
      graph: graph([node('x', 'message', { text: 'LEAK' })], []),
    });
    const draft = await addFlow(p, t, {
      graph: graph([node('x', 'message', { text: 'draft' })], []),
      published: false,
    });
    const paused = await addFlow(p, t, {
      graph: graph([node('x', 'message', { text: 'paused' })], []),
      active: false,
    });
    const targets = [draft.id, paused.id, foreign.id, 987654321];
    for (const [i, target] of targets.entries()) {
      const a = await addFlow(p, t, {
        graph: graph(
          [
            node('t', 'trigger', {}, { isStart: true }),
            node('sub', 'subflow', { flowId: target }),
            node('a2', 'message', { text: 'carried on' }),
            node('z', 'end'),
          ],
          [edge('t', 'sub'), edge('sub', 'a2'), edge('a2', 'z')],
        ),
        trigger: { kind: 'keyword', keywords: `refuse${i}` },
      });
      const peer = nextPeer();
      await say(peer, `refuse${i}`);
      await untilRun(p, t, a.id, 'completed', (r) => r.status === 'completed');
      expect(await sentTo(p, t, ch, peer)).toEqual(['carried on']);
    }
  });

  it('a flow that calls itself is stopped by the depth guard, not left to loop', async () => {
    const f = await addFlow(p, t, {
      graph: graph(
        [node('t', 'trigger', {}, { isStart: true }), node('m', 'message', { text: 'tick' })],
        [edge('t', 'm')],
      ),
      trigger: { kind: 'keyword', keywords: 'selfcall' },
    });
    // The flow's own id is only known after it is saved: point it at itself.
    await p.h.owner.query(`UPDATE flows SET flow_data = $2::jsonb WHERE id = $1`, [
      f.id,
      JSON.stringify(
        graph(
          [
            node('t', 'trigger', {}, { isStart: true }),
            node('m', 'message', { text: 'tick' }),
            node('sub', 'subflow', { flowId: f.id }),
          ],
          [edge('t', 'm'), edge('m', 'sub')],
        ),
      ),
    ]);
    const peer = nextPeer();
    await say(peer, 'selfcall');
    const run = await untilRun(p, t, f.id, 'failed', (r) => r.status === 'failed', 60_000);
    expect(run.failure_reason).toContain('Sub-flows nested');
    const sent = await sentTo(p, t, ch, peer);
    expect(sent.length).toBeGreaterThanOrEqual(10);
    expect(sent.length).toBeLessThanOrEqual(12);
  }, 90_000);
});

describe('Chatbot hand-off', () => {
  it('with no AI agent engine the node is passed and the flow goes on', async () => {
    const f = await addFlow(p, t, {
      graph: graph(
        [
          node('t', 'trigger', {}, { isStart: true }),
          node('bot', 'chatbot', { agentId: '9' }),
          node('m', 'message', { text: 'after bot' }),
          node('z', 'end'),
        ],
        [edge('t', 'bot'), edge('bot', 'm'), edge('m', 'z')],
      ),
      trigger: { kind: 'keyword', keywords: 'nobot' },
    });
    const peer = nextPeer();
    await say(peer, 'nobot');
    await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
    expect(await sentTo(p, t, ch, peer)).toEqual(['after bot']);
  });

  it('when an agent takes the conversation the run ends as a takeover and says nothing more', async () => {
    const { AI_AGENT_HANDOFF_PORT } =
      await import('../../../src/infra/providers/flow-runtime-engine/ai-agent-handoff.port');
    const port = p.h.app.get(AI_AGENT_HANDOFF_PORT) as {
      handOff: (r: unknown) => Promise<unknown>;
    };
    const seen: unknown[] = [];
    const original = port.handOff;
    port.handOff = async (req) => {
      seen.push(req);
      return { ok: true, agentName: 'Sia', replied: true };
    };
    try {
      const f = await addFlow(p, t, {
        graph: graph(
          [
            node('t', 'trigger', {}, { isStart: true }),
            node('bot', 'chatbot', { agentId: '9' }),
            node('m', 'message', { text: 'should not be sent' }),
          ],
          [edge('t', 'bot'), edge('bot', 'm')],
        ),
        trigger: { kind: 'keyword', keywords: 'yesbot' },
      });
      const peer = nextPeer();
      await say(peer, 'yesbot');
      const run = await untilRun(p, t, f.id, 'completed', (r) => r.status === 'completed');
      expect(run.end_reason).toBe('takeover');
      expect(await sentTo(p, t, ch, peer)).toEqual([]);
      expect(seen[0]).toMatchObject({ orgId: t.orgId, agentId: '9', peerKey: peer });
    } finally {
      port.handOff = original;
    }
  });
});

describe('natural-language ordering (WD-FLR-042)', () => {
  const peer = '919800011122';
  let svc: import('../../../src/modules/flow-runtime-engine/runtime/nodes/ai/ordering.service').OrderingFlowService;
  let to: Tenant;
  const cart = async () =>
    (await p.h.owner.query(`SELECT * FROM wa_pending_orders WHERE org_id = $1`, [to.orgId]))
      .rows[0];
  const stock = async (sku: string) =>
    (
      await p.h.owner.query(
        `SELECT stock_qty, reserved_qty FROM wa_products WHERE org_id = $1 AND sku = $2`,
        [to.orgId, sku],
      )
    ).rows[0];

  beforeAll(async () => {
    to = await p.api.signup('flrorder');
    svc = p.h.app.get(
      (await import('../../../src/modules/flow-runtime-engine/runtime/nodes/ai/ordering.service'))
        .OrderingFlowService,
    );
    for (const [sku, name, price, qty, aliases] of [
      ['WNG', 'Chicken wings', 15000, 5, ['wings']],
      ['FRY', 'French fries', 8000, 1, []],
    ] as const) {
      await p.h.owner.query(
        `INSERT INTO wa_products (org_id, sku, name, price_minor, currency_code, stock_qty, status, aliases_json, slug)
         VALUES ($1, $2, $3, $4, 'INR', $5, 'active', $6::jsonb, $7)`,
        [to.orgId, sku, name, price, qty, JSON.stringify(aliases), sku.toLowerCase()],
      );
    }
    model.answer = (c) => {
      if (c.system.startsWith('A customer was shown their saved delivery address'))
        return '{"use_saved":false,"name":"Asha","company":"Acme","address":"1 Main St"}';
      if (c.system.startsWith("You convert a customer's WhatsApp message"))
        return c.user.includes('cancelme')
          ? '{"items":[{"name":"wings","qty":1}]}'
          : '{"items":[{"name":"wings","qty":2},{"name":"unicorn","qty":1},{"name":"french fries","qty":3}]}';
      return 'ok';
    };
  });

  it('parse matches products, holds stock, writes the cart and words the summary and the address prompt', async () => {
    const r = await system(to.orgId, () =>
      svc.parse(to.orgId, { customer_phone: peer, text: 'two wings, a unicorn, 3 fries' }),
    );
    expect(r.has_items).toBe(true);
    expect(r.order_ok).toBe('yes');
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ name: 'Chicken wings', qty: 2, price_minor: 15000 });
    expect(r.total_minor).toBe(30000);
    expect(r.unavailable).toEqual([
      { name: 'unicorn', qty: 1, reason: 'not_found', available: null },
      { name: 'French fries', qty: 3, reason: 'out_of_stock', available: 1 },
    ]);
    expect(r.summary).toContain('• 2 × Chicken wings — ₹ 300');
    expect(r.summary).toContain('• 3 × French fries — only 1 in stock');
    expect(r.ask_shipping).toBe(
      'To place your order, reply with your delivery address: your Name, Company (optional), and Full address.',
    );
    expect(await stock('WNG')).toMatchObject({ stock_qty: 5, reserved_qty: 2 });
    expect(await cart()).toMatchObject({
      status: 'pending',
      customer_phone: peer,
      total_minor: 30000,
    });
  });

  it('the address reply is split into name, company and address on the cart', async () => {
    const r = await system(to.orgId, () =>
      svc.shipping(to.orgId, { customer_phone: peer, text: 'Asha, Acme, 1 Main St' }),
    );
    expect(r.shipping).toBe('Asha\nAcme\n1 Main St');
    expect(await cart()).toMatchObject({
      ship_name: 'Asha',
      ship_company: 'Acme',
      ship_address: '1 Main St',
    });
  });

  it('confirm places the order, commits the stock and says what was ordered and where it goes', async () => {
    const r = await system(to.orgId, () =>
      svc.confirm(to.orgId, { customer_phone: peer, ship_text: 'Asha, Acme, 1 Main St' }),
    );
    expect(r.ok).toBe(true);
    expect(r.total_minor).toBe(30000);
    expect(r.summary).toBe(
      '*New order #' +
        r.order_id +
        '*\n• 2 × Chicken wings\n*Total: ₹ 300*\n*Ship to:* Asha, Acme, 1 Main St',
    );
    const order = (await p.h.owner.query(`SELECT * FROM wa_orders WHERE org_id = $1`, [to.orgId]))
      .rows[0];
    expect(order).toMatchObject({
      source: 'whatsapp_ai',
      status: 'pending',
      customer_phone: peer,
      customer_name: 'Asha',
      customer_address: '1 Main St',
    });
    expect(order.meta_json).toMatchObject({ ship_company: 'Acme' });
    const items = (
      await p.h.owner.query(
        `SELECT name, quantity, retailer_id FROM wa_order_items WHERE org_id = $1`,
        [to.orgId],
      )
    ).rows;
    expect(items).toEqual([{ name: 'Chicken wings', quantity: 2, retailer_id: 'WNG' }]);
    expect(await stock('WNG')).toMatchObject({ stock_qty: 3, reserved_qty: 0 });
    expect(await cart()).toMatchObject({ status: 'confirmed', order_id: r.order_id });
  });

  it('a second confirm finds no cart and answers 200 with a message, never a blank bubble', async () => {
    const r = await system(to.orgId, () => svc.confirm(to.orgId, { customer_phone: peer }));
    expect(r.ok).toBe(false);
    expect(r.error).toBe('no_pending_order');
    expect(r.summary).toContain('could not place your order');
  });

  it('a repeat customer is offered the address of their last order', async () => {
    const r = await system(to.orgId, () =>
      svc.parse(to.orgId, { customer_phone: peer, text: 'cancelme wings' }),
    );
    expect(r.saved_shipping).toMatchObject({ name: 'Asha', company: 'Acme', address: '1 Main St' });
    expect(r.ask_shipping).toContain('Please confirm your delivery address:');
    expect(r.ask_shipping).toContain('Reply YES to ship here, or send a new address.');
  });

  it('reply: cancel releases the stock, an unclear reply asks again and never cancels', async () => {
    expect(await stock('WNG')).toMatchObject({ reserved_qty: 1 });
    const unclear = await system(to.orgId, () =>
      svc.reply(to.orgId, {
        customer_phone: peer,
        text: 'what time do you open and is there parking nearby for my car',
      }),
    );
    expect(unclear.intent).toBe('unclear');
    expect(unclear.summary).toContain("didn't catch that");
    expect(await stock('WNG')).toMatchObject({ reserved_qty: 1 });

    const cancel = await system(to.orgId, () =>
      svc.reply(to.orgId, { customer_phone: peer, text: 'cancel please' }),
    );
    expect(cancel.intent).toBe('cancel');
    expect(cancel.summary).toContain('your order was cancelled');
    expect(await stock('WNG')).toMatchObject({ stock_qty: 3, reserved_qty: 0 });
    expect(await cart()).toMatchObject({ status: 'cancelled' });
  });

  it('reply: confirm places the order in one call', async () => {
    await system(to.orgId, () =>
      svc.parse(to.orgId, { customer_phone: peer, text: 'cancelme wings' }),
    );
    const r = await system(to.orgId, () =>
      svc.reply(to.orgId, { customer_phone: peer, text: 'yes' }),
    );
    expect(r.intent).toBe('confirm');
    expect(r.order_id).toBeTypeOf('number');
    expect(await stock('WNG')).toMatchObject({ stock_qty: 2, reserved_qty: 0 });
  });

  it('nothing matched: no cart is kept and the customer sees what is available', async () => {
    model.answer = () => '{"items":[{"name":"unicorn","qty":1}]}';
    const r = await system(to.orgId, () =>
      svc.parse(to.orgId, { customer_phone: '919800099999', text: 'a unicorn' }),
    );
    expect(r.has_items).toBe(false);
    expect(r.order_ok).toBe('no');
    expect(r.summary).toContain("Sorry, we can't take that order right now:");
    expect(r.summary).toContain('Here is what we have available right now:');
    expect(r.summary).toContain('Chicken wings');
    const gone = await p.h.owner.query(
      `SELECT 1 FROM wa_pending_orders WHERE org_id = $1 AND customer_phone = '919800099999'`,
      [to.orgId],
    );
    expect(gone.rows).toHaveLength(0);
  });

  it('a model failure reads as an empty order, not an error', async () => {
    model.answer = () => 500;
    const r = await system(to.orgId, () =>
      svc.parse(to.orgId, { customer_phone: '919800088888', text: 'wings' }),
    );
    expect(r.has_items).toBe(false);
    expect(r.items).toEqual([]);
  });

  it('is tenant isolated: another workspace sees none of this stock or carts', async () => {
    const other = await p.api.signup('flrorder2');
    model.answer = () => '{"items":[{"name":"wings","qty":1}]}';
    const r = await system(other.orgId, () =>
      svc.parse(other.orgId, { customer_phone: peer, text: 'wings' }),
    );
    expect(r.has_items).toBe(false);
    expect(r.unavailable[0]).toMatchObject({ reason: 'not_found' });
    const confirm = await system(other.orgId, () =>
      svc.confirm(other.orgId, { customer_phone: peer }),
    );
    expect(confirm.ok).toBe(false);
  });
});
