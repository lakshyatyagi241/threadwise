import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { StorageCategory } from '@crm/contracts';
import type { Tx } from '@crm/db';
import type { OwnerSource } from './storage-owners';

type Row = Record<string, unknown>;
const rowsOf = (res: unknown): Row[] => (res as { rows: Row[] }).rows;
const num = (v: unknown): number => Number(v ?? 0);

export interface OwnerRow {
  id: number;
  key: string;
  size: number | null;
  cat: string | null;
}

export interface CommitInput {
  orgId: number;
  /** The reservation to settle; unknown or already gone (reaped) is fine. */
  reservationUuid: string | null;
  bytes: number;
  category: StorageCategory;
  key: string;
  sha256: string | null;
  ownerTable: string | null;
  ownerId: number | null;
}

/**
 * All SQL of the storage meter: the four tables of migration 20270105090000, written in the caller's transaction. Stateless.
 *
 * Counters move only by the DELTA of a registry row (new size minus old), so committing a key twice, or after the nightly check already
 * counted it, never counts it twice. Every subtraction is clamped at zero: a delete that races the reaper gives back at most what is held.
 */
@Injectable()
export class StorageQuotaRepository {
  /** Reserves `bytes` for an upload in flight and returns the token the caller holds. */
  async reserve(
    tx: Tx,
    orgId: number,
    bytes: number,
    category: StorageCategory,
    expiresAt: Date,
  ): Promise<string> {
    await tx.execute(sql`
      INSERT INTO storage_org_state (org_id, reserved_bytes) VALUES (${orgId}, ${bytes})
      ON CONFLICT (org_id) DO UPDATE SET reserved_bytes = storage_org_state.reserved_bytes + EXCLUDED.reserved_bytes`);
    const res = await tx.execute(sql`
      INSERT INTO storage_reservations (org_id, bytes, category, expires_at)
      VALUES (${orgId}, ${bytes}, ${category}, ${expiresAt.toISOString()}::timestamptz)
      RETURNING uuid`);
    return String(rowsOf(res)[0]!.uuid);
  }

  /** Gives a reservation back. Idempotent: a reservation already settled or reaped is not there. */
  async release(tx: Tx, orgId: number, reservationUuid: string): Promise<void> {
    const res = await tx.execute(sql`
      DELETE FROM storage_reservations WHERE org_id = ${orgId} AND uuid = ${reservationUuid}::uuid RETURNING bytes`);
    const back = rowsOf(res)[0];
    if (!back) return;
    await tx.execute(sql`
      UPDATE storage_org_state SET reserved_bytes = GREATEST(reserved_bytes - ${num(back.bytes)}::bigint, 0) WHERE org_id = ${orgId}`);
  }

  /** Settles a reservation: the bytes move from reserved to hot and the object is registered (or its size corrected). */
  async commit(tx: Tx, input: CommitInput): Promise<void> {
    const { orgId } = input;
    let reservedBack = 0;
    if (input.reservationUuid) {
      const res = await tx.execute(sql`
        DELETE FROM storage_reservations WHERE org_id = ${orgId} AND uuid = ${input.reservationUuid}::uuid RETURNING bytes`);
      reservedBack = num(rowsOf(res)[0]?.bytes);
    }

    const current = rowsOf(
      await tx.execute(sql`
        SELECT bytes, category, tier, owner_table FROM storage_objects
        WHERE org_id = ${orgId} AND key = ${input.key} FOR UPDATE`),
    )[0];

    const linked = input.ownerTable !== null && input.ownerId !== null;
    let hotDelta = input.bytes;
    let objectsDelta = 1;
    let previous: { category: string; bytes: number } | null = null;

    if (current) {
      previous = { category: String(current.category), bytes: num(current.bytes) };
      // A cold copy is not counted hot; the commit of a key that is cold is a correction of its size only.
      const countsHot = current.tier !== 'cold';
      hotDelta = countsHot ? input.bytes - previous.bytes : 0;
      objectsDelta = 0;
      await tx.execute(sql`
        UPDATE storage_objects SET
          bytes = ${input.bytes},
          category = ${input.category},
          sha256 = COALESCE(${input.sha256}, sha256),
          owner_table = COALESCE(${input.ownerTable}, owner_table),
          owner_id = COALESCE(${input.ownerId}, owner_id),
          state = CASE WHEN COALESCE(${input.ownerTable}, owner_table) IS NOT NULL THEN 'live'
                       WHEN state = 'missing' THEN 'pending' ELSE state END
        WHERE org_id = ${orgId} AND key = ${input.key}`);
    } else {
      await tx.execute(sql`
        INSERT INTO storage_objects (org_id, key, category, bytes, sha256, state, owner_table, owner_id)
        VALUES (${orgId}, ${input.key}, ${input.category}, ${input.bytes}, ${input.sha256},
                ${linked ? 'live' : 'pending'}, ${input.ownerTable}, ${input.ownerId})`);
    }

    await tx.execute(sql`
      INSERT INTO storage_org_state (org_id, hot_bytes) VALUES (${orgId}, GREATEST(${hotDelta}::bigint, 0))
      ON CONFLICT (org_id) DO UPDATE SET
        reserved_bytes = GREATEST(storage_org_state.reserved_bytes - ${reservedBack}::bigint, 0),
        hot_bytes = GREATEST(storage_org_state.hot_bytes + ${hotDelta}::bigint, 0)`);

    if (previous && previous.category !== input.category) {
      // The object changed category (an adopted `unknown` object found its owner): move its bytes between the two counters.
      await this.bumpUsage(tx, orgId, previous.category, -previous.bytes, -1);
      await this.bumpUsage(tx, orgId, input.category, input.bytes, 1);
    } else {
      await this.bumpUsage(tx, orgId, input.category, hotDelta, objectsDelta);
    }
  }

  /** Drops an object's registry row and gives its bytes back. Returns the bytes given back (0 when the object was not registered). */
  async remove(tx: Tx, orgId: number, key: string): Promise<number> {
    const res = await tx.execute(sql`
      DELETE FROM storage_objects WHERE org_id = ${orgId} AND key = ${key} RETURNING bytes, category, tier`);
    const row = rowsOf(res)[0];
    if (!row) return 0;
    const bytes = num(row.bytes);
    const hot = row.tier !== 'cold';
    await tx.execute(sql`
      UPDATE storage_org_state SET hot_bytes = GREATEST(hot_bytes - ${hot ? bytes : 0}::bigint, 0) WHERE org_id = ${orgId}`);
    if (hot) await this.bumpUsage(tx, orgId, String(row.category), -bytes, -1);
    else
      await tx.execute(sql`
        UPDATE storage_usage SET cold_bytes = GREATEST(cold_bytes - ${bytes}::bigint, 0), objects = GREATEST(objects - 1, 0)
        WHERE org_id = ${orgId} AND category = ${String(row.category)}`);
    return bytes;
  }

  private async bumpUsage(
    tx: Tx,
    orgId: number,
    category: string,
    hotDelta: number,
    objectsDelta: number,
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO storage_usage (org_id, category, hot_bytes, objects)
      VALUES (${orgId}, ${category}, GREATEST(${hotDelta}::bigint, 0), GREATEST(${objectsDelta}::bigint, 0))
      ON CONFLICT (org_id, category) DO UPDATE SET
        hot_bytes = GREATEST(storage_usage.hot_bytes + ${hotDelta}::bigint, 0),
        objects = GREATEST(storage_usage.objects + ${objectsDelta}::bigint, 0)`);
  }

  // --- reaper (every workspace; privileged transaction) ----------------------------------------------------------------------

  /** Returns expired reservations to their workspaces. Returns how many and how many bytes. */
  async reapExpired(tx: Tx, now: Date, limit: number): Promise<{ reaped: number; bytes: number }> {
    const res = await tx.execute(sql`
      WITH gone AS (
        DELETE FROM storage_reservations WHERE (org_id, id) IN (
          SELECT org_id, id FROM storage_reservations WHERE expires_at <= ${now.toISOString()}::timestamptz
          ORDER BY expires_at LIMIT ${limit} FOR UPDATE SKIP LOCKED)
        RETURNING org_id, bytes),
      per_org AS (SELECT org_id, sum(bytes)::bigint AS bytes, count(*)::int AS n FROM gone GROUP BY org_id),
      applied AS (
        UPDATE storage_org_state s SET reserved_bytes = GREATEST(s.reserved_bytes - p.bytes, 0)
        FROM per_org p WHERE s.org_id = p.org_id RETURNING 1)
      SELECT coalesce(sum(n), 0)::int AS reaped, coalesce(sum(bytes), 0)::bigint AS bytes FROM per_org`);
    const row = rowsOf(res)[0]!;
    return { reaped: num(row.reaped), bytes: num(row.bytes) };
  }

  // --- reconcile -------------------------------------------------------------------------------------------------------------

  /**
   * Recomputes a workspace's counters from its registry rows (the nightly counter check, spec 4.4) and writes the result. Returns the
   * drift: how many hot bytes the stored counter was off by. Counters of categories that no longer have rows are zeroed.
   */
  async rebuildCounters(
    tx: Tx,
    orgId: number,
    capBytes: number,
    levelOf: (hotBytes: number) => string,
    now: Date,
  ): Promise<{ driftBytes: number; hotBytes: number; level: string }> {
    const before = rowsOf(
      await tx.execute(sql`SELECT hot_bytes FROM storage_org_state WHERE org_id = ${orgId} FOR UPDATE`),
    )[0];
    const sums = rowsOf(
      await tx.execute(sql`
        SELECT category,
               coalesce(sum(bytes) FILTER (WHERE tier <> 'cold' AND state <> 'missing'), 0)::bigint AS hot,
               coalesce(sum(bytes) FILTER (WHERE tier = 'cold'), 0)::bigint AS cold,
               count(*) FILTER (WHERE state <> 'missing')::bigint AS n
        FROM storage_objects WHERE org_id = ${orgId} GROUP BY category`),
    );
    const hotTotal = sums.reduce((a, r) => a + num(r.hot), 0);
    const storedHot = num(before?.hot_bytes);
    const drift = Math.abs(storedHot - hotTotal);
    const level = levelOf(hotTotal);

    await tx.execute(sql`UPDATE storage_usage SET hot_bytes = 0, cold_bytes = 0, objects = 0 WHERE org_id = ${orgId}`);
    for (const r of sums) {
      await tx.execute(sql`
        INSERT INTO storage_usage (org_id, category, hot_bytes, cold_bytes, objects)
        VALUES (${orgId}, ${String(r.category)}, ${num(r.hot)}, ${num(r.cold)}, ${num(r.n)})
        ON CONFLICT (org_id, category) DO UPDATE SET
          hot_bytes = EXCLUDED.hot_bytes, cold_bytes = EXCLUDED.cold_bytes, objects = EXCLUDED.objects`);
    }
    await tx.execute(sql`
      INSERT INTO storage_org_state (org_id, hot_bytes, cap_bytes, level, last_reconciled_at, last_drift_bytes)
      VALUES (${orgId}, ${hotTotal}, ${capBytes}, ${level}, ${now.toISOString()}::timestamptz, ${drift})
      ON CONFLICT (org_id) DO UPDATE SET
        hot_bytes = EXCLUDED.hot_bytes,
        cap_bytes = EXCLUDED.cap_bytes,
        level = EXCLUDED.level,
        over_since = CASE WHEN EXCLUDED.level = 'over' THEN coalesce(storage_org_state.over_since, ${now.toISOString()}::timestamptz) ELSE NULL END,
        last_reconciled_at = EXCLUDED.last_reconciled_at,
        last_drift_bytes = EXCLUDED.last_drift_bytes`);
    return { driftBytes: drift, hotBytes: hotTotal, level };
  }

  /** Registry rows of Postgres blobs (`pg:<table>:...`) of this workspace, for the sync with the blob table. */
  async registeredBlobKeys(tx: Tx, orgId: number, prefix: string): Promise<Map<string, number>> {
    const res = await tx.execute(sql`
      SELECT key, bytes FROM storage_objects WHERE org_id = ${orgId} AND key LIKE ${prefix + '%'}`);
    return new Map(rowsOf(res).map((r) => [String(r.key), num(r.bytes)]));
  }

  /** Team chat blobs of this workspace with their sizes. */
  async teamChatBlobs(tx: Tx, orgId: number): Promise<Array<{ messageId: number; bytes: number }>> {
    const res = await tx.execute(sql`
      SELECT message_id, byte_size FROM team_chat_attachment_blobs WHERE org_id = ${orgId}`);
    return rowsOf(res).map((r) => ({ messageId: num(r.message_id), bytes: num(r.byte_size) }));
  }

  /**
   * Links `pending` registry rows to the row that owns their key (the owner map, `storage-owners.ts`): one UPDATE per owner source.
   * Returns how many rows were linked.
   */
  async linkPending(
    tx: Tx,
    orgId: number,
    owner: { table: string; idColumn: string; keyColumn: string; where?: string },
  ): Promise<number> {
    // Identifiers come from the closed owner map in code, never from a request.
    const where = owner.where ? ` AND ${owner.where}` : '';
    const res = await tx.execute(
      sql.raw(`
      WITH linked AS (
        UPDATE storage_objects o SET owner_table = '${owner.table}', owner_id = src.id, state = 'live'
        FROM (SELECT ${owner.idColumn} AS id, ${owner.keyColumn} AS k FROM ${owner.table}
              WHERE org_id = ${Number(orgId)} AND ${owner.keyColumn} IS NOT NULL${where}) src
        WHERE o.org_id = ${Number(orgId)} AND o.state = 'pending' AND o.owner_table IS NULL AND o.key = src.k
        RETURNING 1)
      SELECT count(*)::int AS n FROM linked`),
    );
    return num(rowsOf(res)[0]?.n);
  }

  /** `pending` rows older than the cutoff with no owner: orphan candidates (reported; nothing is deleted before phase S5). */
  async countOrphanCandidates(tx: Tx, orgId: number | null, cutoff: Date): Promise<number> {
    const res = await tx.execute(sql`
      SELECT coalesce(sum(bytes), 0)::bigint AS n FROM storage_objects
      WHERE state = 'pending' AND owner_table IS NULL AND created_at <= ${cutoff.toISOString()}::timestamptz
        ${orgId === null ? sql`` : sql`AND org_id = ${orgId}`}`);
    return num(rowsOf(res)[0]?.n);
  }

  // --- backfill --------------------------------------------------------------------------------------------------------------

  /** Registers an object found in an owner table. Idempotent on (org, key): an object a door already registered is left alone. */
  async adopt(
    tx: Tx,
    input: {
      orgId: number;
      key: string;
      category: StorageCategory;
      bytes: number;
      ownerTable: string;
      ownerId: number;
    },
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      INSERT INTO storage_objects (org_id, key, category, bytes, state, owner_table, owner_id)
      VALUES (${input.orgId}, ${input.key}, ${input.category}, ${input.bytes}, 'live', ${input.ownerTable}, ${input.ownerId})
      ON CONFLICT (org_id, key) DO UPDATE SET
        owner_table = COALESCE(storage_objects.owner_table, EXCLUDED.owner_table),
        owner_id = COALESCE(storage_objects.owner_id, EXCLUDED.owner_id),
        state = CASE WHEN storage_objects.state = 'pending' THEN 'live' ELSE storage_objects.state END
      RETURNING (xmax = 0) AS inserted`);
    return rowsOf(res)[0]?.inserted === true;
  }

  /**
   * One page of an owner table: the rows that name an object, after `afterId`, with the size the table knows (null when it keeps none)
   * and the category. Identifiers come from the closed `OWNER_SOURCES` map in code.
   */
  async ownerPage(
    tx: Tx,
    orgId: number,
    source: OwnerSource,
    afterId: number,
    limit: number,
  ): Promise<OwnerRow[]> {
    const sizeExpr = 'column' in source.size ? source.size.column : 'NULL';
    const catExpr = typeof source.category === 'string' ? 'NULL' : source.category.sql;
    const where = source.where ? ` AND ${source.where}` : '';
    const res = await tx.execute(
      sql.raw(`
      SELECT ${source.idColumn} AS id, ${source.keyColumn} AS k, ${sizeExpr} AS size, ${catExpr} AS cat
      FROM ${source.table}
      WHERE org_id = ${Number(orgId)} AND ${source.keyColumn} IS NOT NULL AND ${source.idColumn} > ${Number(afterId)}${where}
      ORDER BY ${source.idColumn} LIMIT ${Number(limit)}`),
    );
    return rowsOf(res).map((r) => ({
      id: num(r.id),
      key: String(r.k),
      size: r.size === null || r.size === undefined ? null : num(r.size),
      cat: r.cat === null || r.cat === undefined ? null : String(r.cat),
    }));
  }

  async markBackfilled(tx: Tx, orgId: number, now: Date): Promise<void> {
    await tx.execute(sql`
      INSERT INTO storage_org_state (org_id, backfilled_at) VALUES (${orgId}, ${now.toISOString()}::timestamptz)
      ON CONFLICT (org_id) DO UPDATE SET backfilled_at = EXCLUDED.backfilled_at`);
  }

  async isRegistered(tx: Tx, orgId: number, key: string): Promise<boolean> {
    const res = await tx.execute(sql`SELECT 1 FROM storage_objects WHERE org_id = ${orgId} AND key = ${key}`);
    return rowsOf(res).length > 0;
  }

  // --- worker scans (privileged) ---------------------------------------------------------------------------------------------

  /** Workspaces still to backfill: no state row or no `backfilled_at`, not deleted. Oldest id first. */
  async orgsToBackfill(tx: Tx, limit: number): Promise<number[]> {
    const res = await tx.execute(sql`
      SELECT o.id FROM organizations o
      LEFT JOIN storage_org_state s ON s.org_id = o.id
      WHERE o.status <> 'deleted' AND s.backfilled_at IS NULL
      ORDER BY o.id LIMIT ${limit}`);
    return rowsOf(res).map((r) => num(r.id));
  }

  /** Every workspace that exists, for the nightly fan-out. */
  async allOrgIds(tx: Tx): Promise<number[]> {
    const res = await tx.execute(sql`SELECT id FROM organizations WHERE status <> 'deleted' ORDER BY id`);
    return rowsOf(res).map((r) => num(r.id));
  }
}
