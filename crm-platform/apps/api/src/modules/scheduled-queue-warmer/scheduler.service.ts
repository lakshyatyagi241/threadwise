import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { sql } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import { DatabaseService } from '../../infra/db/database.service';
import { QUEUES } from '../../infra/queue/queues';
import type { ScheduledRunJob } from './scheduled-run.processor';

/**
 * Pause, resume, cancel and send-now for a scheduled message (TW-NODE-034). Reference's bridge did this by stopping and
 * restarting an in-memory cron task, and needed the Node id Laravel stored; here the row is the schedule, so the lifecycle
 * is a status change plus removing a queued job. A run already in progress notices a pause or cancel before its next batch.
 *
 * Each method returns whether it changed anything: a repeat, or a status it does not apply to, is a quiet no.
 * Must run inside a request context for the organization (the SCHED screens call it from their own transaction rules).
 */
@Injectable()
export class SchedulerService {
  constructor(
    private readonly db: DatabaseService,
    @InjectQueue(QUEUES.SCHED_RUN) private readonly queue: Queue<ScheduledRunJob>,
  ) {}

  /** Stops a schedule by hand. Unlike a system pause it has no resume time: it waits for `resume`. */
  async pause(orgId: number, scheduledId: number): Promise<boolean> {
    return this.change(
      orgId,
      scheduledId,
      ['scheduled', 'running'],
      'paused',
      sql`next_attempt_at = NULL`,
    );
  }

  /** Puts a paused schedule back in line, to run at once if its time has passed. */
  async resume(orgId: number, scheduledId: number): Promise<boolean> {
    return this.db.tx(async (tx) => {
      const res = await tx.execute(sql`
        UPDATE scheduled_messages
           SET status = 'scheduled', next_attempt_at = NULL, node_schedule_id = NULL,
               next_run_at = greatest(coalesce(next_run_at, scheduled_time), now())
         WHERE org_id = ${orgId} AND id = ${scheduledId} AND status = 'paused' RETURNING id`);
      return res.rows.length > 0;
    });
  }

  /** Ends a schedule that has not finished. Recipients already sent stay sent. */
  async cancel(orgId: number, scheduledId: number): Promise<boolean> {
    const changed = await this.change(
      orgId,
      scheduledId,
      ['scheduled', 'running', 'paused'],
      'cancelled',
      sql`next_attempt_at = NULL`,
    );
    if (changed) await this.dropQueuedJob(orgId, scheduledId);
    return changed;
  }

  /** "Send now" on a schedule that is waiting: it becomes due immediately. */
  async sendNow(orgId: number, scheduledId: number): Promise<boolean> {
    return this.db.tx(async (tx) => {
      const res = await tx.execute(sql`
        UPDATE scheduled_messages SET next_run_at = now()
         WHERE org_id = ${orgId} AND id = ${scheduledId} AND status = 'scheduled' RETURNING id`);
      return res.rows.length > 0;
    });
  }

  private async change(
    orgId: number,
    scheduledId: number,
    from: string[],
    to: string,
    extra: ReturnType<typeof sql>,
  ): Promise<boolean> {
    const changed = await this.db.tx(async (tx) => {
      const res = await tx.execute(sql`
        UPDATE scheduled_messages SET status = ${to}, ${extra}
         WHERE org_id = ${orgId} AND id = ${scheduledId} AND status IN (${sql.join(
           from.map((s) => sql`${s}`),
           sql`, `,
         )})
        RETURNING id`);
      return res.rows.length > 0;
    });
    if (changed && to === 'paused') await this.dropQueuedJob(orgId, scheduledId);
    return changed;
  }

  /** A job that has not started is removed; one that is running finishes its batch and sees the new status. */
  private async dropQueuedJob(orgId: number, scheduledId: number): Promise<void> {
    const node = await this.db.tx(async (tx) => {
      const res = await tx.execute(
        sql`SELECT node_schedule_id FROM scheduled_messages WHERE org_id = ${orgId} AND id = ${scheduledId}`,
      );
      return (res.rows[0] as { node_schedule_id: string | null } | undefined)?.node_schedule_id;
    });
    if (!node?.startsWith('bullmq:')) return;
    const job = await this.queue.getJob(node.slice('bullmq:'.length));
    if (job && ['waiting', 'delayed', 'prioritized'].includes(await job.getState()))
      await job.remove();
  }
}
