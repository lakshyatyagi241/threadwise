/**
 * ai-agents-training: tables ported from Reference. Mirrors migrations/20261001102000_aiag_threadwise_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  bigint,
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations, users } from '../foundation';

export const aiChatAssistants = pgTable(
  'ai_chat_assistants',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    greeting: text('greeting'),
    systemPrompt: text('system_prompt'),
    tone: text('tone').notNull().default('helpful'),
    language: text('language').notNull().default('en'),
    aiProvider: text('ai_provider').notNull().default('openai'),
    aiModel: text('ai_model').notNull().default('gpt-4o-mini'),
    replyMaxTokens: smallint('reply_max_tokens').notNull().default(400),
    temperature: numeric('temperature', { precision: 4, scale: 2 }).notNull().default('0.70'),
    fallbackMessage: text('fallback_message'),
    handoffEnabled: boolean('handoff_enabled').notNull().default(true),
    handoffKeyword: text('handoff_keyword'),
    handoffMessage: text('handoff_message'),
    status: text('status').notNull().default('active'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_ai_chat_assistants_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_ai_chat_assistants_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_ai_chat_assistants_slug').on(t.orgId, t.slug),
    foreignKey({
      name: 'fk_ai_chat_assistants_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_ai_chat_assistants_user_id').on(t.orgId, t.userId),
    index('idx_ai_chat_assistants_status').on(t.orgId, t.status),
  ],
);

export type AiChatAssistantsRow = typeof aiChatAssistants.$inferSelect;
export type NewAiChatAssistantsRow = typeof aiChatAssistants.$inferInsert;

export const aiTrainingSources = pgTable(
  'ai_training_sources',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    assistantId: idColumn('assistant_id'),
    userId: idColumn('user_id'),
    kind: text('kind').notNull(),
    label: text('label').notNull(),
    url: text('url'),
    filePath: text('file_path'),
    content: text('content'),
    question: text('question'),
    answer: text('answer'),
    status: text('status').notNull().default('ready'),
    tokensEstimate: integer('tokens_estimate'),
    error: text('error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_ai_training_sources_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_ai_training_sources_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_ai_training_sources_assistant_id',
      columns: [t.orgId, t.assistantId],
      foreignColumns: [aiChatAssistants.orgId, aiChatAssistants.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_ai_training_sources_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_ai_training_sources_user_id').on(t.orgId, t.userId),
    index('idx_ai_training_sources_assistant_id_status').on(t.orgId, t.assistantId, t.status),
  ],
);

export type AiTrainingSourcesRow = typeof aiTrainingSources.$inferSelect;
export type NewAiTrainingSourcesRow = typeof aiTrainingSources.$inferInsert;

export const aiAgents = pgTable(
  'ai_agents',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    name: text('name').notNull(),
    provider: text('provider').notNull().default('openai'),
    model: text('model').notNull().default('gpt-4o-mini'),
    knowledgeAssistantId: idColumn('knowledge_assistant_id'),
    systemPrompt: text('system_prompt'),
    tone: text('tone').notNull().default('professional'),
    avatarColor: text('avatar_color').notNull().default('#6366f1'),
    autoRespond: boolean('auto_respond').notNull().default(true),
    maxTokens: smallint('max_tokens').notNull().default(512),
    temperature: smallint('temperature').notNull().default(7),
    maxRepliesPerConversation: smallint('max_replies_per_conversation').notNull().default(10),
    handoffKeywords: jsonb('handoff_keywords'),
    handoffLowScoreThreshold: smallint('handoff_low_score_threshold').notNull().default(0),
    handoffLowScoreWindow: smallint('handoff_low_score_window').notNull().default(3),
    handoffEnabled: boolean('handoff_enabled').notNull().default(true),
    useSavedReplies: boolean('use_saved_replies').notNull().default(false),
    voiceNoteEnabled: boolean('voice_note_enabled').notNull().default(false),
    voiceCallEnabled: boolean('voice_call_enabled').notNull().default(false),
    voiceProvider: text('voice_provider'),
    voiceId: text('voice_id'),
    voiceLanguage: text('voice_language').notNull().default('en'),
    asrProvider: text('asr_provider'),
    asrLanguage: text('asr_language'),
    maxVoiceNotesPerDay: integer('max_voice_notes_per_day').notNull().default(200),
    isActive: boolean('is_active').notNull().default(true),
    deviceIds: jsonb('device_ids'),
    messagesSent: bigint('messages_sent', { mode: 'number' }).notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_ai_agents_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_ai_agents_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_ai_agents_knowledge_assistant_id',
      columns: [t.orgId, t.knowledgeAssistantId],
      foreignColumns: [aiChatAssistants.orgId, aiChatAssistants.id],
    }).onDelete('set null'),
    index('idx_ai_agents_knowledge_assistant_id').on(t.orgId, t.knowledgeAssistantId),
  ],
);

export type AiAgentsRow = typeof aiAgents.$inferSelect;
export type NewAiAgentsRow = typeof aiAgents.$inferInsert;
