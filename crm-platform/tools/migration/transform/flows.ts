import { docKey } from '../flows/rules';
import type { DocVerdict } from '../flows/plan';
import { primaryKey, uuidv5, type Doc } from '../util';
import { c, times } from './common';
import type { Ctx, FieldMap, HandlerSpec, Outcome, Row, Soft } from './types';

/**
 * Simple flows -> chatbot flows, the widget configuration and the FAQ phrases (spec C sections A and B). All of it is driven by the plan
 * of pass 1 (flows/plan.ts): a step only looks up the verdict of its document.
 *
 *   flow_bots          (derived, one document per bot)  -> flows           inactive and unpublished, always
 *   flow_chatbots / flow_headers / flow_versions / flow_nodes / flow_workspace
 *                      (the source collections)         -> adopted into the flow (id_map points at it) or excluded with a reason
 *   faq_replies        faq_variations                   -> keyword_replies  status false, reply_type flow, no contents
 *   widget_assistants / widgets (derived)               -> ai_chat_assistants (paused), chatbot_widgets (paused, closed allow-list)
 *   widget_config / widget_theme                        -> adopted into the widget, or excluded NO_WIDGET
 *
 * SAFETY: no trigger is armed (is_published false AND is_active false: every consumer in flow-runtime-engine, the schedule sweeper and
 * the admin counters select on both), no flow_runs / flow_subscribers / outbox row is written, and nothing is UPDATEd afterwards.
 */
const NOT_PRESENT = 'NOT PRESENT: no column in flows / chatbot_widgets';

const out = (v: DocVerdict, client: string): Outcome => {
  if (v.kind === 'adopt') {
    const mapCollection = v.table === 'flows' ? 'flow_bots' : 'widgets';
    return {
      kind: 'adopt',
      table: v.table,
      column: 'uuid',
      value: uuidv5(`${client}|${mapCollection}|${v.botId}`),
    };
  }
  return { kind: v.kind, code: v.code, reason: v.reason };
};

const NOT_PLANNED: Outcome = {
  kind: 'quarantine',
  code: 'NOT_PLANNED',
  reason: 'the flows plan has no verdict for this document',
};

const stepOf = (
  handler: HandlerSpec['handler'],
  collection: string,
  fields: FieldMap,
): HandlerSpec => ({
  handler,
  collection,
  mapCollection: collection,
  fields,
  tables: {},
  transform(doc: Doc, ctx: Ctx): Outcome {
    const v = ctx.flows?.docs.get(docKey(collection, doc));
    return v ? out(v, ctx.client) : NOT_PLANNED;
  },
});

// --- field maps (every key of the source documents is mapped or dropped with its reason) ------------------------------------

const FLOW =
  'folded into the flow row (flows.flow_data / name / trigger), or excluded with a counted reason';
const NODE_FIELDS: FieldMap = {
  _id: 'id (registered in migration.id_map; points at the flow the step went into)',
  id: 'id (registered in migration.id_map)',
  botid: 'the bot (one flow per bot)',
  nodeId: `flows.flow_data: the step id (n_ + the first 8 characters)`,
  version_id: 'selects the latest version',
  qid: 'flows.flow_data: the step belongs to this journey (a chain of steps)',
  subType: 'flows.flow_data: the step type',
  displayOrder: 'flows.flow_data: the order of the steps of a journey',
  type: 'record kind (Flow / Intent / FAQ)',
  stage: 'flows.flow_data: orders the journeys',
  name: 'drop:the step label of the console; steps are named by their type here',
  response: 'flows.flow_data: only the FIRST response is read; more are counted in CONVERSION_LOSS',
  connectNode:
    'drop:the console\'s own "next node" hint; the links come from the buttons and the node-to-node actions',
  property: 'flows.flow_data: saveProperty / propertyKey of an ask step',
  variable: 'flows.flow_data: the variable of a step',
  actions:
    'flows.flow_data: node-to-node actions become links; API and other actions are LOST (counted in CONVERSION_LOSS)',
  quickActions: 'drop:quick actions have no step here (counted in CONVERSION_LOSS)',
  input: "drop:the console's input flag (the ask step is chosen by subType)",
  input_type: "drop:the console's input kind (the ask step is chosen by subType)",
  isPropertyUpdate: "drop:the console's flag; saveProperty comes from the property object",
  context: 'drop:subscription bookkeeping of the opt-in / opt-out steps (those are not flows here)',
  isInBetween: "drop:the console's layout flag",
  isUnsaved: "drop:the console's editing flag",
  createdAt: 'flows.created_at / updated_at (earliest step when no version date)',
  updatedAt: 'flows.updated_at',
  delay: 'flows.flow_data: the minutes of a delay step',
  languages: 'drop:other languages are LOST (counted in CONVERSION_LOSS)',
  multi_lingual: 'drop:other languages are LOST (counted in CONVERSION_LOSS)',
  allowedFileTypes: 'flows.flow_data: the allowed extensions of a file step',
  description: 'drop:note of the console',
};
const WORKSPACE_FIELDS: FieldMap = {
  ...NODE_FIELDS,
  query: 'flows.flow_data: trigger words of the flow named by journey.qid',
  question: 'flows.flow_data: trigger words of the flow named by journey.qid (a string or a list)',
  intent: 'drop:the intent label of the console',
  journey: 'flows.flow_data: names a journey and ties the trigger words to it',
  node: "drop:the console's pointer to the first node of the intent",
};

export const CHATBOT_FIELDS: FieldMap = {
  _id: 'id (registered in migration.id_map)',
  id: 'id (registered in migration.id_map)',
  bot_id: 'the bot: one flow (and, for a website bot, one widget) per bot_id',
  name: 'flows.flow_name / chatbot_widgets.name',
  description: `drop:${NOT_PRESENT}`,
  project_version_id: `drop:${NOT_PRESENT}`,
  deploy_url: `drop:${NOT_PRESENT}`,
  chatbot_status: 'WABOO_STATE soft issue only (an imported flow is never live)',
  bot_enabled: 'WABOO_STATE soft issue only (an imported flow is never live)',
  bot_category_id: `drop:${NOT_PRESENT}`,
  bot_type_id: `drop:${NOT_PRESENT}`,
  channel: 'decides flow (whatsapp) or widget (website)',
  business_id: `drop:${NOT_PRESENT}`,
  workspace_id: `drop:${NOT_PRESENT}`,
  chatbot_layout: 'drop:id of a layout document that is not migrated',
  chatbot_theme: 'finds the chatbot_theme document of the widget',
  chatbot_configuration: 'finds the chatbot_configuration document of the widget',
  primary_language: 'ai_chat_assistants.language',
  timezone: `drop:${NOT_PRESENT}`,
  multi_lingual: 'drop:multi-language bots are LOST (soft MULTI_LANGUAGE_NOT_PRESENT)',
  chatbot_languages: 'drop:multi-language bots are LOST (soft MULTI_LANGUAGE_NOT_PRESENT)',
  chatbot_schema: `drop:${NOT_PRESENT}`,
  created_time: 'flows.created_at / chatbot_widgets.created_at',
  modified_time: 'chatbot_widgets.updated_at',
  deleted_time: 'drop:soft-delete timestamp; a bot with it set is excluded SOFT_DELETED',
  is_deleted: 'drop:soft-delete flag; a bot with it set is excluded SOFT_DELETED',
  is_active: 'drop:a bot with is_active false is excluded BOT_INACTIVE',
  selectedProducts: `drop:${NOT_PRESENT}: product selection for AI answers`,
  prompt: 'ai_chat_assistants.system_prompt (fallback when the configuration has none)',
  whatsapp_number: 'chatbot_widgets.target_whatsapp_number (a bot with a number gets a widget)',
};
export const HEADER_FIELDS: FieldMap = {
  _id: 'id (registered in migration.id_map)',
  id: 'id (registered in migration.id_map)',
  botid: 'the bot',
  qid: 'JOURNEY_MAIN_DIVERGES cross-check only',
  name: 'drop:journey names come from the Intent / FAQ records; the header name is not used',
  displayOrder: "drop:the order is the converter's",
  'main-flow': 'JOURNEY_MAIN_DIVERGES cross-check only',
  version_id: 'drop:headers are not versioned here',
  createdAt: 'drop:not used',
  updatedAt: 'drop:not used',
};
export const VERSION_FIELDS: FieldMap = {
  _id: 'id (registered in migration.id_map)',
  id: 'id (registered in migration.id_map)',
  version_id: 'selects the latest version',
  version_name: 'drop:history is not kept (latest version only)',
  botid: 'the bot',
  status: 'selects the latest version (published first)',
  createdAt: 'flows.created_at',
  createdBy: 'drop:Waboo users are not linked to flows',
  publishedAt: 'flows.updated_at',
  publishedBy: 'drop:Waboo users are not linked to flows',
};
export const FAQ_FIELDS: FieldMap = {
  _id: 'id (registered in migration.id_map)',
  id: 'id (registered in migration.id_map)',
  botid: 'the bot whose flow the reply starts',
  qid: 'drop:a journey inside a flow cannot be addressed: the reply starts the flow from its trigger (soft QID_NOT_ADDRESSABLE)',
  phrases: 'keyword_replies.keyword (comma-joined, at most 255 characters per row)',
};
export const CONFIG_FIELDS: FieldMap = Object.fromEntries(
  [
    '_id',
    'id',
    'created_time',
    'modified_time',
    'deleted_time',
    'whatsapp_prefilled_message_text',
    'prefilled_message_text',
    'welcome_message_text',
    'whatsapp_welcome_message_text',
    'cta_button_text',
    'whatsapp_cta_button_text',
    'subheader_text',
    'display_position',
    'desktop_display_position',
    'mobile_display_position',
    'desktop_side_margin',
    'desktop_bottom_margin',
    'mobile_side_margin',
    'mobile_bottom_margin',
    'company_logo',
    'avatar',
    'background_image',
    'desktop_auto_triggering',
    'modelName',
    'prompt',
    'temperature',
  ].map((k) => [k, 'chatbot_widgets / ai_chat_assistants (see widget.ts)'] as const),
);
for (const k of [
  'desktop_triggering_time',
  'mobile_triggering_time',
  'mobile_auto_triggering',
  'before_exit_triggering',
  'urls',
  'consent_configuration',
  'consent_triggering',
  'active_timings',
  'banned_users',
  'canned_responses',
  'enabled_devices',
  'message_tone',
  'otp_validation',
  'email_otp_validation',
  'whatsapp_otp_validation',
  'remove_branding',
  'response_delay',
  'tooltip',
  'show_suggestions',
  'show_suggestion',
  'email_notification',
  'sms_notification',
  'whatsapp_notification',
  'sheet_notification',
  'notification_block',
  'quick_menu',
  'banner_carousel',
  'is_active_operation_hours_enabled',
  'global_user_input_enabled',
  'default_messages',
  'whatsapp_subheader_text',
  'widget_animation',
  'auto_open_enabled',
  'auto_open_delay',
  'landing_page_enabled',
  'landing_page_title',
  'landing_page_description',
])
  CONFIG_FIELDS[k] = `drop:${NOT_PRESENT} (the key name is listed in CONFIG_NOT_PRESENT)`;
CONFIG_FIELDS.ai_configuration =
  'chatbot_widgets.mode and ai_chat_assistants (model, prompt, temperature); apiKeys / openRouterKey / normalKey are NEVER copied';
CONFIG_FIELDS['ai_configuration '] = CONFIG_FIELDS.ai_configuration; // a key with a trailing space exists at the source
export const THEME_FIELDS: FieldMap = {
  _id: 'id (registered in migration.id_map)',
  id: 'id (registered in migration.id_map)',
  created_time: 'chatbot_widgets.created_at',
  modified_time: 'chatbot_widgets.updated_at',
  deleted_time: 'drop:soft-delete timestamp',
  primary: 'chatbot_widgets.button_color / header_bg / action_button_bg (hex values only)',
  button: 'chatbot_widgets.action_button_bg / action_button_text_color (hex values only)',
};
for (const k of [
  'secondary',
  'header',
  'bot_message',
  'user_message',
  'bot_option',
  'user_input',
  'chat_wall',
  'font',
  'avatar_styles',
  'logo_styles',
  'button_hover',
])
  THEME_FIELDS[k] = `drop:${NOT_PRESENT} (the key name is listed in CONFIG_NOT_PRESENT)`;

// --- the steps -------------------------------------------------------------------------------------------------------------------

export const FLOW_CONSTANTS: Record<string, unknown> = {
  user_id: null,
  flow_file_path: null,
  trigger_device_id: null,
  trigger_channel_id: null,
  trigger_last_occurrence: null,
  instaflow_flow_id: null,
  row_version: 1,
};

/** Documents the derived steps read from the plan: {id: botId}. */
export const flowBots: HandlerSpec = {
  handler: 'flow_bots',
  collection: 'chatbots',
  shaCollections: [
    'bot_flow_version',
    'bot_flow_version_data',
    'bot_workspace',
    'flows',
    'faq_variations',
    'chatbot_configuration',
    'chatbot_theme',
    'broadcast_templates',
    'journey',
  ],
  mapCollection: 'flow_bots',
  virtual: true,
  read: ({ ctx }) => (ctx?.flows?.botOrder ?? []).map((id) => ({ id }) as Doc),
  fields: { id: 'the bot id (bot_id)' },
  tables: {
    flows: {
      columns: [
        c('flow_name', 'text'),
        c('flow_data', 'jsonb'),
        c('category', 'text'),
        c('trigger_kind', 'text'),
        c('trigger_value', 'bigint'),
        c('trigger_keywords', 'text'),
        c('trigger_config', 'jsonb'),
        c('provider', 'text'),
        c('flow_type', 'text'),
        c('is_published', 'boolean'),
        c('is_active', 'boolean'),
        c('published_at', 'timestamptz'),
        c('created_at', 'timestamptz'),
        c('updated_at', 'timestamptz'),
      ],
      constants: FLOW_CONSTANTS,
      // what the live application changes once people work in the app (publish, edit, bind a channel)
      liveColumns: [
        'flow_name',
        'flow_data',
        'category',
        'trigger_kind',
        'trigger_value',
        'trigger_keywords',
        'trigger_config',
        'trigger_channel_id',
        'trigger_last_occurrence',
        'provider',
        'flow_type',
        'is_published',
        'is_active',
        'published_at',
        'updated_at',
        'row_version',
        'user_id',
      ],
    },
  },
  transform(doc: Doc, ctx: Ctx): Outcome {
    const plan = ctx.flows;
    const bot = plan?.bots.get(primaryKey(doc));
    if (!plan || !bot) return NOT_PLANNED;
    if (bot.verdict.kind !== 'load' || !bot.row)
      return bot.verdict.kind === 'load'
        ? NOT_PLANNED
        : { kind: bot.verdict.kind, code: bot.verdict.code, reason: bot.verdict.reason };
    return { kind: 'rows', rows: [{ table: 'flows', sub: '', row: bot.row }], soft: bot.soft };
  },
};

export const flowChatbots = stepOf('flow_chatbots', 'chatbots', CHATBOT_FIELDS);
export const flowHeaders = stepOf('flow_headers', 'flows', HEADER_FIELDS);
export const flowVersions = stepOf('flow_versions', 'bot_flow_version', VERSION_FIELDS);
export const flowNodes = stepOf('flow_nodes', 'bot_flow_version_data', NODE_FIELDS);
export const flowWorkspace = stepOf('flow_workspace', 'bot_workspace', WORKSPACE_FIELDS);
export const widgetConfig = stepOf('widget_config', 'chatbot_configuration', CONFIG_FIELDS);
export const widgetTheme = stepOf('widget_theme', 'chatbot_theme', THEME_FIELDS);
void FLOW;

export const KEYWORD_CONSTANTS: Record<string, unknown> = {
  user_id: null,
  device_id: null,
  keyword_translations: null,
  canonical_language: 'en',
  is_catch_all: false,
  trigger_type: 'keyword',
  ig_trigger: null,
  fuzzy_similarity: 80,
  is_flow_trigger: false,
  target_contact_id: null,
  target_catalog_id: null,
  cooldown: null,
  resend_unit: null,
  stop_on_agent_reply: false,
  resume_after: null,
  resume_unit: null,
  timeout: null,
  working_hours: null,
  excluded_numbers: null,
  excluded_group_ids: null,
  message_type: 'text',
  trigger_count: 0,
  last_triggered_at: null,
  priority: 0,
  row_version: 1,
};

export const faqReplies: HandlerSpec = {
  handler: 'faq_replies',
  collection: 'faq_variations',
  mapCollection: 'faq_variations',
  fields: FAQ_FIELDS,
  tables: {
    keyword_replies: {
      columns: [
        c('provider', 'text'),
        c('keyword', 'text'),
        c('matching_method', 'text'),
        c('reply_type', 'text'),
        c('flow_id', 'bigint'),
        c('status', 'boolean'),
        c('created_at', 'timestamptz'),
        c('updated_at', 'timestamptz'),
      ],
      constants: KEYWORD_CONSTANTS,
      liveColumns: [
        'keyword',
        'matching_method',
        'reply_type',
        'flow_id',
        'status',
        'provider',
        'updated_at',
        'row_version',
        'trigger_count',
        'last_triggered_at',
        'keyword_translations',
        'canonical_language',
        'priority',
        'is_flow_trigger',
        'user_id',
      ],
    },
  },
  transform(doc: Doc, ctx: Ctx): Outcome {
    const v = ctx.flows?.faq.get(docKey('faq_variations', doc));
    if (!v) return NOT_PLANNED;
    if (v.kind !== 'load') return { kind: v.kind, code: v.code, reason: v.reason };
    const flow = ctx.ref('flow_bots', v.botId);
    if (!flow || flow.table !== 'flows')
      return {
        kind: 'quarantine',
        code: 'FLOW_NOT_LOADED',
        reason: 'its flow was not loaded into flows',
      };
    const t = times(
      doc,
      ctx.fallbackAt,
      ['created_time', 'created_at', 'createdAt'],
      ['modified_time', 'updated_at', 'updatedAt'],
    );
    const soft: Soft[] = [...t.soft];
    soft.push({
      code: 'QID_NOT_ADDRESSABLE',
      reason:
        'a journey inside a flow cannot be addressed: the reply (inactive) starts the whole flow from its trigger; check it before activating',
      detail: v.qid,
    });
    if (v.droppedLong > 0)
      soft.push({
        code: 'PHRASE_TOO_LONG_DROPPED',
        reason: 'a phrase longer than 255 characters cannot be a keyword and was left out',
        detail: v.droppedLong,
      });
    if (v.commas > 0)
      soft.push({
        code: 'PHRASE_COMMA_REPLACED',
        reason: 'keywords are comma-separated, so a comma inside a phrase was replaced by a space',
        detail: v.commas,
      });
    const rows = v.chunks.map((keyword, i) => ({
      table: 'keyword_replies',
      sub: i === 0 ? '' : `#${i + 1}`,
      row: {
        provider: 'waba',
        keyword,
        matching_method: 'exact',
        reply_type: 'flow',
        flow_id: flow.id,
        // SAFETY: an imported keyword reply never answers: it is switched off
        status: false,
        created_at: t.created,
        updated_at: t.updated,
      } as Row,
    }));
    return { kind: 'rows', rows, soft };
  },
};

export const ASSISTANT_CONSTANTS: Record<string, unknown> = {
  user_id: null,
  greeting: null,
  tone: 'helpful',
  ai_provider: 'openai',
  reply_max_tokens: 400,
  fallback_message: null,
  handoff_enabled: true,
  handoff_keyword: null,
  handoff_message: null,
  row_version: 1,
};
export const WIDGET_CONSTANTS: Record<string, unknown> = { user_id: null, row_version: 1 };

export const widgetAssistants: HandlerSpec = {
  handler: 'widget_assistants',
  collection: 'chatbot_configuration',
  shaCollections: ['chatbots', 'chatbot_theme'],
  mapCollection: 'widget_assistants',
  virtual: true,
  read: ({ ctx }) =>
    (ctx?.flows?.widgetOrder ?? [])
      .filter((id) => ctx?.flows?.widgets.get(id)?.assistant)
      .map((id) => ({ id }) as Doc),
  fields: { id: 'the bot id (bot_id)' },
  tables: {
    ai_chat_assistants: {
      columns: [
        c('name', 'text'),
        c('slug', 'text'),
        c('system_prompt', 'text'),
        c('language', 'text'),
        c('ai_model', 'text'),
        c('temperature', 'numeric'),
        c('status', 'text'),
        c('created_at', 'timestamptz'),
        c('updated_at', 'timestamptz'),
      ],
      constants: ASSISTANT_CONSTANTS,
      liveColumns: [
        'name',
        'slug',
        'system_prompt',
        'language',
        'ai_model',
        'temperature',
        'status',
        'updated_at',
        'row_version',
        'greeting',
        'tone',
        'ai_provider',
        'reply_max_tokens',
        'fallback_message',
        'handoff_enabled',
        'handoff_keyword',
        'handoff_message',
        'user_id',
      ],
    },
  },
  transform(doc: Doc, ctx: Ctx): Outcome {
    const w = ctx.flows?.widgets.get(primaryKey(doc));
    if (!w || !w.assistant) return NOT_PLANNED;
    if (w.verdict.kind !== 'load')
      return { kind: w.verdict.kind, code: w.verdict.code, reason: w.verdict.reason };
    return {
      kind: 'rows',
      rows: [{ table: 'ai_chat_assistants', sub: '', row: w.assistant }],
    };
  },
};

export const widgets: HandlerSpec = {
  handler: 'widgets',
  collection: 'chatbots',
  shaCollections: ['chatbot_configuration', 'chatbot_theme'],
  mapCollection: 'widgets',
  virtual: true,
  read: ({ ctx }) => (ctx?.flows?.widgetOrder ?? []).map((id) => ({ id }) as Doc),
  fields: { id: 'the bot id (bot_id)' },
  tables: {
    chatbot_widgets: {
      columns: [
        c('assistant_id', 'bigint'),
        c('name', 'text'),
        c('slug', 'text'),
        c('embed_token', 'text'),
        c('mode', 'text'),
        c('target_whatsapp_cc', 'text'),
        c('target_whatsapp_number', 'text'),
        c('prefilled_message', 'text'),
        c('position', 'text'),
        c('button_color', 'text'),
        c('button_image_url', 'text'),
        c('header_title', 'text'),
        c('header_bg', 'text'),
        c('header_text_color', 'text'),
        c('welcome_message', 'text'),
        c('message_bubble_color', 'text'),
        c('message_text_color', 'text'),
        c('body_bg_kind', 'text'),
        c('body_bg_color', 'text'),
        c('body_bg_image_url', 'text'),
        c('auto_open', 'boolean'),
        c('button_label', 'text'),
        c('action_button_bg', 'text'),
        c('action_button_text_color', 'text'),
        c('collect_name', 'boolean'),
        c('collect_email', 'boolean'),
        c('collect_phone', 'boolean'),
        c('status', 'text'),
        c('allowed_domains', 'jsonb'),
        c('launcher', 'jsonb'),
        c('created_at', 'timestamptz'),
        c('updated_at', 'timestamptz'),
      ],
      // the embed token is generated at insert time (a CSPRNG, never derived): reconcile checks its shape and uniqueness instead
      skipCompare: ['embed_token'],
      constants: WIDGET_CONSTANTS,
      liveColumns: [
        'assistant_id',
        'name',
        'slug',
        'embed_token',
        'mode',
        'target_whatsapp_cc',
        'target_whatsapp_number',
        'prefilled_message',
        'position',
        'button_color',
        'button_image_url',
        'header_title',
        'header_bg',
        'header_text_color',
        'welcome_message',
        'message_bubble_color',
        'message_text_color',
        'body_bg_kind',
        'body_bg_color',
        'body_bg_image_url',
        'auto_open',
        'button_label',
        'action_button_bg',
        'action_button_text_color',
        'collect_name',
        'collect_email',
        'collect_phone',
        'status',
        'allowed_domains',
        'launcher',
        'updated_at',
        'row_version',
        'user_id',
      ],
    },
  },
  transform(doc: Doc, ctx: Ctx): Outcome {
    const w = ctx.flows?.widgets.get(primaryKey(doc));
    if (!w) return NOT_PLANNED;
    if (w.verdict.kind !== 'load' || !w.row)
      return w.verdict.kind === 'load'
        ? NOT_PLANNED
        : { kind: w.verdict.kind, code: w.verdict.code, reason: w.verdict.reason };
    let assistantId: number | null = null;
    if (w.assistant) {
      const ref = ctx.ref('widget_assistants', w.botId);
      if (!ref || ref.table !== 'ai_chat_assistants')
        return {
          kind: 'quarantine',
          code: 'ASSISTANT_NOT_LOADED',
          reason: 'its assistant was not loaded into ai_chat_assistants',
        };
      assistantId = ref.id;
    }
    return {
      kind: 'rows',
      rows: [{ table: 'chatbot_widgets', sub: '', row: { ...w.row, assistant_id: assistantId } }],
      soft: w.soft,
    };
  },
};
