import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from './columns';

/**
 * Sales activities settings (BL-370..BL-379). Mirrors migrations/20270201090000_sales_activities.sql: the workspace's activity types, the
 * ordered task types and outcomes of each, and the outcome of a completed meeting.
 */
export const activityTypes = pgTable(
  'activity_types',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    /** Stable id: 'task' | 'meeting' | 'phone' | 'email' | 'reminder' | 'sms' | 'chat' for the defaults, 'custom_<slug>' otherwise. */
    key: text('key').notNull(),
    /** NULL on a default activity: the screen shows its localised name. */
    name: text('name'),
    isDefault: boolean('is_default').notNull().default(false),
    /** 'task' | 'meeting' | 'phone' | 'other': which editor and which consumers the activity uses. */
    behavesAs: text('behaves_as').notNull(),
    icon: text('icon').notNull().default('activity'),
    position: integer('position').notNull().default(0),
    showInCalendar: boolean('show_in_calendar').notNull().default(false),
    allowComplete: boolean('allow_complete').notNull().default(true),
    allowEditCompleted: boolean('allow_edit_completed').notNull().default(false),
    mobileCheckIn: boolean('mobile_check_in').notNull().default(false),
    outcomesEnabled: boolean('outcomes_enabled').notNull().default(true),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdBy: idColumn('created_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('activity_types_org_id_uuid_key').on(t.orgId, t.uuid),
    unique('uq_activity_types_key').on(t.orgId, t.key),
    index('idx_activity_types_order')
      .on(t.orgId, t.position, t.id)
      .where(sql`${t.archivedAt} is null`),
    check(
      'ck_activity_types_behaves',
      sql`${t.behavesAs} in ('task', 'meeting', 'phone', 'other')`,
    ),
  ],
);

export const activityTypeOptions = pgTable(
  'activity_type_options',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    activityTypeId: idColumn('activity_type_id').notNull(),
    /** 'type' (a task type) or 'outcome'. */
    kind: text('kind').notNull(),
    key: text('key').notNull(),
    name: text('name'),
    isSystem: boolean('is_system').notNull().default(false),
    /** Phone outcomes: the built-in call outcome a custom outcome counts as in the call log. */
    countsAs: text('counts_as'),
    position: integer('position').notNull().default(0),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('activity_type_options_org_id_uuid_key').on(t.orgId, t.uuid),
    unique('uq_activity_type_options_key').on(t.orgId, t.activityTypeId, t.kind, t.key),
    index('idx_activity_type_options_order')
      .on(t.orgId, t.activityTypeId, t.kind, t.position, t.id)
      .where(sql`${t.deletedAt} is null`),
    check('ck_activity_type_options_kind', sql`${t.kind} in ('type', 'outcome')`),
  ],
);

export const contactMeetingOutcomes = pgTable(
  'contact_meeting_outcomes',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    contactId: idColumn('contact_id').notNull(),
    meetingId: idColumn('meeting_id').notNull(),
    outcomeId: idColumn('outcome_id'),
    note: text('note'),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull().defaultNow(),
    completedBy: idColumn('completed_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('contact_meeting_outcomes_org_id_uuid_key').on(t.orgId, t.uuid),
    uniqueIndex('uq_contact_meeting_outcomes_meeting').on(t.orgId, t.meetingId),
    index('idx_contact_meeting_outcomes_contact').on(t.orgId, t.contactId),
  ],
);

export type SalesActivityType = typeof activityTypes.$inferSelect;
export type SalesActivityTypeOption = typeof activityTypeOptions.$inferSelect;
