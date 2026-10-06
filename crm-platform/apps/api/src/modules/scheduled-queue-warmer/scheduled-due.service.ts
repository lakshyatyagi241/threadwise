import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import type { Queue } from 'bullmq';
import {
  UNOFFICIAL_WHATSAPP_GATE,
  type UnofficialWhatsappGate,
} from '../auth/unofficial-whatsapp.port';
import { scheduledConfig } from '../../config/domains/scheduled-queue-warmer.env';
import { DatabaseService } from '../../infra/db/database.service';
import { QUEUES } from '../../infra/queue/queues';
import { dateOnly, isRecurring, runAt, weekdays, type ScheduledRow } from './scheduled-message';
import { FIRE_NOW_WINDOW_MS, minutesLate, nextRun } from './schedule-time';
import type { ScheduledRunJob } from './scheduled-run.processor';

const BATCH = 50;
/** Bounds the walk past missed occurrences of a recurring schedule (a daily one after a year of downtime). */
const MAX_SKIPS = 1000;

/** BullMQ forbids ':' in a custom job id. */
export const runJobId = (uuid: string, at: Date, attempt: number) =>
  `${uuid}-${at.getTime()}-${attempt}`;

/**
 * Hands every due scheduled message to the run queue (TW-NODE-030, 036).
 *
 * Reference kept a schedule only in the bridge's memory and lost it on a restart; here the row is the schedule and a job is just
 * its next occurrence. The job id is the row's uuid plus the occurrence's time, so queueing twice (a crash between the queue and
 * the commit) is a no-op. The same pass resumes runs the system paused, and queues again any run whose job finished or vanished
 * without the row moving on (the reconciliation job the inventory asks for in place of the boot sync).
 *
 * Runs privileged: due schedules span every tenant, like the outbox drain.
 */
@Injectable()
export class ScheduledDueService {
  private readonly logger = new Logger(ScheduledDueService.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    @InjectQueue(QUEUES.SCHED_RUN) private readonly queue: Queue<ScheduledRunJob>,
    @Inject(UNOFFICIAL_WHATSAPP_GATE) private readonly unofficial: UnofficialWhatsappGate,
  ) {}

  @Interval(3_000)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.tickOnce();
    } catch (err) {
      this.logger.error({ err }, '[SCHED] queueing due schedules failed');
    } finally {
      this.running = false;
    }
  }

  /** Public for tests. */
  async tickOnce(
    now: Date = new Date(),
  ): Promise<{ queued: number; missed: number; resumed: number; requeued: number }> {
    const resumed = await this.resumePaused();
    const { queued, missed } = await this.enqueueDue(now);
    const requeued = await this.requeueStale();
    if (queued + missed + resumed + requeued > 0) {
      this.logger.log({ queued, missed, resumed, requeued }, '[SCHED] due schedules handled');
    }
    return { queued, missed, resumed, requeued };
  }

  /** A run the system paused (daily cap, emergency halt) waits for `next_attempt_at`, then goes again. A hand-paused one has none. */
  private async resumePaused(): Promise<number> {
    return this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        UPDATE scheduled_messages
           SET status = 'scheduled', next_run_at = now(), next_attempt_at = NULL
         WHERE status = 'paused' AND next_attempt_at IS NOT NULL AND next_attempt_at <= now()
         RETURNING id`);
      return res.rows.length;
    });
  }

  private async enqueueDue(now: Date): Promise<{ queued: number; missed: number }> {
    const maxLate = scheduledConfig().SCHED_MAX_LATE_MINUTES;
    // A schedule on the unofficial engine stays `scheduled`, untouched, while it is off (owner decision 2026-10-05).
    const unofficialOn = await this.unofficial.isEnabled();
    return this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        SELECT id, uuid, org_id, status, schedule_type, scheduled_time, next_run_at, timezone, repeat_interval, repeat_every,
               days_of_week, end_date, template_type, message_content, media_file, latitude, longitude, provider, device_id,
               send_attempts
        FROM scheduled_messages
        WHERE status = 'scheduled' AND (provider IS DISTINCT FROM 'baileys' OR ${unofficialOn}::boolean)
          AND coalesce(next_run_at, scheduled_time) <= ${new Date(now.getTime() + FIRE_NOW_WINDOW_MS).toISOString()}::timestamptz
        ORDER BY coalesce(next_run_at, scheduled_time), id LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED`);
      const rows = res.rows as unknown as Array<ScheduledRow & { org_id: number | string }>;
      let queued = 0;
      let missed = 0;
      for (const row of rows) {
        const at = runAt(row);
        const orgId = Number(row.org_id);
        const id = Number(row.id);
        if (minutesLate(at, now) > maxLate) {
          missed++;
          await this.skipMissed(tx, orgId, row, now);
          continue;
        }
        const jobId = runJobId(row.uuid, at, row.send_attempts);
        await this.queue.add('run', { orgId, scheduledId: id }, { jobId });
        await tx.execute(sql`
          UPDATE scheduled_messages SET status = 'running', node_schedule_id = ${`bullmq:${jobId}`}
          WHERE org_id = ${orgId} AND id = ${id}`);
        queued++;
      }
      return { queued, missed };
    });
  }

  /**
   * Past the lateness window (the system was down). A one-off is marked failed and says why (Reference left it `scheduled`
   * for ever); a recurring one does not catch up, it moves to its next future occurrence.
   */
  private async skipMissed(
    tx: Parameters<Parameters<DatabaseService['privileged']>[0]>[0],
    orgId: number,
    row: ScheduledRow,
    now: Date,
  ): Promise<void> {
    const id = Number(row.id);
    if (isRecurring(row)) {
      let next: Date | null = runAt(row);
      for (let i = 0; i < MAX_SKIPS && next && next.getTime() <= now.getTime(); i++) {
        next = nextRun(next, {
          repeatInterval: row.repeat_interval,
          repeatEvery: row.repeat_every ?? 1,
          daysOfWeek: weekdays(row.days_of_week),
          endDate: dateOnly(row.end_date),
          timezone: row.timezone || 'UTC',
        });
      }
      if (next) {
        await tx.execute(sql`
          UPDATE scheduled_messages SET next_run_at = ${next.toISOString()}::timestamptz
          WHERE org_id = ${orgId} AND id = ${id}`);
        return;
      }
      await tx.execute(sql`
        UPDATE scheduled_messages SET status = 'completed', completed_at = now()
        WHERE org_id = ${orgId} AND id = ${id}`);
      return;
    }
    const reason = 'Missed its time: the system was not running when this message was due.';
    await tx.execute(sql`
      UPDATE scheduled_messages SET status = 'failed', failed_at = now(), failure_reason = ${reason}, last_error = ${reason}
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** A `running` row whose job is done or gone: queue it again under a new attempt number. Claims make the repeat safe. */
  private async requeueStale(): Promise<number> {
    const stale = scheduledConfig().SCHED_STALE_RUN_MINUTES;
    return this.db.privileged(async (tx) => {
      const res = await tx.execute(sql`
        SELECT id, uuid, org_id, node_schedule_id, send_attempts, scheduled_time, next_run_at
        FROM scheduled_messages
        WHERE status = 'running' AND updated_at < now() - ${`${stale} minutes`}::interval
        ORDER BY id LIMIT ${BATCH}
        FOR UPDATE SKIP LOCKED`);
      let requeued = 0;
      for (const r of res.rows as unknown as Array<
        ScheduledRow & { org_id: number | string; node_schedule_id: string | null }
      >) {
        const current = r.node_schedule_id?.startsWith('bullmq:')
          ? await this.queue.getJob(r.node_schedule_id.slice('bullmq:'.length))
          : undefined;
        const state = current ? await current.getState() : 'missing';
        if (['active', 'waiting', 'delayed', 'waiting-children', 'prioritized'].includes(state))
          continue;
        const attempt = r.send_attempts + 1;
        const jobId = runJobId(r.uuid, runAt(r), attempt);
        await this.queue.add(
          'run',
          { orgId: Number(r.org_id), scheduledId: Number(r.id) },
          { jobId },
        );
        await tx.execute(sql`
          UPDATE scheduled_messages SET send_attempts = ${attempt}, node_schedule_id = ${`bullmq:${jobId}`}
          WHERE org_id = ${Number(r.org_id)} AND id = ${Number(r.id)}`);
        requeued++;
      }
      return requeued;
    });
  }
}
