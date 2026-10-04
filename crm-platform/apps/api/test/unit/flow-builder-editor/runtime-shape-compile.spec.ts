import { describe, expect, it } from 'vitest';
import {
  FLB_NODE_TYPE_LIST,
  flbDefaultNodeData,
  flbNormalizeGraph,
  flbRuntimeNodeData,
  flbToRuntimeData,
  type FlowGraph,
} from '@crm/contracts';
import { compileGraph } from '../../../src/modules/flow-runtime-engine/graph/compile-graph';
import {
  assignConfig,
  dealConfig,
  instagramMessage,
  notifyPlan,
  tagConfig,
} from '../../../src/modules/flow-runtime-engine/runtime/nodes/actions/actions-config';
import { interpolate } from '../../../src/modules/flow-runtime-engine/runtime/variables';

/**
 * Proof that `flbToRuntimeData` is ADDITIVE against the runtime's real `compileGraph` (WD-FLB-070): for every node type of the
 * catalogue, the graph compiled after the shaper behaves exactly as the graph compiled without it for the types that already worked,
 * and the fields the executors read are populated for the ten that did not. The same data bag is also checked the other way round
 * (shaped AFTER compile, from the raw `props.data` the compiler hands the executors) and through the executors' own pure readers.
 */

type Rec = Record<string, unknown>;

const graphOf = (type: string, data: Rec): FlowGraph =>
  flbNormalizeGraph({
    flowNodes: [
      { id: 't', type: 'trigger', x: 0, y: 0, data: flbDefaultNodeData('trigger'), isStart: true },
      { id: 'n1', type, x: 0, y: 0, data },
    ],
    flowEdges: [{ id: 'e', source: 't', sourceHandle: 'out', target: 'n1' }],
  });

const node = (g: FlowGraph) => compileGraph(g).nodes.find((n) => n.id === 'n1')!;
const rawNode = (type: string, data: Rec) => node(graphOf(type, data));
const shapedNode = (type: string, data: Rec) => node(flbRuntimeNodeData(graphOf(type, data)));

/** A realistic, non-default save per type (what a person would actually configure). `undefined` = the defaults alone. */
const RICH: Record<string, Rec> = {
  message: { text: 'Hello {{name}}' },
  sequence: {
    replies: [
      { type: 'text', text: 'Hi {{name}}' },
      { type: 'image', url: 'https://x/y.png', filename: 'y.png', caption: 'c' },
      { type: 'document', url: 'https://x/d.pdf', filename: 'd.pdf', caption: '' },
    ],
  },
  media: {
    kind: 'video',
    url: 'https://x/v.mp4',
    caption: 'c',
    filename: 'v.mp4',
    mimetype: 'video/mp4',
  },
  buttons: { prompt: 'Pick', options: ['A', 'B', 'C'], var: '{{choice}}' },
  list: {
    prompt: 'Pick',
    button: 'Open',
    var: 'plan',
    options: [
      { title: 'One', description: 'd', section: 'S1' },
      { title: 'Two', description: '', section: 'S2' },
    ],
  },
  ask: { prompt: 'Email?', var: '@email', acceptMedia: true, options: ['yes', 'no'] },
  condition: {
    conditions: [
      { variable: '{{plan}}', operator: 'equals', value: 'pro' },
      { variable: 'age', operator: 'gt', value: '18' },
    ],
    operators: ['or'],
  },
  delay: { amount: 2, unit: 'hour' },
  template: { tpl: 'welcome', tplId: '7', preview: 'Hi' },
  wa_form: { formId: 'f1', bodyText: 'Fill', ctaLabel: 'Go', flowVariable: '{{form}}' },
  book_appointment: {
    bookingTypeId: 'type-uuid',
    slotCount: 3,
    prompt: 'When?',
    confirmation: 'Booked {{slot}}',
    collectEmail: true,
    calendarOverride: 'cal',
  },
  whatsapp_shop: {
    storeId: 's1',
    headerText: 'H',
    bodyText: 'B',
    footerText: 'F',
    abandonedWaitMinutes: 9,
    productItems: [
      { retailer_id: 'r1', name: 'N', image: 'i', price_minor: 1999, currency: 'USD', url: 'u' },
    ],
  },
  woocommerce: { storeId: 's2', productIds: ['a', 'b'] },
  shopify: { storeId: 's3', product: 'solo' },
  cta: {
    headerText: 'H',
    bodyText: 'B',
    footerText: 'F',
    actions: [
      { type: 'url', label: 'Go', value: 'https://a.io' },
      { type: 'phone', label: 'Call', value: '+1 555' },
      { type: 'copy', label: 'Code', value: 'SAVE' },
    ],
  },
};

/** Types whose executors read the compiler's shaped `props`: those props must not change at all. */
const COMPILER_SHAPED = [
  'message',
  'sequence',
  'media',
  'buttons',
  'list',
  'ask',
  'condition',
  'delay',
  'template',
  'wa_form',
  'book_appointment',
  'whatsapp_shop',
  'woocommerce',
  'shopify',
  'cta',
];

describe('types that already worked: the compiled props do not change by one byte', () => {
  it.each(COMPILER_SHAPED)(
    '%s: default data and a realistic save compile to the same props with or without the shaper',
    (type) => {
      expect(shapedNode(type, flbDefaultNodeData(type)).props).toEqual(
        rawNode(type, flbDefaultNodeData(type)).props,
      );
      const rich = { ...flbDefaultNodeData(type), ...RICH[type] };
      expect(shapedNode(type, rich).props).toEqual(rawNode(type, rich).props);
    },
  );

  it('poll and location: unchanged while nothing mismatches (multi off, no coordinates)', () => {
    for (const type of ['poll', 'location']) {
      expect(shapedNode(type, flbDefaultNodeData(type)).props).toEqual(
        rawNode(type, flbDefaultNodeData(type)).props,
      );
    }
  });

  it('every other type keeps all its saved data in `props.data`, node ids, order and edges as they were', () => {
    for (const { id: type } of FLB_NODE_TYPE_LIST) {
      const g = graphOf(type, flbDefaultNodeData(type));
      const raw = compileGraph(g);
      const shaped = compileGraph(flbRuntimeNodeData(g));
      expect(
        shaped.nodes.map((n) => [n.id, n.type]),
        type,
      ).toEqual(raw.nodes.map((n) => [n.id, n.type]));
      expect(shaped.edges, type).toEqual(raw.edges);
      expect(shaped.vars, type).toEqual(raw.vars);
      const before = (rawNode(type, flbDefaultNodeData(type)).props.data ?? {}) as Rec;
      const after = (shapedNode(type, flbDefaultNodeData(type)).props.data ?? {}) as Rec;
      for (const k of Object.keys(before)) expect(after, `${type}.${k}`).toHaveProperty(k);
    }
  });
});

describe("types whose executors read the raw data bag: the executors' own readers answer the same", () => {
  const render = (vars: Rec) => (t: unknown) => interpolate(t, vars);
  const bags = (type: string, extra: Rec = {}) => {
    const data = { ...flbDefaultNodeData(type), ...extra };
    return {
      before: (rawNode(type, data).props.data ?? {}) as Rec,
      after: (shapedNode(type, data).props.data ?? {}) as Rec,
    };
  };

  it('tag', () => {
    for (const extra of [
      {},
      { action: 'remove', tagId: 'uuid', tag: ' VIP ' },
      { action: 'ADD', tag: 'x' },
    ]) {
      const { before, after } = bags('tag', extra);
      expect(tagConfig(after)).toEqual(tagConfig(before));
    }
  });

  it('assign', () => {
    for (const extra of [{}, { team: ' t ', userId: 'u', message: 'Hi {{name}}' }]) {
      const { before, after } = bags('assign', extra);
      expect(assignConfig(after, render({ name: 'Ana' }))).toEqual(
        assignConfig(before, render({ name: 'Ana' })),
      );
    }
  });

  it('deal', () => {
    for (const extra of [
      {},
      { action: 'move', stageId: 's', value: '12.5', ownerId: 'o', saveAs: 'deal_id' },
    ]) {
      const { before, after } = bags('deal', extra);
      expect(dealConfig(after, render({}), {})).toEqual(dealConfig(before, render({}), {}));
    }
  });

  it('notify_number (mirror and custom, text and media)', () => {
    const last = { kind: 'text', text: 'the last message', url: '', caption: '', filename: null };
    for (const extra of [
      {},
      { copyNumber: '+91 98765-43210' },
      { copyNumber: '{{agent}}', source: 'custom', kind: 'text', text: 'Hi {{name}}' },
      {
        copyNumber: '15550100',
        source: 'custom',
        kind: 'pdf',
        url: 'https://x/a.pdf',
        caption: 'c',
        filename: 'a.pdf',
      },
      { copyNumber: '15550100', source: 'custom', kind: 'document', url: '' },
    ]) {
      const { before, after } = bags('notify_number', extra);
      const vars = { agent: '+1 (555) 0100', name: 'Ana' };
      expect(notifyPlan(after, last, render(vars))).toEqual(notifyPlan(before, last, render(vars)));
      expect(notifyPlan(after, null, render(vars))).toEqual(notifyPlan(before, null, render(vars)));
    }
  });

  it('wa_to_instagram', () => {
    for (const extra of [
      {},
      { igUsername: '@shop' },
      { igUsername: ' shop ', introText: '' },
      { igUsername: '' },
    ]) {
      const { before, after } = bags('wa_to_instagram', extra);
      expect(instagramMessage(after, render({}))).toEqual(instagramMessage(before, render({})));
    }
  });

  it('google_meet, google_sheets, google_docs, google_form, ai_call: every key the executor reads has the same value', () => {
    const reads: Record<string, string[]> = {
      google_meet: [
        'title',
        'durationMinutes',
        'leadMinutes',
        'sendCalendarInvite',
        'messageTemplate',
      ],
      google_sheets: [
        'mode',
        'sheetId',
        'tabName',
        'columns',
        'matchColumn',
        'matchValue',
        'saveAs',
        'matchByHeader',
      ],
      google_docs: [
        'templateId',
        'newTitle',
        'placeholders',
        'shareable',
        'messageTemplate',
        'saveAs',
      ],
      google_form: ['formId', 'bodyText', 'saveAs', 'expiresInSec'],
      ai_call: ['assistantId'],
    };
    for (const [type, keys] of Object.entries(reads)) {
      const { before, after } = bags(type);
      for (const k of keys) {
        // the executors coerce with Number() / String(), so compare as they do
        const norm = (v: unknown) =>
          typeof v === 'object' ? JSON.stringify(v) : String(Number(v) || v || '');
        expect(norm(after[k]), `${type}.${k}`).toBe(norm(before[k]));
      }
    }
    // the executor reads `Number(assistantId) || null`: '' and 0 are the same, a UUID stays as saved
    expect(Number(bags('ai_call', { assistantId: 'u-1' }).after.assistantId) || null).toBe(null);
    expect(bags('ai_call', { assistantId: 'u-1' }).after.assistantId).toBe('u-1');
  });

  it('trigger and end: the data is the same object content', () => {
    for (const type of ['trigger', 'end']) {
      const { before, after } = bags(type);
      expect(after).toEqual(before);
    }
  });
});

describe('the ten mismatches: what the executor reads is now populated', () => {
  it.each([
    [
      'ai',
      { save: 'answer', assistant: '9', fields: 'a, b', extract: true },
      { variable: 'answer', assistant_id: 9, fields: ['a', 'b'] },
    ],
    ['chatbot', { bot: 'agent-9' }, { agentId: 'agent-9', botId: 'agent-9' }],
    ['subflow', { flow: 'flow-9' }, { selectedFlowId: 'flow-9', flowId: 'flow-9' }],
    ['webhook', { save: 'api' }, { variable: 'api' }],
    ['code', { save: 'out' }, { variable: 'out' }],
    ['mysql', { save: 'rows2' }, { variable: 'rows2' }],
  ])(
    '%s: the raw data the executor merges flat carries the runtime names',
    (type, save, expected) => {
      const data = { ...flbDefaultNodeData(type), ...save };
      const before = (rawNode(type, data).props.data ?? {}) as Rec;
      const after = (shapedNode(type, data).props.data ?? {}) as Rec;
      for (const k of Object.keys(expected))
        expect(
          before[k] === expected[k as keyof typeof expected],
          `${type}.${k} was already there`,
        ).toBe(false);
      expect(after).toMatchObject(expected);
      // and every saved field is still there, untouched except the documented in-place ones
      expect(after).toMatchObject(
        Object.fromEntries(Object.entries(save).filter(([k]) => k !== 'fields')),
      );
    },
  );

  it('poll: allowMultiple is populated in the compiled props', () => {
    const data = { ...flbDefaultNodeData('poll'), multi: true };
    expect(rawNode('poll', data).props.allowMultiple).toBe(false);
    expect(shapedNode('poll', data).props.allowMultiple).toBe(true);
  });

  it('location: latitude and longitude are populated in the compiled props', () => {
    const data = { ...flbDefaultNodeData('location'), lat: '12.97', lng: '77.59' };
    expect(rawNode('location', data).props).toMatchObject({ latitude: 0, longitude: 0 });
    expect(shapedNode('location', data).props).toMatchObject({ latitude: 12.97, longitude: 77.59 });
  });

  it('cta (legacy single-kind): the compiled actions are populated', () => {
    // a legacy node as an old import stored it: no `actions` array (flbNormalizeGraph would backfill the default one, so build it raw)
    const legacy = {
      flowNodes: [
        { id: 't', type: 'trigger', isStart: true, data: {} },
        { id: 'n1', type: 'cta', data: { kind: 'copy', code: 'SAVE', label: 'Code' } },
      ],
      flowEdges: [],
    };
    const actionsOf = (g: { flowNodes: Array<{ type: string; data: Rec }> }) =>
      compileGraph(g).nodes.find((n) => n.id === 'n1')!.props.actions;
    expect(actionsOf(legacy)).toEqual([]);
    expect(actionsOf(flbRuntimeNodeData(legacy))).toEqual([
      { type: 'copy', label: 'Code', value: 'SAVE' },
    ]);
  });
});

describe('applied AFTER compileGraph instead of before: the same bag', () => {
  it.each(FLB_NODE_TYPE_LIST.map((d) => d.id))(
    '%s: shaping the raw `props.data` equals the data of the graph shaped first',
    (type) => {
      const data = { ...flbDefaultNodeData(type), ...RICH[type] };
      const compiledData = rawNode(type, data).props.data;
      const first = shapedNode(type, data).props.data;
      if (compiledData === undefined) {
        // a type the compiler shapes itself keeps no raw bag: shaping first must leave its props equal (proved above)
        expect(first).toBeUndefined();
        return;
      }
      expect(flbToRuntimeData({ type, data: compiledData })).toEqual(first);
    },
  );

  it('shaping before and after together is the same as shaping once', () => {
    for (const { id: type } of FLB_NODE_TYPE_LIST) {
      const data = { ...flbDefaultNodeData(type), ...RICH[type] };
      const once = shapedNode(type, data);
      const twice = node(flbRuntimeNodeData(flbRuntimeNodeData(graphOf(type, data))));
      expect(twice, type).toEqual(once);
    }
  });
});
