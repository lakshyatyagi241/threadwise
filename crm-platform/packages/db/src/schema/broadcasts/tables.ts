/**
 * broadcasts: tables ported from WaDesk. Mirrors migrations/20261001102900_bcast_wadesk_schema.sql.
 * The SQL migration is the source of truth (ADR-0004); `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
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
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { contacts } from '../crm';
import { organizations, users } from '../foundation';
import { waTemplates } from '../message-templates/tables';

export const broadcasts = pgTable(
  'broadcasts',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    deviceId: idColumn('device_id'),
    templateId: idColumn('template_id'),
    templateOverrides: jsonb('template_overrides'),
    name: text('name').notNull(),
    timezone: text('timezone'),
    status: text('status').notNull().default('scheduled'),
    sendAttempts: smallint('send_attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    pinned: boolean('pinned').notNull().default(false),
    archived: boolean('archived').notNull().default(false),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    nodeScheduleId: text('node_schedule_id'),
    totalRecipients: integer('total_recipients').notNull().default(0),
    successCount: integer('success_count').notNull().default(0),
    deliveredCount: integer('delivered_count').notNull().default(0),
    readCount: integer('read_count').notNull().default(0),
    clickedCount: integer('clicked_count').notNull().default(0),
    failCount: integer('fail_count').notNull().default(0),
    provider: text('provider'),
    tempCaption: text('temp_caption'),
    messagesLog: jsonb('messages_log'),
    templateType: text('template_type'),
    tempImage: text('temp_image'),
    buttonText: jsonb('button_text'),
    latitude: text('latitude'),
    longitude: text('longitude'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_broadcasts_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_broadcasts_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_broadcasts_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_broadcasts_template_id',
      columns: [t.orgId, t.templateId],
      foreignColumns: [waTemplates.orgId, waTemplates.id],
    }).onDelete('set null'),
    index('idx_broadcasts_archived').on(t.orgId, t.archived),
    index('idx_broadcasts_device_id').on(t.orgId, t.deviceId),
    index('idx_broadcasts_provider').on(t.orgId, t.provider),
    index('idx_broadcasts_scheduled_at').on(t.orgId, t.scheduledAt),
    index('idx_broadcasts_status').on(t.orgId, t.status),
    index('idx_broadcasts_template_id').on(t.orgId, t.templateId),
    index('idx_broadcasts_user_id_status').on(t.orgId, t.userId, t.status),
  ],
);

export type BroadcastsRow = typeof broadcasts.$inferSelect;
export type NewBroadcastsRow = typeof broadcasts.$inferInsert;

export const broadcastContacts = pgTable(
  'broadcast_contacts',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    broadcastId: idColumn('broadcast_id').notNull(),
    contactId: idColumn('contact_id').notNull(),
    status: text('status').notNull().default('pending'),
    errorMessage: text('error_message'),
    whatsappMessageId: text('whatsapp_message_id'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_broadcast_contacts_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_broadcast_contacts_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_broadcast_contacts_broadcast_id',
      columns: [t.orgId, t.broadcastId],
      foreignColumns: [broadcasts.orgId, broadcasts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_broadcast_contacts_contact_id',
      columns: [t.orgId, t.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('cascade'),
    index('idx_broadcast_contacts_broadcast_id_status').on(t.orgId, t.broadcastId, t.status),
    index('idx_broadcast_contacts_contact_id').on(t.orgId, t.contactId),
    index('idx_broadcast_contacts_status').on(t.orgId, t.status),
  ],
);

export type BroadcastContactsRow = typeof broadcastContacts.$inferSelect;
export type NewBroadcastContactsRow = typeof broadcastContacts.$inferInsert;

export const waLinkClicks = pgTable(
  'wa_link_clicks',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    token: text('token').notNull(),
    originalUrl: text('original_url').notNull(),
    broadcastId: idColumn('broadcast_id'),
    campaignId: idColumn('campaign_id'),
    messageId: idColumn('message_id'),
    contactId: idColumn('contact_id'),
    templateId: idColumn('template_id'),
    phone: text('phone'),
    clicks: integer('clicks').notNull().default(0),
    uniqueClicks: integer('unique_clicks').notNull().default(0),
    firstClickAt: timestamp('first_click_at', { withTimezone: true }),
    lastClickAt: timestamp('last_click_at', { withTimezone: true }),
    lastIp: text('last_ip'),
    lastUserAgent: text('last_user_agent'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_wa_link_clicks_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_wa_link_clicks_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_wa_link_clicks_token').on(t.token),
    foreignKey({
      name: 'fk_wa_link_clicks_broadcast_id',
      columns: [t.orgId, t.broadcastId],
      foreignColumns: [broadcasts.orgId, broadcasts.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_wa_link_clicks_contact_id',
      columns: [t.orgId, t.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_wa_link_clicks_template_id',
      columns: [t.orgId, t.templateId],
      foreignColumns: [waTemplates.orgId, waTemplates.id],
    }).onDelete('set null'),
    index('idx_wa_link_clicks_broadcast_id').on(t.orgId, t.broadcastId),
    index('idx_wa_link_clicks_campaign_id').on(t.orgId, t.campaignId),
    index('idx_wa_link_clicks_contact_id').on(t.orgId, t.contactId),
    index('idx_wa_link_clicks_expires_at').on(t.orgId, t.expiresAt),
    index('idx_wa_link_clicks_message_id').on(t.orgId, t.messageId),
    index('idx_wa_link_clicks_phone').on(t.orgId, t.phone),
  ],
);

export type WaLinkClicksRow = typeof waLinkClicks.$inferSelect;
export type NewWaLinkClicksRow = typeof waLinkClicks.$inferInsert;
