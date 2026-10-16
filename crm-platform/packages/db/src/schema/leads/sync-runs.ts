/**
 * lead_sync_runs: one "Sync now" or backfill of a pull-capable lead source (BL-014 lead inbox). Mirrors
 * migrations/20261221090000_lead_inbox.sql; the SQL migration is the source of truth.
 */
import {
  check,
  foreignKey,
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
import { sql } from 'drizzle-orm';
import { createdAt, idColumn, orgIdColumn, rowVersion, updatedAt } from '../columns';
import { organizations, users } from '../foundation';
import { leadSources } from './tables';

export const leadSyncRuns = pgTable(
  'lead_sync_runs',
  {
    orgId: orgIdColumn(),
    id: idColumn('id').notNull().generatedByDefaultAsIdentity(),
    uuid: uuid('uuid').notNull().defaultRandom(),
    sourceId: idColumn('source_id').notNull(),
    kind: text('kind').notNull(),
    status: text('status').notNull().default('queued'),
    rangeFrom: timestamp('range_from', { withTimezone: true }),
    rangeTo: timestamp('range_to', { withTimezone: true }),
    fetched: integer('fetched').notNull().default(0),
    accepted: integer('accepted').notNull().default(0),
    duplicates: integer('duplicates').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    windowsDone: integer('windows_done').notNull().default(0),
    windowsTotal: integer('windows_total').notNull().default(0),
    /** A stable code, never provider text. */
    error: text('error'),
    requestedBy: idColumn('requested_by'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    heartbeatAt: timestamp('heartbeat_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    rowVersion: rowVersion(),
  },
  (t) => [
    primaryKey({ columns: [t.orgId, t.id] }),
    unique('uq_lead_sync_runs_org_id_uuid').on(t.orgId, t.uuid),
    foreignKey({
      name: 'lead_sync_runs_org_id_fkey',
      columns: [t.orgId],
      foreignColumns: [organizations.id],
    }).onDelete('cascade'),
    check('chk_lead_sync_runs_kind', sql`${t.kind} in ('sync', 'backfill')`),
    check(
      'chk_lead_sync_runs_status',
      sql`${t.status} in ('queued', 'running', 'done', 'partial', 'failed')`,
    ),
    check(
      'chk_lead_sync_runs_range',
      sql`(${t.kind} = 'sync' and ${t.rangeFrom} is null and ${t.rangeTo} is null) or (${t.kind} = 'backfill' and ${t.rangeFrom} is not null and ${t.rangeTo} is not null and ${t.rangeFrom} < ${t.rangeTo})`,
    ),
    foreignKey({
      name: 'fk_lead_sync_runs_source',
      columns: [t.orgId, t.sourceId],
      foreignColumns: [leadSources.orgId, leadSources.id],
    }).onDelete('cascade'),
    foreignKey({
      name: 'fk_lead_sync_runs_requested_by',
      columns: [t.orgId, t.requestedBy],
      foreignColumns: [users.orgId, users.id],
    }).onDelete('set null'),
    uniqueIndex('uq_lead_sync_runs_active')
      .on(t.orgId, t.sourceId)
      .where(sql`${t.status} in ('queued', 'running')`),
    index('idx_lead_sync_runs_source').on(t.orgId, t.sourceId, t.createdAt.desc(), t.id.desc()),
    index('idx_lead_sync_runs_requested_by')
      .on(t.orgId, t.requestedBy)
      .where(sql`${t.requestedBy} is not null`),
    index('idx_lead_sync_runs_open')
      .on(t.heartbeatAt)
      .where(sql`${t.status} in ('queued', 'running')`),
    index('idx_lead_sync_runs_finished')
      .on(t.finishedAt)
      .where(sql`${t.finishedAt} is not null`),
  ],
);

export type LeadSyncRunsRow = typeof leadSyncRuns.$inferSelect;
export type NewLeadSyncRunsRow = typeof leadSyncRuns.$inferInsert;
