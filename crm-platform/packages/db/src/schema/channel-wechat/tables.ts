/**
 * channel-wechat: tables ported from Reference. Mirrors migrations/20261001104300_wech_threadwise_schema.sql.
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
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { conversations } from '../chat-conversations/tables';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
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
    /** Legacy plaintext routing token; NULL once the audit backfill has run (encryption audit E3). Read `webhookTokenEnc` first. */
    webhookToken: text('webhook_token'),
    /** sha256 (hex) of the routing token: what the public lookup function matches. */
    webhookTokenHash: text('webhook_token_hash'),
    /** The routing token sealed with CryptoService, so the webhook URL can be shown again. */
    webhookTokenEnc: text('webhook_token_enc'),
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
    uniqueIndex('uq_wechat_channels_webhook_token_hash')
      .on(t.webhookTokenHash)
      .where(sql`${t.webhookTokenHash} IS NOT NULL`),
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
    /** BL-191: a mass send is one call, so the whole broadcast waits for the workspace's quiet hours to end. Null = not held. */
    heldUntil: timestamp('held_until', { withTimezone: true }),
    heldReason: text('held_reason'),
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
    check(
      'ck_wechat_broadcasts_held_reason',
      sql`held_reason IS NULL OR held_reason IN ('quiet_hours', 'calling_window')`,
    ),
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
