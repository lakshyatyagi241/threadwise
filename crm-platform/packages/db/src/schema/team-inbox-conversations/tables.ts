/**
 * team-inbox-conversations: tables ported from Reference. Mirrors migrations/20261001102600_tib1_threadwise_schema.sql.
 * The SQL migration is the source of truth (ADR-0004); `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  bigint,
  boolean,
  foreignKey,
  index,
  jsonb,
  numeric,
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
import { tags } from '../contact-views';
import { organizations, users } from '../foundation';

export const conversationTag = pgTable(
  'conversation_tag',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    conversationId: idColumn('conversation_id').notNull(),
    tagId: idColumn('tag_id').notNull(),
    addedBy: idColumn('added_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_conversation_tag_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_conversation_tag_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_conversation_tag_conversation_id_tag_id').on(t.orgId, t.conversationId, t.tagId),
    foreignKey({
      name: 'fk_conversation_tag_tag_id',
      columns: [t.orgId, t.tagId],
      foreignColumns: [tags.orgId, tags.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_conversation_tag_added_by',
      columns: [t.orgId, t.addedBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_conversation_tag_tag_id').on(t.orgId, t.tagId),
  ],
);

export type ConversationTagRow = typeof conversationTag.$inferSelect;
export type NewConversationTagRow = typeof conversationTag.$inferInsert;

export const inboxMessages = pgTable(
  'inbox_messages',
  {
    id: bigint('id', { mode: 'number' })
      .notNull()
      .default(sql`nextval('inbox_messages_id_seq')`),
    orgId: orgIdColumn(),
    conversationId: idColumn('conversation_id').notNull(),
    userId: idColumn('user_id'),
    agentId: idColumn('agent_id'),
    contactId: idColumn('contact_id'),
    templateId: idColumn('template_id'),
    direction: text('direction').notNull().default('out'),
    toNumber: text('to_number'),
    fromNumber: text('from_number'),
    body: text('body'),
    detectedLanguage: text('detected_language'),
    translatedBody: text('translated_body'),
    isTranslated: boolean('is_translated').notNull().default(false),
    mediaPath: text('media_path'),
    mediaType: text('media_type'),
    voiceTranscript: text('voice_transcript'),
    voiceTranscriptLang: text('voice_transcript_lang'),
    aiProcessedAt: timestamp('ai_processed_at', { withTimezone: true }),
    aiReplyId: idColumn('ai_reply_id'),
    latitude: numeric('latitude', { precision: 10, scale: 7 }),
    longitude: numeric('longitude', { precision: 10, scale: 7 }),
    status: text('status').notNull().default('pending'),
    failureReason: text('failure_reason'),
    pinned: boolean('pinned').notNull().default(false),
    starred: boolean('starred').notNull().default(false),
    reaction: text('reaction'),
    editedAt: timestamp('edited_at', { withTimezone: true }),
    qualityScore: smallint('quality_score'),
    qualityNote: text('quality_note'),
    meta: jsonb('meta'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    provider: text('provider'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.createdAt] }),
    index('idx_inbox_messages_agent_id').on(t.orgId, t.agentId),
    index('idx_inbox_messages_ai_processed_at').on(t.orgId, t.aiProcessedAt),
    index('idx_inbox_messages_contact_id').on(t.orgId, t.contactId),
    index('idx_inbox_messages_direction').on(t.orgId, t.direction),
    index('idx_inbox_messages_pinned').on(t.orgId, t.pinned),
    index('idx_inbox_messages_provider').on(t.orgId, t.provider),
    index('idx_inbox_messages_starred').on(t.orgId, t.starred),
    index('idx_inbox_messages_status').on(t.orgId, t.status),
    index('idx_inbox_messages_template_id').on(t.orgId, t.templateId),
    index('idx_inbox_messages_user_id').on(t.orgId, t.userId),
  ],
);

export type InboxMessagesRow = typeof inboxMessages.$inferSelect;
export type NewInboxMessagesRow = typeof inboxMessages.$inferInsert;

export const outboundWebhooks = pgTable(
  'outbound_webhooks',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    events: jsonb('events').notNull(),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    secret: text('secret'),
    isActive: boolean('is_active').notNull().default(true),
    firedCount: bigint('fired_count', { mode: 'number' }).notNull().default(0),
    failedCount: bigint('failed_count', { mode: 'number' }).notNull().default(0),
    lastFiredAt: timestamp('last_fired_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_outbound_webhooks_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_outbound_webhooks_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    index('idx_outbound_webhooks_is_active').on(t.orgId, t.isActive),
  ],
);

export type OutboundWebhooksRow = typeof outboundWebhooks.$inferSelect;
export type NewOutboundWebhooksRow = typeof outboundWebhooks.$inferInsert;

export const savedReplies = pgTable(
  'saved_replies',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    shortcut: text('shortcut').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    attachments: jsonb('attachments'),
    category: text('category'),
    usedCount: bigint('used_count', { mode: 'number' }).notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_saved_replies_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_saved_replies_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_saved_replies_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_saved_replies_shortcut').on(t.orgId, t.shortcut),
    index('idx_saved_replies_user_id').on(t.orgId, t.userId),
  ],
);

export type SavedRepliesRow = typeof savedReplies.$inferSelect;
export type NewSavedRepliesRow = typeof savedReplies.$inferInsert;
