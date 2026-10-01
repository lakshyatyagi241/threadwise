/**
 * auto-reply-keywords: tables ported from Reference. Mirrors migrations/20261001103200_ar_threadwise_schema.sql.
 * The SQL migration is the source of truth (ADR-0004); `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  bigint,
  boolean,
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
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { contacts } from '../crm';
import { flows } from '../flow-builder-editor/tables';
import { organizations, users } from '../foundation';
import { waTemplates } from '../message-templates/tables';

export const autoReplyLookups = pgTable(
  'auto_reply_lookups',
  {
    id: bigint('id', { mode: 'number' })
      .notNull()
      .default(sql`nextval('auto_reply_lookups_id_seq')`),
    orgId: orgIdColumn(),
    deviceId: idColumn('device_id'),
    matchedKeywordReplyId: idColumn('matched_keyword_reply_id'),
    contactPhone: text('contact_phone').notNull(),
    queryText: text('query_text').notNull(),
    latencyMs: integer('latency_ms'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.createdAt] }),
    index('idx_auto_reply_lookups_created_at').on(t.orgId, t.createdAt),
    index('idx_auto_reply_lookups_device_id_created_at').on(t.orgId, t.deviceId, t.createdAt),
    index('idx_auto_reply_lookups_matched_keyword_reply_id_created_at').on(
      t.orgId,
      t.matchedKeywordReplyId,
      t.createdAt,
    ),
  ],
);

export type AutoReplyLookupsRow = typeof autoReplyLookups.$inferSelect;
export type NewAutoReplyLookupsRow = typeof autoReplyLookups.$inferInsert;

export const keywordReplies = pgTable(
  'keyword_replies',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    provider: text('provider').notNull().default('baileys'),
    deviceId: idColumn('device_id'),
    keyword: text('keyword').notNull(),
    keywordTranslations: jsonb('keyword_translations'),
    canonicalLanguage: text('canonical_language').notNull().default('en'),
    matchingMethod: text('matching_method').notNull().default('exact'),
    isCatchAll: boolean('is_catch_all').notNull().default(false),
    triggerType: text('trigger_type').notNull().default('keyword'),
    igTrigger: text('ig_trigger'),
    fuzzySimilarity: smallint('fuzzy_similarity').notNull().default(80),
    replyType: text('reply_type').notNull(),
    flowId: idColumn('flow_id'),
    isFlowTrigger: boolean('is_flow_trigger').notNull().default(false),
    targetContactId: idColumn('target_contact_id'),
    targetCatalogId: idColumn('target_catalog_id'),
    cooldown: integer('cooldown'),
    resendUnit: text('resend_unit'),
    stopOnAgentReply: boolean('stop_on_agent_reply').notNull().default(false),
    resumeAfter: integer('resume_after'),
    resumeUnit: text('resume_unit'),
    timeout: integer('timeout'),
    workingHours: jsonb('working_hours'),
    excludedNumbers: jsonb('excluded_numbers'),
    excludedGroupIds: jsonb('excluded_group_ids'),
    messageType: text('message_type').notNull().default('text'),
    status: boolean('status').notNull().default(true),
    triggerCount: bigint('trigger_count', { mode: 'number' }).notNull().default(0),
    lastTriggeredAt: timestamp('last_triggered_at', { withTimezone: true }),
    priority: integer('priority').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_keyword_replies_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_keyword_replies_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_keyword_replies_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_keyword_replies_flow_id',
      columns: [t.orgId, t.flowId],
      foreignColumns: [flows.orgId, flows.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_keyword_replies_target_contact_id',
      columns: [t.orgId, t.targetContactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('set null'),
    index('idx_keyword_replies_flow_id_is_flow_trigger').on(t.orgId, t.flowId, t.isFlowTrigger),
    index('idx_keyword_replies_ig_trigger').on(t.orgId, t.igTrigger),
    index('idx_keyword_replies_keyword').on(t.orgId, t.keyword),
    index('idx_keyword_replies_priority').on(t.orgId, t.priority),
    index('idx_keyword_replies_status').on(t.orgId, t.status),
    index('idx_keyword_replies_trigger_count').on(t.orgId, t.triggerCount),
    index('idx_keyword_replies_trigger_type').on(t.orgId, t.triggerType),
    index('idx_keyword_replies_user_id').on(t.orgId, t.userId),
    index('idx_keyword_replies_provider').on(t.orgId, t.provider),
    index('idx_keyword_replies_device_id_is_catch_all_status').on(
      t.orgId,
      t.deviceId,
      t.isCatchAll,
      t.status,
    ),
  ],
);

export type KeywordRepliesRow = typeof keywordReplies.$inferSelect;
export type NewKeywordRepliesRow = typeof keywordReplies.$inferInsert;

export const keywordReplyContents = pgTable(
  'keyword_reply_contents',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    keywordReplyId: idColumn('keyword_reply_id').notNull(),
    contentType: text('content_type').notNull().default('text'),
    variantRole: text('variant_role').notNull().default('primary'),
    content: text('content'),
    contentTranslations: jsonb('content_translations'),
    filePath: text('file_path'),
    originalName: text('original_name'),
    fileSize: bigint('file_size', { mode: 'number' }),
    mimeType: text('mime_type'),
    templateId: idColumn('template_id'),
    isSelected: boolean('is_selected').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_keyword_reply_contents_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_keyword_reply_contents_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_keyword_reply_contents_keyword_reply_id',
      columns: [t.orgId, t.keywordReplyId],
      foreignColumns: [keywordReplies.orgId, keywordReplies.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_keyword_reply_contents_template_id',
      columns: [t.orgId, t.templateId],
      foreignColumns: [waTemplates.orgId, waTemplates.id],
    }).onDelete('set null'),
    index('idx_keyword_reply_contents_keyword_reply_id').on(t.orgId, t.keywordReplyId),
    index('idx_keyword_reply_contents_variant_role').on(t.orgId, t.variantRole),
  ],
);

export type KeywordReplyContentsRow = typeof keywordReplyContents.$inferSelect;
export type NewKeywordReplyContentsRow = typeof keywordReplyContents.$inferInsert;

export const keywordReplyLogs = pgTable(
  'keyword_reply_logs',
  {
    id: bigint('id', { mode: 'number' })
      .notNull()
      .default(sql`nextval('keyword_reply_logs_id_seq')`),
    orgId: orgIdColumn(),
    keywordReplyId: idColumn('keyword_reply_id').notNull(),
    contentId: idColumn('content_id'),
    contactPhone: text('contact_phone').notNull(),
    matchedText: text('matched_text'),
    matchedVariant: text('matched_variant'),
    detectedLanguage: text('detected_language'),
    firedAt: timestamp('fired_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.firedAt] }),
    index('idx_keyword_reply_logs_fired_at').on(t.orgId, t.firedAt),
    index('idx_keyword_reply_logs_keyword_reply_id_fired_at').on(
      t.orgId,
      t.keywordReplyId,
      t.firedAt,
    ),
  ],
);

export type KeywordReplyLogsRow = typeof keywordReplyLogs.$inferSelect;
export type NewKeywordReplyLogsRow = typeof keywordReplyLogs.$inferInsert;
