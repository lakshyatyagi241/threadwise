import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { FlowRow } from './flows.v1.mapper';

type Raw = Record<string, unknown>;

const SELECT = sql`
  f.id, f.uuid, f.flow_name, f.trigger_kind, f.is_published, f.is_active, f.category, f.created_at, f.updated_at,
  to_char(f.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS updated_at_iso,
  (SELECT count(*)::int FROM flow_subscribers s WHERE s.org_id = f.org_id AND s.flow_id = f.id) AS subscribers`;

export interface FlowRowWithKey extends FlowRow {
  id: number;
  updatedAtIso: string;
}

const toRow = (r: Raw): FlowRowWithKey => ({
  id: Number(r.id),
  uuid: String(r.uuid),
  name: String(r.flow_name),
  trigger: (r.trigger_kind as string | null) ?? null,
  published: r.is_published === true,
  active: r.is_active === true,
  category: (r.category as string | null) ?? null,
  subscribers: Number(r.subscribers),
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
  updatedAtIso: String(r.updated_at_iso),
});

/**
 * Read-only access to the flow builder's `flows` table and the runtime's `flow_subscribers`, for the two fields the runtime service's
 * REST read leaves out (`category`, `created_at`) and the failure reason of one subscriber. The tables belong to the flow domains; nothing
 * here writes them, and every query names the caller's workspace (row-level security is the backstop).
 */
@Injectable()
export class FlowsV1Repository {
  async list(
    tx: Tx,
    orgId: number,
    q: { limit: number; cursor?: { updatedAtIso: string; id: number } },
  ): Promise<FlowRowWithKey[]> {
    const res = await tx.execute(sql`
      SELECT ${SELECT} FROM flows f
      WHERE f.org_id = ${orgId}
        ${q.cursor ? sql`AND (f.updated_at, f.id) < (${q.cursor.updatedAtIso}::timestamptz, ${q.cursor.id})` : sql``}
      ORDER BY f.updated_at DESC, f.id DESC
      LIMIT ${q.limit + 1}`);
    return (res.rows as Raw[]).map(toRow);
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<FlowRowWithKey | null> {
    const res = await tx.execute(sql`
      SELECT ${SELECT} FROM flows f WHERE f.org_id = ${orgId} AND f.uuid = ${uuid}::uuid`);
    const row = (res.rows as Raw[])[0];
    return row ? toRow(row) : null;
  }

  async failureReason(tx: Tx, orgId: number, subscriberUuid: string): Promise<string | null> {
    const res = await tx.execute(sql`
      SELECT failure_reason FROM flow_subscribers WHERE org_id = ${orgId} AND uuid = ${subscriberUuid}::uuid`);
    return ((res.rows as Raw[])[0]?.failure_reason as string | null) ?? null;
  }
}
