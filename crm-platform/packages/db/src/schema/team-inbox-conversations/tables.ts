/**
 * team-inbox-conversations: tables ported from WaDesk. Mirrors migrations/20261001102600_tib1_wadesk_schema.sql
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
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
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
    // NULLS NOT DISTINCT: one shared (ownerless) reply per shortcut. Drizzle cannot express it; the SQL migration is the truth.
    uniqueIndex('uq_saved_replies_owner_shortcut').on(t.orgId, t.userId, t.shortcut),
  ],
);

export type SavedRepliesRow = typeof savedReplies.$inferSelect;
export type NewSavedRepliesRow = typeof savedReplies.$inferInsert;
