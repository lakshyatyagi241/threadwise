/**
 * channel-facebook: tables ported from WaDesk. Mirrors migrations/20261001104000_fb_wadesk_schema.sql.
 * The SQL migration is the source of truth (ADR-0004); `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  bigint,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { conversations } from '../chat-conversations/tables';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations, users } from '../foundation';
import { waTemplates } from '../message-templates/tables';

export const facebookPages = pgTable(
  'facebook_pages',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    pageId: text('page_id').notNull(),
    name: text('name'),
    category: text('category'),
    username: text('username'),
    pictureUrl: text('picture_url'),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    accessToken: text('access_token'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
    dataAccessExpiresAt: timestamp('data_access_expires_at', { withTimezone: true }),
    scopes: jsonb('scopes'),
    tasks: jsonb('tasks'),
    status: text('status').notNull().default('connected'),
    connectMethod: text('connect_method').notNull().default('oauth'),
    fanCount: bigint('fan_count', { mode: 'number' }),
    lastError: text('last_error'),
    metaJson: jsonb('meta_json'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_facebook_pages_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_facebook_pages_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_facebook_pages_page_id').on(t.orgId, t.pageId),
    foreignKey({
      name: 'fk_facebook_pages_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
  ],
);

export type FacebookPagesRow = typeof facebookPages.$inferSelect;
export type NewFacebookPagesRow = typeof facebookPages.$inferInsert;

export const facebookPosts = pgTable(
  'facebook_posts',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    facebookPageId: idColumn('facebook_page_id').notNull(),
    userId: idColumn('user_id'),
    fbPostId: text('fb_post_id'),
    type: text('type').notNull().default('text'),
    status: text('status').notNull().default('draft'),
    message: text('message'),
    link: text('link'),
    mediaJson: jsonb('media_json'),
    scheduledPublishTime: timestamp('scheduled_publish_time', { withTimezone: true }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    error: text('error'),
    metaJson: jsonb('meta_json'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_facebook_posts_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_facebook_posts_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_facebook_posts_facebook_page_id',
      columns: [t.orgId, t.facebookPageId],
      foreignColumns: [facebookPages.orgId, facebookPages.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_facebook_posts_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_facebook_posts_facebook_page_id').on(t.orgId, t.facebookPageId),
    index('idx_facebook_posts_status').on(t.orgId, t.status),
  ],
);

export type FacebookPostsRow = typeof facebookPosts.$inferSelect;
export type NewFacebookPostsRow = typeof facebookPosts.$inferInsert;

export const facebookBroadcasts = pgTable(
  'facebook_broadcasts',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    facebookPageId: idColumn('facebook_page_id').notNull(),
    userId: idColumn('user_id'),
    name: text('name'),
    templateId: idColumn('template_id'),
    body: text('body'),
    buttons: jsonb('buttons'),
    status: text('status').notNull().default('draft'),
    total: integer('total').notNull().default(0),
    sent: integer('sent').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    blocked: integer('blocked').notNull().default(0),
    lastError: text('last_error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_facebook_broadcasts_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_facebook_broadcasts_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_facebook_broadcasts_facebook_page_id',
      columns: [t.orgId, t.facebookPageId],
      foreignColumns: [facebookPages.orgId, facebookPages.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_facebook_broadcasts_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_facebook_broadcasts_template_id',
      columns: [t.orgId, t.templateId],
      foreignColumns: [waTemplates.orgId, waTemplates.id],
    }).onDelete('set null'),
    index('idx_facebook_broadcasts_facebook_page_id').on(t.orgId, t.facebookPageId),
    index('idx_facebook_broadcasts_status').on(t.orgId, t.status),
  ],
);

export type FacebookBroadcastsRow = typeof facebookBroadcasts.$inferSelect;
export type NewFacebookBroadcastsRow = typeof facebookBroadcasts.$inferInsert;

export const facebookBroadcastRecipients = pgTable(
  'facebook_broadcast_recipients',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    facebookBroadcastId: idColumn('facebook_broadcast_id').notNull(),
    psid: text('psid').notNull(),
    title: text('title'),
    conversationId: idColumn('conversation_id'),
    status: text('status').notNull().default('pending'),
    providerMessageId: text('provider_message_id'),
    error: text('error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_facebook_broadcast_recipients_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_facebook_broadcast_recipients_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_facebook_broadcast_recipients_facebook_broadcast_id',
      columns: [t.orgId, t.facebookBroadcastId],
      foreignColumns: [facebookBroadcasts.orgId, facebookBroadcasts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_facebook_broadcast_recipients_conversation_id',
      columns: [t.orgId, t.conversationId],
      foreignColumns: [conversations.orgId, conversations.id],
    }).onDelete('set null'),
    index('idx_facebook_broadcast_recipients_psid').on(t.orgId, t.psid),
    index('idx_facebook_broadcast_recipients_status').on(t.orgId, t.status),
    index('idx_facebook_broadcast_recipients_facebook_broadcast_id_status').on(
      t.orgId,
      t.facebookBroadcastId,
      t.status,
    ),
  ],
);

export type FacebookBroadcastRecipientsRow = typeof facebookBroadcastRecipients.$inferSelect;
export type NewFacebookBroadcastRecipientsRow = typeof facebookBroadcastRecipients.$inferInsert;
