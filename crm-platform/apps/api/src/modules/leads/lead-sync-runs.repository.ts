import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { LeadSyncKind, LeadSyncStatus } from '@crm/contracts';
import type { Tx } from '@crm/db';
import type { LeadPullProgress } from './lead-pull.port';

type Raw = Record<string, unknown>;
const d = (v: unknown): Date | null => (v ? new Date(v as string) : null);

export interface SyncRunRow {
  id: number;
  uuid: string;
  sourceId: number;
  sourceUuid: string;
  sourceName: string;
  kind: LeadSyncKind;
  status: LeadSyncStatus;
  rangeFrom: Date | null;
  rangeTo: Date | null;
  fetched: number;
  accepted: number;
  duplicates: number;
  failed: number;
  windowsDone: number;
  windowsTotal: number;
  error: string | null;
  requestedBy: number | null;
  startedAt: Date | null;
  heartbeatAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}

const toRow = (r: Raw): SyncRunRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  sourceId: Number(r.source_id),
  sourceUuid: r.source_uuid as string,
  sourceName: r.source_name as string,
  kind: r.kind as LeadSyncKind,
  status: r.status as LeadSyncStatus,
  rangeFrom: d(r.range_from),
  rangeTo: d(r.range_to),
  fetched: Number(r.fetched),
  accepted: Number(r.accepted),
  duplicates: Number(r.duplicates),
  failed: Number(r.failed),
  windowsDone: Number(r.windows_done),
  windowsTotal: Number(r.windows_total),
  error: (r.error as string | null) ?? null,
  requestedBy:
    r.requested_by === null || r.requested_by === undefined ? null : Number(r.requested_by),
  startedAt: d(r.started_at),
  heartbeatAt: d(r.heartbeat_at),
  finishedAt: d(r.finished_at),
  createdAt: new Date(r.created_at as string),
});

const SELECT = sql`
  SELECT r.*, s.uuid AS source_uuid, s.name AS source_name
  FROM lead_sync_runs r JOIN lead_sources s ON s.org_id = r.org_id AND s.id = r.source_id`;

/** `lead_sync_runs`: one "Sync now" or backfill of a pull-capable source, and the guard that lets one run per source be open. */
@Injectable()
export class LeadSyncRunsRepository {
  /** Queues a run. Throws the unique violation (23505) when the source already has one queued or running. */
  async insert(
    tx: Tx,
    orgId: number,
    v: {
      sourceId: number;
      kind: LeadSyncKind;
      from: Date | null;
      to: Date | null;
      requestedBy: number | null;
    },
  ): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO lead_sync_runs (org_id, source_id, kind, range_from, range_to, requested_by)
      VALUES (${orgId}, ${v.sourceId}, ${v.kind}, ${v.from?.toISOString() ?? null}::timestamptz,
              ${v.to?.toISOString() ?? null}::timestamptz, ${v.requestedBy})
      RETURNING id`);
    return Number((res.rows[0] as { id: number | string }).id);
  }

  async byId(tx: Tx, orgId: number, id: number): Promise<SyncRunRow | undefined> {
    const res = await tx.execute(sql`${SELECT} WHERE r.org_id = ${orgId} AND r.id = ${id}`);
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  /** Newest first. */
  async recent(
    tx: Tx,
    orgId: number,
    f: { sourceUuid?: string; limit: number },
  ): Promise<SyncRunRow[]> {
    const res = await tx.execute(sql`
      ${SELECT} WHERE r.org_id = ${orgId} ${f.sourceUuid ? sql`AND s.uuid = ${f.sourceUuid}::uuid` : sql``}
      ORDER BY r.created_at DESC, r.id DESC LIMIT ${f.limit}`);
    return (res.rows as Raw[]).map(toRow);
  }

  /** For each given source: its newest run and its open run, if any. */
  async latestOf(
    tx: Tx,
    orgId: number,
    sourceIds: readonly number[],
  ): Promise<{ last: Map<number, SyncRunRow>; open: Map<number, SyncRunRow> }> {
    const last = new Map<number, SyncRunRow>();
    const open = new Map<number, SyncRunRow>();
    if (sourceIds.length === 0) return { last, open };
    const ids = sql.join(
      sourceIds.map((i) => sql`${i}::bigint`),
      sql`, `,
    );
    const lastRes = await tx.execute(sql`
      ${SELECT} WHERE r.org_id = ${orgId} AND r.id IN (
        SELECT DISTINCT ON (source_id) id FROM lead_sync_runs
        WHERE org_id = ${orgId} AND source_id IN (${ids}) ORDER BY source_id, created_at DESC, id DESC)`);
    for (const r of lastRes.rows as Raw[]) last.set(Number(r.source_id), toRow(r));
    const openRes = await tx.execute(sql`
      ${SELECT} WHERE r.org_id = ${orgId} AND r.source_id IN (${ids}) AND r.status IN ('queued', 'running')`);
    for (const r of openRes.rows as Raw[]) open.set(Number(r.source_id), toRow(r));
    return { last, open };
  }

  /** Whether the source has a run queued or running right now. */
  async hasOpen(tx: Tx, orgId: number, sourceId: number): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT 1 FROM lead_sync_runs
      WHERE org_id = ${orgId} AND source_id = ${sourceId} AND status IN ('queued', 'running') LIMIT 1`);
    return res.rows.length > 0;
  }

  /** When this source was last asked to pull (any kind), for the rate limit. */
  async lastAskedAt(
    tx: Tx,
    orgId: number,
    sourceId: number,
    kind?: LeadSyncKind,
  ): Promise<Date | null> {
    const res = await tx.execute(sql`
      SELECT max(created_at) AS at FROM lead_sync_runs
      WHERE org_id = ${orgId} AND source_id = ${sourceId} ${kind ? sql`AND kind = ${kind}` : sql``}`);
    return d((res.rows[0] as Raw | undefined)?.at);
  }

  /** Takes a queued run for this worker. False when it is not queued any more (taken, or freed by the sweep). */
  async claim(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE lead_sync_runs SET status = 'running', started_at = now(), heartbeat_at = now()
      WHERE org_id = ${orgId} AND id = ${id} AND status = 'queued' RETURNING id`);
    return res.rows.length > 0;
  }

  async progress(tx: Tx, orgId: number, id: number, p: LeadPullProgress): Promise<void> {
    await tx.execute(sql`
      UPDATE lead_sync_runs SET fetched = ${p.fetched}, accepted = ${p.accepted}, duplicates = ${p.duplicates},
        failed = ${p.failed}, windows_done = ${p.windowsDone}, windows_total = ${p.windowsTotal}, heartbeat_at = now()
      WHERE org_id = ${orgId} AND id = ${id} AND status = 'running'`);
  }

  async finish(
    tx: Tx,
    orgId: number,
    id: number,
    v: { status: LeadSyncStatus; error: string | null; progress: LeadPullProgress },
  ): Promise<void> {
    const p = v.progress;
    await tx.execute(sql`
      UPDATE lead_sync_runs SET status = ${v.status}, error = ${v.error}, fetched = ${p.fetched}, accepted = ${p.accepted},
        duplicates = ${p.duplicates}, failed = ${p.failed}, windows_done = ${p.windowsDone}, windows_total = ${p.windowsTotal},
        finished_at = now(), heartbeat_at = now()
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  // --- the sweep (privileged: across workspaces) ------------------------------------------------------------------------------

  /** Runs still `queued` after `olderThanSeconds`: their job was lost (Redis down at request time). They are queued again. */
  async staleQueued(
    tx: Tx,
    olderThanSeconds: number,
    limit: number,
  ): Promise<Array<{ orgId: number; id: number }>> {
    const res = await tx.execute(sql`
      SELECT org_id, id FROM lead_sync_runs
      WHERE status = 'queued' AND created_at < now() - (${olderThanSeconds} * interval '1 second')
      ORDER BY created_at LIMIT ${limit}`);
    return (res.rows as Raw[]).map((r) => ({ orgId: Number(r.org_id), id: Number(r.id) }));
  }

  /** A run that stopped reporting: its worker died. Ends `failed / interrupted` so the source can be asked again. */
  async failAbandoned(tx: Tx, silentSeconds: number): Promise<number> {
    const res = await tx.execute(sql`
      UPDATE lead_sync_runs SET status = 'failed', error = 'interrupted', finished_at = now()
      WHERE status = 'running' AND heartbeat_at < now() - (${silentSeconds} * interval '1 second')
      RETURNING id`);
    return res.rows.length;
  }

  /** History past its retention goes (the runs are a record of who pulled what, not of the leads). */
  async prune(tx: Tx, olderThanDays: number): Promise<number> {
    const res = await tx.execute(sql`
      DELETE FROM lead_sync_runs WHERE finished_at IS NOT NULL
        AND finished_at < now() - (${olderThanDays} * interval '1 day') RETURNING id`);
    return res.rows.length;
  }
}
