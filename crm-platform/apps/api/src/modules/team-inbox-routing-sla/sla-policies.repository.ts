import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { SlaPriorityOverrides } from '@crm/contracts';

type Raw = Record<string, unknown>;

export interface SlaPolicyRow {
  id: number;
  uuid: string;
  name: string;
  firstResponseMinutes: number | null;
  resolutionMinutes: number | null;
  respectBusinessHours: boolean;
  priorityOverrides: SlaPriorityOverrides;
  isDefault: boolean;
  conversationCount: number;
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
}

const SELECT = sql`
  SELECT p.id, p.uuid, p.name, p.first_response_minutes, p.resolution_minutes,
         p.respect_business_hours, p.priority_overrides, p.is_default, p.row_version,
         to_char(p.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS created_at,
         to_char(p.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS updated_at,
         (SELECT count(*)::int FROM conversations c WHERE c.org_id = p.org_id AND c.sla_policy_id = p.id) AS conversation_count
  FROM sla_policies p`;

const int = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

const toRow = (r: Raw): SlaPolicyRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  name: r.name as string,
  firstResponseMinutes: int(r.first_response_minutes),
  resolutionMinutes: int(r.resolution_minutes),
  respectBusinessHours: r.respect_business_hours === true,
  priorityOverrides: (r.priority_overrides as SlaPriorityOverrides | null) ?? {},
  isDefault: r.is_default === true,
  conversationCount: Number(r.conversation_count ?? 0),
  rowVersion: Number(r.row_version),
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

export interface PolicyValues {
  name: string;
  firstResponseMinutes: number | null;
  resolutionMinutes: number | null;
  respectBusinessHours: boolean;
  priorityOverrides: SlaPriorityOverrides;
  isDefault: boolean;
}

/** Data access for `sla_policies`: the workspace's response targets. */
@Injectable()
export class SlaPoliciesRepository {
  async list(tx: Tx, orgId: number): Promise<SlaPolicyRow[]> {
    const res = await tx.execute(
      sql`${SELECT} WHERE p.org_id = ${orgId} ORDER BY p.is_default DESC, p.id`,
    );
    return (res.rows as Raw[]).map(toRow);
  }

  async byUuid(tx: Tx, orgId: number, uuid: string): Promise<SlaPolicyRow | null> {
    const res = await tx.execute(sql`${SELECT} WHERE p.org_id = ${orgId} AND p.uuid = ${uuid}`);
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : null;
  }

  async byId(tx: Tx, orgId: number, id: number): Promise<SlaPolicyRow | null> {
    const res = await tx.execute(sql`${SELECT} WHERE p.org_id = ${orgId} AND p.id = ${id}`);
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : null;
  }

  /** The workspace's default policy, the one a new conversation's clock comes from. */
  async defaultPolicy(tx: Tx, orgId: number): Promise<SlaPolicyRow | null> {
    const res = await tx.execute(
      sql`${SELECT} WHERE p.org_id = ${orgId} AND p.is_default ORDER BY p.id LIMIT 1`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : null;
  }

  /** Serialises changes to a workspace's policies, so two requests cannot both leave a default behind. */
  async lockAll(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(
      sql`SELECT id FROM sla_policies WHERE org_id = ${orgId} ORDER BY id FOR UPDATE`,
    );
    return res.rows.length;
  }

  async clearDefault(tx: Tx, orgId: number, exceptId?: number): Promise<void> {
    await tx.execute(sql`
      UPDATE sla_policies SET is_default = false
      WHERE org_id = ${orgId} AND is_default ${exceptId === undefined ? sql`` : sql`AND id <> ${exceptId}`}`);
  }

  async insert(tx: Tx, orgId: number, v: PolicyValues): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO sla_policies (org_id, name, first_response_minutes, resolution_minutes,
                                respect_business_hours, priority_overrides, is_default)
      VALUES (${orgId}, ${v.name}, ${v.firstResponseMinutes}, ${v.resolutionMinutes},
              ${v.respectBusinessHours}, ${JSON.stringify(v.priorityOverrides)}::jsonb, ${v.isDefault})
      RETURNING id`);
    return Number((res.rows as Raw[])[0]!.id);
  }

  /** Update with the version the caller read; false when it moved. */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    rowVersion: number,
    v: PolicyValues,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE sla_policies SET name = ${v.name}, first_response_minutes = ${v.firstResponseMinutes},
        resolution_minutes = ${v.resolutionMinutes},
        respect_business_hours = ${v.respectBusinessHours}, priority_overrides = ${JSON.stringify(v.priorityOverrides)}::jsonb,
        is_default = ${v.isDefault}
      WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${rowVersion}
      RETURNING id`);
    return res.rows.length > 0;
  }

  async delete(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM sla_policies WHERE org_id = ${orgId} AND id = ${id}`);
  }
}
