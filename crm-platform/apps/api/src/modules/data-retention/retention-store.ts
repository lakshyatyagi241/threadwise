import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import {
  retentionProblem,
  retentionSpecOf,
  type RetentionItemId,
  type RetentionRun,
  type RetentionValues,
} from '@crm/contracts';
import { TABLE_ITEMS } from './table-items';
import { AppError } from '../../common/errors/app-error';

/**
 * Reads and writes of the two platform tables behind the retention dashboard (`data_retention_policies`, `data_retention_runs`).
 * Every function takes a transaction that is already privileged: both tables are privileged-only. Kept as plain functions so the
 * nightly job, the auth maintenance sweep and the operator service share one set of statements.
 */

export interface StoredPolicy extends RetentionValues {
  item: string;
  rowVersion: number;
  updatedAt: Date;
  updatedBy: number | null;
}

export interface StoredRun extends RetentionRun {
  item: string;
  archive: { objects: number; bytes: number; measuredAt: string } | null;
}

type Raw = Record<string, unknown>;
const rowsOf = (res: { rows: unknown[] }): Raw[] => res.rows as Raw[];

const toPolicy = (r: Raw): StoredPolicy => ({
  item: r.item as string,
  liveDays: Number(r.live_days),
  archiveDays: r.archive_days === null ? null : Number(r.archive_days),
  rowVersion: Number(r.row_version),
  updatedAt: new Date(r.updated_at as string),
  updatedBy: r.updated_by === null ? null : Number(r.updated_by),
});

const POLICY_COLUMNS = sql`item, live_days, archive_days, row_version, updated_by, updated_at`;

export async function loadPolicies(tx: Tx): Promise<Map<string, StoredPolicy>> {
  const res = await tx.execute(sql`SELECT ${POLICY_COLUMNS} FROM data_retention_policies`);
  return new Map(rowsOf(res).map((r) => [r.item as string, toPolicy(r)]));
}

export async function loadPolicy(tx: Tx, item: string): Promise<StoredPolicy | null> {
  const res = await tx.execute(
    sql`SELECT ${POLICY_COLUMNS} FROM data_retention_policies WHERE item = ${item}`,
  );
  const row = rowsOf(res)[0];
  return row ? toPolicy(row) : null;
}

/**
 * Creates the policy (`rowVersion` null) or changes it (`rowVersion` is the version the caller read). A stale or missing version is a
 * 409, never a silent overwrite of another admin's save.
 */
export async function savePolicy(
  tx: Tx,
  item: RetentionItemId,
  values: RetentionValues,
  rowVersion: number | null,
  operatorId: number,
): Promise<StoredPolicy> {
  const res =
    rowVersion === null
      ? await tx.execute(sql`
          INSERT INTO data_retention_policies (item, live_days, archive_days, updated_by)
          VALUES (${item}, ${values.liveDays}, ${values.archiveDays}, ${operatorId})
          ON CONFLICT (item) DO NOTHING
          RETURNING ${POLICY_COLUMNS}`)
      : await tx.execute(sql`
          UPDATE data_retention_policies
             SET live_days = ${values.liveDays}, archive_days = ${values.archiveDays}, updated_by = ${operatorId}
           WHERE item = ${item} AND row_version = ${rowVersion}
          RETURNING ${POLICY_COLUMNS}`);
  const row = rowsOf(res)[0];
  if (!row) throw AppError.rowVersionConflict('Retention policy');
  return toPolicy(row);
}

/** Returns the item to its default behaviour. Resolves to the policy that was removed, or null when there was none. */
export async function deletePolicy(tx: Tx, item: RetentionItemId): Promise<StoredPolicy | null> {
  const res = await tx.execute(
    sql`DELETE FROM data_retention_policies WHERE item = ${item} RETURNING ${POLICY_COLUMNS}`,
  );
  const row = rowsOf(res)[0];
  return row ? toPolicy(row) : null;
}

export interface RunRecord {
  mode: 'live' | 'dry_run';
  outcome: 'ok' | 'partial' | 'failed';
  archivedMonths?: number;
  archivedRows?: number;
  archivedBytes?: number;
  expiredItems?: number;
  deletedRows?: number;
  error?: string | null;
  /** Size of the item's cold archive when it was measured in this run. Left as it was when omitted. */
  archive?: { objects: number; bytes: number };
}

/** Writes what the last run did. Best effort by contract of the callers: a failure here must never fail the run itself. */
export async function recordRun(
  tx: Tx,
  item: RetentionItemId,
  run: RunRecord,
  now: Date = new Date(),
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO data_retention_runs
      (item, last_run_at, mode, outcome, archived_months, archived_rows, archived_bytes, expired_items, deleted_rows, error,
       archive_objects, archive_bytes, archive_measured_at)
    VALUES
      (${item}, ${now}, ${run.mode}, ${run.outcome}, ${run.archivedMonths ?? 0}, ${run.archivedRows ?? 0}, ${run.archivedBytes ?? 0},
       ${run.expiredItems ?? 0}, ${run.deletedRows ?? 0}, ${run.error ? run.error.slice(0, 300) : null},
       ${run.archive?.objects ?? null}, ${run.archive?.bytes ?? null}, ${run.archive ? now : null})
    ON CONFLICT (item) DO UPDATE SET
      last_run_at = EXCLUDED.last_run_at, mode = EXCLUDED.mode, outcome = EXCLUDED.outcome,
      archived_months = EXCLUDED.archived_months, archived_rows = EXCLUDED.archived_rows, archived_bytes = EXCLUDED.archived_bytes,
      expired_items = EXCLUDED.expired_items, deleted_rows = EXCLUDED.deleted_rows, error = EXCLUDED.error,
      archive_objects = COALESCE(EXCLUDED.archive_objects, data_retention_runs.archive_objects),
      archive_bytes = COALESCE(EXCLUDED.archive_bytes, data_retention_runs.archive_bytes),
      archive_measured_at = COALESCE(EXCLUDED.archive_measured_at, data_retention_runs.archive_measured_at)`);
}

export async function loadRuns(tx: Tx): Promise<Map<string, StoredRun>> {
  const res = await tx.execute(sql`
    SELECT item, to_char(last_run_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS at, mode, outcome, archived_months,
           archived_rows, archived_bytes, expired_items, deleted_rows, error, archive_objects, archive_bytes,
           to_char(archive_measured_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS measured_at
      FROM data_retention_runs`);
  return new Map(
    rowsOf(res).map((r) => [
      r.item as string,
      {
        item: r.item as string,
        at: r.at as string,
        mode: r.mode as 'live' | 'dry_run',
        outcome: r.outcome as 'ok' | 'partial' | 'failed',
        archivedMonths: Number(r.archived_months),
        archivedRows: Number(r.archived_rows),
        archivedBytes: Number(r.archived_bytes),
        expiredItems: Number(r.expired_items),
        deletedRows: Number(r.deleted_rows),
        error: (r.error as string | null) ?? null,
        archive:
          r.archive_objects === null || r.measured_at === null
            ? null
            : {
                objects: Number(r.archive_objects),
                bytes: Number(r.archive_bytes ?? 0),
                measuredAt: r.measured_at as string,
              },
      },
    ]),
  );
}

export interface LiveStats {
  bytes: number;
  rows: number | null;
  partitions: number | null;
  oldestMonth: string | null;
}

/**
 * Size of an item's live data from the catalog (no table scan), so the dashboard stays cheap on a table of billions of rows.
 * The table name is chosen here from the item id, never from input.
 */
export async function liveStats(tx: Tx, item: RetentionItemId): Promise<LiveStats> {
  if (item === 'an_events' || item === 'audit_log') {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS parts,
             COALESCE(sum(pg_total_relation_size(c.oid)), 0)::text AS bytes,
             CASE WHEN bool_and(c.reltuples < 0) THEN NULL ELSE sum(GREATEST(c.reltuples, 0))::bigint::text END AS rows,
             min(substring(c.relname FROM '_([0-9]{6})$')) AS oldest
        FROM pg_inherits i
        JOIN pg_class c ON c.oid = i.inhrelid AND c.relnamespace = 'public'::regnamespace
        JOIN pg_class p ON p.oid = i.inhparent AND p.relnamespace = 'public'::regnamespace
       WHERE p.relname = ${item} AND c.relname ~ ${`^${item}_[0-9]{6}$`}`);
    const r = rowsOf(res)[0]!;
    const oldest = (r.oldest as string | null) ?? null;
    return {
      bytes: Number(r.bytes),
      rows: r.rows === null ? null : Number(r.rows),
      partitions: Number(r.parts),
      oldestMonth: oldest ? `${oldest.slice(0, 4)}-${oldest.slice(4)}` : null,
    };
  }
  const t = TABLE_ITEMS[item];
  if (t) {
    const res = await tx.execute(sql`
      SELECT pg_total_relation_size(c.oid)::text AS bytes, c.reltuples::bigint::text AS rows
        FROM pg_class c WHERE c.oid = ${`public.${t.table}`}::regclass`);
    const r = rowsOf(res)[0]!;
    return {
      bytes: Number(r.bytes),
      rows: Number(r.rows) < 0 ? null : Number(r.rows),
      partitions: null,
      oldestMonth: null,
    };
  }
  if (item === 'message_log') {
    const res = await tx.execute(sql`
      SELECT pg_total_relation_size(c.oid)::text AS bytes, c.reltuples::bigint::text AS rows
        FROM pg_class c WHERE c.oid = 'public.message_events'::regclass`);
    const r = rowsOf(res)[0]!;
    return {
      bytes: Number(r.bytes),
      rows: Number(r.rows) < 0 ? null : Number(r.rows),
      partitions: null,
      oldestMonth: null,
    };
  }
  if (item === 'call_recordings') {
    const res = await tx.execute(
      sql`SELECT count(*)::text AS rows FROM wa_calls WHERE recording_path IS NOT NULL`,
    );
    return { bytes: 0, rows: Number(rowsOf(res)[0]!.rows), partitions: null, oldestMonth: null };
  }
  const res = await tx.execute(sql`
    SELECT count(*)::text AS rows, COALESCE(sum(file_bytes), 0)::text AS bytes
      FROM audit_log_exports WHERE status = 'ready'`);
  const r = rowsOf(res)[0]!;
  return { bytes: Number(r.bytes), rows: Number(r.rows), partitions: null, oldestMonth: null };
}

/** Size of the part of an item that sits in the database's own archive (the daily archive of the message log). Null for other items. */
export async function dbArchiveStats(
  tx: Tx,
  item: RetentionItemId,
): Promise<{ objects: number; bytes: number } | null> {
  if (item !== 'message_log') return null;
  const res = await tx.execute(sql`
    SELECT pg_total_relation_size(c.oid)::text AS bytes, c.reltuples::bigint::text AS rows
      FROM pg_class c WHERE c.oid = 'public.message_event_archives'::regclass`);
  const r = rowsOf(res)[0]!;
  return { objects: Math.max(0, Number(r.rows)), bytes: Number(r.bytes) };
}

/** Months of a partitioned stream that have a partition, oldest first, with catalog sizes (for the preview). */
export async function partitionSizes(
  tx: Tx,
  stream: string,
): Promise<Array<{ month: string; estimatedRows: number | null; bytes: number }>> {
  const res = await tx.execute(sql`
    SELECT substring(c.relname FROM '_([0-9]{6})$') AS ym, c.reltuples::bigint::text AS rows,
           pg_total_relation_size(c.oid)::text AS bytes
      FROM pg_inherits i
      JOIN pg_class c ON c.oid = i.inhrelid AND c.relnamespace = 'public'::regnamespace
      JOIN pg_class p ON p.oid = i.inhparent AND p.relnamespace = 'public'::regnamespace
     WHERE p.relname = ${stream} AND c.relname ~ ${`^${stream}_[0-9]{6}$`}
     ORDER BY 1`);
  return rowsOf(res).map((r) => {
    const ym = r.ym as string;
    return {
      month: `${ym.slice(0, 4)}-${ym.slice(4)}`,
      estimatedRows: Number(r.rows) < 0 ? null : Number(r.rows),
      bytes: Number(r.bytes),
    };
  });
}

/** Counting stops here, so the preview of a table of billions of rows stays one short query. */
export const PREVIEW_COUNT_CAP = 1_000_000;

/**
 * Rows or files older than `days` that the next sweep would delete (the daily archive: live events that would move into it).
 * Capped at `PREVIEW_COUNT_CAP`.
 */
export async function countOlderThan(tx: Tx, item: RetentionItemId, days: number): Promise<number> {
  const t = TABLE_ITEMS[item];
  if (t) {
    const cond = t.where ? sql` AND ${sql.raw(t.where)}` : sql``;
    const res = await tx.execute(sql`
      SELECT count(*)::text AS n FROM (
        SELECT 1 FROM ${sql.raw(t.table)}
         WHERE ${sql.raw(t.at)} < now() - make_interval(days => ${days})${cond}
         LIMIT ${PREVIEW_COUNT_CAP}) x`);
    return Number(rowsOf(res)[0]!.n);
  }
  if (item === 'message_log') {
    const res = await tx.execute(sql`
      SELECT count(*)::text AS n FROM (
        SELECT 1 FROM message_events
         WHERE created_at < date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' - make_interval(days => ${days})
         LIMIT ${PREVIEW_COUNT_CAP}) x`);
    return Number(rowsOf(res)[0]!.n);
  }
  if (item === 'call_recordings') {
    const res = await tx.execute(sql`
      SELECT count(*)::text AS n FROM (
        SELECT 1 FROM wa_calls w LEFT JOIN call_recording_settings s ON s.org_id = w.org_id
         WHERE w.recording_path IS NOT NULL AND NOT w.recording_legal_hold
           AND w.recording_stored_at < now() - make_interval(days => coalesce(s.retention_days, ${days}))
         LIMIT ${PREVIEW_COUNT_CAP}) x`);
    return Number(rowsOf(res)[0]!.n);
  }
  const res = await tx.execute(sql`
    SELECT count(*)::text AS n FROM audit_log_exports
     WHERE status = 'ready' AND completed_at < now() - make_interval(days => ${days})`);
  return Number(rowsOf(res)[0]!.n);
}

/** Days of the message log's archive older than `days` that the next sweep would delete. */
export async function countArchiveDaysOlderThan(tx: Tx, days: number): Promise<number> {
  const res = await tx.execute(sql`
    SELECT count(*)::text AS n FROM (
      SELECT 1 FROM message_event_archives
       WHERE day < (now() AT TIME ZONE 'UTC')::date - ${days}::int
       LIMIT ${PREVIEW_COUNT_CAP}) x`);
  return Number(rowsOf(res)[0]!.n);
}

/**
 * The live days a sweep must use for `item`: the policy a super admin saved, else the sweep's own built-in number (by default the item's registry default, so the page and the job cannot disagree). Read at the start of
 * every run, so a save takes effect at the next run without a restart. A stored number outside the item's range (a row edited by hand)
 * is ignored in favour of the built-in one, never trusted to delete data.
 */
export async function liveDaysFor(
  tx: Tx,
  item: RetentionItemId,
  fallback: number = retentionSpecOf(item).defaults.liveDays,
): Promise<number> {
  const saved = await loadPolicy(tx, item);
  if (!saved) return fallback;
  return retentionProblem(item, { liveDays: saved.liveDays, archiveDays: saved.archiveDays }) ===
    null
    ? saved.liveDays
    : fallback;
}
