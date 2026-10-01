/**
 * channel-telegram: tables ported from Reference. Mirrors migrations/20261001104100_tg_threadwise_schema.sql.
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

export const telegramAccounts = pgTable(
  'telegram_accounts',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    connectedBy: idColumn('connected_by'),
    session: text('session'),
    tgUserId: text('tg_user_id'),
    username: text('username'),
    firstName: text('first_name'),
    phone: text('phone'),
    lastError: text('last_error'),
    lastCheckedAt: timestamp('last_checked_at', { withTimezone: true }),
    connectedAt: timestamp('connected_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_telegram_accounts_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_telegram_accounts_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_telegram_accounts_tg_user_id').on(t.orgId, t.tgUserId),
    foreignKey({
      name: 'fk_telegram_accounts_connected_by',
      columns: [t.orgId, t.connectedBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
  ],
);

export type TelegramAccountsRow = typeof telegramAccounts.$inferSelect;
export type NewTelegramAccountsRow = typeof telegramAccounts.$inferInsert;

export const telegramBots = pgTable(
  'telegram_bots',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    connectedBy: idColumn('connected_by'),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    botToken: text('bot_token').notNull(),
    botUsername: text('bot_username'),
    botName: text('bot_name'),
    botId: text('bot_id'),
    webhookToken: text('webhook_token').notNull(),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    secretToken: text('secret_token'),
    active: boolean('active').notNull().default(true),
    connectedAt: timestamp('connected_at', { withTimezone: true }),
    lastInboundAt: timestamp('last_inbound_at', { withTimezone: true }),
    lastError: text('last_error'),
    /** AES-GCM ciphertext (credential pattern); never plain text. */
    paymentProviderToken: text('payment_provider_token'),
    paymentProvider: text('payment_provider'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_telegram_bots_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_telegram_bots_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_telegram_bots_webhook_token').on(t.webhookToken),
    foreignKey({
      name: 'fk_telegram_bots_connected_by',
      columns: [t.orgId, t.connectedBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_telegram_bots_active').on(t.orgId, t.active),
    index('idx_telegram_bots_bot_id').on(t.orgId, t.botId),
  ],
);

export type TelegramBotsRow = typeof telegramBots.$inferSelect;
export type NewTelegramBotsRow = typeof telegramBots.$inferInsert;

export const telegramBroadcasts = pgTable(
  'telegram_broadcasts',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    telegramBotId: idColumn('telegram_bot_id').notNull(),
    userId: idColumn('user_id'),
    name: text('name'),
    templateId: idColumn('template_id'),
    body: text('body'),
    buttons: text('buttons'),
    mediaPath: text('media_path'),
    mediaKind: text('media_kind'),
    mediaFileId: text('media_file_id'),
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
    unique('uq_telegram_broadcasts_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_telegram_broadcasts_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_telegram_broadcasts_telegram_bot_id',
      columns: [t.orgId, t.telegramBotId],
      foreignColumns: [telegramBots.orgId, telegramBots.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_telegram_broadcasts_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_telegram_broadcasts_template_id',
      columns: [t.orgId, t.templateId],
      foreignColumns: [waTemplates.orgId, waTemplates.id],
    }).onDelete('set null'),
    index('idx_telegram_broadcasts_status').on(t.orgId, t.status),
    index('idx_telegram_broadcasts_telegram_bot_id').on(t.orgId, t.telegramBotId),
  ],
);

export type TelegramBroadcastsRow = typeof telegramBroadcasts.$inferSelect;
export type NewTelegramBroadcastsRow = typeof telegramBroadcasts.$inferInsert;

export const telegramBroadcastRecipients = pgTable(
  'telegram_broadcast_recipients',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    telegramBroadcastId: idColumn('telegram_broadcast_id').notNull(),
    chatId: text('chat_id').notNull(),
    title: text('title'),
    kind: text('kind'),
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
    unique('uq_telegram_broadcast_recipients_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_telegram_broadcast_recipients_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_telegram_broadcast_recipients_telegram_broadcast_id',
      columns: [t.orgId, t.telegramBroadcastId],
      foreignColumns: [telegramBroadcasts.orgId, telegramBroadcasts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_telegram_broadcast_recipients_conversation_id',
      columns: [t.orgId, t.conversationId],
      foreignColumns: [conversations.orgId, conversations.id],
    }).onDelete('set null'),
    index('idx_telegram_broadcast_recipients_chat_id').on(t.orgId, t.chatId),
    index('idx_telegram_broadcast_recipients_status').on(t.orgId, t.status),
    index('idx_telegram_broadcast_recipients_telegram_broadcast_id_status').on(
      t.orgId,
      t.telegramBroadcastId,
      t.status,
    ),
  ],
);

export type TelegramBroadcastRecipientsRow = typeof telegramBroadcastRecipients.$inferSelect;
export type NewTelegramBroadcastRecipientsRow = typeof telegramBroadcastRecipients.$inferInsert;

export const telegramFlowSessions = pgTable(
  'telegram_flow_sessions',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    conversationId: idColumn('conversation_id').notNull(),
    telegramBotId: idColumn('telegram_bot_id').notNull(),
    chatId: text('chat_id').notNull(),
    flowId: idColumn('flow_id'),
    nodeId: text('node_id'),
    status: text('status').notNull().default('running'),
    awaitVar: text('await_var'),
    awaitOptions: jsonb('await_options'),
    vars: text('vars'),
    lastError: text('last_error'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    lastMessageId: text('last_message_id'),
    pollId: text('poll_id'),
    invoicePayload: text('invoice_payload'),
    paymentLinkId: text('payment_link_id'),
    paymentRef: text('payment_ref'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_telegram_flow_sessions_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_telegram_flow_sessions_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_telegram_flow_sessions_conversation_id').on(t.orgId, t.conversationId),
    foreignKey({
      name: 'fk_telegram_flow_sessions_conversation_id',
      columns: [t.orgId, t.conversationId],
      foreignColumns: [conversations.orgId, conversations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_telegram_flow_sessions_telegram_bot_id',
      columns: [t.orgId, t.telegramBotId],
      foreignColumns: [telegramBots.orgId, telegramBots.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_telegram_flow_sessions_flow_id',
      columns: [t.orgId, t.flowId],
      foreignColumns: [flows.orgId, flows.id],
    }).onDelete('set null'),
    index('idx_telegram_flow_sessions_expires_at').on(t.orgId, t.expiresAt),
    index('idx_telegram_flow_sessions_flow_id').on(t.orgId, t.flowId),
    index('idx_telegram_flow_sessions_invoice_payload').on(t.orgId, t.invoicePayload),
    index('idx_telegram_flow_sessions_payment_link_id').on(t.orgId, t.paymentLinkId),
    index('idx_telegram_flow_sessions_poll_id').on(t.orgId, t.pollId),
    index('idx_telegram_flow_sessions_status').on(t.orgId, t.status),
    index('idx_telegram_flow_sessions_telegram_bot_id').on(t.orgId, t.telegramBotId),
  ],
);

export type TelegramFlowSessionsRow = typeof telegramFlowSessions.$inferSelect;
export type NewTelegramFlowSessionsRow = typeof telegramFlowSessions.$inferInsert;
