/**
 * scheduled-queue-warmer: tables ported from WaDesk. Mirrors migrations/20261001103100_sched_wadesk_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  check,
  date,
  foreignKey,
  index,
  integer,
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
import { wpcampaigns } from '../campaigns/tables';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { contacts } from '../crm';
import { organizations, users } from '../foundation';
import { waTemplates } from '../message-templates/tables';

export const scheduledMessages = pgTable(
  'scheduled_messages',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    campaignId: idColumn('campaign_id'),
    userId: idColumn('user_id'),
    deviceId: idColumn('device_id'),
    scheduleName: text('schedule_name').notNull(),
    messageContent: text('message_content'),
    templateId: idColumn('template_id'),
    templateType: text('template_type').notNull().default('text'),
    templateOverrides: jsonb('template_overrides'),
    scheduleType: text('schedule_type').notNull().default('once'),
    sendDate: date('send_date').notNull(),
    sendTime: text('send_time').notNull(),
    scheduledTime: timestamp('scheduled_time', { withTimezone: true }).notNull(),
    timezone: text('timezone').notNull(),
    repeatInterval: text('repeat_interval'),
    repeatEvery: integer('repeat_every').notNull().default(1),
    daysOfWeek: jsonb('days_of_week'),
    endDate: date('end_date'),
    mediaFile: text('media_file'),
    latitude: numeric('latitude', { precision: 10, scale: 7 }),
    longitude: numeric('longitude', { precision: 10, scale: 7 }),
    recipientType: text('recipient_type').notNull(),
    targetQueues: jsonb('target_queues'),
    targetGroups: jsonb('target_groups'),
    targetNumbers: jsonb('target_numbers'),
    totalRecipients: integer('total_recipients').notNull().default(0),
    fromNumber: text('from_number'),
    nodeScheduleId: text('node_schedule_id'),
    status: text('status').notNull().default('scheduled'),
    sendAttempts: smallint('send_attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    lastError: text('last_error'),
    nextRunAt: timestamp('next_run_at', { withTimezone: true }),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    failureReason: text('failure_reason'),
    totalSent: integer('total_sent').notNull().default(0),
    totalDelivered: integer('total_delivered').notNull().default(0),
    totalFailed: integer('total_failed').notNull().default(0),
    chargedSent: integer('charged_sent').notNull().default(0),
    provider: text('provider'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_scheduled_messages_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_scheduled_messages_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_scheduled_messages_campaign_id',
      columns: [t.orgId, t.campaignId],
      foreignColumns: [wpcampaigns.orgId, wpcampaigns.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_scheduled_messages_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    foreignKey({
      name: 'fk_scheduled_messages_template_id',
      columns: [t.orgId, t.templateId],
      foreignColumns: [waTemplates.orgId, waTemplates.id],
    }).onDelete('set null'),
    index('idx_scheduled_messages_campaign_id').on(t.orgId, t.campaignId),
    index('idx_scheduled_messages_device_id').on(t.orgId, t.deviceId),
    index('idx_scheduled_messages_next_run_at').on(t.orgId, t.nextRunAt),
    index('idx_scheduled_messages_node_schedule_id').on(t.orgId, t.nodeScheduleId),
    index('idx_scheduled_messages_provider').on(t.orgId, t.provider),
    index('idx_scheduled_messages_user_id').on(t.orgId, t.userId),
    index('idx_scheduled_messages_schedule_type').on(t.orgId, t.scheduleType),
    index('idx_scheduled_messages_status_next_run_at').on(t.orgId, t.status, t.nextRunAt),
  ],
);

export type ScheduledMessagesRow = typeof scheduledMessages.$inferSelect;
export type NewScheduledMessagesRow = typeof scheduledMessages.$inferInsert;

export const scheduledMessageContacts = pgTable(
  'scheduled_message_contacts',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    scheduledMessageId: idColumn('scheduled_message_id').notNull(),
    contactId: idColumn('contact_id'),
    phone: text('phone').notNull(),
    status: text('status').notNull().default('pending'),
    errorMessage: text('error_message'),
    waMessageId: text('wa_message_id'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_scheduled_message_contacts_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_scheduled_message_contacts_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    check(
      'chk_scheduled_message_contacts_status',
      sql`${t.status} in ('pending', 'sent', 'delivered', 'read', 'failed')`,
    ),
    foreignKey({
      name: 'fk_scheduled_message_contacts_scheduled_message_id',
      columns: [t.orgId, t.scheduledMessageId],
      foreignColumns: [scheduledMessages.orgId, scheduledMessages.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_scheduled_message_contacts_contact_id',
      columns: [t.orgId, t.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('set null'),
    index('idx_scheduled_message_contacts_scheduled_message_id_phone').on(
      t.orgId,
      t.scheduledMessageId,
      t.phone,
    ),
    index('idx_scheduled_message_contacts_scheduled_message_id_status').on(
      t.orgId,
      t.scheduledMessageId,
      t.status,
    ),
    index('idx_scheduled_message_contacts_wa_message_id').on(t.orgId, t.waMessageId),
  ],
);

export type ScheduledMessageContactsRow = typeof scheduledMessageContacts.$inferSelect;
export type NewScheduledMessageContactsRow = typeof scheduledMessageContacts.$inferInsert;

export const warmerDailySends = pgTable(
  'warmer_daily_sends',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    deviceId: idColumn('device_id').notNull(),
    engine: text('engine').notNull().default('baileys'),
    day: date('day').notNull(),
    count: integer('count').notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_warmer_daily_sends_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_warmer_daily_sends_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_warmer_daily_sends_engine_device_id_day').on(t.orgId, t.engine, t.deviceId, t.day),
    index('idx_warmer_daily_sends_day').on(t.orgId, t.day),
  ],
);

export type WarmerDailySendsRow = typeof warmerDailySends.$inferSelect;
export type NewWarmerDailySendsRow = typeof warmerDailySends.$inferInsert;
