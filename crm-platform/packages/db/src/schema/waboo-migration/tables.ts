/**
 * waboo-migration: platform tables of operator-run Waboo -> WaDesk migrations (runs and bulk batches).
 * Mirrors migrations/20261113100000_wmig_waboo_migration_runs.sql and 20261114100000_wmig_batches_schedule.sql. The SQL migrations
 * are the source of truth; `pnpm db:verify-schema` fails if this file and the database disagree.
 * uq_wmig_one_running (a constant-expression unique index on status = 'running') lives in the SQL migration only.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, idColumn, rowVersion, updatedAt } from '../columns';
import { organizations } from '../foundation';

export const wabooMigrationBatches = pgTable(
  'waboo_migration_batches',
  {
    id: idColumn('id').notNull().primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().unique().defaultRandom(),
    status: text('status').notNull().default('queued'),
    mode: text('mode').notNull().default('dry'),
    runAt: timestamp('run_at', { withTimezone: true }),
    concurrency: smallint('concurrency').notNull().default(1),
    stopOnFailure: boolean('stop_on_failure').notNull().default(false),
    totalCount: integer('total_count').notNull(),
    counts: jsonb('counts').$type<Record<string, number>>().notNull().default({}),
    createdBy: idColumn('created_by'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    index('idx_wmigb_status').on(t.status),
    index('idx_wmigb_created').on(t.createdAt.desc()),
  ],
);
export type WabooMigrationBatchesRow = typeof wabooMigrationBatches.$inferSelect;

export const wabooMigrationRuns = pgTable(
  'waboo_migration_runs',
  {
    id: idColumn('id').notNull().primaryKey().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().unique().defaultRandom(),
    sourceClient: text('source_client').notNull(),
    sourceDb: text('source_db').notNull(),
    orgId: idColumn('org_id').references(() => organizations.id, { onDelete: 'set null' }),
    mode: text('mode').notNull().default('dry'),
    status: text('status').notNull().default('queued'),
    steps: jsonb('steps').$type<unknown[]>().notNull().default([]),
    report: jsonb('report').$type<Record<string, unknown>>(),
    error: text('error'),
    batchId: idColumn('batch_id').references(() => wabooMigrationBatches.id, {
      onDelete: 'cascade',
    }),
    position: integer('position'),
    runAt: timestamp('run_at', { withTimezone: true }),
    createdBy: idColumn('created_by'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    uniqueIndex('uq_wmig_active_client')
      .on(t.sourceClient)
      .where(sql`status IN ('queued', 'running')`),
    index('idx_wmig_status').on(t.status, t.startedAt),
    index('idx_wmig_created').on(t.createdAt.desc()),
    index('idx_wmig_batch')
      .on(t.batchId, t.position)
      .where(sql`batch_id IS NOT NULL`),
  ],
);

export type WabooMigrationRunsRow = typeof wabooMigrationRuns.$inferSelect;
