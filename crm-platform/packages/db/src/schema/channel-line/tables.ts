/**
 * channel-line: tables ported from Reference. Mirrors migrations/20261001104200_line_threadwise_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import { sql } from 'drizzle-orm';
import {
  check,
  boolean,
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
import { flows } from '../flow-builder-editor/tables';
import { organizations, users } from '../foundation';
import { waTemplates } from '../message-templates/tables';

export const lineChannels = pgTable(
  'line_channels',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    connectedBy: idColumn('connected_by'),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    channelAccessToken: text('channel_access_token').notNull(),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    channelSecret: text('channel_secret').notNull(),
    assertionKid: text('assertion_kid'),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    assertionPrivateKey: text('assertion_private_key'),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    rotatingToken: text('rotating_token'),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    rotatingTokenKeyId: text('rotating_token_key_id'),
    rotatingTokenExpiresAt: timestamp('rotating_token_expires_at', { withTimezone: true }),
    webhookToken: text('webhook_token').notNull(),
    lineChannelId: text('line_channel_id'),
    basicId: text('basic_id'),
    displayName: text('display_name'),
    pictureUrl: text('picture_url'),
    active: boolean('active').notNull().default(true),
    connectedAt: timestamp('connected_at', { withTimezone: true }),
    lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_line_channels_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_line_channels_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_line_channels_webhook_token').on(t.webhookToken),
    foreignKey({
      name: 'fk_line_channels_connected_by',
      columns: [t.orgId, t.connectedBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_line_channels_active').on(t.orgId, t.active),
    index('idx_line_channels_line_channel_id').on(t.orgId, t.lineChannelId),
  ],
);

export type LineChannelsRow = typeof lineChannels.$inferSelect;
export type NewLineChannelsRow = typeof lineChannels.$inferInsert;

export const lineFlowSessions = pgTable(
  'line_flow_sessions',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    conversationId: idColumn('conversation_id').notNull(),
    lineChannelId: idColumn('line_channel_id').notNull(),
    lineUserId: text('line_user_id').notNull(),
    flowId: idColumn('flow_id'),
    nodeId: text('node_id'),
    status: text('status').notNull().default('running'),
    awaitVar: text('await_var'),
    awaitOptions: jsonb('await_options'),
    vars: jsonb('vars'),
    lastError: text('last_error'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastMessageId: text('last_message_id'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_line_flow_sessions_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_line_flow_sessions_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_line_flow_sessions_conversation_id').on(t.orgId, t.conversationId),
    foreignKey({
      name: 'fk_line_flow_sessions_conversation_id',
      columns: [t.orgId, t.conversationId],
      foreignColumns: [conversations.orgId, conversations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_line_flow_sessions_line_channel_id',
      columns: [t.orgId, t.lineChannelId],
      foreignColumns: [lineChannels.orgId, lineChannels.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_line_flow_sessions_flow_id',
      columns: [t.orgId, t.flowId],
      foreignColumns: [flows.orgId, flows.id],
    }).onDelete('set null'),
    index('idx_line_flow_sessions_expires_at').on(t.orgId, t.expiresAt),
    index('idx_line_flow_sessions_flow_id').on(t.orgId, t.flowId),
    index('idx_line_flow_sessions_line_channel_id').on(t.orgId, t.lineChannelId),
    index('idx_line_flow_sessions_status').on(t.orgId, t.status),
  ],
);

export type LineFlowSessionsRow = typeof lineFlowSessions.$inferSelect;
export type NewLineFlowSessionsRow = typeof lineFlowSessions.$inferInsert;

export const lineRichMenus = pgTable(
  'line_rich_menus',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    lineChannelId: idColumn('line_channel_id').notNull(),
    createdBy: idColumn('created_by'),
    richMenuId: text('rich_menu_id'),
    name: text('name').notNull(),
    chatBarText: text('chat_bar_text').notNull().default('Menu'),
    layout: text('layout').notNull().default('full'),
    size: jsonb('size'),
    areas: jsonb('areas'),
    imagePath: text('image_path'),
    isDefault: boolean('is_default').notNull().default(false),
    active: boolean('active').notNull().default(true),
    lastError: text('last_error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_line_rich_menus_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_line_rich_menus_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_line_rich_menus_line_channel_id',
      columns: [t.orgId, t.lineChannelId],
      foreignColumns: [lineChannels.orgId, lineChannels.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_line_rich_menus_created_by',
      columns: [t.orgId, t.createdBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_line_rich_menus_active').on(t.orgId, t.active),
    index('idx_line_rich_menus_is_default').on(t.orgId, t.isDefault),
    index('idx_line_rich_menus_line_channel_id').on(t.orgId, t.lineChannelId),
    index('idx_line_rich_menus_rich_menu_id').on(t.orgId, t.richMenuId),
  ],
);

export type LineRichMenusRow = typeof lineRichMenus.$inferSelect;
export type NewLineRichMenusRow = typeof lineRichMenus.$inferInsert;

export const lineBroadcasts = pgTable(
  'line_broadcasts',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    lineChannelId: idColumn('line_channel_id').notNull(),
    userId: idColumn('user_id'),
    name: text('name'),
    templateId: idColumn('template_id'),
    body: text('body'),
    buttons: jsonb('buttons'),
    mediaPath: text('media_path'),
    mediaKind: text('media_kind'),
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
    unique('uq_line_broadcasts_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_line_broadcasts_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_line_broadcasts_line_channel_id',
      columns: [t.orgId, t.lineChannelId],
      foreignColumns: [lineChannels.orgId, lineChannels.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_line_broadcasts_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_line_broadcasts_template_id',
      columns: [t.orgId, t.templateId],
      foreignColumns: [waTemplates.orgId, waTemplates.id],
    }).onDelete('set null'),
    index('idx_line_broadcasts_line_channel_id').on(t.orgId, t.lineChannelId),
    index('idx_line_broadcasts_status').on(t.orgId, t.status),
  ],
);

export type LineBroadcastsRow = typeof lineBroadcasts.$inferSelect;
export type NewLineBroadcastsRow = typeof lineBroadcasts.$inferInsert;

export const lineBroadcastRecipients = pgTable(
  'line_broadcast_recipients',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    lineBroadcastId: idColumn('line_broadcast_id').notNull(),
    lineUserId: text('line_user_id').notNull(),
    title: text('title'),
    conversationId: idColumn('conversation_id'),
    status: text('status').notNull().default('pending'),
    providerMessageId: text('provider_message_id'),
    error: text('error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    /** BL-191: the instant this recipient may be messaged after the workspace's quiet hours, and why. Null = not held. */
    heldUntil: timestamp('held_until', { withTimezone: true }),
    heldReason: text('held_reason'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_line_broadcast_recipients_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_line_broadcast_recipients_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_line_broadcast_recipients_line_broadcast_id',
      columns: [t.orgId, t.lineBroadcastId],
      foreignColumns: [lineBroadcasts.orgId, lineBroadcasts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_line_broadcast_recipients_conversation_id',
      columns: [t.orgId, t.conversationId],
      foreignColumns: [conversations.orgId, conversations.id],
    }).onDelete('set null'),
    index('idx_line_broadcast_recipients_line_broadcast_id_status').on(
      t.orgId,
      t.lineBroadcastId,
      t.status,
    ),
    index('idx_line_broadcast_recipients_line_user_id').on(t.orgId, t.lineUserId),
    index('idx_line_broadcast_recipients_status').on(t.orgId, t.status),
    check(
      'ck_line_broadcast_recipients_held_reason',
      sql`held_reason IS NULL OR held_reason IN ('quiet_hours', 'calling_window')`,
    ),
    index('idx_line_broadcast_recipients_held')
      .on(t.orgId, t.lineBroadcastId, t.heldUntil)
      .where(sql`${t.heldUntil} IS NOT NULL`),
  ],
);

export type LineBroadcastRecipientsRow = typeof lineBroadcastRecipients.$inferSelect;
export type NewLineBroadcastRecipientsRow = typeof lineBroadcastRecipients.$inferInsert;
