/**
 * meeting-conferencing: a person's own Zoom / Teams account, and the video link and calendar entry asked for on a typed-in meeting (BL-360,
 * BL-361, BL-362). Mirrors migrations/20270130090000_conferencing_connections.sql and 20270130090100_contact_meeting_conferencing.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { contactMeetings } from '../contact-detail';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations, users } from '../foundation';

/** One person's grant to one provider (`zoom`, `teams`). Tokens are sealed with the credentials key; both providers rotate refresh tokens. */
export const conferencingConnections = pgTable(
  'conferencing_connections',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    userId: idColumn('user_id').notNull(),
    provider: text('provider').notNull(),
    accountEmail: text('account_email'),
    accountSub: text('account_sub'),
    refreshTokenEnc: text('refresh_token_enc').notNull(),
    accessTokenEnc: text('access_token_enc'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    scopes: text('scopes'),
    status: text('status').notNull().default('active'),
    statusReason: text('status_reason'),
    statusAt: timestamp('status_at', { withTimezone: true }).notNull().defaultNow(),
    connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
    lastErrorCode: text('last_error_code'),
    lastErrorAt: timestamp('last_error_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('conferencing_connections_org_id_uuid_key').on(t.orgId, t.uuid),
    foreignKey({
      name: 'conferencing_connections_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_conferencing_connections_user_provider').on(t.orgId, t.userId, t.provider),
    check('chk_conferencing_connections_provider', sql`${t.provider} in ('zoom', 'teams')`),
    check('chk_conferencing_connections_status', sql`${t.status} in ('active', 'needs_reconnect')`),
    check(
      'chk_conferencing_connections_last_error',
      sql`(${t.lastErrorCode} is null) = (${t.lastErrorAt} is null)`,
    ),
    foreignKey({
      name: 'fk_conferencing_connections_user',
      columns: [t.orgId, t.userId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('cascade'),
  ],
);

export type ConferencingConnectionRow = typeof conferencingConnections.$inferSelect;

/** The video link and calendar entry of one typed-in meeting: what was asked for, where it lives, and the last problem. */
export const contactMeetingConferencing = pgTable(
  'contact_meeting_conferencing',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    meetingId: idColumn('meeting_id').notNull(),
    hostUserId: idColumn('host_user_id'),
    videoProvider: text('video_provider'),
    videoMeetingId: text('video_meeting_id'),
    videoStatus: text('video_status'),
    videoError: text('video_error'),
    addToCalendar: boolean('add_to_calendar').notNull().default(false),
    sendInvitation: boolean('send_invitation').notNull().default(false),
    calendarProvider: text('calendar_provider'),
    calendarId: text('calendar_id'),
    calendarEventId: text('calendar_event_id'),
    calendarStatus: text('calendar_status'),
    calendarError: text('calendar_error'),
    syncedAt: timestamp('synced_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('contact_meeting_conferencing_org_id_uuid_key').on(t.orgId, t.uuid),
    foreignKey({
      name: 'contact_meeting_conferencing_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_contact_meeting_conferencing_meeting').on(t.orgId, t.meetingId),
    check(
      'chk_contact_meeting_conferencing_video_provider',
      sql`${t.videoProvider} is null or ${t.videoProvider} in ('zoom', 'teams', 'meet')`,
    ),
    check(
      'chk_contact_meeting_conferencing_video_status',
      sql`${t.videoStatus} is null or ${t.videoStatus} in ('pending', 'ready', 'failed')`,
    ),
    check(
      'chk_contact_meeting_conferencing_calendar_provider',
      sql`${t.calendarProvider} is null or ${t.calendarProvider} in ('google', 'microsoft')`,
    ),
    check(
      'chk_contact_meeting_conferencing_calendar_status',
      sql`${t.calendarStatus} is null or ${t.calendarStatus} in ('synced', 'failed')`,
    ),
    check(
      'chk_contact_meeting_conferencing_status_has_provider',
      sql`(${t.videoStatus} is null) = (${t.videoProvider} is null)`,
    ),
    foreignKey({
      name: 'fk_contact_meeting_conferencing_meeting',
      columns: [t.orgId, t.meetingId],
      foreignColumns: [contactMeetings.orgId, contactMeetings.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_contact_meeting_conferencing_host',
      columns: [t.orgId, t.hostUserId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_contact_meeting_conferencing_host').on(t.orgId, t.hostUserId),
  ],
);

export type ContactMeetingConferencingRow = typeof contactMeetingConferencing.$inferSelect;
