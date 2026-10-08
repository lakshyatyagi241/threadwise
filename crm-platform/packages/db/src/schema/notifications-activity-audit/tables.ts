/**
 * notifications-activity-audit: tables ported from Reference. Mirrors migrations/20261001100400_notif_threadwise_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import { sql } from 'drizzle-orm';
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
  uniqueIndex,
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
    /** Idempotency key: event type + outbox event id. Unique per (org, user) when set. */
    dedupeKey: text('dedupe_key'),
    readAt: timestamp('read_at', { withTimezone: true }),
    /** Non-null only for collapsing types (`msg:<conversation uuid>`): one UNREAD row per (user, key). */
    collapseKey: text('collapse_key'),
    /** How many events the row stands for ("3 new messages"). */
    eventCount: integer('event_count').notNull().default(1),
    /** What the row is about (`conversation`), with `subjectUuid`: lets "mark read" find rows without parsing `link`. */
    subjectKind: text('subject_kind'),
    subjectUuid: uuid('subject_uuid'),
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
    uniqueIndex('uq_inbox_notifications_dedupe')
      .on(t.orgId, t.userId, t.dedupeKey)
      .where(sql`dedupe_key IS NOT NULL`),
    index('idx_inbox_notifications_user_feed').on(t.orgId, t.userId, t.id.desc()),
    index('idx_inbox_notifications_user_unread')
      .on(t.orgId, t.userId)
      .where(sql`read_at IS NULL`),
    uniqueIndex('uq_inbox_notifications_collapse')
      .on(t.orgId, t.userId, t.collapseKey)
      .where(sql`collapse_key IS NOT NULL AND read_at IS NULL`),
    index('idx_inbox_notifications_collapse_latest')
      .on(t.orgId, t.userId, t.collapseKey, t.id.desc())
      .where(sql`collapse_key IS NOT NULL`),
    index('idx_inbox_notifications_subject_unread')
      .on(t.orgId, t.userId, t.subjectKind, t.subjectUuid)
      .where(sql`read_at IS NULL AND subject_uuid IS NOT NULL`),
    // "Was this waiting episode already nudged?" for one conversation (BL-098, migration 20261110090100).
    index('idx_inbox_notifications_chat_waiting')
      .on(t.orgId, t.subjectUuid, t.createdAt.desc())
      .where(sql`type = 'chat_waiting'`),
    // The retention job's batch deletes: oldest first, read and unread rows apart.
    index('idx_inbox_notifications_prune_read')
      .on(t.createdAt)
      .where(sql`read_at IS NOT NULL`),
    index('idx_inbox_notifications_prune_unread')
      .on(t.createdAt)
      .where(sql`read_at IS NULL`),
  ],
);

export type InboxNotificationsRow = typeof inboxNotifications.$inferSelect;
export type NewInboxNotificationsRow = typeof inboxNotifications.$inferInsert;

/** Mirrors 20261107090000_notif_user_prefs_retention.sql: what one person chose for one notification type; NULL = inherit. */
export const notificationUserPrefs = pgTable(
  'notification_user_prefs',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id').notNull(),
    type: text('type').notNull(),
    bell: boolean('bell'),
    toast: boolean('toast'),
    sound: boolean('sound'),
    /** The browser (Web Push) channel; null inherits the catalogue default. */
    push: boolean('push'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_notification_user_prefs_org_id_uuid').on(t.orgId, t.uuid),
    unique('uq_notification_user_prefs_user_type').on(t.orgId, t.userId, t.type),
    foreignKey({
      name: 'fk_notification_user_prefs_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('cascade'),
  ],
);

export type NotificationUserPrefsRow = typeof notificationUserPrefs.$inferSelect;
export type NewNotificationUserPrefsRow = typeof notificationUserPrefs.$inferInsert;

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
    userId: idColumn('user_id').notNull(),
    /** A secret: whoever holds it (with the keys) can push to the browser. Read only by the sender; never logged or returned. */
    endpoint: text('endpoint').notNull(),
    /** sha256 of the endpoint (hex): the lookup key, so an endpoint is never searched by its secret value. */
    endpointHash: text('endpoint_hash').notNull(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    /** The raw user agent, cut short. */
    ua: text('ua'),
    channel: text('channel').notNull().default('team-inbox'),
    /** A short name for the device ("Chrome on Windows"). */
    label: text('label'),
    /** The last time the push service accepted a push to this device. */
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
    failureCount: integer('failure_count').notNull().default(0),
    /** The push service said the subscription is gone (404 / 410) or the person removed the device. Never sent to again. */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
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
    unique('uq_push_subscriptions_user_endpoint').on(t.orgId, t.userId, t.endpointHash),
    foreignKey({
      name: 'fk_push_subscriptions_user_id',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('cascade'),
    index('idx_push_subscriptions_channel').on(t.orgId, t.channel),
    index('idx_push_subscriptions_user_id').on(t.orgId, t.userId),
    index('idx_push_subscriptions_live')
      .on(t.orgId, t.userId)
      .where(sql`${t.revokedAt} IS NULL`),
    index('idx_push_subscriptions_revoked')
      .on(t.revokedAt)
      .where(sql`${t.revokedAt} IS NOT NULL`),
  ],
);

export type PushSubscriptionsRow = typeof pushSubscriptions.$inferSelect;
export type NewPushSubscriptionsRow = typeof pushSubscriptions.$inferInsert;
