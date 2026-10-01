/**
 * channel-wechat: tables ported from Reference. Mirrors migrations/20261001104300_wech_threadwise_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
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

export const wechatChannels = pgTable(
  'wechat_channels',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    connectedBy: idColumn('connected_by'),
    appId: text('app_id'),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    appSecret: text('app_secret').notNull(),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    verifyToken: text('verify_token').notNull(),
    encodingAesKey: text('encoding_aes_key'),
    encMode: text('enc_mode').notNull().default('compat'),
    webhookToken: text('webhook_token').notNull(),
    wxId: text('wx_id'),
    accountName: text('account_name'),
    avatarUrl: text('avatar_url'),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    cachedAccessToken: text('cached_access_token'),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }),
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
    unique('uq_wechat_channels_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_wechat_channels_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_wechat_channels_webhook_token').on(t.webhookToken),
    foreignKey({
      name: 'fk_wechat_channels_connected_by',
      columns: [t.orgId, t.connectedBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_wechat_channels_active').on(t.orgId, t.active),
    index('idx_wechat_channels_app_id').on(t.orgId, t.appId),
    index('idx_wechat_channels_wx_id').on(t.orgId, t.wxId),
  ],
);

export type WechatChannelsRow = typeof wechatChannels.$inferSelect;
export type NewWechatChannelsRow = typeof wechatChannels.$inferInsert;

export const wechatFlowSessions = pgTable(
  'wechat_flow_sessions',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    conversationId: idColumn('conversation_id').notNull(),
    wechatChannelId: idColumn('wechat_channel_id').notNull(),
    openid: text('openid').notNull(),
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
    unique('uq_wechat_flow_sessions_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_wechat_flow_sessions_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_wechat_flow_sessions_conversation_id').on(t.orgId, t.conversationId),
    foreignKey({
      name: 'fk_wechat_flow_sessions_conversation_id',
      columns: [t.orgId, t.conversationId],
      foreignColumns: [conversations.orgId, conversations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_wechat_flow_sessions_wechat_channel_id',
      columns: [t.orgId, t.wechatChannelId],
      foreignColumns: [wechatChannels.orgId, wechatChannels.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_wechat_flow_sessions_flow_id',
      columns: [t.orgId, t.flowId],
      foreignColumns: [flows.orgId, flows.id],
    }).onDelete('set null'),
    index('idx_wechat_flow_sessions_expires_at').on(t.orgId, t.expiresAt),
    index('idx_wechat_flow_sessions_flow_id').on(t.orgId, t.flowId),
    index('idx_wechat_flow_sessions_status').on(t.orgId, t.status),
    index('idx_wechat_flow_sessions_wechat_channel_id').on(t.orgId, t.wechatChannelId),
  ],
);

export type WechatFlowSessionsRow = typeof wechatFlowSessions.$inferSelect;
export type NewWechatFlowSessionsRow = typeof wechatFlowSessions.$inferInsert;

export const wechatBroadcasts = pgTable(
  'wechat_broadcasts',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    wechatChannelId: idColumn('wechat_channel_id').notNull(),
    userId: idColumn('user_id'),
    name: text('name'),
    templateId: idColumn('template_id'),
    body: text('body'),
    buttons: jsonb('buttons'),
    audience: text('audience').notNull().default('list'),
    tagId: text('tag_id'),
    massMsgId: text('mass_msg_id'),
    status: text('status').notNull().default('draft'),
    total: integer('total').notNull().default(0),
    sent: integer('sent').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    lastError: text('last_error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_wechat_broadcasts_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_wechat_broadcasts_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_wechat_broadcasts_wechat_channel_id',
      columns: [t.orgId, t.wechatChannelId],
      foreignColumns: [wechatChannels.orgId, wechatChannels.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_wechat_broadcasts_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_wechat_broadcasts_template_id',
      columns: [t.orgId, t.templateId],
      foreignColumns: [waTemplates.orgId, waTemplates.id],
    }).onDelete('set null'),
    index('idx_wechat_broadcasts_status').on(t.orgId, t.status),
    index('idx_wechat_broadcasts_wechat_channel_id').on(t.orgId, t.wechatChannelId),
  ],
);

export type WechatBroadcastsRow = typeof wechatBroadcasts.$inferSelect;
export type NewWechatBroadcastsRow = typeof wechatBroadcasts.$inferInsert;

export const wechatBroadcastRecipients = pgTable(
  'wechat_broadcast_recipients',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    wechatBroadcastId: idColumn('wechat_broadcast_id').notNull(),
    openid: text('openid').notNull(),
    title: text('title'),
    conversationId: idColumn('conversation_id'),
    status: text('status').notNull().default('pending'),
    error: text('error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_wechat_broadcast_recipients_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_wechat_broadcast_recipients_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_wechat_broadcast_recipients_wechat_broadcast_id',
      columns: [t.orgId, t.wechatBroadcastId],
      foreignColumns: [wechatBroadcasts.orgId, wechatBroadcasts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_wechat_broadcast_recipients_conversation_id',
      columns: [t.orgId, t.conversationId],
      foreignColumns: [conversations.orgId, conversations.id],
    }).onDelete('set null'),
    index('idx_wechat_broadcast_recipients_wechat_broadcast_id_status').on(
      t.orgId,
      t.wechatBroadcastId,
      t.status,
    ),
    index('idx_wechat_broadcast_recipients_openid').on(t.orgId, t.openid),
    index('idx_wechat_broadcast_recipients_status').on(t.orgId, t.status),
  ],
);

export type WechatBroadcastRecipientsRow = typeof wechatBroadcastRecipients.$inferSelect;
export type NewWechatBroadcastRecipientsRow = typeof wechatBroadcastRecipients.$inferInsert;
