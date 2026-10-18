import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  RecordScope,
  RevenueCsvKind,
  RevenueExportFilters,
  RevenueExportFormat,
  RevenueExportStatus,
} from '@crm/contracts';
import type { Tx } from '@crm/db';

type Raw = Record<string, unknown>;
const rowsOf = (res: { rows: unknown[] }): Raw[] => res.rows as Raw[];

/** One `revenue_report_exports` row without its file. */
export interface RevenueExportRow {
  id: number;
  uuid: string;
  orgId: number;
  requestedBy: number;
  emailedTo: string | null;
  format: RevenueExportFormat;
  csvKind: RevenueCsvKind | null;
  scope: RecordScope;
  filters: RevenueExportFilters;
  status: RevenueExportStatus;
  rowCount: number | null;
  fileBytes: number | null;
  error: string | null;
  requestedAt: Date;
  completedAt: Date | null;
  expiresAt: Date | null;
}

const toExport = (r: Raw): RevenueExportRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  orgId: Number(r.org_id),
  requestedBy: Number(r.requested_by),
  emailedTo: (r.emailed_to as string | null) ?? null,
  format: r.format as RevenueExportFormat,
  csvKind: (r.csv_kind as RevenueCsvKind | null) ?? null,
  scope: r.scope as RecordScope,
  filters: r.filters as RevenueExportFilters,
  status: r.status as RevenueExportStatus,
  rowCount: r.row_count === null ? null : Number(r.row_count),
  fileBytes: r.file_bytes === null ? null : Number(r.file_bytes),
  error: (r.error as string | null) ?? null,
  requestedAt: new Date(r.requested_at as string),
  completedAt: r.completed_at ? new Date(r.completed_at as string) : null,
  expiresAt: r.expires_at ? new Date(r.expires_at as string) : null,
});

const COLUMNS = sql.raw(
  `id, uuid, org_id, requested_by, emailed_to, format, csv_kind, scope, filters, status, row_count, file_name, file_bytes, error, requested_at, completed_at, expires_at`,
);

/** SQL of the prepared revenue report files. Every statement names `org_id` (RLS sits underneath), except the sweeps. */
@Injectable()
export class RevenueExportRepository {
  async create(
    tx: Tx,
    orgId: number,
    input: {
      requestedBy: number;
      emailedTo: string | null;
      format: RevenueExportFormat;
      csvKind: RevenueCsvKind | null;
      scope: RecordScope;
      filters: RevenueExportFilters;
    },
  ): Promise<RevenueExportRow> {
    const res = await tx.execute(sql`
      INSERT INTO revenue_report_exports (org_id, requested_by, emailed_to, format, csv_kind, scope, filters)
      VALUES (${orgId}, ${input.requestedBy}, ${input.emailedTo}, ${input.format}, ${input.csvKind}, ${input.scope}::record_scope,
              ${JSON.stringify(input.filters)}::jsonb)
      RETURNING ${COLUMNS}`);
    return toExport(rowsOf(res)[0]!);
  }

  /** The export this person is still waiting for, if any. */
  async active(tx: Tx, orgId: number, userId: number): Promise<RevenueExportRow | null> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM revenue_report_exports
      WHERE org_id = ${orgId} AND requested_by = ${userId} AND status IN ('queued', 'running') LIMIT 1`);
    const r = rowsOf(res)[0];
    return r ? toExport(r) : null;
  }

  async list(tx: Tx, orgId: number, userId: number, limit: number): Promise<RevenueExportRow[]> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM revenue_report_exports WHERE org_id = ${orgId} AND requested_by = ${userId}
      ORDER BY requested_at DESC, id DESC LIMIT ${limit}`);
    return rowsOf(res).map(toExport);
  }

  /** `userId` null reads any person's row (the worker); a person reads only their own. */
  async byUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
    userId: number | null,
  ): Promise<RevenueExportRow | null> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM revenue_report_exports
      WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid ${userId === null ? sql`` : sql`AND requested_by = ${userId}`}`);
    const r = rowsOf(res)[0];
    return r ? toExport(r) : null;
  }

  /** queued -> running. False when another worker has it or it is no longer queued. */
  async claim(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE revenue_report_exports SET status = 'running', started_at = now(), error = NULL
      WHERE org_id = ${orgId} AND id = ${id} AND status = 'queued' RETURNING 1`);
    return rowsOf(res).length > 0;
  }

  /**
   * Stores the finished file. False when the row is gone or no longer running: an erasure removed it while it was being built
   * (privacy registry, `revenue.exports`), and then no file is stored.
   */
  async finish(
    tx: Tx,
    orgId: number,
    id: number,
    f: { fileName: string; file: Buffer; rowCount: number; expiresAt: Date },
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE revenue_report_exports SET status = 'ready', file_name = ${f.fileName}, file_gz = ${f.file}, file_bytes = ${f.file.length},
        row_count = ${f.rowCount}, completed_at = now(), expires_at = ${f.expiresAt}, error = NULL
      WHERE org_id = ${orgId} AND id = ${id} AND status = 'running' RETURNING 1`);
    return rowsOf(res).length > 0;
  }

  async fail(tx: Tx, orgId: number, id: number, error: string): Promise<void> {
    await tx.execute(sql`
      UPDATE revenue_report_exports SET status = 'failed', error = ${error.slice(0, 500)}, completed_at = now()
      WHERE org_id = ${orgId} AND id = ${id} AND status IN ('queued', 'running')`);
  }

  async file(
    tx: Tx,
    orgId: number,
    id: number,
  ): Promise<{ file: Buffer; fileName: string } | null> {
    const res = await tx.execute(sql`
      SELECT file_gz, file_name FROM revenue_report_exports
      WHERE org_id = ${orgId} AND id = ${id} AND status = 'ready' AND expires_at > now()`);
    const r = rowsOf(res)[0];
    if (!r?.file_gz) return null;
    return {
      file: r.file_gz as Buffer,
      fileName: (r.file_name as string | null) ?? 'revenue-report',
    };
  }

  async userContact(tx: Tx, orgId: number, userId: number): Promise<{ email: string } | null> {
    const res = await tx.execute(
      sql`SELECT email::text AS email FROM users WHERE org_id = ${orgId} AND id = ${userId}`,
    );
    const r = rowsOf(res)[0];
    return r ? { email: r.email as string } : null;
  }

  async orgName(tx: Tx, orgId: number): Promise<string> {
    const res = await tx.execute(sql`SELECT name FROM organizations WHERE id = ${orgId}`);
    return ((rowsOf(res)[0]?.name as string | undefined) ?? '').trim() || 'Workspace';
  }

  // --- sweeps (privileged, across workspaces) ----------------------------------------------------------------------------------

  async expire(tx: Tx, now: Date): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE revenue_report_exports SET status = 'expired', file_gz = NULL
      WHERE status = 'ready' AND expires_at < ${now} RETURNING 1`);
    return rowsOf(res).length;
  }

  async failStuck(tx: Tx, now: Date, olderThanMs: number): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE revenue_report_exports SET status = 'failed', error = 'The export was interrupted. Request it again.'
      WHERE status = 'running' AND started_at < ${new Date(now.getTime() - olderThanMs)} RETURNING 1`);
    return rowsOf(res).length;
  }
}
