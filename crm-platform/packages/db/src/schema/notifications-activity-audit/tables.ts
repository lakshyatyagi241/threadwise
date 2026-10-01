/**
 * notifications-activity-audit: tables ported from Reference. Mirrors migrations/20261001100400_notif_threadwise_schema.sql.
 * The SQL migration is the source of truth (ADR-0004); `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  boolean,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations, users } from '../foundation';

export const inboxNotifications = pgTable(
  'inbox_notifications',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    data: jsonb('data'),
    link: text('link'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_inbox_notifications_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_inbox_notifications_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_inbox_notifications_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_inbox_notifications_read_at').on(t.orgId, t.readAt),
    index('idx_inbox_notifications_type').on(t.orgId, t.type),
    index('idx_inbox_notifications_user_id_read_at').on(t.orgId, t.userId, t.readAt),
  ],
);

export type InboxNotificationsRow = typeof inboxNotifications.$inferSelect;
export type NewInboxNotificationsRow = typeof inboxNotifications.$inferInsert;

export const notifications = pgTable(
  'notifications',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    category: text('category').notNull().default('system'),
    severity: text('severity').notNull().default('info'),
    icon: text('icon'),
    notificationTitle: text('notification_title').notNull(),
    notificationMsg: text('notification_msg').notNull(),
    sourceType: text('source_type'),
    sourceId: idColumn('source_id'),
    verb: text('verb'),
    actionUrl: text('action_url'),
    isUrgent: boolean('is_urgent').notNull().default(false),
    status: boolean('status').notNull().default(true),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_notifications_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_notifications_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_notifications_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_notifications_category_created_at').on(t.orgId, t.category, t.createdAt),
    index('idx_notifications_user_id_status').on(t.orgId, t.userId, t.status),
  ],
);

export type NotificationsRow = typeof notifications.$inferSelect;
export type NewNotificationsRow = typeof notifications.$inferInsert;

export const pushSubscriptions = pgTable(
  'push_subscriptions',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id'),
    endpoint: text('endpoint').notNull(),
    endpointHash: text('endpoint_hash').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    ua: text('ua'),
    channel: text('channel').notNull().default('team-inbox'),
    lastNotifiedAt: timestamp('last_notified_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_push_subscriptions_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_push_subscriptions_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_push_subscriptions_endpoint_hash').on(t.endpointHash),
    foreignKey({
      name: 'fk_push_subscriptions_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_push_subscriptions_channel').on(t.orgId, t.channel),
    index('idx_push_subscriptions_user_id').on(t.orgId, t.userId),
  ],
);

export type PushSubscriptionsRow = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscriptionsRow = typeof pushSubscriptions.$inferInsert;
