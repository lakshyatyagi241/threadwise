import type {
  FlowEdge,
  FlowNode,
  FlbTestWebhookRequest,
  FlbTestWebhookResponse,
} from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import { createSimulator, type LogEntry, type SimulatorOptions } from './simulator';
import { translator } from '../../test-utils/intl';

const node = (
  id: string,
  type: string,
  data: Record<string, unknown> = {},
  extra: Partial<FlowNode> = {},
): FlowNode => ({
  id,
  type,
  x: 0,
  y: 0,
  data: data,
  ...extra,
});
const edge = (source: string, sourceHandle: string, target: string): FlowEdge => ({
  id: `${source}-${sourceHandle}-${target}`,
  source,
  sourceHandle,
  target,
});

function harness(nodes: FlowNode[], edges: FlowEdge[], over: Partial<SimulatorOptions> = {}) {
  const log: LogEntry[] = [];
  const queue: Array<() => void> = [];
  let awaiting = false;
  const sim = createSimulator({
    t: translator('flb'),
    nodes,
    edges,
    callWebhook: () => Promise.resolve({ ok: false, error: 'unused' }),
    schedule: (fn) => void queue.push(fn),
    onLog: (e) => void log.push(e),
    onReset: () => void (log.length = 0),
    onAwaiting: (b) => void (awaiting = b),
    random: () => 0,
    ...over,
  });
  /** Run scheduled steps (and the microtasks of webhook calls) until quiet. */
  const settle = async () => {
    for (let i = 0; i < 50; i++) {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      const fn = queue.shift();
      if (!fn) {
        await Promise.resolve();
        if (queue.length === 0) return;
        continue;
      }
      fn();
    }
  };
  return { sim, log, settle, awaiting: () => awaiting, texts: () => log.map((l) => l.text) };
}

describe('simulator: start', () => {
  it('empty canvas', () => {
    const h = harness([], []);
    h.sim.start();
    expect(h.texts()).toEqual([
      'Canvas is empty. Add a trigger and at least one node, then click Restart.',
    ]);
    expect(h.awaiting()).toBe(false);
  });

  it('hints at the first keyword, else any message', () => {
    const a = harness([node('t', 'trigger', { keywords: 'hi, hello' })], []);
    a.sim.start();
    expect(a.texts()).toEqual(['Type "hi" (or any keyword: hi, hello) to start the flow.']);
    expect(a.awaiting()).toBe(true);
    const b = harness([node('t', 'trigger')], []);
    b.sim.start();
    expect(b.texts()).toEqual(['Type any message to start the flow.']);
  });

  it('off-keyword first message runs anyway with a note', async () => {
    const h = harness(
      [
        node('t', 'trigger', { keywords: 'hi' }),
        node('m', 'message', { text: 'ok {{user_message}}' }),
      ],
      [edge('t', 'out', 'm')],
    );
    h.sim.start();
    h.sim.send('zzz');
    await h.settle();
    expect(h.texts()).toContain("(message didn't match any keyword — running anyway for testing)");
    expect(h.texts()).toContain('ok zzz');
    expect(h.texts().at(-1)).toBe('No path forward — stop.');
  });

  it('start node precedence: pinned start > first trigger > node 0', async () => {
    const mk = (nodes: FlowNode[]) => {
      const h = harness(nodes, []);
      h.sim.start();
      h.sim.send('go');
      return h;
    };
    const pinned = mk([
      node('a', 'message', { text: 'A' }),
      node('t', 'trigger'),
      node('p', 'message', { text: 'P' }, { isStart: true }),
    ]);
    await pinned.settle();
    expect(pinned.texts()).toContain('P');
    const trig = mk([
      node('a', 'message', { text: 'A' }),
      node('t', 'trigger'),
      node('b', 'message', { text: 'B' }),
    ]);
    await trig.settle();
    expect(trig.texts()).not.toContain('A');
    const zero = mk([node('a', 'message', { text: 'A' }), node('b', 'message', { text: 'B' })]);
    await zero.settle();
    expect(zero.texts()).toContain('A');
  });
});

describe('simulator: nodes', () => {
  it('Trigger -> Ask(name) -> Message "Hi {{name}}"', async () => {
    const h = harness(
      [
        node('t', 'trigger'),
        node('a', 'ask', { prompt: 'Your name?', var: 'name' }),
        node('m', 'message', { text: 'Hi {{name}}' }),
      ],
      [edge('t', 'out', 'a'), edge('a', 'out', 'm')],
    );
    h.sim.start();
    h.sim.send('hello');
    expect(h.awaiting()).toBe(false);
    await h.settle();
    expect(h.awaiting()).toBe(true);
    h.sim.send('Sam');
    await h.settle();
    expect(h.log.map((l) => `${l.kind}:${l.text}`)).toEqual([
      'system:Type any message to start the flow.',
      'user:hello',
      'bot:Your name?',
      'user:Sam',
      'bot:Hi Sam',
      'system:No path forward — stop.',
    ]);
  });

  it('unknown variables stay literal; defaults name/phone exist', async () => {
    const h = harness(
      [node('t', 'trigger'), node('m', 'message', { text: '{{ name }} {{phone}} {{nope}}' })],
      [edge('t', 'out', 'm')],
    );
    h.sim.start();
    h.sim.send('x');
    await h.settle();
    expect(h.texts()).toContain('Anya +919876543210 {{nope}}');
  });

  it('ask with expected answers routes p<i> case-insensitively, else otherwise', async () => {
    const nodes = [
      node('t', 'trigger'),
      node('a', 'ask', { prompt: 'Q', options: ['Yes', 'No'] }),
      node('y', 'message', { text: 'YES' }),
      node('e', 'message', { text: 'ELSE' }),
    ];
    const edges = [edge('t', 'out', 'a'), edge('a', 'p0', 'y'), edge('a', 'else', 'e')];
    const h = harness(nodes, edges);
    h.sim.start();
    h.sim.send('go');
    await h.settle();
    h.sim.send('yes');
    await h.settle();
    expect(h.texts()).toContain('YES');
    const g = harness(nodes, edges);
    g.sim.start();
    g.sim.send('go');
    await g.settle();
    g.sim.send('maybe');
    await g.settle();
    expect(g.texts()).toContain('ELSE');
    const u = harness(nodes, [edge('t', 'out', 'a')]);
    u.sim.start();
    u.sim.send('go');
    await u.settle();
    u.sim.send('maybe');
    expect(u.texts().at(-1)).toBe('Port "else" not connected — stop.');
  });

  it('condition with an unset var takes NO; AND/OR chain and legacy shape', async () => {
    const run = async (cond: Record<string, unknown>) => {
      const h = harness(
        [
          node('t', 'trigger'),
          node('c', 'condition', cond),
          node('y', 'message', { text: 'Y' }),
          node('n', 'message', { text: 'N' }),
        ],
        [edge('t', 'out', 'c'), edge('c', 'yes', 'y'), edge('c', 'no', 'n')],
      );
      h.sim.start();
      h.sim.send('go');
      await h.settle();
      return h.texts();
    };
    const no = await run({ conditions: [{ variable: 'plan', operator: 'equals', value: 'pro' }] });
    expect(no).toContain('if plan equals pro → NO');
    expect(no).toContain('N');
    const or = await run({
      conditions: [
        { variable: 'plan', operator: 'equals', value: 'pro' },
        { variable: 'name', operator: 'equals', value: 'Anya' },
      ],
      operators: ['OR'],
    });
    expect(or).toContain('if plan equals pro OR name equals Anya → YES');
    const and = await run({
      conditions: [
        { variable: 'name', operator: 'contains', value: 'ANY' },
        { variable: 'plan', operator: 'exists' },
      ],
    });
    expect(and).toContain('if name contains ANY AND plan exists  → NO');
    const legacy = await run({ var: 'name', op: 'equals', value: 'Anya' });
    expect(legacy).toContain('Y');
    const empty = await run({});
    expect(empty).toContain('N');
  });

  it('condition with a nested conditionGroup wins over the flat chain', async () => {
    const run = async (cond: Record<string, unknown>) => {
      const h = harness(
        [
          node('t', 'trigger'),
          node('c', 'condition', cond),
          node('y', 'message', { text: 'Y' }),
          node('n', 'message', { text: 'N' }),
        ],
        [edge('t', 'out', 'c'), edge('c', 'yes', 'y'), edge('c', 'no', 'n')],
      );
      h.sim.start();
      h.sim.send('go');
      await h.settle();
      return h.texts();
    };
    const r = (variable: string, operator: string, value = '') => ({ variable, operator, value });
    const log = await run({
      conditions: [r('name', 'equals', 'nobody')],
      conditionGroup: {
        op: 'and',
        items: [
          r('name', 'exists'),
          { op: 'or', items: [r('plan', 'equals', 'pro'), r('name', 'contains', 'any')] },
        ],
      },
    });
    expect(log).toContain('if {{name}} is set AND ({{plan}} = pro OR {{name}} ⊆ any) → YES');
    const empty = await run({
      conditions: [r('name', 'exists')],
      conditionGroup: { op: 'and', items: [] },
    });
    expect(empty).toContain('N');
  });

  it('condition operators gt/lt/not_equals/not_contains', async () => {
    const run = async (operator: string, value: string, variable = 'phone') => {
      const h = harness(
        [
          node('t', 'trigger'),
          node('c', 'condition', { conditions: [{ variable, operator, value }] }),
        ],
        [edge('t', 'out', 'c')],
      );
      h.sim.start();
      h.sim.send('go');
      await h.settle();
      return h.texts().find((x) => x.startsWith('if '));
    };
    expect(await run('gt', '5', 'user_message')).toMatch(/NO$/);
    expect(await run('not_equals', 'x', 'name')).toMatch(/YES$/);
    expect(await run('not_contains', 'zzz', 'name')).toMatch(/YES$/);
    expect(await run('lt', '1', 'name')).toMatch(/NO$/);
  });

  it('buttons: number and title matching, unwired port message', async () => {
    const nodes = [
      node('t', 'trigger'),
      node('b', 'buttons', { prompt: 'Pick', options: ['One', 'Two'], var: 'choice' }),
      node('m0', 'message', { text: 'got {{choice}}' }),
    ];
    const edges = [edge('t', 'out', 'b'), edge('b', 'p0', 'm0')];
    const prompt = async () => {
      const h = harness(nodes, edges);
      h.sim.start();
      h.sim.send('go');
      await h.settle();
      return h;
    };
    const a = await prompt();
    expect(a.texts()).toContain('Pick\n  1. One\n  2. Two');
    a.sim.send('one');
    await a.settle();
    expect(a.texts()).toContain('got One');
    const b = await prompt();
    b.sim.send('1');
    await b.settle();
    expect(b.texts()).toContain('got One');
    const c = await prompt();
    c.sim.send('nonsense');
    await c.settle();
    expect(c.texts()).toContain('got One');
    const d = await prompt();
    d.sim.send('2');
    expect(d.texts().at(-1)).toBe('Port "p1" (option 2) not connected — stop.');
  });

  it('list: item titles are saved, never [object Object]', async () => {
    const h = harness(
      [
        node('t', 'trigger'),
        node('l', 'list', {
          prompt: 'Pick',
          var: 'choice',
          options: [{ title: 'Alpha', description: 'first', section: 'S' }, { title: 'Beta' }],
        }),
        node('m', 'message', { text: 'chose {{choice}}' }),
      ],
      [edge('t', 'out', 'l'), edge('l', 'p1', 'm')],
    );
    h.sim.start();
    h.sim.send('go');
    await h.settle();
    expect(h.texts()).toContain('Pick\n  1. Alpha — first   [S]\n  2. Beta');
    h.sim.send('2');
    await h.settle();
    expect(h.texts()).toContain('chose Beta');
    expect(h.texts().join('\n')).not.toContain('[object Object]');
  });

  it('template with quick replies awaits a tap and routes p<i>', async () => {
    const nodes = [
      node('t', 'trigger'),
      node('tp', 'template', { tpl: 'promo', preview: 'Hello' }),
      node('m', 'message', { text: 'B' }),
    ];
    const h = harness(nodes, [edge('t', 'out', 'tp'), edge('tp', 'p1', 'm')], {
      templateButtons: () => [{ label: 'Yes' }, { label: 'No' }],
    });
    h.sim.start();
    h.sim.send('go');
    await h.settle();
    expect(h.texts()).toContain('[template: promo]\nHello\n  1. Yes\n  2. No');
    h.sim.send('no');
    await h.settle();
    expect(h.texts()).toContain('B');
    const g = harness(nodes, [edge('t', 'out', 'tp')], {
      templateButtons: () => [{ label: 'Yes' }],
    });
    g.sim.start();
    g.sim.send('go');
    await g.settle();
    g.sim.send('1');
    expect(g.texts().at(-1)).toBe('Button "Yes" not connected — stop.');
  });

  it('commerce: number purchases, anything else abandons, no products abandons', async () => {
    const nodes = [
      node('t', 'trigger'),
      node('s', 'shopify', {
        productItems: [{ retailer_id: 'sku1', name: 'Mug', price_minor: 1250, currency: 'USD' }],
      }),
      node('p', 'message', {
        text: 'order {{order_id}} {{order_total}} {{order_currency}} {{commerce_choice}}',
      }),
      node('a', 'message', { text: 'abandoned' }),
    ];
    const edges = [edge('t', 'out', 's'), edge('s', 'purchased', 'p'), edge('s', 'abandoned', 'a')];
    const h = harness(nodes, edges);
    h.sim.start();
    h.sim.send('go');
    await h.settle();
    expect(h.texts().find((x) => x.startsWith('[shopify]'))).toContain('1. Mug · 12.50 USD');
    h.sim.send('1');
    await h.settle();
    expect(h.texts()).toContain('Simulated purchase: Mug → port "purchased"');
    expect(h.texts()).toContain('order TEST-1000 12.5 USD sku1');
    const g = harness(nodes, edges);
    g.sim.start();
    g.sim.send('go');
    await g.settle();
    g.sim.send('later');
    await g.settle();
    expect(g.texts()).toContain('Simulated abandon → port "abandoned"');
    expect(g.texts()).toContain('abandoned');
    const e = harness([node('t', 'trigger'), node('s', 'whatsapp_shop')], [edge('t', 'out', 's')]);
    e.sim.start();
    e.sim.send('go');
    await e.settle();
    expect(e.texts()).toContain('No products on commerce node — taking abandoned port.');
    expect(e.texts().at(-1)).toBe('No path forward (port "abandoned") — stop.');
  });

  it('sequence renders media bubbles and a caption', async () => {
    const h = harness(
      [
        node('t', 'trigger'),
        node('s', 'sequence', {
          replies: [
            { type: 'text', text: 'Hi {{name}}' },
            { type: 'image', url: '/uploads/a.png', caption: 'Look', filename: 'a.png' },
            { type: 'document', url: '/uploads/b.pdf' },
          ],
        }),
        node('m', 'media', { kind: 'video', url: '/v.mp4' }),
      ],
      [edge('t', 'out', 's'), edge('s', 'out', 'm')],
    );
    h.sim.start();
    h.sim.send('go');
    await h.settle();
    expect(h.log.filter((l) => l.kind === 'bot')).toEqual([
      { kind: 'bot', text: 'Hi Anya' },
      {
        kind: 'bot',
        text: 'Look',
        media: { kind: 'image', url: '/uploads/a.png', filename: 'a.png' },
      },
      { kind: 'bot', text: '', media: { kind: 'document', url: '/uploads/b.pdf', filename: '' } },
      { kind: 'bot', text: '', media: { kind: 'video', url: '/v.mp4', filename: '' } },
    ]);
  });

  it('end, delay, mocked nodes and the unknown-type fallback', async () => {
    const h = harness(
      [
        node('t', 'trigger'),
        node('d', 'delay', { amount: 5, unit: 'minutes' }),
        node('x', 'cf_say'),
        node('s', 'subflow', { flow: '7' }),
        node('e', 'end'),
      ],
      [edge('t', 'out', 'd'), edge('d', 'out', 'x'), edge('x', 'out', 's'), edge('s', 'out', 'e')],
      { flowName: (id) => (id === '7' ? 'Welcome' : undefined) },
    );
    h.sim.start();
    h.sim.send('go');
    await h.settle();
    expect(h.texts()).toEqual([
      'Type any message to start the flow.',
      'go',
      'wait 5 minutes (skipped in test)',
      '(unknown node type "cf_say" — skipping)',
      'run sub-flow "Welcome" (skipped in test)',
      'Flow ended.',
    ]);
    expect(h.awaiting()).toBe(false);
    expect(h.sim.current()).toBeNull();
  });
});

describe('simulator: integration and channel nodes (copy verified against the running Reference)', () => {
  const chain = (nodes: FlowNode[], handles: Record<string, string> = {}) => {
    const all = [node('t', 'trigger'), ...nodes];
    const edges = all
      .slice(0, -1)
      .map((n, i) => edge(n.id, handles[n.id] ?? 'out', all[i + 1]!.id));
    return harness(all, edges);
  };

  it('book_appointment lists the sample slots (slotCount clamped to 1..10 of the 5 samples) and takes booked', async () => {
    const h = chain(
      [node('b', 'book_appointment', { slotCount: 3, prompt: 'Choose' }), node('e', 'end')],
      { b: 'booked' },
    );
    h.sim.start();
    h.sim.send('x');
    await h.settle();
    expect(h.texts()).toContain(
      'Choose\n  1. Mon 20 May · 10:00 AM\n  2. Mon 20 May · 11:30 AM\n  3. Tue 21 May · 9:00 AM',
    );
    expect(h.texts()).toContain('(simulated) customer picks slot 1 → booked');
    expect(h.texts().at(-1)).toBe('Flow ended.');
    const many = chain([node('b', 'book_appointment', { slotCount: 99 }), node('e', 'end')], {
      b: 'booked',
    });
    many.sim.start();
    many.sim.send('x');
    await many.settle();
    expect(
      many
        .texts()
        .find((t) => t.startsWith('Pick a time:'))!
        .split('\n'),
    ).toHaveLength(6);
  });

  it('google_form, deal, wa_form, notify_number, wa_to_instagram, cta and location log what the runtime would do', async () => {
    const h = chain(
      [
        node('f', 'google_form', { formId: 'F1', bodyText: 'Fill {{name}}' }),
        node('d', 'deal', {
          action: 'move',
          stageId: '3',
          dealName: 'Deal for {{name}}',
          value: '10',
        }),
        node('w', 'wa_form', { formTitle: 'Survey' }),
        node('n', 'notify_number', { copyNumber: '+911', kind: 'text', text: 'Hi {{name}}' }),
        node('i', 'wa_to_instagram', { igUsername: '@shop', introText: 'Follow us' }),
        node('c', 'cta', { kind: 'url', label: 'Go', url: 'https://x.y' }),
        node('l', 'location', { name: 'HQ', address: '1 Road', lat: '12.5', lng: '77.1' }),
        node('e', 'end'),
      ],
      { f: 'submitted', d: 'created' },
    );
    h.sim.start();
    h.sim.send('x');
    await h.settle();
    expect(h.texts()).toEqual([
      'Type any message to start the flow.',
      'x',
      'Fill Anya\n\nhttps://docs.google.com/forms/d/F1/viewform',
      '(simulated) form submitted → submitted port',
      '[CRM] move contact deal to stage 3 — "Deal for Anya" · 10 (skipped in test)',
      'Please complete this form:',
      '(simulated) published Meta form Survey sent → out',
      'Copy sent to +911: Hi Anya',
      'Follow us\nhttps://ig.me/m/shop',
      '(CTA)\n[url] Go → https://x.y',
      '(location) HQ\n1 Road\nlat 12.5, lng 77.1',
      'Flow ended.',
    ]);
  });

  it('code, mysql, ai, tag, assign, chatbot, google_sheets and google_docs are mocked lines', async () => {
    const h = chain([
      node('c', 'code', { save: 'r' }),
      node('m', 'mysql', {
        database: 'shop',
        sql: 'SELECT * FROM orders WHERE id = 1 AND status = "open" LIMIT 5',
      }),
      node('a', 'ai', { model: 'gpt-4o' }),
      node('g', 'tag', { action: 'remove', tag: 'vip' }),
      node('s', 'assign', { team: 'Sales', userId: '9' }),
      node('b', 'chatbot', { bot: 'Helper' }),
      node('gs', 'google_sheets', {
        mode: 'read',
        sheetId: 'abcdefghijklmnop',
        matchColumn: 'A',
        matchValue: '{{phone}}',
      }),
      node('gd', 'google_docs', { templateId: 'tpl1234567890', newTitle: 'Doc {{name}}' }),
      node('e', 'end'),
    ]);
    h.sim.start();
    h.sim.send('x');
    await h.settle();
    expect(h.texts().slice(2)).toEqual([
      'run JS → {{r}} (mocked — runs live only)',
      'query shop: SELECT * FROM orders WHERE id = 1 AND status = "… (mocked)',
      '[gpt-4o] (simulated reply)',
      'remove tag "vip"',
      'assigned to team "Sales" user 9',
      '[chatbot: Helper] (simulated)',
      '[Google Sheets · READ] Lookup row where A="+919876543210" in abcdefghij… (skipped in test)',
      '[Google Docs] copy template tpl1234567… → "Doc Anya" (mocked URL)',
      "Here's your document: https://docs.google.com/document/d/MOCKED/edit",
      'Flow ended.',
    ]);
  });
});

describe('simulator: location', () => {
  const run = async (data: Record<string, unknown>) => {
    const h = harness([node('t', 'trigger'), node('l', 'location', data)], [edge('t', 'out', 'l')]);
    h.sim.start();
    h.sim.send('x');
    await h.settle();
    return h.texts().slice(2, 3);
  };
  it('shows the pin the runtime would send, name and address optional', async () => {
    expect(await run({ title: 'HQ', address: '1 Road', lat: '12.5', lng: '77.1' })).toEqual([
      '(location) HQ\n1 Road\nlat 12.5, lng 77.1',
    ]);
    expect(
      await run({
        locMode: 'link',
        mapsUrl: 'https://maps.google.com/?q=1.5,2.5',
        lat: '1.5',
        lng: '2.5',
      }),
    ).toEqual(['(location) \n\nlat 1.5, lng 2.5']);
  });
  it('says the step is skipped when it has no real coordinates, like the runtime', async () => {
    for (const data of [{}, { lat: '0', lng: '0' }, { lat: '95', lng: '1' }])
      expect(await run(data)).toEqual(['(location) skipped: no valid coordinates']);
  });
});

describe('simulator: webhook', () => {
  const flow = (data: Record<string, unknown>) => ({
    nodes: [
      node('t', 'trigger'),
      node('w', 'webhook', data),
      node('m', 'message', { text: 'after {{response}} {{response.name}} {{response.nested}}' }),
    ],
    edges: [edge('t', 'out', 'w'), edge('w', 'out', 'm')],
  });

  it('private IP shows the failure and the flow continues via out', async () => {
    const calls: FlbTestWebhookRequest[] = [];
    const { nodes, edges } = flow({ url: 'http://169.254.169.254/x' });
    const h = harness(nodes, edges, {
      callWebhook: (r) => {
        calls.push(r);
        return Promise.resolve({
          ok: false,
          error: 'Blocked: host resolves to a private/reserved IP (169.254.169.254)',
        });
      },
    });
    h.sim.start();
    h.sim.send('go');
    await h.settle();
    expect(calls).toHaveLength(1);
    expect(h.texts()).toContain('Calling POST http://169.254.169.254/x …');
    expect(h.texts()).toContain(
      'webhook failed: Blocked: host resolves to a private/reserved IP (169.254.169.254)',
    );
    expect(h.texts()).toContain('after  {{response.name}} {{response.nested}}');
  });

  it('saves the response text and flattens JSON fields', async () => {
    const { nodes, edges } = flow({ url: 'https://x.test/{{ name }}', method: 'GET' });
    let seen: FlbTestWebhookRequest | undefined;
    const reply: FlbTestWebhookResponse = {
      ok: true,
      status: 200,
      success: true,
      response: '{"name":"Zed","nested":{"a":1}}',
      json: { name: 'Zed', nested: { a: 1 } },
    };
    const h = harness(nodes, edges, {
      callWebhook: (r) => {
        seen = r;
        return Promise.resolve(reply);
      },
    });
    h.sim.start();
    h.sim.send('go');
    await h.settle();
    expect(seen?.url).toBe('https://x.test/{{ name }}');
    expect(seen?.vars).toMatchObject({ name: 'Anya' });
    expect(h.texts()).toContain('Calling GET https://x.test/Anya …');
    expect(h.texts()).toContain('← HTTP 200 · saved to {{response}}');
    expect(h.texts()).toContain('after {"name":"Zed","nested":{"a":1}} Zed {"a":1}');
  });

  it('no URL is skipped; a thrown error is logged and continues', async () => {
    const a = flow({ url: '  ' });
    const h = harness(a.nodes, a.edges);
    h.sim.start();
    h.sim.send('go');
    await h.settle();
    expect(h.texts()).toContain('webhook has no URL — skipped');
    expect(h.texts()).toContain('after {{response}} {{response.name}} {{response.nested}}');
    const b = flow({ url: 'https://x.test' });
    const g = harness(b.nodes, b.edges, { callWebhook: () => Promise.reject(new Error('boom')) });
    g.sim.start();
    g.sim.send('go');
    await g.settle();
    expect(g.texts()).toContain('webhook error: boom');
    expect(g.texts()).toContain('after  {{response.name}} {{response.nested}}');
  });

  it('a restart while the request is in flight does not continue the old run', async () => {
    const { nodes, edges } = flow({ url: 'https://x.test' });
    let resolve: (r: FlbTestWebhookResponse) => void = () => undefined;
    const h = harness(nodes, edges, {
      callWebhook: () => new Promise<FlbTestWebhookResponse>((res) => void (resolve = res)),
    });
    h.sim.start();
    h.sim.send('go');
    await h.settle();
    expect(h.texts().at(-1)).toBe('Calling POST https://x.test …');
    h.sim.start();
    resolve({ ok: true, status: 200, success: true, response: 'late', json: null });
    await h.settle();
    expect(h.texts()).toEqual(['Type any message to start the flow.']);
    expect(h.awaiting()).toBe(true);
  });
});

describe('Ask for file / image and Ask for location in the test runner (TW-FLB-081, 082)', () => {
  const flow = (type: 'ask_file' | 'ask_location', data: Record<string, unknown>) =>
    harness(
      [
        node('t', 'trigger', { keywords: 'hi' }, { isStart: true }),
        node('a', type, data),
        node('m', 'message', { text: 'file={{file}} loc={{location}} st={{file_status}}' }),
      ],
      [edge('t', 'out', 'a'), edge('a', 'out', 'm')],
    );

  const open = async (h: ReturnType<typeof flow>) => {
    h.sim.start();
    h.sim.send('hi');
    await h.settle();
  };

  it('ask_file: asks, waits, saves a sample file to the variables and moves on by its one port', async () => {
    const h = flow('ask_file', { prompt: 'Send the ID', var: 'file', extensions: [] });
    await open(h);
    expect(h.texts()).toContain('Send the ID');
    expect(h.awaiting()).toBe(true);
    h.sim.sendFile({ name: 'id.pdf', mime: 'application/pdf', caption: 'mine' });
    await h.settle();
    expect(h.sim.vars()).toMatchObject({
      file: 'chatmedia:test-id.pdf',
      file_kind: 'document',
      file_name: 'id.pdf',
      file_mime: 'application/pdf',
      file_caption: 'mine',
      file_status: 'received',
    });
    expect(h.texts()).toContain('file=chatmedia:test-id.pdf loc={{location}} st=received');
  });

  it('ask_file: a file outside the allow-list is a wrong reply, a typed text too, then it gives up and continues', async () => {
    const h = flow('ask_file', {
      prompt: 'Send',
      extensions: ['png'],
      retries: 1,
      wrongReply: 'PNG only',
    });
    await open(h);
    h.sim.sendFile({ name: 'a.pdf', mime: 'application/pdf' });
    await h.settle();
    expect(h.texts()).toContain('PNG only');
    expect(h.awaiting()).toBe(true);
    h.sim.send('here you go');
    await h.settle();
    expect(h.sim.vars()).toMatchObject({ file: '', file_status: 'failed' });
    expect(h.texts()).toContain('file= loc={{location}} st=failed');
  });

  it('ask_file: a png photo with no name passes on its mime type', async () => {
    const h = flow('ask_file', { prompt: 'Send', extensions: ['png'] });
    await open(h);
    h.sim.sendFile({ name: '', mime: 'image/png' });
    await h.settle();
    expect(h.sim.vars().file_status).toBe('received');
  });

  it('ask_file: the skip word moves on; onFail "end" stops the run', async () => {
    const a = flow('ask_file', { prompt: 'Send', skipKeyword: 'skip' });
    await open(a);
    a.sim.send('Skip');
    await a.settle();
    expect(a.sim.vars()).toMatchObject({ file: '', file_status: 'skipped' });

    const b = flow('ask_file', { prompt: 'Send', retries: 0, onFail: 'end' });
    await open(b);
    b.sim.send('no');
    await b.settle();
    expect(b.texts().some((t) => t.includes('flow ends here'))).toBe(true);
    expect(b.texts().some((x) => x.includes('st='))).toBe(false);
  });

  it('ask_location: saves the maps link, latitude, longitude, name and address', async () => {
    const h = flow('ask_location', { prompt: 'Where?', var: 'location' });
    await open(h);
    expect(h.texts()).toContain('Where?');
    h.sim.sendLocation({ latitude: 12.9, longitude: 77.5, name: 'Cafe', address: '1 Main St' });
    await h.settle();
    expect(h.sim.vars()).toMatchObject({
      location: 'https://www.google.com/maps?q=12.9,77.5',
      location_latitude: '12.9',
      location_longitude: '77.5',
      location_name: 'Cafe',
      location_address: '1 Main St',
      location_status: 'received',
    });
  });

  it('ask_location: text and files are wrong replies; a file sent to the location node does nothing', async () => {
    const h = flow('ask_location', { prompt: 'Where?', retries: 2, wrongReply: 'Use the + menu' });
    await open(h);
    h.sim.send('Bangalore');
    await h.settle();
    expect(h.texts()).toContain('Use the + menu');
    h.sim.sendFile({ name: 'x.png', mime: 'image/png' });
    await h.settle();
    expect(h.awaiting()).toBe(true);
    expect(h.texts().filter((t) => t === 'Use the + menu')).toHaveLength(1);
  });
});

describe('simulator: Answer from FAQ', () => {
  const run = async (handles: string[]) => {
    const nodes = [
      node('t', 'trigger'),
      node('f', 'faq', { query: '{{user_message}}', save: 'kb' }),
      node('yes', 'message', { text: 'ANSWERED PATH' }),
      node('no', 'message', { text: 'NO MATCH PATH' }),
    ];
    const edges = [
      edge('t', 'out', 'f'),
      ...(handles.includes('matched') ? [edge('f', 'matched', 'yes')] : []),
      ...(handles.includes('no_match') ? [edge('f', 'no_match', 'no')] : []),
    ];
    const h = harness(nodes, edges);
    h.sim.start();
    h.sim.send('hello');
    await h.settle();
    return h;
  };

  it('takes the no match exit (the test chat does not search the knowledge base), even when the answered exit is connected, and says so', async () => {
    const h = await run(['matched', 'no_match']);
    const texts = h.texts();
    expect(texts.find((t) => t.startsWith('(simulated) Answer from FAQ'))).toContain(
      'not searched',
    );
    expect(texts).toContain('NO MATCH PATH');
    expect(texts).not.toContain('ANSWERED PATH');
  });

  it('stops with the usual note when the no match exit is not connected', async () => {
    const h = await run(['matched']);
    expect(h.texts().some((t) => t.includes('No path forward (port "no_match")'))).toBe(true);
  });
});
