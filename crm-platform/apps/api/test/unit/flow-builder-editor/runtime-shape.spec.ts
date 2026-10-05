import { describe, expect, it } from 'vitest';
import {
  FLB_NODE_TYPE_LIST,
  FLB_RUNTIME_SHAPED_TYPES,
  flbCleanVarName,
  flbDefaultNodeData,
  flbRuntimeNodeData,
  flbToRuntimeData,
} from '@crm/contracts';

/**
 * `flbToRuntimeData` (TW-FLB-070): Reference's FlowNormalizer for the `data` bag of one node. Pure unit tests of the translation itself;
 * the proof against the runtime's real `compileGraph` is in `editor-field-seam.spec.ts` and `runtime-shape-compile.spec.ts`.
 */

const shape = (type: string, data: Record<string, unknown>) => flbToRuntimeData({ type, data });

/** Keys the runtime reads under the SAME name the editor saves, so the shaper rewrites them to their normalised form. */
const NORMALISED_IN_PLACE: Record<string, string[]> = {
  notify_number: ['copyNumber', 'kind', 'text', 'source'],
  wa_to_instagram: ['igUsername', 'introText'],
  wa_form: ['bodyText', 'ctaLabel', 'flowVariable', 'formId'],
  google_meet: ['title', 'durationMinutes', 'leadMinutes', 'sendCalendarInvite', 'messageTemplate'],
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
  google_docs: ['templateId', 'newTitle', 'placeholders', 'shareable', 'messageTemplate', 'saveAs'],
  google_form: ['formId', 'bodyText', 'saveAs', 'expiresInSec'],
  condition: ['conditions'],
  webhook: ['method', 'url', 'body', 'contentType', 'headers'],
  mysql: ['host', 'port', 'database', 'username', 'password', 'sql'],
  code: ['code'],
  assign: [],
  tag: ['action', 'tagId', 'tag'],
  deal: ['action', 'dealName', 'stageId', 'saveAs', 'ownerId'],
  ai: ['model', 'prompt', 'extract', 'silent', 'fields', 'conversational', 'exit_keyword'],
  poll: ['question', 'options'],
  ai_call: ['assistantId'],
  book_appointment: [
    'slotCount',
    'prompt',
    'confirmation',
    'calendarOverride',
    'collectEmail',
    'bookingTypeId',
  ],
  cf_menu: ['options'],
  cf_ai: ['model', 'prompt', 'endOnGoodbye'],
  cf_listen: ['silenceTimeout'],
  cf_say: ['text'],
  cf_search: ['query', 'filler'],
  cf_transfer: ['number', 'message'],
  cf_hangup: ['goodbye'],
  cta: ['headerText', 'bodyText', 'footerText'],
  location: ['address', 'title'],
  media: ['mimetype'],
  whatsapp_shop: [
    'storeId',
    'headerText',
    'bodyText',
    'footerText',
    'abandonedWaitMinutes',
    'productItems',
  ],
  woocommerce: [
    'storeId',
    'headerText',
    'bodyText',
    'footerText',
    'abandonedWaitMinutes',
    'productItems',
  ],
  shopify: [
    'storeId',
    'headerText',
    'bodyText',
    'footerText',
    'abandonedWaitMinutes',
    'productItems',
  ],
  list: [],
  buttons: [],
  ask: [],
  delay: [],
  template: [],
};

describe('flbToRuntimeData: the field renames Reference delivered', () => {
  it('ai: save to variable, assistant to assistant_id, fields comma string to array, promoted flags', () => {
    expect(
      shape('ai', {
        ...flbDefaultNodeData('ai'),
        save: '{{answer}}',
        assistant: '7',
        extract: true,
        silent: true,
        fields: ' name , email,,phone ',
        conversational: true,
        exit_keyword: 'bye',
        temperature: '0.3',
        maxTokens: '500',
      }),
    ).toMatchObject({
      save: '{{answer}}',
      variable: 'answer',
      assistant_id: 7,
      extract: true,
      silent: true,
      fields: ['name', 'email', 'phone'],
      conversational: true,
      exit_keyword: 'bye',
      temperature: 0.3,
      maxTokens: 500,
    });
  });

  it('ai: defaults (model, variable) and an empty assistant is null', () => {
    expect(shape('ai', {})).toMatchObject({
      model: 'gpt-4o-mini',
      variable: 'reply',
      assistant_id: null,
      extract: false,
      fields: [],
    });
  });

  it('ai: fields may be an array of strings or {key|name} objects; a field named "0" is dropped like PHP array_filter', () => {
    expect(shape('ai', { fields: ['a', { key: 'b' }, { name: 'c' }, '', '0'] }).fields).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('ai: a UUID assistant is never cast to an integer (PHP would read the leading digits)', () => {
    expect(
      shape('ai', { assistant: '3fa85f64-5717-4562-b3fc-2c963f66afa6' }).assistant_id,
    ).toBeNull();
  });

  it('ai: an existing `variable` survives a blank `save`', () => {
    expect(shape('ai', { save: '', variable: 'kept' }).variable).toBe('kept');
  });

  it('chatbot: bot to agentId and botId; no bot key leaves the legacy names alone', () => {
    expect(shape('chatbot', { bot: 'agent-1' })).toMatchObject({
      bot: 'agent-1',
      agentId: 'agent-1',
      botId: 'agent-1',
    });
    expect(shape('chatbot', { agentId: 'old' })).toEqual({ agentId: 'old' });
  });

  it('subflow: flow to flowId and selectedFlowId (a stale selectedFlowId cannot win)', () => {
    expect(shape('subflow', { flow: 'f1', selectedFlowId: 'stale' })).toMatchObject({
      flow: 'f1',
      flowId: 'f1',
      selectedFlowId: 'f1',
    });
    expect(shape('subflow', { flow: '' })).toMatchObject({ flowId: '', selectedFlowId: '' });
  });

  it('webhook / code / mysql: save to variable with each node default; headers without a key are dropped', () => {
    expect(
      shape('webhook', {
        save: 'api',
        method: 'get',
        headers: [{ key: 'X', value: 1 }, { key: '', value: 'a' }, 'x'],
      }),
    ).toMatchObject({
      variable: 'api',
      method: 'GET',
      headers: [{ key: 'X', value: '1' }],
      contentType: 'application/json',
    });
    expect(shape('webhook', {}).variable).toBe('response');
    expect(shape('code', { save: 'out' }).variable).toBe('out');
    expect(shape('code', {}).variable).toBe('result');
    expect(shape('mysql', { save: '@r', port: '3307' })).toMatchObject({
      variable: 'r',
      port: 3307,
    });
    expect(shape('mysql', {})).toMatchObject({ variable: 'rows', port: 3306 });
  });

  it('poll: multi to allowMultiple, options as a list, default question', () => {
    expect(shape('poll', { multi: true, options: ['a', 'b'] })).toMatchObject({
      multi: true,
      allowMultiple: true,
      options: ['a', 'b'],
    });
    expect(shape('poll', { multi: '0' }).allowMultiple).toBe(false);
    expect(shape('poll', {}).question).toBe('Pick one');
  });

  it('location: lat / lng to latitude / longitude as numbers (a blank or bad value is 0)', () => {
    expect(shape('location', { lat: '12.97', lng: '77.59' })).toMatchObject({
      latitude: 12.97,
      longitude: 77.59,
    });
    expect(shape('location', { lat: '', lng: 'abc' })).toMatchObject({ latitude: 0, longitude: 0 });
    expect(shape('location', { lat: '12.5abc', lng: -3 })).toMatchObject({
      latitude: 12.5,
      longitude: -3,
    });
  });

  it('cta: the legacy single-kind shape becomes ctaActions and the flat first-action fields', () => {
    expect(shape('cta', { kind: 'phone', label: 'Call us', phone: '+1 555 0100' })).toMatchObject({
      ctaActions: [{ type: 'phone', label: 'Call us', value: '+1 555 0100' }],
      ctaType: 'phone',
      ctaLabel: 'Call us',
      ctaUrl: 'tel:+15550100',
      ctaPhone: '+1 555 0100',
      ctaCode: '',
    });
    expect(shape('cta', { kind: 'copy', code: 'SAVE10' }).ctaActions).toEqual([
      { type: 'copy', label: '', value: 'SAVE10' },
    ]);
    expect(shape('cta', { kind: 'bogus', url: 'https://x.io', label: 'Go' }).ctaActions).toEqual([
      { type: 'url', label: 'Go', value: 'https://x.io' },
    ]);
  });

  it('cta: actions are capped at three, an unknown type is a url, the type is lower-cased', () => {
    const r = shape('cta', {
      actions: [1, 2, 3, 4].map((n) => ({
        type: n === 2 ? 'CALL_NOW' : n === 3 ? 'weird' : 'url',
        label: `l${n}`,
        value: `v${n}`,
      })),
    });
    expect(r.ctaActions).toEqual([
      { type: 'url', label: 'l1', value: 'v1' },
      { type: 'call_now', label: 'l2', value: 'v2' },
      { type: 'url', label: 'l3', value: 'v3' },
    ]);
  });

  it('message and sequence: the Text / media replies of the Node runtime shape', () => {
    expect(shape('message', { text: 'Hi' }).flowReplies).toEqual([
      { flowReplyType: 'Text', data: 'Hi' },
    ]);
    expect(
      shape('sequence', {
        replies: [
          { type: 'text', text: 'a' },
          { type: 'IMAGE', mediaUrl: 'https://x/y.png', filename: 'y.png', caption: 'c' },
          { type: 'nonsense', text: 'z' },
        ],
      }).flowReplies,
    ).toEqual([
      { flowReplyType: 'Text', data: 'a' },
      { flowReplyType: 'Image', data: 'https://x/y.png', filename: 'y.png', caption: 'c' },
      { flowReplyType: 'Text', data: 'z' },
    ]);
  });

  it('media and copy-to-number: the top-level media fields, a relative path made absolute only with a base URL', () => {
    expect(
      shape('media', {
        kind: 'DOCUMENT',
        url: 'https://x/a.pdf',
        caption: 'c',
        filename: 'a.pdf',
        mimetype: 'application/pdf',
      }),
    ).toMatchObject({
      mediaKind: 'document',
      mediaUrl: 'https://x/a.pdf',
      mediaCaption: 'c',
      mediaFilename: 'a.pdf',
      mediaMimetype: 'application/pdf',
    });
    expect(shape('media', { url: '/storage/a.png' }).mediaUrl).toBe('/storage/a.png');
    expect(
      flbToRuntimeData(
        { type: 'media', data: { url: '/storage/a.png' } },
        { baseUrl: 'https://app.test/' },
      ),
    ).toMatchObject({
      url: 'https://app.test/storage/a.png',
      mediaUrl: 'https://app.test/storage/a.png',
    });
    expect(
      flbToRuntimeData(
        { type: 'media', data: { url: '{{invoice_url}}' } },
        { baseUrl: 'https://app.test' },
      ).mediaUrl,
    ).toBe('{{invoice_url}}');
    expect(
      shape('notify_number', { copyNumber: '+91 98765-43210', source: 'weird', kind: 'PDF' }),
    ).toMatchObject({
      copyNumber: '919876543210',
      source: 'mirror',
      kind: 'pdf',
      mediaKind: 'pdf',
    });
    expect(shape('notify_number', { copyNumber: '{{agent_number}}', kind: 'text' })).toMatchObject({
      copyNumber: '{{agent_number}}',
      mediaKind: '',
    });
  });

  it('buttons / list / ask: prompt to bodyText, options to ports, var to variable, expected answers trimmed', () => {
    expect(
      shape('buttons', { prompt: 'Pick', options: ['A', { title: 'B' }, {}], var: ' {{choice}} ' }),
    ).toMatchObject({
      headerText: '',
      bodyText: 'Pick',
      buttons: [
        { id: 'p0', title: 'A' },
        { id: 'p1', title: 'B' },
        { id: 'p2', title: 'Option 3' },
      ],
      variable: 'choice',
    });
    const list = shape('list', {
      prompt: 'Pick',
      button: '',
      var: '',
      options: [
        'x'.repeat(30),
        { title: 'T', description: 'd'.repeat(80), section: 'S'.repeat(30) },
      ],
    });
    expect(list).toMatchObject({ bodyText: 'Pick', buttonText: '', variable: 'choice' });
    const items = list.listItems as Array<Record<string, string>>;
    expect(items[0]).toEqual({ id: 'p0', title: 'x'.repeat(24), description: '', section: '' });
    expect(items[1]!.description).toHaveLength(72);
    expect(items[1]!.section).toHaveLength(24);
    expect(
      shape('ask', {
        prompt: 'Name?',
        var: '@name',
        acceptMedia: 1,
        options: [' yes ', '', 3, 'no'],
      }),
    ).toMatchObject({
      question: 'Name?',
      variable: 'name',
      acceptMedia: true,
      expectedAnswers: ['yes', 'no'],
    });
    expect(shape('ask', { expected: ['a'] }).expectedAnswers).toEqual(['a']);
  });

  it('condition: rules cleaned, joiners upper-cased, the first rule mirrored flat; the legacy var/op/value is promoted', () => {
    expect(
      shape('condition', {
        conditions: [
          { variable: '{{plan}}', operator: 'equals', value: 'pro' },
          { variable: 'age', value: 18 },
        ],
        operators: ['or', 'x'],
      }),
    ).toMatchObject({
      conditions: [
        { variable: 'plan', operator: 'equals', value: 'pro' },
        { variable: 'age', operator: 'equals', value: '18' },
      ],
      logicOperators: ['OR', 'AND'],
      variable: 'plan',
      operator: 'equals',
      compareValue: 'pro',
    });
    expect(shape('condition', { var: 'x', op: 'gt', value: '3' })).toMatchObject({
      conditions: [{ variable: 'x', operator: 'gt', value: '3' }],
      compareValue: '3',
    });
  });

  it('delay: amount and unit to seconds (an unknown unit is minutes, a missing amount is 5)', () => {
    expect(shape('delay', { amount: '2', unit: 'hour' }).delaySeconds).toBe(7200);
    expect(shape('delay', { amount: 3, unit: 'days' }).delaySeconds).toBe(259200);
    expect(shape('delay', { amount: 4, unit: 'fortnight' }).delaySeconds).toBe(240);
    expect(shape('delay', {}).delaySeconds).toBe(300);
    expect(shape('delay', { amount: '', unit: 'sec' }).delaySeconds).toBe(0);
  });

  it('tag / assign / deal: the Reference action fields', () => {
    expect(shape('tag', { action: 'REMOVE', tagId: 't', tag: 'n' })).toMatchObject({
      action: 'remove',
      tagId: 't',
      tag: 'n',
    });
    expect(shape('tag', { action: 'whatever' }).action).toBe('add');
    expect(shape('assign', { team: 'a', userId: 'b', message: 'm' })).toMatchObject({
      teamId: 'a',
      userId: 'b',
      noteForAgent: 'm',
    });
    expect(shape('deal', { action: 'MOVE', value: 12, saveAs: '{{d}}' })).toMatchObject({
      action: 'move',
      dealName: '{{contact_name}} — deal',
      dealValue: '12',
      saveAs: 'd',
    });
  });

  it('commerce: provider from the type, defaults, legacy productIds / product migrated, at most 30 hydrated items', () => {
    expect(shape('shopify', { productIds: ['r1', 'r2'], abandonedWaitMinutes: '9' })).toMatchObject(
      {
        provider: 'shopify',
        bodyText: 'Tap a product to see details:',
        abandonedWaitMinutes: 9,
        productItems: [
          { retailer_id: 'r1', name: '', image: '', price_minor: 0, currency: '', url: '' },
          { retailer_id: 'r2', name: '', image: '', price_minor: 0, currency: '', url: '' },
        ],
      },
    );
    expect(shape('woocommerce', { product: 'solo' }).productItems).toEqual([
      { retailer_id: 'solo', name: '', image: '', price_minor: 0, currency: '', url: '' },
    ]);
    const many = Array.from({ length: 40 }, (_, i) => ({
      retailer_id: `r${i}`,
      price_minor: '199.9',
    }));
    const out = shape('whatsapp_shop', { productItems: [...many, { name: 'no id' }] })
      .productItems as Array<Record<string, unknown>>;
    expect(out).toHaveLength(30);
    expect(out[0]).toMatchObject({ retailer_id: 'r0', price_minor: 199 });
  });

  it('book_appointment: defaults; the booking type stays a string and 0 means every service', () => {
    expect(
      shape('book_appointment', { bookingTypeId: ' 3fa8-uuid ', slotCount: '7', collectEmail: 1 }),
    ).toMatchObject({
      bookingTypeId: '3fa8-uuid',
      slotCount: 7,
      collectEmail: true,
      prompt: 'Pick a time that works for you:',
      confirmation: '✅ Booked! See you on {{slot}}.',
    });
    expect(shape('book_appointment', { bookingTypeId: '0' }).bookingTypeId).toBe('');
  });

  it('ai_call: an integer id is normalised, a UUID is left exactly as saved, nothing is 0', () => {
    expect(shape('ai_call', { assistantId: '12' }).assistantId).toBe(12);
    expect(shape('ai_call', { assistantId: 'uuid-1' }).assistantId).toBe('uuid-1');
    expect(shape('ai_call', { assistantId: '' }).assistantId).toBe(0);
    expect(shape('ai_call', {}).assistantId).toBe(0);
  });

  it('template: the name, and the id only when it really is an integer', () => {
    expect(shape('template', { tpl: 'welcome', tplId: '42', preview: 'p' })).toMatchObject({
      templateName: 'welcome',
      templateId: 42,
      preview: 'p',
    });
    expect(shape('template', { tpl: 'w', tplId: '3fa85f64-5717' })).not.toHaveProperty(
      'templateId',
    );
  });

  it('google nodes: defaults and number / flag coercion', () => {
    expect(shape('google_meet', { durationMinutes: '45', sendCalendarInvite: 1 })).toMatchObject({
      title: 'WhatsApp consultation',
      durationMinutes: 45,
      leadMinutes: 5,
      sendCalendarInvite: true,
      messageTemplate: 'Your meeting link: {{meet_link}}\nStarts at {{meet_start}}',
    });
    expect(
      shape('google_sheets', { saveAs: '', columns: 'x', matchByHeader: 'yes' }),
    ).toMatchObject({
      mode: 'write',
      columns: [],
      saveAs: 'sheet_row',
      matchByHeader: true,
    });
    expect(shape('google_docs', {})).toMatchObject({
      shareable: true,
      saveAs: 'doc_url',
      newTitle: 'Document for {{name}}',
    });
    expect(shape('google_docs', { shareable: false }).shareable).toBe(false);
    expect(shape('google_form', { expiresInSec: '60' })).toMatchObject({
      expiresInSec: 60,
      saveAs: 'google_form',
    });
    expect(shape('wa_to_instagram', { igUsername: '@@shop ' })).toMatchObject({
      igUsername: 'shop',
    });
    expect(shape('wa_form', {})).toMatchObject({
      ctaLabel: 'Open form',
      flowVariable: 'form_submission',
    });
  });

  it('call flow nodes: flat fields for the call runtime', () => {
    expect(shape('cf_listen', { save: 'said' })).toMatchObject({
      variable: 'said',
      silenceTimeout: 6,
    });
    expect(shape('cf_ai', { save: '', assistant: '4' })).toMatchObject({
      variable: 'ai_reply',
      assistant_id: 4,
      endOnGoodbye: true,
      model: 'gpt-4o-mini',
    });
    expect(
      shape('cf_menu', { mode: 'digit', options: [{ match: '1', label: 'Sales', extra: 1 }] }),
    ).toMatchObject({
      routeBy: 'digit',
      options: [{ match: '1', label: 'Sales' }],
    });
    expect(shape('cf_search', { save: 's' })).toMatchObject({ variable: 's' });
  });
});

describe('flbToRuntimeData: the contract', () => {
  it('an unshaped type (trigger, end, Instagram, Facebook, Telegram, cf_assistant) comes back as an untouched copy', () => {
    for (const type of [
      'trigger',
      'end',
      'cf_assistant',
      'ig_send_dm',
      'ig_lead',
      'fb_gallery',
      'tg_payment',
      'not_a_type',
    ]) {
      const data = { a: 1, save: 'x', nested: { b: [1] } };
      const out = shape(type, data);
      expect(out).toEqual(data);
      expect(out).not.toBe(data);
    }
  });

  it("shapes exactly the types Reference's normaliser translated (plus the three commerce providers)", () => {
    const catalogue = new Set(FLB_NODE_TYPE_LIST.map((d) => d.id));
    for (const t of FLB_RUNTIME_SHAPED_TYPES) expect(catalogue.has(t), t).toBe(true);
    expect([...FLB_RUNTIME_SHAPED_TYPES].sort()).toEqual(
      [
        'message',
        'sequence',
        'media',
        'notify_number',
        'wa_to_instagram',
        'google_meet',
        'wa_form',
        'template',
        'buttons',
        'list',
        'ask',
        // not Reference: the Ask for file / location additions (TW-FLB-081, 082)
        'ask_file',
        'ask_location',
        'condition',
        'delay',
        'webhook',
        'code',
        'mysql',
        'subflow',
        'assign',
        'tag',
        'whatsapp_shop',
        'woocommerce',
        'shopify',
        'ai',
        'cta',
        'location',
        'poll',
        'chatbot',
        'book_appointment',
        'ai_call',
        'google_sheets',
        'google_docs',
        'google_form',
        'deal',
        'cf_say',
        'cf_listen',
        'cf_ai',
        'cf_menu',
        'cf_search',
        'cf_transfer',
        'cf_hangup',
      ].sort(),
    );
  });

  it('a node that is not an object, or has no data, never throws', () => {
    expect(flbToRuntimeData({})).toEqual({});
    expect(flbToRuntimeData({ type: 'ai', data: null })).toMatchObject({ variable: 'reply' });
    expect(flbToRuntimeData({ type: 'ai', data: 'junk' })).toMatchObject({ variable: 'reply' });
    expect(flbToRuntimeData({ flowNodeType: 'poll', data: { multi: true } })).toMatchObject({
      allowMultiple: true,
    });
  });

  it.each(FLB_NODE_TYPE_LIST.map((d) => d.id))(
    '%s: default data is kept, idempotent, never mutated',
    (type) => {
      const data = flbDefaultNodeData(type);
      const frozen = JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
      const once = shape(type, data);
      // the input is untouched
      expect(data).toEqual(frozen);
      // additive: every original key survives, and only the normalised-in-place keys may change their value
      const normalised = NORMALISED_IN_PLACE[type] ?? [];
      for (const [k, v] of Object.entries(frozen)) {
        expect(once, `${type}.${k} was dropped`).toHaveProperty(k);
        if (!normalised.includes(k)) expect(once[k], `${type}.${k} was rewritten`).toEqual(v);
      }
      // idempotent: shaping the shaped bag again changes nothing
      expect(shape(type, once)).toEqual(once);
      // and JSON-safe (it is stored on a run)
      expect(JSON.parse(JSON.stringify(once))).toEqual(once);
    },
  );

  it('every shaped type stays idempotent on a messy hand-written bag too', () => {
    const messy = {
      save: ' {{x}} ',
      var: '@y',
      assistant: '9',
      fields: 'a, b',
      options: ['a', { title: 'b' }, 3],
      actions: [{ type: 'URL', value: 'https://a.io' }],
      kind: 'phone',
      phone: '1 2 3',
      lat: '1.5',
      lng: '2.5',
      multi: 1,
      bot: 'b1',
      flow: 'f1',
      amount: '3',
      unit: 'day',
      conditions: [{ variable: '{{v}}', operator: 'gt', value: 1 }],
      operators: ['or'],
      productIds: ['p1'],
      bookingTypeId: '0',
      headers: [{ key: 'K', value: 'V' }],
      port: '3307',
      copyNumber: '+1 (555) 010-0100',
      url: '/rel/x.png',
      replies: [{ type: 'image', url: 'https://a/b.png' }],
      tplId: '5',
      tpl: 't',
    };
    for (const type of FLB_RUNTIME_SHAPED_TYPES) {
      const once = flbToRuntimeData({ type, data: messy }, { baseUrl: 'https://app.test' });
      expect(flbToRuntimeData({ type, data: once }, { baseUrl: 'https://app.test' }), type).toEqual(
        once,
      );
    }
  });
});

describe('flbRuntimeNodeData: a whole graph', () => {
  const graph = {
    flowNodes: [
      { id: 't', type: 'trigger', x: 1, y: 2, isStart: true, data: { kind: 'keyword' } },
      { id: 'a', type: 'ai', x: 3, y: 4, data: { save: 'answer', fields: 'a,b' } },
      { id: 'p', type: 'poll', x: 5, y: 6, data: { multi: true, options: ['x', 'y'] } },
    ],
    flowEdges: [{ id: 'e', source: 't', sourceHandle: 'out', target: 'a' }],
    vars: [{ name: 'v' }],
  };

  it('shapes every node, leaves ids, positions, start flag, edges and vars alone, and does not mutate the input', () => {
    const before = JSON.parse(JSON.stringify(graph)) as unknown;
    const out = flbRuntimeNodeData(graph);
    expect(graph).toEqual(before);
    expect(out.flowEdges).toEqual(graph.flowEdges);
    expect(out.vars).toEqual(graph.vars);
    expect(out.flowNodes.map(({ id, type, x, y }) => ({ id, type, x, y }))).toEqual(
      graph.flowNodes.map(({ id, type, x, y }) => ({ id, type, x, y })),
    );
    expect(out.flowNodes[0]!).toMatchObject({ isStart: true, data: { kind: 'keyword' } });
    expect(out.flowNodes[1]!.data).toMatchObject({
      variable: 'answer',
      fields: ['a', 'b'],
      save: 'answer',
    });
    expect(out.flowNodes[2]!.data).toMatchObject({ allowMultiple: true, multi: true });
    expect(flbRuntimeNodeData(out)).toEqual(out);
  });
});

describe('flbCleanVarName (Reference cleanVar)', () => {
  it.each([
    ['{{name}}', 'name'],
    ['@name', 'name'],
    [' name ', 'name'],
    ['  {{ name }}  ', 'name'],
    ['{{{a}}}', 'a'],
    ['', 'dflt'],
    ['   ', 'dflt'],
    ['{{}}', 'dflt'],
    ['@', 'dflt'],
    ['first name', 'first name'],
  ])('%j becomes %j', (input, expected) => {
    expect(flbCleanVarName(input, 'dflt')).toBe(expected);
  });
  it('null and undefined are the default', () => {
    expect(flbCleanVarName(null, 'd')).toBe('d');
    expect(flbCleanVarName(undefined, 'd')).toBe('d');
  });
});
