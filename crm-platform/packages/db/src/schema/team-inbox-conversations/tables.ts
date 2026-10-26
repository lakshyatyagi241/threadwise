/**
 * team-inbox-conversations: tables ported from Reference. Mirrors migrations/20261001102600_tib1_threadwise_schema.sql
 * and 20261014100300_tib1_saved_replies_shortcut_unique.sql (the folded `inbox_messages` is now `messages` in chat-conversations).
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  bigint,
  boolean,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  check,
  text,
  timestamp,
  unique,
  uniqueIndex,
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
    // 20261121090000_tib1_saved_replies_library.sql
    createdBy: idColumn('created_by'),
    language: text('language'),
    channelKinds: text('channel_kinds')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
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
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_saved_replies_created_by',
      columns: [t.orgId, t.createdBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    check(
      'chk_saved_replies_shortcut',
      sql`${t.shortcut} = lower(${t.shortcut}) AND char_length(${t.shortcut}) BETWEEN 1 AND 64 AND ${t.shortcut} !~ '[[:space:]/]'`,
    ),
    check('chk_saved_replies_title', sql`char_length(btrim(${t.title})) BETWEEN 1 AND 128`),
    check('chk_saved_replies_body', sql`char_length(btrim(${t.body})) BETWEEN 1 AND 4000`),
    check(
      'chk_saved_replies_category',
      sql`${t.category} IS NULL OR char_length(${t.category}) BETWEEN 1 AND 64`,
    ),
    check(
      'chk_saved_replies_language',
      sql`${t.language} IS NULL OR char_length(${t.language}) BETWEEN 2 AND 16`,
    ),
    check('chk_saved_replies_channel_kinds', sql`cardinality(${t.channelKinds}) <= 20`),
    index('idx_saved_replies_usage').on(t.orgId, t.usedCount.desc(), t.id),
    index('idx_saved_replies_shortcut').on(t.orgId, t.shortcut),
    // NULLS NOT DISTINCT: one shared (ownerless) reply per shortcut. Drizzle cannot express it; the SQL migration is the truth.
    uniqueIndex('uq_saved_replies_owner_shortcut').on(t.orgId, t.userId, t.shortcut),
  ],
);

export type SavedRepliesRow = typeof savedReplies.$inferSelect;
export type NewSavedRepliesRow = typeof savedReplies.$inferInsert;

/**
 * A file an agent attached in the composer before sending: the reference a send names (`mediaId`). The bytes live in the media store,
 * never in Postgres. Migration 20261015090100.
 */
export const conversationMediaUploads = pgTable(
  'conversation_media_uploads',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    mediaKey: text('media_key').notNull(),
    kind: text('kind').$type<'image' | 'video' | 'audio' | 'document'>().notNull(),
    mime: text('mime').notNull(),
    sizeBytes: idColumn('size_bytes').notNull(),
    name: text('name').notNull(),
    sha256: text('sha256').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    /** The send that claimed the file (its `clientMessageId`), so a retry of that send is recognised. */
    usedByClientMessageId: uuid('used_by_client_message_id'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_conversation_media_uploads_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'conversation_media_uploads_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'conversation_media_uploads_org_id_user_id_fkey',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    check(
      'chk_conversation_media_uploads_kind',
      sql`kind IN ('image', 'video', 'audio', 'document')`,
    ),
    check('chk_conversation_media_uploads_size', sql`size_bytes >= 0`),
    check(
      'chk_conversation_media_uploads_claim',
      sql`(used_at IS NULL) = (used_by_client_message_id IS NULL)`,
    ),
    index('idx_conversation_media_uploads_expiry')
      .on(t.expiresAt)
      .where(sql`used_at IS NULL`),
  ],
);

export type ConversationMediaUploadsRow = typeof conversationMediaUploads.$inferSelect;
export type NewConversationMediaUploadsRow = typeof conversationMediaUploads.$inferInsert;
