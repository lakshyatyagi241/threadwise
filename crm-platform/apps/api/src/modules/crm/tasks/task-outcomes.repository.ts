import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

/** One task outcome as the SQL returns it. */
export interface TaskOutcomeRow {
  id: number;
  uuid: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
  taskCount: number;
}

type Raw = Record<string, unknown>;

const toOutcome = (r: Raw): TaskOutcomeRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  name: r.name as string,
  sortOrder: Number(r.sort_order),
  isActive: r.is_active as boolean,
  rowVersion: Number(r.row_version),
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
  taskCount: Number(r.task_count ?? 0),
});

const SELECT = sql`
  SELECT o.id, o.uuid, o.name, o.sort_order, o.is_active, o.row_version, o.created_at, o.updated_at,
         (SELECT count(*) FROM tasks t WHERE t.org_id = o.org_id AND t.outcome_id = o.id)::int AS task_count
  FROM task_outcomes o
`;

/** Data access for the task outcome list. Every query carries the org: RLS is the backstop, not the filter. */
@Injectable()
export class TaskOutcomesRepository {
  async list(tx: Tx, orgId: number, activeOnly: boolean): Promise<TaskOutcomeRow[]> {
    const res = await tx.execute(sql`
      ${SELECT} WHERE o.org_id = ${orgId} ${activeOnly ? sql`AND o.is_active` : sql``}
      ORDER BY o.sort_order, o.id
    `);
    return (res.rows as Raw[]).map(toOutcome);
  }

  async byUuid(tx: Tx, orgId: number, uuid: string): Promise<TaskOutcomeRow | undefined> {
    const res = await tx.execute(sql`${SELECT} WHERE o.org_id = ${orgId} AND o.uuid = ${uuid}::uuid`);
    const r = (res.rows as Raw[])[0];
    return r ? toOutcome(r) : undefined;
  }

  async byName(tx: Tx, orgId: number, name: string): Promise<TaskOutcomeRow | undefined> {
    const res = await tx.execute(
      sql`${SELECT} WHERE o.org_id = ${orgId} AND lower(btrim(o.name)) = lower(btrim(${name}))`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? toOutcome(r) : undefined;
  }

  async maxOrder(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(
      sql`SELECT coalesce(max(sort_order), -1)::int AS m FROM task_outcomes WHERE org_id = ${orgId}`,
    );
    return Number((res.rows[0] as { m: number }).m);
  }

  async insert(
    tx: Tx,
    orgId: number,
    v: { name: string; isActive: boolean; sortOrder: number },
  ): Promise<{ id: number; uuid: string }> {
    const res = await tx.execute(sql`
      INSERT INTO task_outcomes (org_id, name, is_active, sort_order)
      VALUES (${orgId}, ${v.name}, ${v.isActive}, ${v.sortOrder}) RETURNING id, uuid
    `);
    const r = res.rows[0] as { id: number | string; uuid: string };
    return { id: Number(r.id), uuid: r.uuid };
  }

  /** The optimistic lock is the `row_version` in the WHERE: zero rows back means somebody else wrote first. */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    expectedVersion: number,
    patch: { name?: string; isActive?: boolean },
  ): Promise<boolean> {
    const sets = [];
    if (patch.name !== undefined) sets.push(sql`name = ${patch.name}`);
    if (patch.isActive !== undefined) sets.push(sql`is_active = ${patch.isActive}`);
    if (sets.length === 0) sets.push(sql`updated_at = now()`);
    const res = await tx.execute(sql`
      UPDATE task_outcomes SET ${sql.join(sets, sql`, `)}
      WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${expectedVersion} RETURNING id
    `);
    return res.rows.length > 0;
  }

  async setOrder(tx: Tx, orgId: number, ids: number[]): Promise<void> {
    await tx.execute(sql`
      UPDATE task_outcomes o SET sort_order = x.ord
      FROM unnest(${sql.raw(`ARRAY[${ids.map(Number).join(',')}]::bigint[]`)}) WITH ORDINALITY AS x(id, ord)
      WHERE o.org_id = ${orgId} AND o.id = x.id
    `);
  }

  async delete(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM task_outcomes WHERE org_id = ${orgId} AND id = ${id}`);
  }
}
