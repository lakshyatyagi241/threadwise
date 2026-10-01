/**
 * calling-voice: tables ported from Reference. Mirrors migrations/20261001103700_call_threadwise_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  bigint,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { aiAgents } from '../ai-agents-training/tables';
import { conversations } from '../chat-conversations/tables';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { contacts } from '../crm';
import { organizations, users } from '../foundation';
import { waProviderConfigs } from '../whatsapp-devices-baileys/tables';

export const aiCallAssistants = pgTable(
  'ai_call_assistants',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    greetingText: text('greeting_text'),
    status: text('status').notNull().default('draft'),
    isActive: boolean('is_active').notNull().default(true),
    aiProvider: text('ai_provider').notNull().default('gemini'),
    aiModel: text('ai_model').notNull().default('gemini-2.5-flash-lite'),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    aiApiKeyEncrypted: text('ai_api_key_encrypted'),
    aiSystemPrompt: text('ai_system_prompt'),
    knowledgeBaseUrl: text('knowledge_base_url'),
    naturalConciseness: boolean('natural_conciseness').notNull().default(true),
    voiceProvider: text('voice_provider').notNull().default('elevenlabs'),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    voiceApiKeyEncrypted: text('voice_api_key_encrypted'),
    voiceId: text('voice_id'),
    voiceSettingsJson: jsonb('voice_settings_json'),
    sttProvider: text('stt_provider').notNull().default('elevenlabs'),
    sttSettingsJson: jsonb('stt_settings_json'),
    recordAgent: boolean('record_agent').notNull().default(true),
    recordUser: boolean('record_user').notNull().default(true),
    autoLogging: boolean('auto_logging').notNull().default(true),
    exitKeywordsJson: jsonb('exit_keywords_json'),
    lastGreeting: text('last_greeting'),
    metaJson: jsonb('meta_json'),
    deviceIds: jsonb('device_ids'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_ai_call_assistants_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_ai_call_assistants_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_ai_call_assistants_slug').on(t.orgId, t.slug),
    foreignKey({
      name: 'fk_ai_call_assistants_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_ai_call_assistants_user_id').on(t.orgId, t.userId),
    index('idx_ai_call_assistants_is_active_status').on(t.orgId, t.isActive, t.status),
  ],
);

export type AiCallAssistantsRow = typeof aiCallAssistants.$inferSelect;
export type NewAiCallAssistantsRow = typeof aiCallAssistants.$inferInsert;

export const aiCallAssistantTools = pgTable(
  'ai_call_assistant_tools',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    assistantId: idColumn('assistant_id').notNull(),
    functionName: text('function_name').notNull(),
    triggerKeywordsJson: jsonb('trigger_keywords_json'),
    httpMethod: text('http_method').notNull().default('GET'),
    httpUrl: text('http_url').notNull(),
    headersJson: jsonb('headers_json'),
    parametersJson: jsonb('parameters_json'),
    sortOrder: smallint('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_ai_call_assistant_tools_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_ai_call_assistant_tools_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_ai_call_assistant_tools_assistant_id_function_name').on(
      t.orgId,
      t.assistantId,
      t.functionName,
    ),
    foreignKey({
      name: 'fk_ai_call_assistant_tools_assistant_id',
      columns: [t.orgId, t.assistantId],
      foreignColumns: [aiCallAssistants.orgId, aiCallAssistants.id],
    }).onDelete('cascade'),
  ],
);

export type AiCallAssistantToolsRow = typeof aiCallAssistantTools.$inferSelect;
export type NewAiCallAssistantToolsRow = typeof aiCallAssistantTools.$inferInsert;

export const aiCallLogs = pgTable(
  'ai_call_logs',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    assistantId: idColumn('assistant_id'),
    conversationId: idColumn('conversation_id'),
    callerPhone: text('caller_phone').notNull(),
    calleePhone: text('callee_phone').notNull(),
    direction: text('direction').notNull().default('inbound'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    durationSeconds: integer('duration_seconds').notNull().default(0),
    status: text('status').notNull().default('in-progress'),
    failureReason: text('failure_reason'),
    recordingUrlAgent: text('recording_url_agent'),
    recordingUrlUser: text('recording_url_user'),
    recordingUrlMixed: text('recording_url_mixed'),
    transcriptJson: jsonb('transcript_json'),
    toolCallsJson: jsonb('tool_calls_json'),
    aiTokensIn: integer('ai_tokens_in').notNull().default(0),
    aiTokensOut: integer('ai_tokens_out').notNull().default(0),
    sttSeconds: integer('stt_seconds').notNull().default(0),
    ttsChars: integer('tts_chars').notNull().default(0),
    costMinor: integer('cost_minor').notNull().default(0),
    currencyCode: text('currency_code').notNull().default('USD'),
    twilioCallSid: text('twilio_call_sid'),
    metaJson: jsonb('meta_json'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_ai_call_logs_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_ai_call_logs_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_ai_call_logs_twilio_call_sid').on(t.twilioCallSid),
    foreignKey({
      name: 'fk_ai_call_logs_assistant_id',
      columns: [t.orgId, t.assistantId],
      foreignColumns: [aiCallAssistants.orgId, aiCallAssistants.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_ai_call_logs_conversation_id',
      columns: [t.orgId, t.conversationId],
      foreignColumns: [conversations.orgId, conversations.id],
    }).onDelete('set null'),
    index('idx_ai_call_logs_assistant_id').on(t.orgId, t.assistantId),
    index('idx_ai_call_logs_caller_phone').on(t.orgId, t.callerPhone),
    index('idx_ai_call_logs_conversation_id').on(t.orgId, t.conversationId),
    index('idx_ai_call_logs_started_at').on(t.orgId, t.startedAt),
  ],
);

export type AiCallLogsRow = typeof aiCallLogs.$inferSelect;
export type NewAiCallLogsRow = typeof aiCallLogs.$inferInsert;

export const aiVoiceUsageDaily = pgTable(
  'ai_voice_usage_daily',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    aiAgentId: idColumn('ai_agent_id'),
    date: date('date').notNull(),
    voiceNotesProcessed: integer('voice_notes_processed').notNull().default(0),
    callSeconds: integer('call_seconds').notNull().default(0),
    asrSeconds: integer('asr_seconds').notNull().default(0),
    ttsChars: integer('tts_chars').notNull().default(0),
    llmInputTokens: integer('llm_input_tokens').notNull().default(0),
    llmOutputTokens: integer('llm_output_tokens').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_ai_voice_usage_daily_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_ai_voice_usage_daily_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_ai_voice_usage_daily_ai_agent_id_date').on(t.orgId, t.aiAgentId, t.date),
    foreignKey({
      name: 'fk_ai_voice_usage_daily_ai_agent_id',
      columns: [t.orgId, t.aiAgentId],
      foreignColumns: [aiAgents.orgId, aiAgents.id],
    }).onDelete('set null'),
    index('idx_ai_voice_usage_daily_date').on(t.orgId, t.date),
  ],
);

export type AiVoiceUsageDailyRow = typeof aiVoiceUsageDaily.$inferSelect;
export type NewAiVoiceUsageDailyRow = typeof aiVoiceUsageDaily.$inferInsert;

export const waCalls = pgTable(
  'wa_calls',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    provider: text('provider').notNull().default('baileys'),
    waProviderConfigId: idColumn('wa_provider_config_id'),
    metaCallId: text('meta_call_id'),
    correlationId: text('correlation_id'),
    direction: text('direction').notNull(),
    fromPhone: text('from_phone').notNull(),
    toPhone: text('to_phone').notNull(),
    contactId: idColumn('contact_id'),
    conversationId: idColumn('conversation_id'),
    handlerType: text('handler_type'),
    handlerUserId: idColumn('handler_user_id'),
    handlerAgentId: idColumn('handler_agent_id'),
    assistantId: idColumn('assistant_id'),
    /** Mirror id in ai_call_logs for the /call-logs UI */
    aiCallLogId: idColumn('ai_call_log_id'),
    status: text('status').notNull().default('ringing'),
    recordingStartedAt: timestamp('recording_started_at', { withTimezone: true }),
    endReason: text('end_reason'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    answeredAt: timestamp('answered_at', { withTimezone: true }),
    endedAt: timestamp('ended_at', { withTimezone: true }),
    durationSec: integer('duration_sec').notNull().default(0),
    recordingPath: text('recording_path'),
    transcript: text('transcript'),
    errorPayload: jsonb('error_payload'),
    metaPayload: jsonb('meta_payload'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_wa_calls_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_wa_calls_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    check(
      'chk_wa_calls_direction',
      sql`${t.direction} in ('USER_INITIATED', 'BUSINESS_INITIATED')`,
    ),
    check(
      'chk_wa_calls_handler_type',
      sql`${t.handlerType} in ('operator', 'ai_agent', 'voicemail', 'none')`,
    ),
    check(
      'chk_wa_calls_status',
      sql`${t.status} in ('ringing', 'connecting', 'active', 'ended', 'failed')`,
    ),
    unique('uq_wa_calls_correlation_id').on(t.correlationId),
    unique('uq_wa_calls_meta_call_id').on(t.metaCallId),
    foreignKey({
      name: 'fk_wa_calls_wa_provider_config_id',
      columns: [t.orgId, t.waProviderConfigId],
      foreignColumns: [waProviderConfigs.orgId, waProviderConfigs.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_wa_calls_contact_id',
      columns: [t.orgId, t.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_wa_calls_conversation_id',
      columns: [t.orgId, t.conversationId],
      foreignColumns: [conversations.orgId, conversations.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_wa_calls_handler_user_id',
      columns: [t.orgId, t.handlerUserId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_wa_calls_assistant_id',
      columns: [t.orgId, t.assistantId],
      foreignColumns: [aiCallAssistants.orgId, aiCallAssistants.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_wa_calls_ai_call_log_id',
      columns: [t.orgId, t.aiCallLogId],
      foreignColumns: [aiCallLogs.orgId, aiCallLogs.id],
    }).onDelete('set null'),
    index('idx_wa_calls_assistant_id').on(t.orgId, t.assistantId),
    index('idx_wa_calls_contact_id_started_at').on(t.orgId, t.contactId, t.startedAt),
    index('idx_wa_calls_wa_provider_config_id').on(t.orgId, t.waProviderConfigId),
    index('idx_wa_calls_status').on(t.orgId, t.status),
    index('idx_wa_calls_provider').on(t.orgId, t.provider),
  ],
);

export type WaCallsRow = typeof waCalls.$inferSelect;
export type NewWaCallsRow = typeof waCalls.$inferInsert;

export const waCallEvents = pgTable(
  'wa_call_events',
  {
    id: bigint('id', { mode: 'number' })
      .notNull()
      .default(sql`nextval('wa_call_events_id_seq')`),
    orgId: orgIdColumn(),
    waCallId: idColumn('wa_call_id').notNull(),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.receivedAt] }),
    index('idx_wa_call_events_wa_call_id_received_at').on(t.orgId, t.waCallId, t.receivedAt),
  ],
);

export type WaCallEventsRow = typeof waCallEvents.$inferSelect;
export type NewWaCallEventsRow = typeof waCallEvents.$inferInsert;

export const waCallPermissions = pgTable(
  'wa_call_permissions',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    waProviderConfigId: idColumn('wa_provider_config_id'),
    contactPhone: text('contact_phone').notNull(),
    status: text('status').notNull().default('granted'),
    grantedAt: timestamp('granted_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_wa_call_permissions_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_wa_call_permissions_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    check('chk_wa_call_permissions_status', sql`${t.status} in ('granted', 'declined', 'expired')`),
    unique('uq_wa_call_permissions_wa_provider_config_id_contact_phone').on(
      t.orgId,
      t.waProviderConfigId,
      t.contactPhone,
    ),
    foreignKey({
      name: 'fk_wa_call_permissions_wa_provider_config_id',
      columns: [t.orgId, t.waProviderConfigId],
      foreignColumns: [waProviderConfigs.orgId, waProviderConfigs.id],
    }).onDelete('set null'),
    index('idx_wa_call_permissions_status').on(t.orgId, t.status),
  ],
);

export type WaCallPermissionsRow = typeof waCallPermissions.$inferSelect;
export type NewWaCallPermissionsRow = typeof waCallPermissions.$inferInsert;
