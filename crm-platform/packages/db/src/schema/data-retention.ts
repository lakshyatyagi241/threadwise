import { bigint, check, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, idColumn, rowVersion, updatedAt } from './columns';

/**
 * Mirror of 20270101090000_data_retention_policies.sql: the per-item retention policies a super admin saves, and what the last run did.
 * Platform tables: no org_id, privileged-only RLS. The SQL is the source of truth.
 */
export const dataRetentionPolicies = pgTable(
  'data_retention_policies',
  {
    item: text('item').primaryKey(),
    liveDays: integer('live_days').notNull(),
    archiveDays: integer('archive_days'),
    rowVersion: rowVersion(),
    updatedBy: idColumn('updated_by'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  () => [
    check('chk_retention_item', sql`item ~ '^[a-z][a-z0-9_]*$'`),
    check('chk_retention_live', sql`live_days >= 1`),
    check('chk_retention_archive', sql`archive_days IS NULL OR archive_days >= 1`),
  ],
);

export const dataRetentionRuns = pgTable('data_retention_runs', {
  item: text('item').primaryKey(),
  lastRunAt: timestamp('last_run_at', { withTimezone: true }).notNull(),
  mode: text('mode').notNull(),
  outcome: text('outcome').notNull(),
  archivedMonths: integer('archived_months').notNull().default(0),
  archivedRows: bigint('archived_rows', { mode: 'number' }).notNull().default(0),
  archivedBytes: bigint('archived_bytes', { mode: 'number' }).notNull().default(0),
  expiredItems: bigint('expired_items', { mode: 'number' }).notNull().default(0),
  deletedRows: bigint('deleted_rows', { mode: 'number' }).notNull().default(0),
  error: text('error'),
  archiveObjects: bigint('archive_objects', { mode: 'number' }),
  archiveBytes: bigint('archive_bytes', { mode: 'number' }),
  archiveMeasuredAt: timestamp('archive_measured_at', { withTimezone: true }),
});
