import { describe, expect, it } from 'vitest';
import {
  FLB_NODE_TYPE_LIST,
  flbDefaultNodeData,
  flbNormalizeGraph,
  flbRuntimeNodeData,
  type FlowGraph,
  type FlowType,
} from '@crm/contracts';
import { compileGraph } from '../../../src/modules/flow-runtime-engine/graph/compile-graph';
import { FlowReaderService } from '../../../src/modules/flow-builder-editor/flow-reader.service';

/**
 * The FIELD seam between the editor and the runtime (WD-FLB-030..050, 061, 070 + WD-FLR-013): the data keys the inspector forms save
 * (WaDesk's builder vocabulary) against the keys the runtime executors read after `compileGraph`. WaDesk's FlowNormalizer renamed
 * them on the way (save -> variable, lat/lng -> latitude/longitude, multi -> allowMultiple, a comma string of fields -> an array, ...).
 * `flbToRuntimeData` is that translation on our side (packages/contracts, runtime-shape.ts) and `FlowReaderService.getRunnableFlow`
 * returns the graph through it; these tests run the shaped graph through the runtime's REAL `compileGraph` and assert the name each
 * executor reads, so a wrong or missing name fails loudly here.
 */

function graphOf(type: string, overrides: Record<string, unknown>): FlowGraph {
  const node = { id: 'n1', type, x: 0, y: 0, data: { ...flbDefaultNodeData(type), ...overrides } };
  const trigger = {
    id: 't',
    type: 'trigger',
    x: 0,
    y: 0,
    data: flbDefaultNodeData('trigger'),
    isStart: true,
  };
  return flbNormalizeGraph({
    flowNodes: [trigger, node],
    flowEdges: [{ id: 'e', source: 't', sourceHandle: 'out', target: 'n1' }],
  });
}

type Read = Record<string, unknown>;

/** The node as an executor sees it: the shaped props, or for a type the compiler does not shape, the raw `data` bag merged flat. */
function readOf(g: FlowGraph): { props: Read; read: Read } {
  const n = compileGraph(g).nodes.find((x) => x.id === 'n1')!;
  const raw = (n.props.data ?? {}) as Read;
  return { props: n.props, read: { ...n.props, ...raw } };
}

/** What the runtime reads once the reader has shaped the graph (the production path). */
const compiled = (type: string, overrides: Read = {}) =>
  readOf(flbRuntimeNodeData(graphOf(type, overrides)));
/** What `compileGraph` reads from the saved graph alone: it calls the shaper itself, so the reader's shaping changes nothing. */
const compiledRaw = (type: string, overrides: Read = {}) => readOf(graphOf(type, overrides));

describe('editor fields the runtime reads (already matching, and still matching after the shaper)', () => {
  it('message: the text becomes the single Text reply', () => {
    expect(compiled('message', { text: 'Hi' }).props.replies).toEqual([
      { type: 'Text', data: 'Hi' },
    ]);
  });

  it('sequence: every reply keeps its kind, url, filename and caption', () => {
    const r = compiled('sequence', {
      replies: [
        { type: 'text', text: 'a' },
        { type: 'image', url: 'https://x/y.png', filename: 'y.png', caption: 'c' },
      ],
    }).props.replies;
    expect(r).toEqual([
      { type: 'Text', data: 'a' },
      { type: 'Image', data: 'https://x/y.png', filename: 'y.png', caption: 'c' },
    ]);
  });

  it('media: kind, url, caption and filename', () => {
    expect(
      compiled('media', {
        kind: 'document',
        url: 'https://x/a.pdf',
        filename: 'a.pdf',
        caption: 'c',
      }).props,
    ).toMatchObject({
      mediaKind: 'document',
      mediaUrl: 'https://x/a.pdf',
      filename: 'a.pdf',
      caption: 'c',
    });
  });

  it('buttons and list: the prompt, the options and the save variable', () => {
    expect(compiled('buttons').props).toMatchObject({
      bodyText: 'Pick one',
      variable: 'choice',
      buttons: [
        { id: 'p0', title: 'Option A' },
        { id: 'p1', title: 'Option B' },
      ],
    });
    const list = compiled('list', {
      options: [{ title: 'A'.repeat(40), description: 'd', section: 'S' }],
    }).props;
    expect(list).toMatchObject({
      bodyText: 'Pick from list',
      buttonText: 'View options',
      variable: 'choice',
    });
    expect((list.items as Array<{ title: string }>)[0]!.title).toHaveLength(24);
  });

  it('ask: the prompt, the cleaned variable, the upload flag and the expected answers', () => {
    expect(
      compiled('ask', { var: '{{email}}', acceptMedia: true, options: ['yes', ' ', 'no'] }).props,
    ).toMatchObject({
      question: "What's your name?",
      variable: 'email',
      acceptMedia: true,
      expectedAnswers: ['yes', 'no'],
    });
  });

  it('condition: rules and the AND/OR joiners', () => {
    expect(
      compiled('condition', {
        conditions: [
          { variable: 'plan', operator: 'equals', value: 'pro' },
          { variable: 'age', operator: 'gt', value: '18' },
        ],
        operators: ['or'],
      }).props,
    ).toMatchObject({
      logicOperators: ['OR'],
      conditions: [
        { variable: 'plan', operator: 'equals', value: 'pro' },
        { variable: 'age', operator: 'gt', value: '18' },
      ],
    });
  });

  it('delay: amount and unit become seconds', () => {
    expect(compiled('delay', { amount: 2, unit: 'hour' }).props.delaySeconds).toBe(7200);
    expect(compiled('delay', { amount: 3, unit: 'day' }).props.delaySeconds).toBe(259200);
  });

  it('cta: the actions array', () => {
    expect(
      (compiled('cta').props.actions as Array<{ type: string; value: string }>)[0],
    ).toMatchObject({
      type: 'url',
      value: 'https://example.com',
    });
  });

  it('template: the name and the integer id the picker stamps', () => {
    expect(compiled('template', { tpl: 'welcome', tplId: '5' }).props).toMatchObject({
      templateName: 'welcome',
      templateId: 5,
    });
    // a UUID id is not an integer: the executor falls back to the name (see the runtime TODO in the report)
    expect(compiled('template', { tpl: 'welcome', tplId: '3fa85f64-5717' }).props).toMatchObject({
      templateName: 'welcome',
      templateId: 0,
    });
  });

  it('copy to number, tag and assign: read from the raw data under the editor names', () => {
    expect(compiled('notify_number').read).toMatchObject({ copyNumber: '', source: 'mirror' });
    expect(compiled('tag', { action: 'remove', tagId: 'x', tag: 't' }).read).toMatchObject({
      action: 'remove',
      tagId: 'x',
      tag: 't',
    });
    expect(compiled('assign', { team: 'a', userId: 'b', message: 'm' }).read).toMatchObject({
      team: 'a',
      userId: 'b',
      message: 'm',
    });
  });
});

describe('editor fields the runtime reads under another name (mapped by flbToRuntimeData)', () => {
  it('poll: the form saves `multi`, the runtime reads `allowMultiple`', () => {
    expect(compiled('poll', { multi: true }).props.allowMultiple).toBe(true);
    expect(compiled('poll', { multi: false }).props.allowMultiple).toBe(false);
  });

  it('location: the form saves `lat` / `lng`, the runtime reads `latitude` / `longitude`', () => {
    const p = compiled('location', { lat: '12.97', lng: '77.59' }).props;
    expect([p.latitude, p.longitude]).toEqual([12.97, 77.59]);
    expect(compiled('location', { lat: '', lng: '' }).props).toMatchObject({
      latitude: 0,
      longitude: 0,
    });
  });

  it('ai: the form saves `save`, the runtime reads `variable`', () => {
    expect(compiled('ai', { save: 'answer' }).read.variable).toBe('answer');
    expect(compiled('ai').read.variable).toBe('reply');
  });

  it('ai: the form saves `assistant`, the runtime reads `assistant_id`', () => {
    expect(compiled('ai', { assistant: '7' }).read.assistant_id).toBe(7);
    expect(compiled('ai', { assistant: '' }).read.assistant_id).toBeNull();
  });

  it('ai: the form saves `fields` as a comma string, the runtime reads an array', () => {
    expect(compiled('ai', { extract: true, fields: 'A, B' }).read.fields).toEqual(['A', 'B']);
    expect(compiled('ai', { fields: '' }).read.fields).toEqual([]);
  });

  it('chatbot: the form saves `bot`, the runtime reads `agentId` / `botId`', () => {
    const r = compiled('chatbot', { bot: 'agent-1' }).read;
    expect([r.agentId, r.botId]).toEqual(['agent-1', 'agent-1']);
  });

  it('subflow: the form saves `flow`, the runtime reads `selectedFlowId` / `flowId`', () => {
    const r = compiled('subflow', { flow: 'flow-1' }).read;
    expect([r.selectedFlowId, r.flowId]).toEqual(['flow-1', 'flow-1']);
  });

  it('webhook: the form saves `save`, the runtime reads `variable`', () => {
    expect(compiled('webhook', { save: 'api' }).read.variable).toBe('api');
  });

  it('code: the form saves `save`, the runtime reads `variable`', () => {
    expect(compiled('code', { save: 'out' }).read.variable).toBe('out');
  });

  it('mysql: the form saves `save`, the runtime reads `variable`', () => {
    expect(compiled('mysql', { save: 'r' }).read.variable).toBe('r');
  });

  it('cta: the legacy single-kind shape (`kind` + `url`) becomes the actions the runtime reads', () => {
    const g = graphOf('cta', {
      actions: undefined,
      kind: 'url',
      url: 'https://legacy.io',
      label: 'Go',
    });
    // the saved legacy node carries no `actions` array at all
    delete (g.flowNodes[1]!.data as Read).actions;
    expect(readOf(flbRuntimeNodeData(g)).props.actions).toEqual([
      { type: 'url', label: 'Go', value: 'https://legacy.io' },
    ]);
    expect(readOf(g).props.actions).toEqual([
      { type: 'url', label: 'Go', value: 'https://legacy.io' },
    ]);
  });
});

/**
 * One entry per node type of the catalogue: the overrides to save and the fields the executor reads afterwards. A type missing from
 * this table, or in it but gone from the catalogue, fails the guard test below, so a new node type cannot ship unmapped.
 */
const EXECUTOR_READS: Record<string, { save?: Read; reads: Read | 'raw-data-untouched' }> = {
  trigger: { reads: {} },
  message: { save: { text: 'Hello' }, reads: { replies: [{ type: 'Text', data: 'Hello' }] } },
  template: {
    save: { tpl: 'welcome', tplId: '5' },
    reads: { templateName: 'welcome', templateId: 5 },
  },
  media: {
    save: { kind: 'image', url: 'https://x/a.png' },
    reads: { mediaKind: 'image', mediaUrl: 'https://x/a.png' },
  },
  notify_number: {
    save: { copyNumber: '+1 555 0100', source: 'custom', kind: 'pdf', url: 'https://x/a.pdf' },
    reads: {
      copyNumber: '15550100',
      source: 'custom',
      kind: 'pdf',
      mediaKind: 'pdf',
      mediaUrl: 'https://x/a.pdf',
    },
  },
  wa_to_instagram: { save: { igUsername: '@shop' }, reads: { igUsername: 'shop' } },
  sequence: {
    save: { replies: [{ type: 'text', text: 'a' }] },
    reads: { replies: [{ type: 'Text', data: 'a' }] },
  },
  buttons: {
    save: { options: ['A'] },
    reads: { buttons: [{ id: 'p0', title: 'A' }], variable: 'choice' },
  },
  list: {
    save: { options: ['A'] },
    reads: { items: [{ id: 'p0', title: 'A', description: '', section: '' }], variable: 'choice' },
  },
  ask: { save: { var: '{{x}}' }, reads: { variable: 'x', question: "What's your name?" } },
  ask_file: {
    save: { var: '{{doc}}', extensions: ['PDF', 'png'], retries: 4 },
    reads: { variable: 'doc', extensions: ['png', 'pdf'], maxRetries: 4 },
  },
  ask_location: {
    save: { var: 'where', interactive: false },
    reads: { variable: 'where', interactive: false, maxRetries: 2 },
  },
  condition: { save: {}, reads: { logicOperators: [] } },
  delay: { save: { amount: 1, unit: 'min' }, reads: { delaySeconds: 60 } },
  webhook: {
    save: {
      save: 'api',
      method: 'get',
      headers: [
        { key: 'X-A', value: '1' },
        { key: '', value: 'drop' },
      ],
    },
    reads: {
      variable: 'api',
      method: 'GET',
      headers: [{ key: 'X-A', value: '1' }],
      contentType: 'application/json',
    },
  },
  code: { save: { save: 'out' }, reads: { variable: 'out' } },
  mysql: { save: { save: 'r', port: '3307' }, reads: { variable: 'r', port: 3307 } },
  ai: {
    save: {
      save: 'answer',
      assistant: '7',
      fields: 'a, b',
      extract: true,
      conversational: true,
      exit_keyword: 'bye',
    },
    reads: {
      variable: 'answer',
      assistant_id: 7,
      fields: ['a', 'b'],
      extract: true,
      conversational: true,
      exit_keyword: 'bye',
    },
  },
  tag: {
    save: { action: 'remove', tagId: 't', tag: 'n' },
    reads: { action: 'remove', tagId: 't', tag: 'n' },
  },
  assign: {
    save: { team: 'a', userId: 'b', message: 'm' },
    reads: { team: 'a', teamId: 'a', userId: 'b', message: 'm', noteForAgent: 'm' },
  },
  subflow: { save: { flow: 'f1' }, reads: { flowId: 'f1', selectedFlowId: 'f1' } },
  end: { reads: {} },
  cta: {
    save: {},
    reads: { actions: [{ type: 'url', label: 'Visit website', value: 'https://example.com' }] },
  },
  location: { save: { lat: '1.5', lng: '2.5' }, reads: { latitude: 1.5, longitude: 2.5 } },
  poll: { save: { multi: true }, reads: { allowMultiple: true } },
  chatbot: { save: { bot: 'b1' }, reads: { agentId: 'b1', botId: 'b1' } },
  whatsapp_shop: {
    save: { productIds: ['r1'] },
    reads: {
      provider: 'whatsapp_shop',
      products: [{ retailerId: 'r1', name: '', image: '', priceMinor: 0, currency: '', url: '' }],
    },
  },
  woocommerce: { save: { product: 'solo' }, reads: { provider: 'woocommerce' } },
  shopify: {
    save: { abandonedWaitMinutes: '9' },
    reads: { provider: 'shopify', abandonedWaitMinutes: 9 },
  },
  book_appointment: { save: { bookingTypeId: '0' }, reads: { bookingTypeId: '', slotCount: 5 } },
  ai_call: { save: { assistantId: '12' }, reads: { assistantId: 12 } },
  google_meet: { save: { durationMinutes: '45' }, reads: { durationMinutes: 45, leadMinutes: 5 } },
  wa_form: { save: { flowVariable: '{{form}}' }, reads: { flowVariable: 'form' } },
  google_sheets: { save: { saveAs: '{{row}}' }, reads: { saveAs: 'row', mode: 'write' } },
  google_docs: { save: { saveAs: '{{u}}' }, reads: { saveAs: 'u', shareable: true } },
  google_form: { save: { expiresInSec: '60' }, reads: { expiresInSec: 60 } },
  deal: {
    save: { action: 'MOVE', value: '12' },
    reads: { action: 'move', dealValue: '12', value: '12' },
  },
  cf_say: { save: { text: 'Hi' }, reads: { text: 'Hi' } },
  cf_listen: { save: { save: 'said' }, reads: { variable: 'said', silenceTimeout: 6 } },
  cf_ai: {
    save: { save: 'r', assistant: '4' },
    reads: { variable: 'r', assistant_id: 4, endOnGoodbye: true },
  },
  cf_assistant: { reads: 'raw-data-untouched' },
  cf_menu: {
    save: { mode: 'digit' },
    reads: {
      routeBy: 'digit',
      options: [
        { match: 'sales', label: 'Sales' },
        { match: 'support', label: 'Support' },
      ],
    },
  },
  cf_search: { save: { save: 's' }, reads: { variable: 's', query: '{{caller_said}}' } },
  cf_transfer: { save: { number: '+1555' }, reads: { number: '+1555' } },
  cf_hangup: { save: { goodbye: 'Bye' }, reads: { goodbye: 'Bye' } },
  ig_send_dm: { save: { text: 'Hi' }, reads: { replies: [{ type: 'Text', data: 'Hi' }] } },
  ig_quick: {
    reads: {
      bodyText: 'What can I help you with?',
      buttons: [
        { id: 'p0', title: 'Pricing' },
        { id: 'p1', title: 'Support' },
      ],
    },
  },
  // only the link buttons survive: a postback has no tap to wait for in a node with one exit
  ig_buttons: {
    reads: {
      bodyText: 'Tap a button below:',
      actions: [{ type: 'url', label: 'Visit site', value: 'https://' }],
    },
  },
  ig_reply_comment: { reads: 'raw-data-untouched' },
  ig_ai: { save: { save: 'r' }, reads: { variable: 'r', model: 'gpt-4o-mini' } },
  ig_products: { reads: 'raw-data-untouched' },
  ig_ask: { save: { question: 'Name?', save: 'n' }, reads: { question: 'Name?', variable: 'n' } },
  ig_lead: { reads: 'raw-data-untouched' },
  ig_to_whatsapp: { reads: 'raw-data-untouched' },
  fb_gallery: { reads: 'raw-data-untouched' },
  fb_products: { reads: 'raw-data-untouched' },
  fb_lead: { reads: 'raw-data-untouched' },
  fb_reply_comment: { reads: 'raw-data-untouched' },
  fb_to_whatsapp: { reads: 'raw-data-untouched' },
  tg_payment: { reads: 'raw-data-untouched' },
};

describe('every node type of the catalogue: the field the executor reads is there', () => {
  it('the table covers exactly the 60 catalogue types (a new node type must be added here)', () => {
    expect(Object.keys(EXECUTOR_READS).sort()).toEqual(FLB_NODE_TYPE_LIST.map((d) => d.id).sort());
  });

  it.each(Object.entries(EXECUTOR_READS))('%s', (type, spec) => {
    const save = spec.save ?? {};
    const { read, props } = compiled(type, save);
    if (spec.reads === 'raw-data-untouched') {
      // WaDesk's normaliser never translated this family: the runtime (once it has an executor) reads the saved data as it is
      expect(props.data).toEqual({ ...flbDefaultNodeData(type), ...save });
      return;
    }
    expect(read).toMatchObject(spec.reads);
  });
});

describe('compileGraph itself applies the shaper (the FLR hook)', () => {
  it('a graph straight from the editor reaches the executors with the runtime names, shaped by the reader or not', () => {
    expect(compiledRaw('ai', { save: 'answer' }).read.variable).toBe('answer');
    expect(compiledRaw('poll', { multi: true }).props.allowMultiple).toBe(true);
    expect(compiledRaw('location', { lat: '1', lng: '2' }).props).toMatchObject({
      latitude: 1,
      longitude: 2,
    });
    for (const [type, save] of [
      ['ai', { save: 'answer', fields: 'a, b' }],
      ['poll', { multi: true }],
      ['location', { lat: '1.5', lng: '2.5' }],
      ['webhook', { save: 'api' }],
    ] as const) {
      expect(compiledRaw(type, save), type).toEqual(compiled(type, save));
    }
  });
});

describe('FlowReaderService.getRunnableFlow returns the graph shaped for the runtime', () => {
  const nodes = [
    { id: 't', type: 'trigger', x: 0, y: 0, isStart: true, data: flbDefaultNodeData('trigger') },
    {
      id: 'a',
      type: 'ai',
      x: 0,
      y: 0,
      data: { ...flbDefaultNodeData('ai'), save: 'answer', fields: 'x, y' },
    },
    {
      id: 'l',
      type: 'location',
      x: 0,
      y: 0,
      data: { ...flbDefaultNodeData('location'), lat: '1.5', lng: '2.5' },
    },
  ];
  const row = {
    uuid: 'f1',
    name: 'F',
    flowType: 'chat' as FlowType,
    isPublished: true,
    isActive: true,
    triggerKind: 'keyword',
    triggerKeywords: 'hi',
    provider: 'baileys',
    triggerChannelId: null,
    graph: {
      flowNodes: nodes,
      flowEdges: [
        { id: 'e1', source: 't', sourceHandle: 'out', target: 'a' },
        { id: 'e2', source: 'a', sourceHandle: 'out', target: 'l' },
      ],
      vars: [],
    },
  };
  const service = (r: unknown) =>
    new FlowReaderService(
      { txAs: async (_scope: unknown, fn: (tx: unknown) => unknown) => fn({}) } as never,
      { findByUuid: async () => r } as never,
    );

  it('adds the runtime-named fields and keeps every saved one; routes and start are unchanged', async () => {
    const before = JSON.stringify(row.graph);
    const run = (await service(row).getRunnableFlow(1, 'f1'))!;
    expect(JSON.stringify(row.graph)).toBe(before);
    const byId = new Map(run.graph.flowNodes.map((n) => [n.id, n]));
    expect(byId.get('a')!.data).toMatchObject({
      save: 'answer',
      variable: 'answer',
      fields: ['x', 'y'],
    });
    expect(byId.get('l')!.data).toMatchObject({
      lat: '1.5',
      lng: '2.5',
      latitude: 1.5,
      longitude: 2.5,
    });
    expect(byId.get('t')!.data).toEqual(flbDefaultNodeData('trigger'));
    expect(run.routes).toEqual({ t_1: 'a', a_1: 'l' });
    expect(run.startNodeId).toBe('t');
    expect(run.graph.flowEdges).toEqual(row.graph.flowEdges);
  });

  it('a flow with no graph is null', async () => {
    expect(await service({ ...row, graph: null }).getRunnableFlow(1, 'f1')).toBeNull();
  });
});
