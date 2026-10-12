import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

export interface TaskRow {
  id: number;
  uuid: string;
  userId: number | null;
  status: string;
  steps: number;
  confirmedActions: number;
  deniedActions: number;
  taskLength: number;
  route: string;
  promptTokens: number;
  completionTokens: number;
  startedAt: Date;
}

interface RawTask {
  id: number | string;
  uuid: string;
  user_id: number | string | null;
  status: string;
  steps: number;
  confirmed_actions: number;
  denied_actions: number;
  task_length: number;
  route: string;
  prompt_tokens: number | string;
  completion_tokens: number | string;
  started_at: Date | string;
}

const COLUMNS = sql`id, uuid, user_id, status, steps, confirmed_actions, denied_actions, task_length, route,
  prompt_tokens, completion_tokens, started_at`;

const toTask = (r: RawTask): TaskRow => ({
  id: Number(r.id),
  uuid: r.uuid,
  userId: r.user_id === null ? null : Number(r.user_id),
  status: r.status,
  steps: Number(r.steps),
  confirmedActions: Number(r.confirmed_actions),
  deniedActions: Number(r.denied_actions),
  taskLength: Number(r.task_length),
  route: r.route,
  promptTokens: Number(r.prompt_tokens),
  completionTokens: Number(r.completion_tokens),
  startedAt: new Date(r.started_at),
});

/** SQL of the Help assistant. Every statement runs inside the caller's tenant transaction (row-level security) and names `org_id` too. */
@Injectable()
export class HelpAgentRepository {
  async enabled(tx: Tx, orgId: number): Promise<boolean> {
    const res = await tx.execute(
      sql`SELECT enabled FROM help_agent_settings WHERE org_id = ${orgId}`,
    );
    return (res.rows[0] as { enabled: boolean } | undefined)?.enabled === true;
  }

  /** Returns the previous value (false when the workspace never saved). */
  async saveEnabled(
    tx: Tx,
    orgId: number,
    userId: number | null,
    enabled: boolean,
  ): Promise<boolean> {
    const before = await this.enabled(tx, orgId);
    await tx.execute(sql`
      INSERT INTO help_agent_settings (org_id, enabled, updated_by) VALUES (${orgId}, ${enabled}, ${userId})
      ON CONFLICT (org_id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by`);
    return before;
  }

  /** Serialises task starts of one person, so two tabs cannot both pass the caps. */
  async lockUser(tx: Tx, orgId: number, userId: number): Promise<void> {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`help_agent:${orgId}:${userId}`}, 0))`,
    );
  }

  async countStarts(tx: Tx, orgId: number, userId: number | null, since: Date): Promise<number> {
    const res = await tx.execute(
      userId === null
        ? sql`SELECT count(*)::int AS n FROM help_agent_tasks WHERE org_id = ${orgId} AND started_at >= ${since}`
        : sql`SELECT count(*)::int AS n FROM help_agent_tasks
              WHERE org_id = ${orgId} AND user_id = ${userId} AND started_at >= ${since}`,
    );
    return Number((res.rows[0] as { n: number }).n);
  }

  /** Marks the person's tasks still running as abandoned and returns them (their audit event is written by the caller). */
  async abandonRunning(tx: Tx, orgId: number, userId: number): Promise<TaskRow[]> {
    const res = await tx.execute(sql`
      UPDATE help_agent_tasks SET status = 'abandoned', finished_at = now()
      WHERE org_id = ${orgId} AND user_id = ${userId} AND status = 'running'
      RETURNING ${COLUMNS}`);
    return (res.rows as unknown as RawTask[]).map(toTask);
  }

  async insert(
    tx: Tx,
    orgId: number,
    userId: number,
    input: { locale: string; taskLength: number; route: string },
  ): Promise<TaskRow> {
    const res = await tx.execute(sql`
      INSERT INTO help_agent_tasks (org_id, user_id, locale, task_length, route)
      VALUES (${orgId}, ${userId}, ${input.locale}, ${input.taskLength}, ${input.route})
      RETURNING ${COLUMNS}`);
    return toTask(res.rows[0] as unknown as RawTask);
  }

  /** The person's own task by its public id. Another person's or another workspace's id finds nothing. */
  async findOwn(tx: Tx, orgId: number, userId: number, uuid: string): Promise<TaskRow | null> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM help_agent_tasks
      WHERE org_id = ${orgId} AND user_id = ${userId} AND uuid = ${uuid}::uuid`);
    const row = res.rows[0] as unknown as RawTask | undefined;
    return row ? toTask(row) : null;
  }

  /**
   * Takes one step of the budget in the same statement that checks it, so concurrent calls cannot overshoot. Returns the new step number,
   * or null when the task is closed or has used its steps or its tokens.
   */
  async reserveStep(
    tx: Tx,
    orgId: number,
    id: number,
    limits: { maxSteps: number; maxTokens: number },
  ): Promise<number | null> {
    const res = await tx.execute(sql`
      UPDATE help_agent_tasks SET steps = steps + 1, last_step_at = now()
      WHERE org_id = ${orgId} AND id = ${id} AND status = 'running'
        AND steps < ${limits.maxSteps} AND prompt_tokens + completion_tokens < ${limits.maxTokens}
      RETURNING steps`);
    const row = res.rows[0] as { steps: number } | undefined;
    return row ? Number(row.steps) : null;
  }

  async addTokens(
    tx: Tx,
    orgId: number,
    id: number,
    tokens: { prompt: number; completion: number },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE help_agent_tasks
      SET prompt_tokens = prompt_tokens + ${tokens.prompt}, completion_tokens = completion_tokens + ${tokens.completion}
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** Closes a running task. Returns the closed row, or null when it was not running (a second finish changes nothing). */
  async close(
    tx: Tx,
    orgId: number,
    id: number,
    done: { status: string; confirmedActions: number; deniedActions: number },
  ): Promise<TaskRow | null> {
    const res = await tx.execute(sql`
      UPDATE help_agent_tasks
      SET status = ${done.status}, confirmed_actions = ${done.confirmedActions}, denied_actions = ${done.deniedActions},
          finished_at = now()
      WHERE org_id = ${orgId} AND id = ${id} AND status = 'running'
      RETURNING ${COLUMNS}`);
    const row = res.rows[0] as unknown as RawTask | undefined;
    return row ? toTask(row) : null;
  }
}
