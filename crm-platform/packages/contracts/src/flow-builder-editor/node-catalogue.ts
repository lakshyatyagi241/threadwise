/**
 * The flow node catalogue (TW-FLB-016, 017, 030..067): every node type the builder can place, the channels each one
 * runs on, the data a fresh node starts with, and the output ports a node exposes. One definition shared by the
 * canvas, the server-side save validation, the import path and (later) the runtime, so the four cannot drift
 * (Reference kept the matrix in one JavaScript file and a second copy in PHP).
 *
 * The visual side (icon, colour chip) is the web feature's; this file is data and pure functions only.
 */

/** The ten channels a flow can run on. `chat` is WhatsApp (any engine). */
export const FLOW_TYPES = [
  'chat',
  'call',
  'instagram',
  'facebook',
  'tiktok',
  'telegram',
  'line',
  'wechat',
  'viber',
  'email',
] as const;
export type FlowType = (typeof FLOW_TYPES)[number];

/** The eight social and email channels that share the common Send / Listen / Logic / AI nodes. */
export const SOCIAL_FLOW_TYPES = [
  'instagram',
  'facebook',
  'tiktok',
  'telegram',
  'line',
  'wechat',
  'viber',
  'email',
] as const satisfies readonly FlowType[];

/** Channels a Trigger node can switch to (everything except `call`, which is a distinct builder). */
export const MESSAGING_FLOW_TYPES = [
  'chat',
  ...SOCIAL_FLOW_TYPES,
] as const satisfies readonly FlowType[];

export const FLOW_TYPE_LABELS: Record<FlowType, string> = {
  chat: 'WhatsApp',
  call: 'Call',
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  telegram: 'Telegram',
  line: 'LINE',
  wechat: 'WeChat',
  viber: 'Viber',
  email: 'Email',
};

export const FLB_NODE_GROUPS = [
  'Start',
  'Send',
  'Listen',
  'Logic',
  'AI',
  'Contact',
  'Engage',
  'Commerce',
  'Integrations',
  'CRM',
  'Voice',
  'Call routing',
  'Call control',
  'Instagram',
  'Facebook',
  'Telegram',
] as const;
export type FlbNodeGroup = (typeof FLB_NODE_GROUPS)[number];

export interface FlbNodeTypeDef {
  id: string;
  label: string;
  group: FlbNodeGroup;
  desc: string;
  /** Channels the node can be placed on. Default (omitted in the table below) is chat only. */
  modes: readonly FlowType[];
  /** Only one per flow (the Trigger). */
  singleton?: boolean;
  /** Legacy type: still rendered on existing flows, never offered in the palette. */
  hidden?: boolean;
  /** No output (the flow stops here). */
  terminal?: boolean;
}

const ALL = FLOW_TYPES;
const SOCIAL_AND_CHAT = ['chat', ...SOCIAL_FLOW_TYPES] as const;
const CHAT = ['chat'] as const;
const CALL = ['call'] as const;

const def = (
  id: string,
  label: string,
  group: FlbNodeGroup,
  desc: string,
  modes: readonly FlowType[] = CHAT,
  extra: Partial<Pick<FlbNodeTypeDef, 'singleton' | 'hidden' | 'terminal'>> = {},
): FlbNodeTypeDef => ({ id, label, group, desc, modes, ...extra });

/** Insertion order is the palette order within a group. */
export const FLB_NODE_TYPE_LIST: readonly FlbNodeTypeDef[] = [
  def('trigger', 'Trigger', 'Start', 'Where the flow starts', ALL, { singleton: true }),
  def('message', 'Send message', 'Send', 'Plain text message', SOCIAL_AND_CHAT),
  def('template', 'Send template', 'Send', 'Approved template'),
  def('media', 'Send media', 'Send', 'Image, video, doc, audio', SOCIAL_AND_CHAT),
  def('notify_number', 'Copy to number', 'Send', 'Send a copy to a fixed number'),
  def('wa_to_instagram', 'Hand off to Instagram', 'Engage', 'Send the user an Instagram DM link'),
  def('sequence', 'Send sequence', 'Send', 'Stack text + media in one node'),
  def('buttons', 'Quick replies', 'Send', 'Tap-to-pick reply buttons', SOCIAL_AND_CHAT),
  def('list', 'List message', 'Send', 'Interactive list picker'),
  def('ask', 'Ask question', 'Listen', 'Save user reply to a var', SOCIAL_AND_CHAT),
  // Not Reference nodes: an addition the project owner asked for (TW-FLB-081, 082). WhatsApp only: they wait for a media / location message.
  def('ask_file', 'Ask for file / image', 'Listen', 'Wait for a photo, document, video or audio'),
  def('ask_location', 'Ask for location', 'Listen', 'Wait for the customer to share a location'),
  def('condition', 'Condition', 'Logic', 'If / else branch', ALL),
  def('delay', 'Wait', 'Logic', 'Pause for X minutes', ALL),
  def('webhook', 'Webhook', 'Logic', 'Call external HTTPS endpoint', ALL),
  // NOT instagram: the JS sandbox is node:vm and the Instagram runner is not the Node VM.
  def('code', 'Run code (JS)', 'Logic', 'Sandboxed JavaScript transform', ['chat', 'call']),
  def('mysql', 'MySQL Query', 'Logic', 'Run a read-only SQL query'),
  def('ai', 'AI assistant', 'AI', 'Reply with ChatGPT or Gemini', SOCIAL_AND_CHAT),
  def('tag', 'Tag contact', 'Contact', 'Add or remove a tag'),
  def('assign', 'Assign agent', 'Contact', 'Hand off to a human'),
  def('subflow', 'Run sub-flow', 'Logic', 'Call another flow'),
  def('end', 'End', 'Start', 'Stop the flow here', ALL, { terminal: true }),
  def('cta', 'Call to action', 'Engage', 'Send a CTA button'),
  def('location', 'Location', 'Engage', 'Send a map pin'),
  def('poll', 'Poll', 'Engage', 'Send a poll'),
  def('chatbot', 'Chatbot', 'Engage', 'Trigger another chatbot'),
  def('whatsapp_shop', 'WhatsApp Shop', 'Commerce', 'Open WhatsApp catalog'),
  def('woocommerce', 'WooCommerce', 'Commerce', 'Send WooCommerce product'),
  def('shopify', 'Shopify', 'Commerce', 'Send Shopify product'),
  def('book_appointment', 'Book appointment', 'Engage', 'Book one of your services in chat'),
  def('ai_call', 'AI voice call', 'Engage', 'Call the customer with an AI voice agent'),
  def('google_meet', 'Google Meet', 'Engage', 'Create + send a Meet link'),
  def('wa_form', 'WhatsApp form', 'Engage', 'Send a published Meta form'),
  def('google_sheets', 'Google Sheets', 'Integrations', 'Write or read a row'),
  def('google_docs', 'Google Docs', 'Integrations', 'Generate from a template'),
  def('google_form', 'Google Form', 'Integrations', 'Send link, capture answers'),
  def('deal', 'Create / move deal', 'CRM', 'Create or advance a CRM deal'),

  // Call flow (AI voice IVR): only when flow_type = call.
  def('cf_say', 'Say', 'Voice', 'Speak a line (text-to-speech)', CALL),
  def('cf_listen', 'Listen', 'Voice', 'Capture caller speech → variable', CALL),
  def('cf_ai', 'AI Respond', 'Voice', 'AI answers, spoken back', CALL),
  def('cf_assistant', 'AI Assistant', 'Voice', 'Answer with a voice agent', CALL),
  def('cf_menu', 'Menu / Branch', 'Call routing', 'Route by intent / digit', CALL),
  def('cf_search', 'Search web', 'Call routing', 'Look up the web → variable', CALL),
  def('cf_transfer', 'Transfer', 'Call control', 'Hand the call to a human', CALL),
  def('cf_hangup', 'Hang up', 'Call control', 'End the call', CALL, { terminal: true }),

  // Instagram. The first four legacy types are superseded by the shared nodes but still render on old flows.
  def('ig_send_dm', 'Send DM', 'Instagram', 'Send a direct message', ['instagram'], {
    hidden: true,
  }),
  def('ig_quick', 'Quick replies', 'Instagram', 'DM with tap-to-pick buttons', ['instagram'], {
    hidden: true,
  }),
  def('ig_buttons', 'Button message', 'Instagram', 'DM with URL / action buttons', ['instagram']),
  def('ig_reply_comment', 'Reply to comment', 'Instagram', 'Public reply under the comment', [
    'instagram',
  ]),
  def('ig_ai', 'AI Reply', 'Instagram', 'AI answers with your knowledge base', ['instagram'], {
    hidden: true,
  }),
  def('ig_products', 'Send products', 'Instagram', 'Shoppable carousel from your catalog', [
    'instagram',
  ]),
  def(
    'ig_ask',
    'Ask a question',
    'Instagram',
    'Ask, then save the reply to a variable',
    ['instagram'],
    { hidden: true },
  ),
  def('ig_lead', 'Capture lead', 'Instagram', 'Save name / email / phone as a lead + deal', [
    'instagram',
  ]),
  def(
    'ig_to_whatsapp',
    'Hand off to WhatsApp',
    'Instagram',
    'Move the conversation from Instagram to a WhatsApp flow',
    ['instagram'],
  ),

  // Facebook Messenger.
  def('fb_gallery', 'Card gallery', 'Facebook', 'Generic-template carousel of custom cards', [
    'facebook',
  ]),
  def('fb_products', 'Send products', 'Facebook', 'Shoppable carousel with Order buttons', [
    'facebook',
  ]),
  def('fb_lead', 'Capture lead', 'Facebook', 'Save name / email / phone as a lead + deal', [
    'facebook',
  ]),
  def(
    'fb_reply_comment',
    'Reply to comment',
    'Facebook',
    'Public reply under the triggering comment',
    ['facebook'],
  ),
  def(
    'fb_to_whatsapp',
    'Hand off to WhatsApp',
    'Facebook',
    'Move the Messenger chat to a WhatsApp flow',
    ['facebook'],
  ),

  // Telegram.
  def(
    'tg_payment',
    'Payment / Invoice',
    'Telegram',
    'Send a Telegram invoice or a shareable pay link',
    ['telegram'],
  ),
];

export const FLB_NODE_TYPES: Readonly<Record<string, FlbNodeTypeDef>> = Object.fromEntries(
  FLB_NODE_TYPE_LIST.map((d) => [d.id, d]),
);

export const flbNodeTypeDef = (type: string): FlbNodeTypeDef | undefined => FLB_NODE_TYPES[type];

export const flbNodeInMode = (def: FlbNodeTypeDef, mode: FlowType): boolean =>
  def.modes.includes(mode);

export const flbIsFlowType = (v: unknown): v is FlowType =>
  typeof v === 'string' && (FLOW_TYPES as readonly string[]).includes(v);

/** The node types the palette offers for one channel, in catalogue order. Legacy (`hidden`) types are never offered. */
export function flbPaletteFor(mode: FlowType): FlbNodeTypeDef[] {
  return FLB_NODE_TYPE_LIST.filter((d) => !d.hidden && flbNodeInMode(d, mode));
}

// --- defaults -------------------------------------------------------------------------------------------------------

export type FlbNodeData = Record<string, unknown>;

/** What a fresh node of `type` carries (Reference `defaultData`). Unknown types start empty. */
export function flbDefaultNodeData(type: string): FlbNodeData {
  switch (type) {
    case 'trigger':
      return {
        kind: 'keyword',
        keywordMode: 'keywords',
        keywords: 'price, pricing, cost',
        tagId: '',
        groupId: '',
        deviceId: '',
        keywordRuleIds: [],
      };
    case 'message':
      return { text: 'Type your message…' };
    case 'template':
      return { tpl: '' };
    case 'media':
      return { kind: 'image', filename: '', caption: '' };
    case 'notify_number':
      return {
        copyNumber: '',
        source: 'mirror',
        kind: 'text',
        text: 'A new update:\n{{name}}',
        url: '',
        filename: '',
        caption: '',
      };
    case 'wa_to_instagram':
      return { igUsername: '', introText: 'Continue with us on Instagram 👇' };
    case 'sequence':
      return { replies: [{ type: 'text', text: 'Hi {{name}}!' }] };
    case 'buttons':
      return { prompt: 'Pick one', options: ['Option A', 'Option B'], var: 'choice' };
    case 'list':
      return {
        prompt: 'Pick from list',
        button: 'View options',
        var: 'choice',
        options: [
          { title: 'Item 1', description: '', section: '' },
          { title: 'Item 2', description: '', section: '' },
          { title: 'Item 3', description: '', section: '' },
        ],
      };
    case 'ask':
      return {
        prompt: "What's your name?",
        var: 'answer',
        validate: 'text',
        options: [],
        // Used when "Validate as" is not free text: the date shape, the wrong-answer text (blank: a ready-made one), how many wrong
        // answers are tolerated (0: keep asking), what happens after that, and the contact property the answer is also saved to.
        dateFormat: 'dd-mm-yyyy',
        wrongReply: '',
        retries: 0,
        onFail: 'continue',
        saveProperty: false,
        propertyKey: '',
      };
    case 'ask_file':
      return {
        prompt: 'Please send the file or image.',
        extensions: [],
        var: 'file',
        retries: 2,
        wrongReply: 'That is not a file we can accept. Please send it as an attachment.',
        skipKeyword: '',
        onFail: 'continue',
        timeoutMinutes: 0,
        saveProperty: false,
        propertyKey: '',
      };
    case 'ask_location':
      return {
        prompt: 'Please share your location with us.',
        var: 'location',
        interactive: true,
        retries: 2,
        wrongReply: 'Please share your location with the attachment (+) menu, then Location.',
        skipKeyword: '',
        onFail: 'continue',
        timeoutMinutes: 0,
      };
    case 'condition':
      return { conditions: [{ variable: '', operator: 'equals', value: '' }], operators: [] };
    case 'delay':
      return { amount: 5, unit: 'min' };
    case 'webhook':
      return {
        method: 'POST',
        url: '',
        body: '',
        contentType: 'application/json',
        headers: [],
        save: 'response',
      };
    case 'code':
      return {
        code: '// Available variables:\n// - previousResponse : output of the previous node\n// - allResponses     : every saved {{variable}} so far\n// - functionArgs     : args passed in\n\nreturn {\n  ok: true,\n  message: "Hello from the code node"\n};',
        save: 'result',
      };
    case 'mysql':
      return {
        host: 'localhost',
        port: '3306',
        database: '',
        username: '',
        password: '',
        sql: 'SELECT * FROM products WHERE field = {{field}}',
        save: 'rows',
      };
    case 'ai':
      return {
        model: 'gpt-4o-mini',
        prompt: 'You are a friendly support assistant. Reply briefly.',
        save: 'reply',
        assistant: '',
        extract: false,
        silent: false,
        fields: '',
      };
    case 'cf_say':
      return { text: 'Hello! Thanks for calling.' };
    case 'cf_listen':
      return { save: 'caller_said', silenceTimeout: 6 };
    case 'cf_ai':
      return {
        model: 'gpt-4o-mini',
        prompt: 'You are a helpful phone assistant. Keep answers short and natural.',
        assistant: '',
        save: 'ai_reply',
        endOnGoodbye: true,
      };
    case 'cf_assistant':
      return { assistant: '', prompt: '', save: 'assistant_reply', endOnGoodbye: true };
    case 'cf_menu':
      return {
        mode: 'intent',
        options: [
          { match: 'sales', label: 'Sales' },
          { match: 'support', label: 'Support' },
        ],
      };
    case 'cf_search':
      return { query: '{{caller_said}}', save: 'search', filler: 'One moment, let me check that…' };
    case 'cf_transfer':
      return { number: '', message: 'Connecting you to an agent now.' };
    case 'cf_hangup':
      return { goodbye: 'Thanks for calling. Goodbye!' };
    case 'ig_send_dm':
      return { text: 'Hi! Thanks for your message.' };
    case 'ig_quick':
      return {
        text: 'What can I help you with?',
        options: [
          { title: 'Pricing', payload: 'PRICING' },
          { title: 'Support', payload: 'SUPPORT' },
        ],
      };
    case 'ig_buttons':
      return {
        text: 'Tap a button below:',
        buttons: [
          { type: 'web_url', title: 'Visit site', url: 'https://' },
          { type: 'postback', title: 'Talk to us', payload: 'CONTACT' },
        ],
      };
    case 'ig_reply_comment':
      return { message: 'Thanks! Just sent you a DM.' };
    case 'ig_ai':
      return {
        model: 'gpt-4o-mini',
        prompt: 'You are our friendly Instagram assistant. Answer briefly and warmly.',
        assistant: '',
        save: 'ai_reply',
      };
    case 'ig_products':
      return {
        selection: 'pick',
        productIds: [],
        limit: 5,
        intro: 'Here are some products you might like:',
        orderButton: true,
        orderLabel: 'Order',
        detailsButton: true,
        detailsLabel: 'View',
      };
    case 'ig_ask':
      return { question: 'What is your name?', save: 'lead_name' };
    case 'ig_lead':
    case 'fb_lead':
      return {
        nameVar: 'lead_name',
        emailVar: 'lead_email',
        phoneVar: 'lead_phone',
        notesVar: '',
        createDeal: true,
        ack: 'Thanks! Our team will reach out shortly.',
      };
    case 'ig_to_whatsapp':
    case 'fb_to_whatsapp':
      return {
        mode: 'deeplink',
        waNumber: '',
        prefillText:
          type === 'ig_to_whatsapp' ? 'Hi! I came from Instagram' : 'Hi! I came from Facebook',
        introText: "Let's continue on WhatsApp 👇",
        numberVar: 'wa_number',
        waFlowId: '',
      };
    case 'fb_gallery':
      return {
        cards: [
          {
            title: 'Card title',
            subtitle: '',
            imageUrl: '',
            buttonLabel: 'Learn more',
            buttonUrl: 'https://',
          },
        ],
        intro: '',
      };
    case 'fb_products':
      return {
        products: [{ title: 'Product name', subtitle: '', imageUrl: '', url: '' }],
        intro: 'Here are some products you might like:',
        orderButton: true,
        orderLabel: 'Order',
        detailsButton: true,
        detailsLabel: 'View',
      };
    case 'fb_reply_comment':
      return { text: 'Thanks! Just sent you a DM.' };
    case 'tg_payment':
      return {
        mode: 'invoice',
        title: 'Order payment',
        description: 'Complete your purchase',
        label: 'Total',
        currency: 'USD',
        amount: '9.99',
        payload: '',
        linkText: 'Tap to pay:',
        wait: false,
      };
    case 'tag':
      return { action: 'add', tag: '', tagId: '' };
    case 'assign':
      return { team: '', userId: '', message: '' };
    case 'subflow':
      return { flow: '' };
    case 'end':
      return {};
    case 'cta':
      return { actions: [{ type: 'url', label: 'Visit website', value: 'https://example.com' }] };
    case 'location':
      return { lat: '', lng: '', address: 'Office address', title: 'Our office' };
    case 'poll':
      return { question: 'Pick one', options: ['Option A', 'Option B'], multi: false };
    case 'chatbot':
      return { bot: '' };
    case 'whatsapp_shop':
    case 'woocommerce':
    case 'shopify':
      return {
        storeId: '',
        productItems: [],
        headerText: '',
        bodyText: 'Tap a product to see details:',
        footerText: '',
        abandonedWaitMinutes: 5,
      };
    case 'book_appointment':
      return {
        bookingTypeId: '',
        slotCount: 5,
        prompt: 'Pick a time that works for you:',
        confirmation: 'Booked! See you on {{slot}}.',
        collectEmail: false,
        calendarOverride: '',
      };
    case 'ai_call':
      return { assistantId: '' };
    case 'google_meet':
      return {
        title: 'WhatsApp consultation with {{name}}',
        durationMinutes: 30,
        leadMinutes: 5,
        sendCalendarInvite: false,
        messageTemplate: 'Your meeting link:\n{{meet_link}}\n\nStarts {{meet_start}}',
      };
    case 'wa_form':
      return {
        formId: '',
        bodyText: 'Please tap below to fill out our quick form.',
        ctaLabel: 'Open form',
        flowVariable: 'form_submission',
      };
    case 'google_sheets':
      return {
        mode: 'write',
        sheetId: '',
        tabName: '',
        columns: [
          { header: 'Name', value: '{{name}}' },
          { header: 'Phone', value: '{{phone}}' },
        ],
        matchByHeader: false,
        matchColumn: '',
        matchValue: '',
        saveAs: 'sheet_row',
      };
    case 'google_docs':
      return {
        templateId: '',
        newTitle: 'Document for {{name}}',
        placeholders: [{ key: 'customer_name', value: '{{name}}' }],
        shareable: true,
        messageTemplate: "Here's your document:\n{{doc_url}}",
        saveAs: 'doc_url',
      };
    case 'google_form':
      return {
        formId: '',
        bodyText: 'Please fill out this short form:',
        saveAs: 'google_form',
        expiresInSec: 86400,
      };
    case 'deal':
      return {
        action: 'create',
        dealName: '{{contact_name}} — deal',
        stageId: '',
        value: '',
        ownerId: '',
        saveAs: 'deal_id',
      };
    default:
      return {};
  }
}

// --- trigger kinds ----------------------------------------------------------------------------------------------------

/** The twelve kinds the server accepts (TW-FLB-020). `appointment_booked` is allowed but the builder never offers it. */
export const FLB_TRIGGER_KINDS = [
  'keyword',
  'tag_added',
  'group_join',
  'manual_enroll',
  'contact_created',
  'opt_in',
  'order_placed',
  'appointment_booked',
  'deal_stage_changed',
  'away',
  'out_of_hours',
  'comment_to_dm',
] as const;
export type FlbTriggerKind = (typeof FLB_TRIGGER_KINDS)[number];

/** The label under the Trigger node's single output port. */
export const FLB_TRIGGER_PORT_LABELS: Record<string, string> = {
  keyword: 'on keyword',
  comment_to_dm: 'on comment → DM',
  tag_added: 'on tag added',
  group_join: 'on group join',
  contact_created: 'on new contact',
  opt_in: 'on opt-in',
  order_placed: 'on order',
  deal_stage_changed: 'on deal stage',
  away: 'while away',
  out_of_hours: 'after hours',
  manual_enroll: 'on enroll',
};

// --- ports ------------------------------------------------------------------------------------------------------------

export type FlbPortKind = 'flow' | 'yes' | 'no';
export interface FlbPortDef {
  /** The handle id an edge's `sourceHandle` carries: the routing contract between builder and runtime. */
  id: string;
  label: string;
  kind: FlbPortKind;
}

/** A quick-reply button of the template a Send-template node points at (the web resolves it from the template list). */
export interface FlbTemplateButtonRef {
  label: string;
}

export interface FlbPortContext {
  /** Quick-reply buttons of the node's template; each becomes a branch port. */
  templateButtons?: (node: { data: FlbNodeData }) => FlbTemplateButtonRef[];
}

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string =>
  typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v);

/** Reference `listOpt`: older flows saved list items as bare strings. */
export function flbListOption(
  o: unknown,
  i: number,
): { title: string; description: string; section: string } {
  if (typeof o === 'string') return { title: o, description: '', section: '' };
  const r = (o ?? {}) as Record<string, unknown>;
  return {
    title: str(r.title) || `Item ${i + 1}`,
    description: str(r.description),
    section: str(r.section),
  };
}

const out = (label: string): FlbPortDef[] => [{ id: 'out', label, kind: 'flow' }];
const yesNo = (yes: [string, string], no: [string, string]): FlbPortDef[] => [
  { id: yes[0], label: yes[1], kind: 'yes' },
  { id: no[0], label: no[1], kind: 'no' },
];

/**
 * The output ports of a node (Reference `nodeRows`). One pure function used by the card, the save-time validator and the
 * simulator. Every declared port is rendered: Reference drew a single dot for book_appointment, the commerce nodes, deal
 * and cf_menu, so their second branch could only be wired by import (a defect the inventory says not to port).
 */
export function flbPortsFor(
  node: { type: string; data?: FlbNodeData | null },
  ctx: FlbPortContext = {},
): FlbPortDef[] {
  const d = (node.data ?? {}) as FlbNodeData;
  switch (node.type) {
    case 'trigger':
      return out(FLB_TRIGGER_PORT_LABELS[str(d.kind)] ?? (str(d.kind) || 'manual'));
    case 'message':
    case 'media':
    case 'sequence':
    case 'tag':
    case 'assign':
    case 'cta':
    case 'location':
    case 'chatbot':
      return out('next');
    case 'template': {
      const qr = ctx.templateButtons?.({ data: d }) ?? [];
      if (qr.length === 0) return out('next');
      return qr.map((b, i) => ({
        id: `p${i}`,
        label: b.label || `Button ${i + 1}`,
        kind: 'flow' as const,
      }));
    }
    case 'notify_number':
      return out('sent');
    case 'wa_to_instagram':
      return out('link sent');
    case 'buttons':
    case 'poll': {
      const opts = asArray(d.options);
      return (opts.length ? opts : ['Option']).map((o, i) => ({
        id: `p${i}`,
        label: str(o),
        kind: 'flow' as const,
      }));
    }
    case 'list': {
      const opts = asArray(d.options);
      return (opts.length ? opts : ['Item']).map((o, i) => ({
        id: `p${i}`,
        label: flbListOption(o, i).title,
        kind: 'flow' as const,
      }));
    }
    case 'ask': {
      const exp = asArray(d.options);
      if (exp.length === 0) return out('reply received');
      return [
        ...exp.map((o, i) => ({
          id: `p${i}`,
          label: str(o) || `Answer ${i + 1}`,
          kind: 'flow' as const,
        })),
        { id: 'else', label: 'else / no match', kind: 'no' as const },
      ];
    }
    case 'ask_file':
      return out('file received');
    case 'ask_location':
      return out('location received');
    case 'condition':
      return yesNo(['yes', 'IF · true'], ['no', 'ELSE · false']);
    case 'delay':
      return out('after wait');
    case 'webhook':
      return out('response');
    case 'code':
      return out('done');
    case 'mysql':
      return out('rows');
    case 'ai':
      return out('reply ready');
    case 'subflow':
      return out('after run');
    case 'end':
    case 'cf_hangup':
      return [];
    case 'cf_say':
      return out('spoken');
    case 'cf_listen':
      return out('heard');
    case 'cf_ai':
    case 'cf_assistant':
      return out('answered');
    case 'cf_search':
      return out('results');
    case 'cf_transfer':
      return out('if no answer');
    case 'cf_menu': {
      const opts = asArray(d.options) as Array<Record<string, unknown>>;
      return [
        ...(opts.length ? opts : [{ match: 'option' }]).map((o, i) => ({
          id: `p${i}`,
          label: str(o.label) || str(o.match) || `Option ${i + 1}`,
          kind: 'flow' as const,
        })),
        { id: 'nomatch', label: 'no match', kind: 'no' as const },
      ];
    }
    case 'ig_send_dm':
    case 'ig_buttons':
    case 'ig_products':
    case 'fb_gallery':
    case 'fb_products':
      return out('sent');
    case 'ig_reply_comment':
    case 'fb_reply_comment':
      return out('replied');
    case 'ig_ai':
      return out('answered');
    case 'ig_ask':
      return out('answered');
    case 'ig_lead':
    case 'fb_lead':
      return out('saved');
    case 'ig_to_whatsapp':
    case 'fb_to_whatsapp':
      return out('handed off');
    case 'ig_quick': {
      const opts = asArray(d.options) as Array<Record<string, unknown>>;
      return (opts.length ? opts : [{ title: 'option' }]).map((o, i) => ({
        id: `p${i}`,
        label: str(o.title) || `Option ${i + 1}`,
        kind: 'flow' as const,
      }));
    }
    case 'tg_payment':
      return out(d.wait ? 'after paid' : 'invoice sent');
    case 'whatsapp_shop':
    case 'woocommerce':
    case 'shopify':
      return yesNo(['purchased', 'purchased'], ['abandoned', 'abandoned']);
    case 'book_appointment':
      return yesNo(['booked', 'booked'], ['no_slots', 'no slots']);
    case 'ai_call':
      return out('call placed');
    case 'google_meet':
      return out('link sent');
    case 'wa_form':
      return out('submitted');
    case 'google_sheets':
      return out(d.mode === 'read' ? 'row loaded' : 'row written');
    case 'google_docs':
      return out('doc sent');
    case 'google_form':
      return yesNo(['submitted', 'submitted'], ['timeout', 'timed out']);
    case 'deal':
      return yesNo(['created', d.action === 'move' ? 'moved' : 'created'], ['error', 'error']);
    default:
      return [];
  }
}

/** A node card draws one dot per row instead of a single dot when it has more than one branch (every declared port). */
export const flbIsMultiPort = (
  node: { type: string; data?: FlbNodeData | null },
  ctx: FlbPortContext = {},
): boolean =>
  flbPortsFor(node, ctx).length > 1 ||
  ['buttons', 'list', 'poll', 'condition', 'google_form'].includes(node.type);

const HANDLE_PORT: Record<string, Record<string, number>> = {
  condition: { yes: 1, no: 2 },
  book_appointment: { booked: 1, no_slots: 2 },
  whatsapp_shop: { purchased: 1, abandoned: 2 },
  woocommerce: { purchased: 1, abandoned: 2 },
  shopify: { purchased: 1, abandoned: 2 },
  google_form: { submitted: 1, timeout: 2 },
  deal: { created: 1, error: 2 },
};

/**
 * The 1-based port number the runtime looks up (`<nodeId>_<port>`): `p<i>` is i+1, `else` is 0, the named pairs map as
 * Reference's FlowNormalizer does, anything else (including `out`) is 1. The seam FLR reads.
 */
export function flbHandleToPort(nodeType: string, handle: string): number {
  const named = HANDLE_PORT[nodeType]?.[handle];
  if (named !== undefined) return named;
  if (handle === 'else') return 0;
  const m = /^p(\d+)$/.exec(handle);
  if (m) return Number(m[1]) + 1;
  return 1;
}
