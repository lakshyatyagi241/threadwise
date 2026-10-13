/**
 * contacts-attributes-tags: tables ported from Reference. Mirrors migrations/20261001103500_con_threadwise_schema.sql.
 * The SQL migration is the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 */
import { sql } from 'drizzle-orm';
import {
  customType,
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

export const contactGroups = pgTable(
  'contact_groups',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    createdBy: idColumn('created_by'),
    name: text('name').notNull(),
    note: text('note'),
    /** `#RRGGBB` or null. */
    color: text('color'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_contact_groups_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_contact_groups_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_contact_groups_user_id',
      columns: [t.orgId, t.createdBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_contact_groups_user_id').on(t.orgId, t.createdBy),
    index('idx_contact_groups_org_created').on(t.orgId, t.createdAt, t.id),
    // uq_contact_groups_org_lower_name (org_id, lower(name)) lives in the SQL migration: verify-schema cannot compare expression indexes.
  ],
);

export type ContactGroupsRow = typeof contactGroups.$inferSelect;
export type NewContactGroupsRow = typeof contactGroups.$inferInsert;

export const csatResponses = pgTable(
  'csat_responses',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    conversationId: idColumn('conversation_id').notNull(),
    agentUserId: idColumn('agent_user_id'),
    rating: smallint('rating'),
    comment: text('comment'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_csat_responses_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_csat_responses_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_csat_responses_agent_user_id',
      columns: [t.orgId, t.agentUserId],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_csat_responses_agent_user_id').on(t.orgId, t.agentUserId),
    index('idx_csat_responses_conversation_id').on(t.orgId, t.conversationId),
  ],
);

export type CsatResponsesRow = typeof csatResponses.$inferSelect;
export type NewCsatResponsesRow = typeof csatResponses.$inferInsert;

export const contactGroupMembers = pgTable(
  'contact_group_members',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    contactId: idColumn('contact_id').notNull(),
    groupId: idColumn('group_id').notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_contact_group_members_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'fk_contact_group_members_org',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    unique('uq_contact_group_members_contact_id_group_id').on(t.orgId, t.contactId, t.groupId),
    foreignKey({
      name: 'fk_contact_group_members_contact_id',
      columns: [t.orgId, t.contactId],
      foreignColumns: [contacts.orgId, contacts.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_contact_group_members_group_id',
      columns: [t.orgId, t.groupId],
      foreignColumns: [contactGroups.orgId, contactGroups.id],
    }).onDelete('cascade'),
    index('idx_contact_group_members_group_id').on(t.orgId, t.groupId),
  ],
);

export type ContactGroupMembersRow = typeof contactGroupMembers.$inferSelect;
export type NewContactGroupMembersRow = typeof contactGroupMembers.$inferInsert;

/** One CSV import run (TW-CON-027): the uploaded text while it runs, progress, counted outcomes, rejected rows. */
export const contactImportJobs = pgTable(
  'contact_import_jobs',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    createdBy: idColumn('created_by'),
    status: text('status').notNull().default('queued'),
    fileName: text('file_name').notNull(),
    byteSize: integer('byte_size').notNull().default(0),
    totalRows: integer('total_rows').notNull().default(0),
    processedRows: integer('processed_rows').notNull().default(0),
    createdCount: integer('created_count').notNull().default(0),
    updatedCount: integer('updated_count').notNull().default(0),
    invalidCount: integer('invalid_count').notNull().default(0),
    duplicatesInFile: integer('duplicates_in_file').notNull().default(0),
    limitExceeded: integer('limit_exceeded').notNull().default(0),
    options: jsonb('options').$type<Record<string, unknown>>().notNull().default({}),
    rejects: jsonb('rejects')
      .$type<Array<{ row: number; reason: string; values?: Record<string, string> }>>()
      .notNull()
      .default([]),
    sourceCsv: text('source_csv'),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('contact_import_jobs_org_id_uuid_key').on(t.orgId, t.uuid),
    foreignKey({
      name: 'contact_import_jobs_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_contact_import_jobs_created_by',
      columns: [t.orgId, t.createdBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_contact_import_jobs_org_created').on(t.orgId, t.createdAt, t.id),
    index('idx_contact_import_jobs_active')
      .on(t.status)
      .where(sql`${t.status} IN ('queued', 'running')`),
  ],
);

export type ContactImportJobsRow = typeof contactImportJobs.$inferSelect;
export type NewContactImportJobsRow = typeof contactImportJobs.$inferInsert;

const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

/** The CSV of a contacts export, gzipped, kept until `expiresAt` so it can be downloaded again (migration 20261121090300). */
export const contactExports = pgTable(
  'contact_exports',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    createdBy: idColumn('created_by'),
    fileName: text('file_name').notNull(),
    rowCount: integer('row_count').notNull().default(0),
    byteSize: integer('byte_size').notNull().default(0),
    csvGz: bytea('csv_gz').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('contact_exports_org_id_uuid_key').on(t.orgId, t.uuid),
    foreignKey({
      name: 'contact_exports_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_contact_exports_created_by',
      columns: [t.orgId, t.createdBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    index('idx_contact_exports_org_expires').on(t.orgId, t.expiresAt),
  ],
);

export type ContactExportsRow = typeof contactExports.$inferSelect;
export type NewContactExportsRow = typeof contactExports.$inferInsert;
