/**
 * channel-viber: tables ported from Reference. Mirrors migrations/20261001104400_vib_threadwise_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
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
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { conversations } from '../chat-conversations/tables';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations, users } from '../foundation';
import { waTemplates } from '../message-templates/tables';

export const viberChannels = pgTable(
  'viber_channels',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    connectedBy: idColumn('connected_by'),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    authToken: text('auth_token').notNull(),
    webhookToken: text('webhook_token').notNull(),
    viberId: text('viber_id'),
    botName: text('bot_name'),
    botUri: text('bot_uri'),
    botAvatar: text('bot_avatar'),
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
    unique('uq_viber_channels_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_viber_channels_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_viber_channels_webhook_token').on(t.webhookToken),
    foreignKey({
      name: 'fk_viber_channels_connected_by',
      columns: [t.orgId, t.connectedBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_viber_channels_active').on(t.orgId, t.active),
    index('idx_viber_channels_viber_id').on(t.orgId, t.viberId),
  ],
);

export type ViberChannelsRow = typeof viberChannels.$inferSelect;
export type NewViberChannelsRow = typeof viberChannels.$inferInsert;

export const viberBroadcasts = pgTable(
  'viber_broadcasts',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    viberChannelId: idColumn('viber_channel_id').notNull(),
    userId: idColumn('user_id'),
    name: text('name'),
    templateId: idColumn('template_id'),
    body: text('body'),
    buttons: jsonb('buttons'),
    mediaPath: text('media_path'),
    mediaKind: text('media_kind'),
    /** Bytes of the attached file; Viber requires it on a video message. */
    mediaSize: bigint('media_size', { mode: 'number' }),
    status: text('status').notNull().default('draft'),
    total: integer('total').notNull().default(0),
    sent: integer('sent').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    /** Receipts Viber reported for this broadcast's recipients (matched on the message token). */
    delivered: integer('delivered').notNull().default(0),
    seen: integer('seen').notNull().default(0),
    lastError: text('last_error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_viber_broadcasts_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_viber_broadcasts_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_viber_broadcasts_viber_channel_id',
      columns: [t.orgId, t.viberChannelId],
      foreignColumns: [viberChannels.orgId, viberChannels.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_viber_broadcasts_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_viber_broadcasts_template_id',
      columns: [t.orgId, t.templateId],
      foreignColumns: [waTemplates.orgId, waTemplates.id],
    }).onDelete('set null'),
    index('idx_viber_broadcasts_status').on(t.orgId, t.status),
    index('idx_viber_broadcasts_viber_channel_id').on(t.orgId, t.viberChannelId),
  ],
);

export type ViberBroadcastsRow = typeof viberBroadcasts.$inferSelect;
export type NewViberBroadcastsRow = typeof viberBroadcasts.$inferInsert;

export const viberBroadcastRecipients = pgTable(
  'viber_broadcast_recipients',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    viberBroadcastId: idColumn('viber_broadcast_id').notNull(),
    viberUserId: text('viber_user_id').notNull(),
    title: text('title'),
    conversationId: idColumn('conversation_id'),
    status: text('status').notNull().default('pending'),
    error: text('error'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    /** Viber's token for the send; a batch of up to 300 shares one, so a receipt is matched on token and user id. */
    messageToken: text('message_token'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    seenAt: timestamp('seen_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_viber_broadcast_recipients_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_viber_broadcast_recipients_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_viber_broadcast_recipients_viber_broadcast_id',
      columns: [t.orgId, t.viberBroadcastId],
      foreignColumns: [viberBroadcasts.orgId, viberBroadcasts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_viber_broadcast_recipients_conversation_id',
      columns: [t.orgId, t.conversationId],
      foreignColumns: [conversations.orgId, conversations.id],
    }).onDelete('set null'),
    index('idx_viber_broadcast_recipients_viber_broadcast_id_status').on(
      t.orgId,
      t.viberBroadcastId,
      t.status,
    ),
    index('idx_viber_broadcast_recipients_status').on(t.orgId, t.status),
    index('idx_viber_broadcast_recipients_viber_user_id').on(t.orgId, t.viberUserId),
    index('idx_viber_broadcast_recipients_message_token').on(
      t.orgId,
      t.messageToken,
      t.viberUserId,
    ),
  ],
);

export type ViberBroadcastRecipientsRow = typeof viberBroadcastRecipients.$inferSelect;
export type NewViberBroadcastRecipientsRow = typeof viberBroadcastRecipients.$inferInsert;
