import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type {
  ActivityOptionRef,
  RecordScope,
  TaskBucket,
  TaskDueFilter,
  TaskKind,
  TaskPriority,
  TaskSort,
  TaskSource,
  TaskStatus,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { optionRefColumns, optionRefFrom } from '../activity-types/activity-option-ref';
import { decodeTaskCursor } from './task-rules';

/** One task as the SQL returns it, with the people and the linked records already joined (names only, never ids). */
export interface TaskRow {
  id: number;
  uuid: string;
  createdAtIso: string;
  createdAt: Date;
  updatedAt: Date;
  /** The keyset key of the due and done orders (`infinity` / `-infinity` when the stamp is missing). */
  dueKey: string;
  doneKey: string;
  title: string;
  /** Encrypted at rest; the service decrypts. */
  notesCipher: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  source: TaskSource;
  kind: TaskKind;
  dueAt: Date | null;
  doneAt: Date | null;
  remindedAt: Date | null;
  bucket: TaskBucket | null;
  rowVersion: number;
  assigneeId: number | null;
  assigneeUuid: string | null;
  assigneeName: string | null;
  createdById: number | null;
  createdByUuid: string | null;
  createdByName: string | null;
  contactId: number | null;
  contactUuid: string | null;
  contactName: string | null;
  dealId: number | null;
  dealUuid: string | null;
  dealTitle: string | null;
  companyId: number | null;
  companyUuid: string | null;
  companyName: string | null;
  outcomeId: number | null;
  outcomeUuid: string | null;
  outcomeName: string | null;
  outcomeActive: boolean | null;
  /** Sales activities settings: the task type (readable even after it was removed from the list). */
  taskTypeId: number | null;
  taskType: ActivityOptionRef | null;
}

type Raw = Record<string, unknown>;
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const s = (v: unknown): string | null => (v === null || v === undefined ? null : (v as string));
const d = (v: unknown): Date | null => (v ? new Date(v as string) : null);

const toRow = (r: Raw): TaskRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  createdAtIso: r.created_at_iso as string,
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
  // to_char of an infinite timestamp is not a usable key: a missing stamp is the literal the cursor decoder knows.
  dueKey: r.due_at ? (r.due_key as string) : 'infinity',
  doneKey: r.done_at ? (r.done_key as string) : '-infinity',
  title: r.title as string,
  notesCipher: s(r.notes),
  priority: r.priority as TaskPriority,
  status: r.status as TaskStatus,
  source: r.source as TaskSource,
  kind: r.kind as TaskKind,
  dueAt: d(r.due_at),
  doneAt: d(r.done_at),
  remindedAt: d(r.reminded_at),
  bucket: (r.bucket as TaskBucket | null) ?? null,
  rowVersion: Number(r.row_version),
  assigneeId: n(r.assignee_id),
  assigneeUuid: s(r.assignee_uuid),
  assigneeName: s(r.assignee_name),
  createdById: n(r.created_by),
  createdByUuid: s(r.created_by_uuid),
  createdByName: s(r.created_by_name),
  contactId: n(r.contact_id),
  contactUuid: s(r.contact_uuid),
  contactName: s(r.contact_name),
  dealId: n(r.deal_id),
  dealUuid: s(r.deal_uuid),
  dealTitle: s(r.deal_title),
  companyId: n(r.company_id),
  companyUuid: s(r.company_uuid),
  companyName: s(r.company_name),
  taskTypeId: n(r.task_type_id),
  taskType: optionRefFrom(r, 'task_type'),
  outcomeId: n(r.outcome_id),
  outcomeUuid: s(r.outcome_uuid),
  outcomeName: s(r.outcome_name),
  outcomeActive:
    r.outcome_active === null || r.outcome_active === undefined ? null : Boolean(r.outcome_active),
});

const ISO = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

/** The start of the NEXT day in the workspace's zone, as an instant: the edge between "today" and "upcoming". */
const dayEndSql = (tz: string) =>
  sql`((date_trunc('day', now() AT TIME ZONE ${tz}) + interval '1 day') AT TIME ZONE ${tz})`;

/** The bucket of an open task, the same split as `bucketOf` in task-rules. */
const bucketSql = (tz: string) => sql`
  CASE WHEN t.status <> 'open' THEN NULL
       WHEN t.due_at IS NULL THEN 'no_date'
       WHEN t.due_at < now() THEN 'overdue'
       WHEN t.due_at < ${dayEndSql(tz)} THEN 'today'
       ELSE 'upcoming' END`;

const selectSql = (tz: string) => sql`
  SELECT t.id, t.uuid,
         to_char(t.created_at at time zone 'UTC', ${sql.raw(ISO)}) AS created_at_iso,
         to_char(coalesce(t.due_at, 'infinity'::timestamptz) at time zone 'UTC', ${sql.raw(ISO)}) AS due_key,
         to_char(coalesce(t.done_at, '-infinity'::timestamptz) at time zone 'UTC', ${sql.raw(ISO)}) AS done_key,
         t.created_at, t.updated_at, t.title, t.notes, t.priority, t.status, t.source, t.kind,
         t.due_at, t.done_at, t.reminded_at, t.row_version, ${bucketSql(tz)} AS bucket,
         t.assignee_id, au.uuid AS assignee_uuid, au.full_name AS assignee_name,
         t.created_by, cu.uuid AS created_by_uuid, cu.full_name AS created_by_name,
         t.contact_id, c.uuid AS contact_uuid, c.name AS contact_name,
         t.deal_id, dl.uuid AS deal_uuid, dl.title AS deal_title,
         t.company_id, co.uuid AS company_uuid, co.name AS company_name,
         t.outcome_id, oc.uuid AS outcome_uuid, oc.name AS outcome_name, oc.is_active AS outcome_active,
         t.task_type_id, ${optionRefColumns('tto', 'tta', 'task_type')}
  FROM tasks t
  LEFT JOIN users au ON au.org_id = t.org_id AND au.id = t.assignee_id
  LEFT JOIN users cu ON cu.org_id = t.org_id AND cu.id = t.created_by
  LEFT JOIN contacts c ON c.org_id = t.org_id AND c.id = t.contact_id
  LEFT JOIN deals dl ON dl.org_id = t.org_id AND dl.id = t.deal_id
  LEFT JOIN companies co ON co.org_id = t.org_id AND co.id = t.company_id
  LEFT JOIN task_outcomes oc ON oc.org_id = t.org_id AND oc.id = t.outcome_id
  LEFT JOIN activity_type_options tto ON tto.org_id = t.org_id AND tto.id = t.task_type_id
  LEFT JOIN activity_types tta ON tta.org_id = tto.org_id AND tta.id = tto.activity_type_id
`;

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * The record scope of a task is a condition on the PEOPLE of the task: `own` is "assigned to me or created by me" (so the person
 * who hands a task to a colleague keeps sight of it), `team` adds everyone who shares a team with me, `all` adds nothing.
 */
export function taskScopeCondition(
  orgId: number,
  scope: RecordScope,
  actorUserId: number | null,
): SQL | undefined {
  if (scope === 'all') return undefined;
  if (!actorUserId) return sql`false`;
  const own = sql`(t.assignee_id = ${actorUserId} OR t.created_by = ${actorUserId})`;
  if (scope === 'own') return own;
  const peers = sql`(SELECT tm2.user_id FROM team_members tm1
      JOIN team_members tm2 ON tm2.org_id = tm1.org_id AND tm2.team_id = tm1.team_id
      WHERE tm1.org_id = ${orgId} AND tm1.user_id = ${actorUserId})`;
  return sql`(${own} OR t.assignee_id IN ${peers} OR t.created_by IN ${peers})`;
}

/** A filter with every uuid already resolved to the internal id the SQL needs. */
export interface TaskFilter {
  q?: string;
  priority?: TaskPriority[];
  assigneeId?: number;
  unassigned?: boolean;
  contactId?: number;
  dealId?: number;
  companyId?: number;
  outcomeId?: number;
}

export interface TaskListInput {
  filter: TaskFilter;
  scope?: SQL;
  status: 'open' | 'done' | 'all';
  due?: TaskDueFilter;
  dueFrom?: string;
  dueTo?: string;
  sort: TaskSort;
  cursor?: string;
  limit: number;
  tz: string;
}

function filterConds(orgId: number, f: TaskFilter, scope?: SQL): SQL[] {
  const conds: SQL[] = [sql`t.org_id = ${orgId}`];
  if (scope) conds.push(scope);
  if (f.q) conds.push(sql`t.title ILIKE ${`%${escapeLike(f.q)}%`}`);
  if (f.priority?.length)
    conds.push(
      sql`t.priority IN (${sql.join(
        f.priority.map((p) => sql`${p}`),
        sql`, `,
      )})`,
    );
  if (f.assigneeId !== undefined) conds.push(sql`t.assignee_id = ${f.assigneeId}`);
  if (f.unassigned) conds.push(sql`t.assignee_id IS NULL`);
  if (f.contactId !== undefined) conds.push(sql`t.contact_id = ${f.contactId}`);
  if (f.dealId !== undefined) conds.push(sql`t.deal_id = ${f.dealId}`);
  if (f.companyId !== undefined) conds.push(sql`t.company_id = ${f.companyId}`);
  if (f.outcomeId !== undefined) conds.push(sql`t.outcome_id = ${f.outcomeId}`);
  return conds;
}

/** What the order is made of: the key expression, its direction, and the key a row carries for the next cursor. */
const ORDERS: Record<
  TaskSort,
  { key: SQL; asc: boolean; rowKey: 'dueKey' | 'doneKey' | 'createdAtIso' }
> = {
  due: { key: sql`coalesce(t.due_at, 'infinity'::timestamptz)`, asc: true, rowKey: 'dueKey' },
  created: { key: sql`t.created_at`, asc: false, rowKey: 'createdAtIso' },
  completed: {
    key: sql`coalesce(t.done_at, '-infinity'::timestamptz)`,
    asc: false,
    rowKey: 'doneKey',
  },
};
export const sortKeyOf = (sort: TaskSort, row: TaskRow): string => row[ORDERS[sort].rowKey];

export interface TaskCounts {
  overdue: number;
  today: number;
  upcoming: number;
  noDate: number;
  done: number;
}

export interface TaskPatch {
  title?: string;
  notes?: string | null;
  priority?: TaskPriority;
  due_at?: Date | null;
  assignee_id?: number | null;
  contact_id?: number | null;
  deal_id?: number | null;
  company_id?: number | null;
  outcome_id?: number | null;
  task_type_id?: number | null;
  /** The completed time of a done task (only when the Task activity allows editing it). */
  done_at?: Date;
  /** Set when the due date moves: the reminder arms again. */
  clearReminder?: boolean;
}

/** Data access for tasks. Every query carries the org: RLS is the backstop, not the filter. */
@Injectable()
export class TasksRepository {
  async list(tx: Tx, orgId: number, input: TaskListInput): Promise<TaskRow[]> {
    const conds = filterConds(orgId, input.filter, input.scope);
    if (input.status !== 'all') conds.push(sql`t.status = ${input.status}`);
    // A due-window filter is about open tasks: a done task has no clock to be late against.
    if (input.due || input.dueFrom || input.dueTo) conds.push(sql`t.status = 'open'`);
    if (input.due === 'overdue') conds.push(sql`t.due_at < now()`);
    if (input.due === 'today')
      conds.push(sql`(t.due_at >= now() AND t.due_at < ${dayEndSql(input.tz)})`);
    if (input.due === 'upcoming') conds.push(sql`t.due_at >= ${dayEndSql(input.tz)}`);
    if (input.due === 'none') conds.push(sql`t.due_at IS NULL`);
    if (input.dueFrom) conds.push(sql`t.due_at >= ${input.dueFrom}::timestamptz`);
    if (input.dueTo) conds.push(sql`t.due_at < ${input.dueTo}::timestamptz`);

    const order = ORDERS[input.sort];
    if (input.cursor) {
      const c = decodeTaskCursor(input.cursor, input.sort);
      const cmp = order.asc ? sql`>` : sql`<`;
      conds.push(
        sql`(${order.key} ${cmp} ${c.key}::timestamptz OR (${order.key} = ${c.key}::timestamptz AND t.id ${cmp} ${c.id}))`,
      );
    }
    const dir = order.asc ? sql`ASC` : sql`DESC`;
    const res = await tx.execute(sql`
      ${selectSql(input.tz)} WHERE ${sql.join(conds, sql` AND `)}
      ORDER BY ${order.key} ${dir}, t.id ${dir} LIMIT ${input.limit + 1}
    `);
    return (res.rows as Raw[]).map(toRow);
  }

  /** One round trip for the four open buckets and the done total, inside the filter. */
  async counts(
    tx: Tx,
    orgId: number,
    filter: TaskFilter,
    scope: SQL | undefined,
    tz: string,
  ): Promise<TaskCounts> {
    const conds = filterConds(orgId, filter, scope);
    const edge = dayEndSql(tz);
    const res = await tx.execute(sql`
      SELECT
        count(*) FILTER (WHERE t.status = 'open' AND t.due_at < now())::int AS overdue,
        count(*) FILTER (WHERE t.status = 'open' AND t.due_at >= now() AND t.due_at < ${edge})::int AS today,
        count(*) FILTER (WHERE t.status = 'open' AND t.due_at >= ${edge})::int AS upcoming,
        count(*) FILTER (WHERE t.status = 'open' AND t.due_at IS NULL)::int AS no_date,
        count(*) FILTER (WHERE t.status = 'done')::int AS done
      FROM tasks t WHERE ${sql.join(conds, sql` AND `)}
    `);
    const r = res.rows[0] as Raw;
    return {
      overdue: Number(r.overdue),
      today: Number(r.today),
      upcoming: Number(r.upcoming),
      noDate: Number(r.no_date),
      done: Number(r.done),
    };
  }

  async findByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
    tz: string,
    forUpdate = false,
  ): Promise<TaskRow | undefined> {
    // FOR UPDATE cannot lock the outer-joined side, so lock the task row alone and read the joined shape after.
    if (forUpdate) {
      await tx.execute(
        sql`SELECT 1 FROM tasks WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid FOR UPDATE`,
      );
    }
    const res = await tx.execute(
      sql`${selectSql(tz)} WHERE t.org_id = ${orgId} AND t.uuid = ${uuid}::uuid`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async findById(tx: Tx, orgId: number, id: number, tz: string): Promise<TaskRow | undefined> {
    const res = await tx.execute(sql`${selectSql(tz)} WHERE t.org_id = ${orgId} AND t.id = ${id}`);
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : undefined;
  }

  async insert(
    tx: Tx,
    orgId: number,
    v: {
      title: string;
      notesCipher: string | null;
      priority: TaskPriority;
      dueAt: Date | null;
      assigneeId: number | null;
      createdBy: number | null;
      contactId: number | null;
      dealId: number | null;
      companyId: number | null;
      outcomeId?: number | null;
      taskTypeId?: number | null;
      source: TaskSource;
      kind?: TaskKind;
    },
  ): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO tasks (org_id, title, notes, priority, due_at, assignee_id, created_by, contact_id, deal_id, company_id, outcome_id, source, kind, task_type_id)
      VALUES (${orgId}, ${v.title}, ${v.notesCipher}, ${v.priority}, ${v.dueAt}, ${v.assigneeId}, ${v.createdBy},
              ${v.contactId}, ${v.dealId}, ${v.companyId}, ${v.outcomeId ?? null}, ${v.source}, ${v.kind ?? 'task'}, ${v.taskTypeId ?? null})
      RETURNING id
    `);
    return Number((res.rows[0] as { id: number | string }).id);
  }

  /** The contact's one open follow-up (BL-291), or undefined. */
  async openFollowUpId(tx: Tx, orgId: number, contactId: number): Promise<number | undefined> {
    const res = await tx.execute(sql`
      SELECT id FROM tasks
      WHERE org_id = ${orgId} AND contact_id = ${contactId} AND kind = 'follow_up' AND status = 'open'
      LIMIT 1
    `);
    const r = res.rows[0] as { id: number | string } | undefined;
    return r ? Number(r.id) : undefined;
  }

  /** Serialises writers of one contact's follow-up (the unique index is the last line; this keeps the loser from erroring). */
  async lockFollowUp(tx: Tx, orgId: number, contactId: number): Promise<void> {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`follow-up:${orgId}:${contactId}`}, 0))`,
    );
  }

  /** The optimistic lock is the `row_version` in the WHERE: zero rows back means somebody else wrote first. */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    expectedVersion: number | undefined,
    patch: TaskPatch,
  ): Promise<boolean> {
    const sets: SQL[] = [];
    const add = (col: string, value: unknown) => sets.push(sql`${sql.raw(col)} = ${value}`);
    if (patch.title !== undefined) add('title', patch.title);
    if (patch.notes !== undefined) add('notes', patch.notes);
    if (patch.priority !== undefined) add('priority', patch.priority);
    if (patch.due_at !== undefined) add('due_at', patch.due_at);
    if (patch.assignee_id !== undefined) add('assignee_id', patch.assignee_id);
    if (patch.contact_id !== undefined) add('contact_id', patch.contact_id);
    if (patch.deal_id !== undefined) add('deal_id', patch.deal_id);
    if (patch.company_id !== undefined) add('company_id', patch.company_id);
    if (patch.outcome_id !== undefined) add('outcome_id', patch.outcome_id);
    if (patch.task_type_id !== undefined) add('task_type_id', patch.task_type_id);
    if (patch.done_at !== undefined) add('done_at', patch.done_at);
    if (patch.clearReminder) sets.push(sql`reminded_at = NULL`);
    if (sets.length === 0) sets.push(sql`updated_at = now()`);
    const res = await tx.execute(sql`
      UPDATE tasks SET ${sql.join(sets, sql`, `)}
      WHERE org_id = ${orgId} AND id = ${id}
      ${expectedVersion !== undefined ? sql`AND row_version = ${expectedVersion}` : sql``}
      RETURNING id
    `);
    return res.rows.length > 0;
  }

  /** Done stamps and the status move together (the table has a CHECK that they agree). Reopening re-arms the reminder. */
  async setDone(
    tx: Tx,
    orgId: number,
    id: number,
    done: boolean,
    /** Completing only: the outcome to record (`null` clears it); undefined keeps what the task has. */
    outcomeId?: number | null,
  ): Promise<void> {
    await tx.execute(
      done
        ? sql`UPDATE tasks SET status = 'done', done_at = now()${
            outcomeId !== undefined ? sql`, outcome_id = ${outcomeId}` : sql``
          } WHERE org_id = ${orgId} AND id = ${id}`
        : sql`UPDATE tasks SET status = 'open', done_at = NULL, reminded_at = NULL WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  async deleteById(tx: Tx, orgId: number, id: number): Promise<boolean> {
    const res = await tx.execute(
      sql`DELETE FROM tasks WHERE org_id = ${orgId} AND id = ${id} RETURNING id`,
    );
    return res.rows.length > 0;
  }

  // --- the deal timeline's mirror ---------------------------------------------------------------------------------------------

  /** The timeline task that mirrors a task, kept in step with it (done stamp, due date, assignee). */
  async syncActivity(
    tx: Tx,
    orgId: number,
    taskId: number,
    patch: { done?: boolean; dueAt?: Date | null; assigneeId?: number | null },
  ): Promise<void> {
    const sets: SQL[] = [];
    if (patch.done === true) sets.push(sql`done_at = coalesce(done_at, now())`);
    if (patch.done === false) sets.push(sql`done_at = NULL`, sql`reminded_at = NULL`);
    if (patch.dueAt !== undefined) sets.push(sql`due_at = ${patch.dueAt}`, sql`reminded_at = NULL`);
    if (patch.assigneeId !== undefined) sets.push(sql`assignee_user_id = ${patch.assigneeId}`);
    if (sets.length === 0) return;
    await tx.execute(sql`
      UPDATE deal_activities SET ${sql.join(sets, sql`, `)}
      WHERE org_id = ${orgId} AND task_id = ${taskId} AND type = 'task'
    `);
  }

  async linkActivity(tx: Tx, orgId: number, activityId: number, taskId: number): Promise<void> {
    await tx.execute(
      sql`UPDATE deal_activities SET task_id = ${taskId} WHERE org_id = ${orgId} AND id = ${activityId}`,
    );
  }

  /** The task that mirrors a timeline task, if it still exists. */
  async taskOfActivity(tx: Tx, orgId: number, activityId: number): Promise<number | undefined> {
    const res = await tx.execute(
      sql`SELECT task_id FROM deal_activities WHERE org_id = ${orgId} AND id = ${activityId} AND task_id IS NOT NULL`,
    );
    const r = res.rows[0] as { task_id: number | string } | undefined;
    return r ? Number(r.task_id) : undefined;
  }

  // --- references ----------------------------------------------------------------------------------------------------------------

  /** An ACTIVE member of this workspace by uuid: the only kind of user a task can be assigned to. */
  async resolveActiveUser(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<{ id: number; name: string } | undefined> {
    const res = await tx.execute(
      sql`SELECT id, full_name FROM users WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid AND status = 'active'`,
    );
    const r = res.rows[0] as { id: number | string; full_name: string } | undefined;
    return r ? { id: Number(r.id), name: r.full_name } : undefined;
  }

  /** Any user (active or not) by uuid, for filters: an ex-member's old tasks are still filterable. */
  async resolveUserId(tx: Tx, orgId: number, uuid: string): Promise<number | undefined> {
    const res = await tx.execute(
      sql`SELECT id FROM users WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as { id: number | string } | undefined;
    return r ? Number(r.id) : undefined;
  }

  async resolveContact(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<{ id: number; companyId: number | null } | undefined> {
    const res = await tx.execute(
      sql`SELECT id, company_id FROM contacts WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as
      { id: number | string; company_id: number | string | null } | undefined;
    return r ? { id: Number(r.id), companyId: n(r.company_id) } : undefined;
  }

  async resolveDeal(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<{ id: number; contactId: number | null; companyId: number | null } | undefined> {
    const res = await tx.execute(
      sql`SELECT id, contact_id, company_id FROM deals WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as
      | {
          id: number | string;
          contact_id: number | string | null;
          company_id: number | string | null;
        }
      | undefined;
    return r
      ? { id: Number(r.id), contactId: n(r.contact_id), companyId: n(r.company_id) }
      : undefined;
  }

  /** An outcome of this workspace by uuid, whether or not it is active (the service decides what an inactive one may do). */
  async resolveOutcome(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<{ id: number; isActive: boolean } | undefined> {
    const res = await tx.execute(
      sql`SELECT id, is_active FROM task_outcomes WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as { id: number | string; is_active: boolean } | undefined;
    return r ? { id: Number(r.id), isActive: r.is_active } : undefined;
  }

  async resolveCompanyId(tx: Tx, orgId: number, uuid: string): Promise<number | undefined> {
    const res = await tx.execute(
      sql`SELECT id FROM companies WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as { id: number | string } | undefined;
    return r ? Number(r.id) : undefined;
  }

  /** True if `userId` is on a team `actorUserId` is also on: the 'team' record-scope check for one task. */
  async isInActorTeam(
    tx: Tx,
    orgId: number,
    actorUserId: number,
    userId: number,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT 1 FROM team_members tm1
      JOIN team_members tm2 ON tm2.org_id = tm1.org_id AND tm2.team_id = tm1.team_id
      WHERE tm1.org_id = ${orgId} AND tm1.user_id = ${actorUserId} AND tm2.user_id = ${userId}
      LIMIT 1
    `);
    return res.rows.length > 0;
  }

  /** The workspace's time zone for the day buckets (UTC when it has none). */
  async timezone(tx: Tx, orgId: number): Promise<string | null> {
    const res = await tx.execute(
      sql`SELECT settings ->> 'timezone' AS timezone FROM organizations WHERE id = ${orgId}`,
    );
    return (res.rows[0] as { timezone: string | null } | undefined)?.timezone ?? null;
  }
}
