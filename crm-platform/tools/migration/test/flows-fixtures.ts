/**
 * INVENTED bots, versions, steps, widgets and FAQ phrases for the flows tests. Shapes follow the masked pilot profiles
 * (bot_flow_version_data: node-per-record with qid / nodeId / subType / displayOrder and response[0].interactive; bot_workspace: Flow /
 * Intent / FAQ records; chatbots + chatbot_configuration + chatbot_theme joined by id; createdAt a Date on some steps and a string on
 * others). Every id, name, text and key here is made up; the "keys" are fake strings in the shape of vendor keys.
 */
import { O } from './fixtures';

type J = Record<string, unknown>;
const D = (iso: string): J => ({ $date: iso });

let n0 = 1_700_000;
const oid = (): J => O(n0++);

export const nid = (n: number): string =>
  `${n.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
export const bid = (n: number): string =>
  `bot-${n.toString().padStart(4, '0')}-0000-4000-8000-000000000000`;

export const FAKE_OPENAI = 'sk-FAKEFAKEFAKEFAKEFAKEFAKE0001';
export const FAKE_ROUTER = 'or-FAKEROUTERKEY-0000000000000002';
export const FAKE_META = 'EAAFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE00003';

export interface NodeOpts {
  bot: string;
  version?: string | null;
  qid: string;
  node: number;
  sub: string;
  order: number;
  response?: unknown[];
  extra?: J;
  created?: string;
  asString?: boolean;
  type?: string;
}
/** One node record (bot_flow_version_data / bot_workspace Flow). */
export function node(o: NodeOpts): J {
  const at = o.created ?? '2026-03-01T10:00:00Z';
  return {
    _id: oid(),
    botid: o.bot,
    ...(o.version === null ? {} : { version_id: o.version ?? 'v-published' }),
    nodeId: nid(o.node),
    id: `${nid(o.node)}-rec`,
    name: `step ${o.node}`,
    qid: o.qid,
    displayOrder: o.order,
    type: o.type ?? 'Flow',
    subType: o.sub,
    stage: '1.1',
    isUnsaved: false,
    response: o.response ?? [
      { type: 'text', id: 'r1', value: `<p>Hello &amp; welcome ${o.node}</p>` },
    ],
    createdAt: o.asString ? at : D(at),
    updatedAt: o.asString ? at : D(at),
    ...o.extra,
  };
}

const inter = (body: string, buttons: unknown[], header?: unknown): J => ({
  type: 'interactive',
  id: 'i1',
  interactive: {
    type: 'button',
    body: { text: body },
    ...(header ? { header } : {}),
    action: { buttons },
  },
});
const flowBtn = (text: string, nodeId: string): J => ({
  type: 'flow',
  id: `b-${text}`,
  value: { text, nodeId },
});

export function version(
  bot: string,
  id: string,
  status: string,
  createdAt: string,
  publishedAt: string,
): J {
  return {
    _id: oid(),
    version_id: id,
    version_name: `name ${id}`,
    botid: bot,
    status,
    createdAt: D(createdAt),
    createdBy: 'someone',
    publishedAt: D(publishedAt),
    publishedBy: 'someone',
  };
}

export function chatbot(n: number, o: J = {}): J {
  return {
    _id: oid(),
    id: `cb${n.toString().padStart(6, '0')}`,
    name: `Bot ${n}`,
    description: 'a made-up bot',
    bot_id: bid(n),
    project_version_id: 'VxdN3w',
    deploy_url: null,
    chatbot_status: false,
    bot_enabled: false,
    channel: 'whatsapp',
    business_id: 'biz-1',
    workspace_id: 'ws-1',
    chatbot_configuration: `cfg${n.toString().padStart(8, '0')}`,
    chatbot_theme: `thm${n.toString().padStart(8, '0')}`,
    primary_language: 'english',
    multi_lingual: { multi_lingual: false },
    chatbot_languages: [],
    created_time: '2026-02-12T09:00:00Z',
    modified_time: D('2026-04-01T09:00:00Z'),
    deleted_time: null,
    is_active: true,
    ...o,
  };
}

export function config(n: number, o: J = {}): J {
  return {
    _id: oid(),
    id: `cfg${n.toString().padStart(8, '0')}`,
    created_time: D('2026-02-12T09:00:00Z'),
    modified_time: D('2026-04-02T09:00:00Z'),
    deleted_time: null,
    desktop_triggering_time: 5,
    desktop_auto_triggering: true,
    consent_configuration: {},
    active_timings: { monday: {}, activeOperatingHours: false, timezone: 'UTC' },
    quick_menu: { enabled: false, data: [] },
    remove_branding: false,
    display_position: 'right',
    desktop_display_position: 'left',
    desktop_side_margin: 20,
    desktop_bottom_margin: 30,
    company_logo: 'logo-file-ref',
    avatar: null,
    background_image: null,
    welcome_message_text: 'Hi, how can we help?',
    whatsapp_welcome_message_text: 'Hello from WhatsApp',
    cta_button_text: 'Chat now',
    whatsapp_prefilled_message_text: 'I want to know more',
    subheader_text: 'We reply fast',
    ...o,
  };
}

export function theme(n: number, o: J = {}): J {
  return {
    _id: oid(),
    id: `thm${n.toString().padStart(8, '0')}`,
    created_time: D('2026-02-12T09:00:00Z'),
    modified_time: D('2026-04-03T09:00:00Z'),
    deleted_time: null,
    primary: { main: '#112233' },
    secondary: null,
    font: { primary: {} },
    button: { background: '#445566', text: '#FFFFFF', button_type: {} },
    button_hover: { background: '#000000' },
    ...o,
  };
}

const ai = (o: J = {}): J => ({
  enabled: true,
  model: 'gpt-4o-mini',
  temperature: 0.4,
  prompt: 'You are a helpful assistant for Acme.',
  auto_router: false,
  normalKey: FAKE_OPENAI,
  openRouterKey: FAKE_ROUTER,
  ...o,
});

export interface FlowsDump {
  chatbots: J[];
  chatbot_configuration: J[];
  chatbot_theme: J[];
  bot_flow_version: J[];
  bot_flow_version_data: J[];
  bot_workspace: J[];
  flows: J[];
  faq_variations: J[];
  broadcast_templates: J[];
  journey: J[];
}

const empty = (): FlowsDump => ({
  chatbots: [],
  chatbot_configuration: [],
  chatbot_theme: [],
  bot_flow_version: [],
  bot_flow_version_data: [],
  bot_workspace: [],
  flows: [],
  faq_variations: [],
  broadcast_templates: [],
  journey: [],
});

/** The main fixture: every shape of the spec's list, one bot each. */
export function acmeFlows(): FlowsDump {
  const d = empty();
  const A = bid(1);
  // --- bot 1: a published flow with 3 versions, every kind of loss -------------------------------------------------------------
  d.chatbots.push(chatbot(1, { name: 'Support Bot' }));
  d.bot_flow_version.push(
    version(A, 'v-published', 'published', '2026-03-01T00:00:00Z', '2026-03-05T00:00:00Z'),
    version(A, 'v-old', 'unpublished', '2026-02-01T00:00:00Z', '2026-02-02T00:00:00Z'),
    version(A, 'v-draft', 'draft', '2026-04-10T00:00:00Z', '2026-04-10T00:00:00Z'),
  );
  const P = 'v-published';
  const nodes = d.bot_flow_version_data;
  // journey Q1 (displayOrder with gaps)
  nodes.push(
    node({ bot: A, version: P, qid: 'Q1', node: 1, sub: 'text', order: 0 }),
    node({
      bot: A,
      version: P,
      qid: 'Q1',
      node: 2,
      sub: 'interactive-message',
      order: 3,
      response: [
        inter(
          'Pick one',
          [
            flowBtn('Pricing', nid(11)),
            { type: 'live_agent', id: 'agent-0001-xxxx', value: { text: 'Talk to agent' } },
            { type: 'url', id: 'u1', value: { text: 'Site', url: 'https://example.test' } },
          ],
          { type: 'image', image: { link: 'https://cdn.example.test/h.png' } },
        ),
      ],
      extra: { variable: 'choice' },
    }),
    // after a buttons step: a new chain nobody links to (an orphan in the source too)
    node({
      bot: A,
      version: P,
      qid: 'Q1',
      node: 3,
      sub: 'text',
      order: 7,
      created: '2026-03-02T10:00:00Z',
      asString: true,
    }),
  );
  // journey Q2
  nodes.push(
    node({
      bot: A,
      version: P,
      qid: 'Q2',
      node: 11,
      sub: 'text',
      order: 0,
      extra: {
        quickActions: [{ label: 'x' }],
        actions: [
          { id: 'a1', type: 'api', apiLibraryId: 'api-lib-1', name: 'call' },
          { id: 'a2', type: 'connect_node', nodeId: nid(13) },
        ],
      },
    }),
    node({
      bot: A,
      version: P,
      qid: 'Q2',
      node: 12,
      sub: 'email',
      order: 1,
      response: [{ type: 'text', id: 'r', value: 'Your email?' }],
      extra: {
        property: { name: 'Email', type: 'x', property: { value: 'email' } },
        variable: 'mail',
      },
    }),
    node({
      bot: A,
      version: P,
      qid: 'Q2',
      node: 13,
      sub: 'whatsapp-template',
      order: 2,
      response: [{ type: 'template', id: 't', template_id: 'tpl-1', variables: ['a'] }],
    }),
    node({
      bot: A,
      version: P,
      qid: 'Q2',
      node: 14,
      sub: 'whatsapp-template',
      order: 3,
      response: [{ type: 'template', id: 't', template_id: 'tpl-unknown' }],
    }),
    node({ bot: A, version: P, qid: 'Q2', node: 15, sub: 'button', order: 4 }), // unsupported subType
    node({
      bot: A,
      version: P,
      qid: 'Q2',
      node: 16,
      sub: 'text',
      order: 5,
      response: [
        {
          type: 'image',
          id: 'm',
          value: { text: 'caption', url: 'https://cdn.example.test/p.png' },
        },
        { type: 'text', id: 'm2', value: 'second response' },
      ],
      extra: { actions: [{ id: 'c', type: 'connect_node', nodeId: nid(11) }] }, // a loop back to the start of Q2
    }),
    node({ bot: A, version: P, qid: 'Q2', node: 12, sub: 'text', order: 6 }), // the same nodeId again
    node({ bot: A, version: P, qid: 'OPT-IN', node: 17, sub: 'text', order: 0 }),
    {
      ...node({ bot: A, version: P, qid: 'Q2', node: 18, sub: 'text', order: 9 }),
      nodeId: 42, // not a string: not a step
    },
  );
  // an older version and the draft hold other steps (never imported)
  nodes.push(
    node({ bot: A, version: 'v-old', qid: 'Q1', node: 21, sub: 'text', order: 0 }),
    node({ bot: A, version: 'v-draft', qid: 'Q1', node: 22, sub: 'text', order: 0 }),
  );
  // the draft copy: Intent / FAQ records with a string and a list for question / query
  d.bot_workspace.push(
    {
      _id: oid(),
      botid: A,
      qid: 'Q1',
      type: 'Intent',
      intent: 'greet',
      query: 'ignored',
      question: ['Help', 'Support me'],
      journey: { qid: 'Q1', name: 'Support', displayOrder: 0, nodeCounts: 3, nodeId: nid(1) },
      node: { nodeId: nid(1), value: 'v' },
      createdAt: D('2026-03-01T00:00:00Z'),
      updatedAt: D('2026-03-01T00:00:00Z'),
    },
    {
      _id: oid(),
      botid: A,
      qid: 'Q2',
      type: 'Intent',
      intent: 'price',
      query: ['pricing', 'cost'],
      question: '',
      journey: { qid: 'Q2', name: 'Prices', displayOrder: 1, nodeCounts: 6, nodeId: nid(11) },
      node: { nodeId: nid(11), value: 'v' },
      createdAt: D('2026-03-01T00:00:00Z'),
      updatedAt: D('2026-03-01T00:00:00Z'),
    },
    {
      _id: oid(),
      botid: A,
      qid: 'Q2',
      type: 'FAQ',
      intent: 'x',
      query: 'faq q',
      question: 'what is the price',
      journey: { qid: 'Q2', name: 'Prices' },
      node: { nodeId: nid(11), value: 'v' },
      createdAt: D('2026-03-01T00:00:00Z'),
      updatedAt: D('2026-03-01T00:00:00Z'),
    },
    {
      _id: oid(),
      botid: A,
      qid: 'Qx',
      type: 'Intent',
      intent: 'none',
      query: 'no journey here',
      question: 'no journey here',
    },
    { _id: oid(), botid: A, qid: 'Qy', type: 'Mystery' },
    // a draft step (not used while the published version is)
    node({ bot: A, version: null, qid: 'Q1', node: 31, sub: 'text', order: 0, type: 'Flow' }),
  );
  d.flows.push(
    {
      _id: oid(),
      botid: A,
      qid: 'Q1',
      name: 'Support',
      displayOrder: 0,
      createdAt: D('2026-03-01T00:00:00Z'),
      updatedAt: D('2026-03-01T00:00:00Z'),
      'main-flow': false,
    },
    {
      _id: oid(),
      botid: A,
      qid: 'Q2',
      name: 'Prices',
      displayOrder: 1,
      createdAt: D('2026-03-01T00:00:00Z'),
      updatedAt: D('2026-03-01T00:00:00Z'),
      'main-flow': true,
      version_id: 'v-ghost',
    },
  );
  d.journey.push({ _id: oid(), botid: A, nodeId: nid(31), qid: 'Q1', type: 'Flow' });
  d.broadcast_templates.push({
    _id: oid(),
    id: 'tpl-1',
    meta_template_id: '1234567890123456',
    name: 'welcome_offer',
    language: 'en',
  });
  d.faq_variations.push(
    {
      _id: oid(),
      botid: A,
      qid: 'Q2',
      phrases: [
        'how much',
        'what is the price',
        'How Much',
        'price, please',
        'cost',
        ...Array.from(
          { length: 8 },
          (_, i) => `a rather long way to ask about the price number ${i} ${'x'.repeat(30)}`,
        ),
        'z'.repeat(300),
      ],
    },
    { _id: oid(), botid: bid(99), qid: 'Q9', phrases: ['unknown bot'] },
    { _id: oid(), botid: A, qid: 'Q2', phrases: [] },
  );

  // --- bot 2: draft only, string dates, a list step ---------------------------------------------------------------------------------
  const B = bid(2);
  d.chatbots.push(chatbot(2, { name: 'Support Bot' })); // the same name: gets "(2)"
  d.bot_workspace.push(
    node({ bot: B, version: null, qid: 'W1', node: 101, sub: 'text', order: 0, asString: true }),
    node({
      bot: B,
      version: null,
      qid: 'W1',
      node: 102,
      sub: 'interactive-message-list',
      order: 1,
      asString: true,
      response: [
        {
          type: 'interactive',
          id: 'l',
          interactive: {
            body: { text: 'Choose' },
            action: {
              button: 'Options',
              sections: [
                {
                  title: 'S',
                  rows: [
                    { type: 'flow', value: { text: 'One', nodeId: nid(103) } },
                    { type: 'flow', value: { text: 'Two', nodeId: nid(999) } },
                  ],
                },
              ],
            },
          },
        },
      ],
    }),
    node({
      bot: B,
      version: null,
      qid: 'W2',
      node: 103,
      sub: 'phone-number',
      order: 0,
      asString: true,
    }),
    node({ bot: B, version: null, qid: 'W2', node: 104, sub: 'text', order: 1, asString: true }),
  );
  // a version header that points at no data, plus a flows header of a missing version
  d.bot_flow_version.push(
    version(B, 'v-empty', 'published', '2026-04-01T00:00:00Z', '2026-04-02T00:00:00Z'),
  );

  // --- bot 3: a website bot with the whole widget (and AI keys) -----------------------------------------------------------------------
  d.chatbots.push(chatbot(3, { name: 'Web Widget', channel: 'Web Bot', prompt: 'old prompt' }));
  d.chatbot_configuration.push(
    config(3, {
      'ai_configuration ': ai({ temperature: 0.1 }),
      ai_configuration: ai(),
      modelName: 'gpt-4o-mini',
      banned_users: { x: 1 },
      email_notification: { enabled: true, token: FAKE_META },
    }),
  );
  d.chatbot_theme.push(theme(3));

  // --- bot 4: a WhatsApp bot with its own number: a flow AND a widget; the theme is missing ------------------------------------
  const E = bid(4);
  d.chatbots.push(chatbot(4, { name: 'Numbered Bot', whatsapp_number: '+91 98765 43210' }));
  d.chatbot_configuration.push(config(4, { ai_configuration: { enabled: false } }));
  d.chatbot_theme.push(theme(40)); // belongs to nobody
  d.bot_flow_version.push(
    version(E, 'v4', 'unpublished', '2026-04-01T00:00:00Z', '2026-04-01T00:00:00Z'),
  );
  d.bot_flow_version_data.push(
    node({ bot: E, version: 'v4', qid: 'N1', node: 401, sub: 'text', order: 0 }),
  );
  d.chatbots[d.chatbots.length - 1]!.chatbot_theme = 'missing-theme';

  // --- bot 5: deleted; bot 6: switched off; bot 7: secret in a step; bot 8: nothing usable -----------------------------------------
  d.chatbots.push(chatbot(5, { deleted_time: D('2026-05-01T00:00:00Z') }));
  d.bot_flow_version_data.push(
    node({ bot: bid(5), version: 'v5', qid: 'D1', node: 501, sub: 'text', order: 0 }),
  );
  d.chatbots.push(chatbot(6, { is_active: false }));
  d.chatbots.push(chatbot(7, { name: 'Leaky' }));
  d.bot_flow_version_data.push(
    node({
      bot: bid(7),
      version: 'v7',
      qid: 'L1',
      node: 701,
      sub: 'text',
      order: 0,
      response: [{ type: 'text', id: 'x', value: `token ${FAKE_META}` }],
    }),
  );
  d.chatbots.push(chatbot(8, { name: 'Empty' }));
  // orphan version data of a bot that has no chatbots document
  d.bot_flow_version_data.push(
    node({ bot: bid(9), version: 'v9', qid: 'G1', node: 901, sub: 'text', order: 0 }),
  );
  return d;
}

/** A second client with one tiny bot (isolation between organizations). */
export function globexFlows(): FlowsDump {
  const d = empty();
  const A = bid(1);
  d.chatbots.push(chatbot(1, { name: 'Globex Bot' }));
  d.bot_flow_version.push(
    version(A, 'g1', 'published', '2026-03-01T00:00:00Z', '2026-03-02T00:00:00Z'),
  );
  d.bot_flow_version_data.push(
    node({ bot: A, version: 'g1', qid: 'G', node: 1, sub: 'text', order: 0 }),
    node({ bot: A, version: 'g1', qid: 'G', node: 2, sub: 'text', order: 1 }),
  );
  return d;
}

/** Many bots, for the volume test. */
export function bulkFlows(bots: number, steps: number): FlowsDump {
  const d = empty();
  for (let b = 1; b <= bots; b++) {
    const id = bid(1000 + b);
    d.chatbots.push(chatbot(1000 + b, { name: `Bulk ${b}` }));
    d.bot_flow_version.push(
      version(id, `bv${b}`, 'published', '2026-03-01T00:00:00Z', '2026-03-02T00:00:00Z'),
    );
    for (let s = 0; s < steps; s++)
      d.bot_flow_version_data.push(
        node({ bot: id, version: `bv${b}`, qid: 'B', node: b * 1000 + s, sub: 'text', order: s }),
      );
    d.faq_variations.push({ _id: oid(), botid: id, qid: 'B', phrases: [`phrase ${b}`] });
  }
  return d;
}
