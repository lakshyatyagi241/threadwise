import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { AuditLogExportStatus, AuditLogFilters } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { buildWhere, type FilterContext, type RowPosition } from './audit-log.rules';

type Raw = Record<string, unknown>;
const rowsOf = (res: { rows: unknown[] }): Raw[] => res.rows as Raw[];

/** One `audit_log` row as the screen and the export need it. `delta` is present only when asked for. */
export interface AuditRow {
  id: number;
  atText: string;
  at: Date;
  actorId: number | null;
  actorType: string;
  module: string;
  recordId: string;
  action: string;
  requestId: string | null;
  changedFields: string[];
  sessionUuid: string | null;
  userUuid: string | null;
  userName: string | null;
  keyName: string | null;
  delta?: unknown;
  /** Read back from the cold archive: the names are looked up afterwards (set by the export). */
  fromArchive?: boolean;
}

const toRow = (r: Raw): AuditRow => ({
  id: Number(r.id),
  atText: r.at_text as string,
  at: new Date(r.at_text as string),
  actorId: r.actor_id === null ? null : Number(r.actor_id),
  actorType: r.actor_type as string,
  module: r.module as string,
  recordId: String(r.record_id),
  action: r.action as string,
  requestId: (r.request_id as string | null) ?? null,
  changedFields: (r.changed_fields as string[] | null) ?? [],
  sessionUuid: (r.session_uuid as string | null) ?? null,
  userUuid: (r.user_uuid as string | null) ?? null,
  userName: (r.user_name as string | null) ?? null,
  keyName: (r.key_name as string | null) ?? null,
  ...('delta' in r ? { delta: r.delta } : {}),
});

/** The columns of an audit row with the actor resolved. `at` is read as text so its microseconds survive a cursor round trip. */
const SELECT_ROW = sql`
  a.id, to_char(a.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at_text,
  a.actor_id, a.actor_type, a.module, a.record_id, a.action, a.request_id,
  CASE WHEN jsonb_typeof(a.delta) = 'object'
       THEN ARRAY(SELECT k FROM jsonb_object_keys(a.delta) k WHERE k <> '_impersonatedBy' ORDER BY k)
       ELSE ARRAY[]::text[] END AS changed_fields,
  a.delta #>> '{_impersonatedBy,new,sessionId}' AS session_uuid,
  u.uuid::text AS user_uuid, u.full_name AS user_name, ak.name AS key_name`;
const FROM_ROW = sql`
  FROM audit_log a
  LEFT JOIN users u ON u.org_id = a.org_id AND u.id = a.actor_id AND a.actor_type = 'user'
  LEFT JOIN api_keys ak ON ak.org_id = a.org_id AND ak.id = a.actor_id AND a.actor_type = 'api_key'`;

export interface ExportRow {
  id: number;
  uuid: string;
  orgId: number;
  requestedBy: number;
  emailedTo: string | null;
  filters: AuditLogFilters;
  status: AuditLogExportStatus;
  rowCount: number | null;
  fileBytes: number | null;
  error: string | null;
  requestedAt: Date;
  completedAt: Date | null;
  expiresAt: Date | null;
}

const toExport = (r: Raw): ExportRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  orgId: Number(r.org_id),
  requestedBy: Number(r.requested_by),
  emailedTo: (r.emailed_to as string | null) ?? null,
  filters: (r.filters as AuditLogFilters) ?? {},
  status: r.status as AuditLogExportStatus,
  rowCount: r.row_count === null ? null : Number(r.row_count),
  fileBytes: r.file_bytes === null ? null : Number(r.file_bytes),
  error: (r.error as string | null) ?? null,
  requestedAt: new Date(r.requested_at as string),
  completedAt: r.completed_at ? new Date(r.completed_at as string) : null,
  expiresAt: r.expires_at ? new Date(r.expires_at as string) : null,
});

const EXPORT_COLUMNS = sql.raw(
  `id, uuid, org_id, requested_by, emailed_to, filters, status, row_count, file_name, file_bytes, error, requested_at, completed_at, expires_at`,
);

/** Where a record type has a screen: the table that maps its number to a uuid and the app path. */
export const LINKABLE: Record<string, { table: string; path: (uuid: string) => string }> = {
  contacts: { table: 'contacts', path: (u) => `/contacts/${u}` },
  companies: { table: 'companies', path: (u) => `/companies/${u}` },
  deals: { table: 'deals', path: (u) => `/deals/${u}` },
  broadcasts: { table: 'broadcasts', path: (u) => `/broadcasts/${u}` },
};

/** SQL of the audit log reads and its exports. Every statement names `org_id` and an `at` range (RLS sits underneath), except the sweeps. */
@Injectable()
export class AuditLogRepository {
  // --- reads -------------------------------------------------------------------------------------------------------------------

  async page(
    tx: Tx,
    f: AuditLogFilters,
    ctx: FilterContext,
    limit: number,
    withDelta = false,
  ): Promise<AuditRow[]> {
    const delta: SQL = withDelta ? sql`, a.delta` : sql``;
    const res = await tx.execute(sql`
      SELECT ${SELECT_ROW}${delta} ${FROM_ROW}
      WHERE ${buildWhere(f, ctx)}
      ORDER BY a.at DESC, a.id DESC
      LIMIT ${limit}`);
    return rowsOf(res).map(toRow);
  }

  /** One entry by position. The `at` bound prunes the scan to one partition. */
  async byPosition(tx: Tx, orgId: number, pos: RowPosition): Promise<AuditRow | null> {
    const res = await tx.execute(sql`
      SELECT ${SELECT_ROW}, a.delta ${FROM_ROW}
      WHERE a.org_id = ${orgId} AND a.id = ${pos.id} AND a.at = ${pos.atText}::timestamptz`);
    const r = rowsOf(res)[0];
    return r ? toRow(r) : null;
  }

  /** The modules and actions present in the window. */
  async facets(
    tx: Tx,
    orgId: number,
    window: { from: Date; to: Date },
  ): Promise<{
    modules: string[];
    actions: string[];
    actors: Array<{ id: string; name: string }>;
  }> {
    const res = await tx.execute(sql`
      SELECT DISTINCT a.module, a.action FROM audit_log a
      WHERE a.org_id = ${orgId}
        AND a.at >= ${window.from.toISOString()}::timestamptz AND a.at < ${window.to.toISOString()}::timestamptz`);
    const modules = new Set<string>();
    const actions = new Set<string>();
    for (const r of rowsOf(res)) {
      modules.add(r.module as string);
      actions.add(r.action as string);
    }
    const people = await tx.execute(sql`
      SELECT u.uuid::text AS id, u.full_name AS name FROM users u
      WHERE u.org_id = ${orgId} AND u.id IN (
        SELECT DISTINCT a.actor_id FROM audit_log a
        WHERE a.org_id = ${orgId} AND a.actor_type = 'user' AND a.actor_id IS NOT NULL
          AND a.at >= ${window.from.toISOString()}::timestamptz AND a.at < ${window.to.toISOString()}::timestamptz)
      ORDER BY u.full_name, u.id`);
    return {
      modules: [...modules].sort(),
      actions: [...actions].sort(),
      actors: rowsOf(people).map((r) => ({ id: r.id as string, name: r.name as string })),
    };
  }

  /** `users.id` of a user uuid in this workspace, or null. */
  async userId(tx: Tx, orgId: number, uuid: string): Promise<number | null> {
    const res = await tx.execute(
      sql`SELECT id FROM users WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = rowsOf(res)[0];
    return r ? Number(r.id) : null;
  }

  /** Display names of the users and API keys of one workspace, for archived lines that carry only their ids. */
  async actorNames(
    tx: Tx,
    orgId: number,
    userIds: number[],
    keyIds: number[],
  ): Promise<{ users: Map<number, string>; keys: Map<number, string> }> {
    const list = (ids: number[]) =>
      sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      );
    const users = new Map<number, string>();
    const keys = new Map<number, string>();
    if (userIds.length > 0) {
      const res = await tx.execute(
        sql`SELECT id, full_name FROM users WHERE org_id = ${orgId} AND id IN (${list(userIds)})`,
      );
      for (const r of rowsOf(res)) users.set(Number(r.id), r.full_name as string);
    }
    if (keyIds.length > 0) {
      const res = await tx.execute(
        sql`SELECT id, name FROM api_keys WHERE org_id = ${orgId} AND id IN (${list(keyIds)})`,
      );
      for (const r of rowsOf(res)) keys.set(Number(r.id), r.name as string);
    }
    return { users, keys };
  }

  /** The uuids of records of one linkable type that still exist (a deleted record has no screen). */
  async recordUuids(
    tx: Tx,
    orgId: number,
    table: string,
    ids: number[],
  ): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (ids.length === 0) return out;
    const res = await tx.execute(sql`
      SELECT id, uuid::text AS uuid FROM ${sql.raw(table)}
      WHERE org_id = ${orgId} AND id IN (${sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      )})`);
    for (const r of rowsOf(res)) out.set(String(r.id), r.uuid as string);
    return out;
  }

  // --- privileged reads (platform tables) ----------------------------------------------------------------------------------------

  /** The support sessions of THIS workspace among `uuids` (the table is platform-only; the org bound keeps another workspace's out). */
  async impersonationSessions(
    tx: Tx,
    orgId: number,
    uuids: string[],
  ): Promise<Map<string, { reason: string; readOnly: boolean; startedAt: Date }>> {
    const out = new Map<string, { reason: string; readOnly: boolean; startedAt: Date }>();
    if (uuids.length === 0) return out;
    const res = await tx.execute(sql`
      SELECT uuid::text AS uuid, reason, read_only, started_at FROM impersonation_sessions
      WHERE target_workspace_id = ${orgId} AND uuid::text IN (${sql.join(
        uuids.map((u) => sql`${u}`),
        sql`, `,
      )})`);
    for (const r of rowsOf(res)) {
      out.set(r.uuid as string, {
        reason: r.reason as string,
        readOnly: r.read_only as boolean,
        startedAt: new Date(r.started_at as string),
      });
    }
    return out;
  }

  /** The platform's audit retention policy in days (0 = forever); 365 when it was never saved, null if it cannot be read. */
  async retentionDays(tx: Tx): Promise<number | null> {
    const res = await tx.execute(
      sql`SELECT (value ->> 'auditLogRetentionDays')::int AS days FROM platform_settings WHERE key = 'security.policy'`,
    );
    const r = rowsOf(res)[0];
    if (!r || r.days === null || r.days === undefined) return 365;
    return Number(r.days);
  }

  // --- exports -----------------------------------------------------------------------------------------------------------------

  async createExport(
    tx: Tx,
    orgId: number,
    input: { requestedBy: number; emailedTo: string | null; filters: AuditLogFilters },
  ): Promise<ExportRow> {
    const res = await tx.execute(sql`
      INSERT INTO audit_log_exports (org_id, requested_by, emailed_to, filters)
      VALUES (${orgId}, ${input.requestedBy}, ${input.emailedTo}, ${JSON.stringify(input.filters)}::jsonb)
      RETURNING ${EXPORT_COLUMNS}`);
    return toExport(rowsOf(res)[0]!);
  }

  async activeExport(tx: Tx, orgId: number): Promise<ExportRow | null> {
    const res = await tx.execute(sql`
      SELECT ${EXPORT_COLUMNS} FROM audit_log_exports
      WHERE org_id = ${orgId} AND status IN ('queued', 'running') LIMIT 1`);
    const r = rowsOf(res)[0];
    return r ? toExport(r) : null;
  }

  async listExports(tx: Tx, orgId: number, limit: number): Promise<ExportRow[]> {
    const res = await tx.execute(sql`
      SELECT ${EXPORT_COLUMNS} FROM audit_log_exports WHERE org_id = ${orgId}
      ORDER BY requested_at DESC, id DESC LIMIT ${limit}`);
    return rowsOf(res).map(toExport);
  }

  async exportByUuid(tx: Tx, orgId: number, uuid: string): Promise<ExportRow | null> {
    const res = await tx.execute(sql`
      SELECT ${EXPORT_COLUMNS} FROM audit_log_exports WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`);
    const r = rowsOf(res)[0];
    return r ? toExport(r) : null;
  }

  /** queued -> running. False when another worker has it or it is no longer queued. */
  async claimExport(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE audit_log_exports SET status = 'running', started_at = now(), error = NULL
      WHERE org_id = ${orgId} AND id = ${id} AND status = 'queued' RETURNING 1`);
    return rowsOf(res).length > 0;
  }

  async finishExport(
    tx: Tx,
    orgId: number,
    id: number,
    f: { fileName: string; file: Buffer; rowCount: number; expiresAt: Date },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE audit_log_exports SET status = 'ready', file_name = ${f.fileName}, file_gz = ${f.file}, file_bytes = ${f.file.length},
        row_count = ${f.rowCount}, completed_at = now(), expires_at = ${f.expiresAt}, error = NULL
      WHERE org_id = ${orgId} AND id = ${id} AND status = 'running'`);
  }

  async failExport(tx: Tx, orgId: number, id: number, error: string): Promise<void> {
    await tx.execute(sql`
      UPDATE audit_log_exports SET status = 'failed', error = ${error.slice(0, 500)}, completed_at = now()
      WHERE org_id = ${orgId} AND id = ${id} AND status IN ('queued', 'running')`);
  }

  async exportFile(
    tx: Tx,
    orgId: number,
    id: number,
  ): Promise<{ file: Buffer; fileName: string } | null> {
    const res = await tx.execute(sql`
      SELECT file_gz, file_name FROM audit_log_exports
      WHERE org_id = ${orgId} AND id = ${id} AND status = 'ready' AND expires_at > now()`);
    const r = rowsOf(res)[0];
    if (!r?.file_gz) return null;
    return {
      file: r.file_gz as Buffer,
      fileName: (r.file_name as string | null) ?? 'audit-log.csv',
    };
  }

  async userContact(tx: Tx, orgId: number, userId: number): Promise<{ email: string } | null> {
    const res = await tx.execute(
      sql`SELECT email::text AS email FROM users WHERE org_id = ${orgId} AND id = ${userId}`,
    );
    const r = rowsOf(res)[0];
    return r ? { email: r.email as string } : null;
  }

  // --- sweeps (privileged, across workspaces) ----------------------------------------------------------------------------------

  /**
   * Deletes the file of every export past its date. With `ttlDays` (a super admin's saved file lifetime) a file is also deleted once
   * it is older than that, so shortening the lifetime reaches the files already built, not only the next ones.
   */
  async expireExports(tx: Tx, now: Date, ttlDays: number | null = null): Promise<number> {
    const cutoff = ttlDays === null ? null : new Date(now.getTime() - ttlDays * 86_400_000);
    const res = await tx.execute(sql`
      UPDATE audit_log_exports SET status = 'expired', file_gz = NULL
      WHERE status = 'ready'
        AND (expires_at < ${now} OR (${cutoff}::timestamptz IS NOT NULL AND completed_at < ${cutoff}::timestamptz))
        AND NOT is_subject_held(org_id, 'contact', NULL)
      RETURNING 1`);
    return rowsOf(res).length;
  }

  async failStuckExports(tx: Tx, now: Date, olderThanMs: number): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE audit_log_exports SET status = 'failed', error = 'The export was interrupted. Request it again.'
      WHERE status = 'running' AND started_at < ${new Date(now.getTime() - olderThanMs)} RETURNING 1`);
    return rowsOf(res).length;
  }
}
