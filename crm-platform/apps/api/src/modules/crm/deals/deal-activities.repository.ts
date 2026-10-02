import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { ActivityType } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../../common/errors/app-error';
import { decodeCursor } from '../../../common/pagination/cursor';

export interface StageChangeMeta {
  from: { id: string; name: string } | null;
  to: { id: string; name: string };
}

export interface ActivityRow {
  id: number;
  uuid: string;
  createdAtIso: string;
  createdAt: Date;
  updatedAt: Date;
  dealId: number;
  dealUuid: string;
  dealTitle: string;
  type: ActivityType;
  /** Encrypted at rest; the service decrypts. */
  bodyCipher: string | null;
  meta: StageChangeMeta | null;
  dueAt: Date | null;
  doneAt: Date | null;
  authorUuid: string | null;
  authorName: string | null;
  assigneeUuid: string | null;
  assigneeName: string | null;
  rowVersion: number;
  /** The mirrored row in `tasks` (timeline tasks only), if it still exists. */
  taskId: number | null;
  /** Tasks: the sort key used by the task list cursor. */
  dueKey: string | null;
}

type Raw = Record<string, unknown>;

const toRow = (r: Raw): ActivityRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  createdAtIso: r.created_at_iso as string,
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
  dealId: Number(r.deal_id),
  dealUuid: r.deal_uuid as string,
  dealTitle: r.deal_title as string,
  type: r.type as ActivityType,
  bodyCipher: (r.body as string | null) ?? null,
  meta: (r.meta as StageChangeMeta | null) ?? null,
  dueAt: r.due_at ? new Date(r.due_at as string) : null,
  doneAt: r.done_at ? new Date(r.done_at as string) : null,
  authorUuid: (r.author_uuid as string | null) ?? null,
  authorName: (r.author_name as string | null) ?? null,
  assigneeUuid: (r.assignee_uuid as string | null) ?? null,
  assigneeName: (r.assignee_name as string | null) ?? null,
  rowVersion: Number(r.row_version),
  taskId: r.task_id === null || r.task_id === undefined ? null : Number(r.task_id),
  dueKey: (r.due_key as string | null) ?? null,
});

const SELECT = sql`
  SELECT a.id, a.uuid,
         to_char(a.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso,
         to_char(coalesce(a.due_at, 'infinity'::timestamptz) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS due_key,
         a.created_at, a.updated_at, a.deal_id, d.uuid AS deal_uuid, d.title AS deal_title, a.type, a.body, a.meta,
         a.due_at, a.done_at, a.row_version, a.task_id,
         au.uuid AS author_uuid, au.full_name AS author_name, asg.uuid AS assignee_uuid, asg.full_name AS assignee_name
  FROM deal_activities a
  JOIN deals d ON d.org_id = a.org_id AND d.id = a.deal_id
  LEFT JOIN users au ON au.org_id = a.org_id AND au.id = a.user_id
  LEFT JOIN users asg ON asg.org_id = a.org_id AND asg.id = a.assignee_user_id
`;

/** Data access for the deal timeline and its tasks. */
@Injectable()
export class DealActivitiesRepository {
  /** Newest first, `limit + 1` rows, keyset at microsecond precision. */
  async listForDeal(
    tx: Tx,
    orgId: number,
    dealId: number,
    input: { type?: ActivityType; cursor?: string; limit: number },
  ): Promise<ActivityRow[]> {
    const conds: SQL[] = [sql`a.org_id = ${orgId}`, sql`a.deal_id = ${dealId}`];
    if (input.type) conds.push(sql`a.type = ${input.type}`);
    if (input.cursor) {
      const c = decodeCursor(input.cursor);
      const bound = sql`${c.createdAtIso ?? c.createdAt.toISOString()}::timestamptz`;
      conds.push(sql`(a.created_at < ${bound} OR (a.created_at = ${bound} AND a.id < ${c.id}))`);
    }
    const res = await tx.execute(sql`
      ${SELECT} WHERE ${sql.join(conds, sql` AND `)}
      ORDER BY a.created_at DESC, a.id DESC LIMIT ${input.limit + 1}
    `);
    return (res.rows as Raw[]).map(toRow);
  }

  async findForDeal(
    tx: Tx,
    orgId: number,
    dealId: number,
    uuid: string,
  ): Promise<ActivityRow | undefined> {
    const res = await tx.execute(
      sql`${SELECT} WHERE a.org_id = ${orgId} AND a.deal_id = ${dealId} AND a.uuid = ${uuid}::uuid`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<ActivityRow | undefined> {
    const res = await tx.execute(sql`${SELECT} WHERE a.org_id = ${orgId} AND a.id = ${id}`);
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async insert(
    tx: Tx,
    orgId: number,
    v: {
      dealId: number;
      userId: number | null;
      type: ActivityType;
      bodyCipher: string | null;
      meta?: StageChangeMeta | null;
      dueAt?: Date | null;
      assigneeUserId?: number | null;
    },
  ): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO deal_activities (org_id, deal_id, user_id, type, body, meta, due_at, assignee_user_id)
      VALUES (${orgId}, ${v.dealId}, ${v.userId}, ${v.type}, ${v.bodyCipher},
              ${v.meta ? JSON.stringify(v.meta) : null}::jsonb, ${v.dueAt ?? null}, ${v.assigneeUserId ?? null})
      RETURNING id
    `);
    return Number((res.rows[0] as { id: number | string }).id);
  }

  /**
   * Marks a task done or open. Reopening also clears `reminded_at`, so a reopened overdue task is reminded again (Reference never
   * did). Only tasks of this deal match; zero rows means it is not one.
   */
  async setDone(
    tx: Tx,
    orgId: number,
    dealId: number,
    uuid: string,
    done: boolean,
  ): Promise<number | undefined> {
    const res = await tx.execute(sql`
      UPDATE deal_activities
         SET done_at = ${done ? sql`coalesce(done_at, now())` : sql`NULL`}
             ${done ? sql`` : sql`, reminded_at = NULL`}
       WHERE org_id = ${orgId} AND deal_id = ${dealId} AND uuid = ${uuid}::uuid AND type = 'task'
       RETURNING id
    `);
    const r = res.rows[0] as { id: number | string } | undefined;
    return r ? Number(r.id) : undefined;
  }

  /** Tasks across deals, soonest due first (no due date last), keyset over (due, id). */
  async listTasks(
    tx: Tx,
    orgId: number,
    input: {
      scope?: SQL;
      dealId?: number;
      assigneeId?: number;
      status: 'open' | 'done' | 'all';
      overdue?: boolean;
      cursor?: string;
      limit: number;
    },
  ): Promise<ActivityRow[]> {
    const conds: SQL[] = [sql`a.org_id = ${orgId}`, sql`a.type = 'task'`];
    if (input.scope) conds.push(input.scope);
    if (input.dealId !== undefined) conds.push(sql`a.deal_id = ${input.dealId}`);
    if (input.assigneeId !== undefined) conds.push(sql`a.assignee_user_id = ${input.assigneeId}`);
    if (input.status === 'open') conds.push(sql`a.done_at IS NULL`);
    if (input.status === 'done') conds.push(sql`a.done_at IS NOT NULL`);
    if (input.overdue)
      conds.push(sql`a.done_at IS NULL AND a.due_at IS NOT NULL AND a.due_at < now()`);
    if (input.cursor) {
      const [key, id] = decodeTaskCursor(input.cursor);
      conds.push(
        sql`(coalesce(a.due_at, 'infinity'::timestamptz) > ${key}::timestamptz
            OR (coalesce(a.due_at, 'infinity'::timestamptz) = ${key}::timestamptz AND a.id > ${id}))`,
      );
    }
    const res = await tx.execute(sql`
      ${SELECT} WHERE ${sql.join(conds, sql` AND `)}
      ORDER BY coalesce(a.due_at, 'infinity'::timestamptz) ASC, a.id ASC LIMIT ${input.limit + 1}
    `);
    return (res.rows as Raw[]).map(toRow);
  }
}

export function encodeTaskCursor(row: ActivityRow): string {
  const key = row.dueAt ? row.dueKey : 'infinity';
  return Buffer.from(`${key}|${row.id}`, 'utf8').toString('base64url');
}

function decodeTaskCursor(raw: string): [string, number] {
  try {
    const [key, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
    if (!key || !id || !/^\d+$/.test(id)) throw new Error('malformed');
    if (key !== 'infinity' && Number.isNaN(new Date(key).getTime())) throw new Error('malformed');
    return [key, Number(id)];
  } catch {
    throw new AppError('VALIDATION_FAILED', 'Invalid pagination cursor', 400);
  }
}
