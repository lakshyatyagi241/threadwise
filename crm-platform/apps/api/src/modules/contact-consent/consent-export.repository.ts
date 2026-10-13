import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { ConsentExportStatus } from '@crm/contracts';
import type { Tx } from '@crm/db';

type Raw = Record<string, unknown>;
const rowsOf = (res: { rows: unknown[] }): Raw[] => res.rows as Raw[];

export interface ConsentExportRow {
  id: number;
  uuid: string;
  orgId: number;
  requestedBy: number;
  emailedTo: string | null;
  status: ConsentExportStatus;
  rowCount: number | null;
  fileName: string | null;
  fileBytes: number | null;
  error: string | null;
  requestedAt: Date;
  completedAt: Date | null;
  expiresAt: Date | null;
}

const toExport = (r: Raw): ConsentExportRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  orgId: Number(r.org_id),
  requestedBy: Number(r.requested_by),
  emailedTo: (r.emailed_to as string | null) ?? null,
  status: r.status as ConsentExportStatus,
  rowCount: r.row_count === null ? null : Number(r.row_count),
  fileName: (r.file_name as string | null) ?? null,
  fileBytes: r.file_bytes === null ? null : Number(r.file_bytes),
  error: (r.error as string | null) ?? null,
  requestedAt: new Date(r.requested_at as string),
  completedAt: r.completed_at ? new Date(r.completed_at as string) : null,
  expiresAt: r.expires_at ? new Date(r.expires_at as string) : null,
});

const COLUMNS = sql.raw(
  `id, uuid, org_id, requested_by, emailed_to, status, row_count, file_name, file_bytes, error, requested_at, completed_at, expires_at`,
);

/** SQL of the asynchronous consent proof exports. Every statement names `org_id` (and forced RLS sits underneath), except the sweeps. */
@Injectable()
export class ConsentExportRepository {
  async create(
    tx: Tx,
    orgId: number,
    input: { requestedBy: number; emailedTo: string | null },
  ): Promise<ConsentExportRow> {
    const res = await tx.execute(sql`
      INSERT INTO contact_consent_exports (org_id, requested_by, emailed_to)
      VALUES (${orgId}, ${input.requestedBy}, ${input.emailedTo})
      RETURNING ${COLUMNS}`);
    return toExport(rowsOf(res)[0]!);
  }

  async active(tx: Tx, orgId: number): Promise<ConsentExportRow | null> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM contact_consent_exports
      WHERE org_id = ${orgId} AND status IN ('queued', 'running') LIMIT 1`);
    const r = rowsOf(res)[0];
    return r ? toExport(r) : null;
  }

  async list(tx: Tx, orgId: number, limit: number): Promise<ConsentExportRow[]> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM contact_consent_exports WHERE org_id = ${orgId}
      ORDER BY requested_at DESC, id DESC LIMIT ${limit}`);
    return rowsOf(res).map(toExport);
  }

  async byUuid(tx: Tx, orgId: number, uuid: string): Promise<ConsentExportRow | null> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM contact_consent_exports WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`);
    const r = rowsOf(res)[0];
    return r ? toExport(r) : null;
  }

  /** The ledger size, counted up to `cap` rows (a count of millions is never needed: the answer is "more than the direct download carries"). */
  async ledgerRowsUpTo(tx: Tx, orgId: number, cap: number): Promise<number> {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS n FROM (
        SELECT 1 FROM contact_consent_events WHERE org_id = ${orgId} LIMIT ${cap}) s`);
    return Number(rowsOf(res)[0]?.n ?? 0);
  }

  /** queued -> running. False when another worker has it or it is no longer queued. */
  async claim(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE contact_consent_exports SET status = 'running', started_at = now(), error = NULL
      WHERE org_id = ${orgId} AND id = ${id} AND status = 'queued' RETURNING 1`);
    return rowsOf(res).length > 0;
  }

  async finish(
    tx: Tx,
    orgId: number,
    id: number,
    f: { fileName: string; file: Buffer; rowCount: number; expiresAt: Date },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE contact_consent_exports SET status = 'ready', file_name = ${f.fileName}, file_gz = ${f.file}, file_bytes = ${f.file.length},
        row_count = ${f.rowCount}, completed_at = now(), expires_at = ${f.expiresAt}, error = NULL
      WHERE org_id = ${orgId} AND id = ${id} AND status = 'running'`);
  }

  async fail(tx: Tx, orgId: number, id: number, error: string): Promise<void> {
    await tx.execute(sql`
      UPDATE contact_consent_exports SET status = 'failed', error = ${error.slice(0, 500)}, completed_at = now()
      WHERE org_id = ${orgId} AND id = ${id} AND status IN ('queued', 'running')`);
  }

  async file(tx: Tx, orgId: number, id: number): Promise<Buffer | null> {
    const res = await tx.execute(
      sql`SELECT file_gz FROM contact_consent_exports WHERE org_id = ${orgId} AND id = ${id} AND status = 'ready' AND expires_at > now()`,
    );
    return (rowsOf(res)[0]?.file_gz as Buffer | undefined) ?? null;
  }

  async userContact(tx: Tx, orgId: number, userId: number): Promise<{ email: string } | null> {
    const res = await tx.execute(
      sql`SELECT email::text AS email FROM users WHERE org_id = ${orgId} AND id = ${userId}`,
    );
    const r = rowsOf(res)[0];
    return r ? { email: r.email as string } : null;
  }

  // --- sweeps (privileged, across workspaces) ------------------------------------------------------------------------------------

  /** Drops the file of every export past its time and marks it `expired`. */
  async expire(tx: Tx, now: Date): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE contact_consent_exports SET status = 'expired', file_gz = NULL
      WHERE status = 'ready' AND expires_at < ${now} RETURNING 1`);
    return rowsOf(res).length;
  }

  /** Marks an export that has been `running` for more than `olderThanMs` as failed: its worker died. */
  async failStuck(tx: Tx, now: Date, olderThanMs: number): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE contact_consent_exports SET status = 'failed', error = 'The export was interrupted. Request it again.'
      WHERE status = 'running' AND started_at < ${new Date(now.getTime() - olderThanMs)} RETURNING 1`);
    return rowsOf(res).length;
  }
}
