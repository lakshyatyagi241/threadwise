import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from './columns';

/** Contact detail page tabs: Notes, Files, Activity Timeline, Meetings. */

export const contactNotes = pgTable(
  'contact_notes',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull(),
    contactId: idColumn('contact_id').notNull(),
    body: text('body').notNull(),
    createdBy: idColumn('created_by'),
    updatedBy: idColumn('updated_by'),
    rowVersion: rowVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    uniqueIndex('contact_notes_org_id_uuid_key').on(t.orgId, t.uuid),
    index('idx_contact_notes_contact').on(t.orgId, t.contactId, t.createdAt),
  ],
);

/** Metadata only — actual byte storage is Phase 9 (File Manager)'s job. */
export const contactFiles = pgTable(
  'contact_files',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull(),
    contactId: idColumn('contact_id').notNull(),
    fileName: text('file_name').notNull(),
    fileSizeBytes: bigint('file_size_bytes', { mode: 'number' }),
    storageKey: text('storage_key').notNull(),
    mimeType: text('mime_type'),
    uploadedBy: idColumn('uploaded_by'),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    uniqueIndex('contact_files_org_id_uuid_key').on(t.orgId, t.uuid),
    index('idx_contact_files_contact').on(t.orgId, t.contactId, t.createdAt),
  ],
);

/** Append-only timeline — never edited, no row_version. */
export const contactActivities = pgTable(
  'contact_activities',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull(),
    contactId: idColumn('contact_id').notNull(),
    activityType: text('activity_type').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    /** 'system' | 'user' | 'bot' */
    source: text('source').notNull().default('user'),
    actorId: idColumn('actor_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    uniqueIndex('contact_activities_org_id_uuid_key').on(t.orgId, t.uuid),
    index('idx_contact_activities_contact').on(t.orgId, t.contactId, t.occurredAt),
  ],
);

export const contactMeetings = pgTable(
  'contact_meetings',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull(),
    contactId: idColumn('contact_id').notNull(),
    title: text('title').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    location: text('location'),
    /** 'manual' (typed in) or 'booking' (mirrored from an appointment by the appointments-booking module). */
    source: text('source').notNull().default('manual'),
    /** The appointment a 'booking' row mirrors; the foreign key (org_id, appointment_id) sets it NULL when the appointment goes. */
    appointmentId: idColumn('appointment_id'),
    /** The web address that joins the call (BL-245); `location` stays for places. */
    joinUrl: text('join_url'),
    createdBy: idColumn('created_by'),
    rowVersion: rowVersion(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    uniqueIndex('contact_meetings_org_id_uuid_key').on(t.orgId, t.uuid),
    index('idx_contact_meetings_contact').on(t.orgId, t.contactId, t.startsAt),
    uniqueIndex('uq_contact_meetings_appointment')
      .on(t.orgId, t.appointmentId)
      .where(sql`${t.appointmentId} is not null`),
    check('ck_contact_meetings_source', sql`${t.source} in ('manual', 'booking')`),
    check(
      'ck_contact_meetings_appointment_source',
      sql`${t.appointmentId} is null or ${t.source} = 'booking'`,
    ),
    check(
      'ck_contact_meetings_join_url',
      sql`${t.joinUrl} is null or char_length(${t.joinUrl}) <= 2048`,
    ),
  ],
);

export type ContactNote = typeof contactNotes.$inferSelect;
export type ContactFile = typeof contactFiles.$inferSelect;
export type ContactActivity = typeof contactActivities.$inferSelect;
export type ContactMeeting = typeof contactMeetings.$inferSelect;
