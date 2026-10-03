import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { ERROR_CODES, type RetryScheduleInput, type UpdateScheduleInput } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { isKnownTimeZone, wallTimeToUtc } from '../broadcasts';
import { normaliseTime } from './schedule-create.service';
import { SchedulerService } from './scheduler.service';
import { WarmerService } from './warmer/warmer.service';

interface Facts {
  id: number;
  status: string;
  provider: string | null;
  device_id: number | string | null;
  warmer_reserved: number;
  warmer_reserved_day: string | null;
  total_sent: number;
  send_date: string;
  send_time: string;
  timezone: string;
  schedule_type: string;
  row_version: number;
}

const conflict = (message: string): AppError => new AppError(ERROR_CODES.CONFLICT, message, 409);

/**
 * What a person does to a schedule that exists (WD-SCHED-013 to 018): pause, resume, cancel, send now, edit, retry and delete. The
 * lifecycle itself is `SchedulerService`; this adds the rules around it: which statuses allow what, the 2-minute lead time on a new
 * time, and giving back the warmer budget a schedule reserved but did not use.
 */
@Injectable()
export class ScheduleActionsService {
  now: () => Date = () => new Date();

  constructor(
    private readonly db: DatabaseService,
    private readonly scheduler: SchedulerService,
    private readonly warmer: WarmerService,
  ) {}

  async pause(uuid: string): Promise<void> {
    const f = await this.facts(uuid);
    if (!(await this.scheduler.pause(this.org(), f.id)))
      throw conflict('Only a waiting or running schedule can be paused.');
  }

  async resume(uuid: string): Promise<void> {
    const f = await this.facts(uuid);
    if (!(await this.scheduler.resume(this.org(), f.id)))
      throw conflict('Only a paused schedule can be resumed.');
  }

  /** Cancelling gives back the warmer budget the unsent part reserved. */
  async cancel(uuid: string): Promise<void> {
    const f = await this.facts(uuid);
    if (!(await this.scheduler.cancel(this.org(), f.id))) {
      throw conflict(
        'Only a waiting, running or paused schedule can be cancelled. A failed one can be deleted.',
      );
    }
    await this.release(f);
  }

  /** "Run now": the schedule becomes due at once. A waiting, running, paused or failed schedule qualifies; recipients already sent are skipped. */
  async runNow(uuid: string): Promise<void> {
    const f = await this.facts(uuid);
    if (!['scheduled', 'running', 'paused', 'failed'].includes(f.status)) {
      throw conflict('A completed or cancelled schedule cannot be run again. Create a new one.');
    }
    await this.db.tx((tx) =>
      tx.execute(sql`
        UPDATE scheduled_messages
           SET status = 'scheduled', next_run_at = now(), next_attempt_at = NULL, node_schedule_id = NULL,
               failure_reason = NULL, failed_at = NULL, last_error = NULL
         WHERE org_id = ${this.org()} AND id = ${f.id}`),
    );
  }

  /** Name, time and message only, while it is waiting or paused. A new time must still be 2 minutes ahead. */
  async edit(uuid: string, input: UpdateScheduleInput): Promise<void> {
    const f = await this.facts(uuid);
    if (!['scheduled', 'paused'].includes(f.status)) {
      throw conflict('Only a waiting or paused schedule can be edited.');
    }
    const date = input.sendDate ?? f.send_date;
    const time = input.sendTime ? normaliseTime(input.sendTime) : f.send_time;
    const zone = input.timezone ?? f.timezone;
    const timeChanged = input.sendDate || input.sendTime || input.timezone;
    let at: Date | null = null;
    if (timeChanged) {
      if (!isKnownTimeZone(zone))
        throw AppError.validation('Choose a valid timezone.', [
          { path: 'timezone', message: 'Invalid timezone' },
        ]);
      at = wallTimeToUtc(date, time, zone);
      if (at.getTime() < this.now().getTime() + 2 * 60_000) {
        throw AppError.validation('Schedule must be at least 2 minutes from now.', [
          { path: 'sendTime', message: 'Too soon' },
        ]);
      }
    }
    const done = await this.db.tx((tx) =>
      tx.execute(sql`
        UPDATE scheduled_messages SET
          schedule_name = coalesce(${input.name ?? null}, schedule_name),
          message_content = coalesce(${input.message ?? null}, message_content),
          send_date = ${date}::date, send_time = ${time}, timezone = ${zone},
          scheduled_time = coalesce(${at ? at.toISOString() : null}::timestamptz, scheduled_time),
          next_run_at = CASE WHEN ${at !== null} THEN ${at ? at.toISOString() : null}::timestamptz ELSE next_run_at END
        WHERE org_id = ${this.org()} AND id = ${f.id} AND row_version = ${input.rowVersion}
        RETURNING id`),
    );
    if (done.rows.length === 0) throw AppError.rowVersionConflict('Schedule');
  }

  /**
   * Gives a failed (or paused, waiting) schedule a new time. Recipients that failed go back to pending; those already sent stay
   * sent, so a retry never messages the same person twice (WaDesk re-sent to everyone).
   */
  async retry(uuid: string, input: RetryScheduleInput): Promise<void> {
    const f = await this.facts(uuid);
    if (!['failed', 'cancelled', 'paused', 'scheduled', 'running'].includes(f.status)) {
      throw conflict('A completed schedule cannot be retried.');
    }
    const zone = input.timezone ?? f.timezone;
    if (!isKnownTimeZone(zone))
      throw AppError.validation('Choose a valid timezone.', [
        { path: 'timezone', message: 'Invalid timezone' },
      ]);
    const time = normaliseTime(input.sendTime);
    const at = wallTimeToUtc(input.sendDate, time, zone);
    if (at.getTime() < this.now().getTime() + 2 * 60_000) {
      throw AppError.validation('Schedule must be at least 2 minutes from now.', [
        { path: 'sendTime', message: 'Too soon' },
      ]);
    }
    await this.db.tx(async (tx) => {
      await tx.execute(sql`
        UPDATE scheduled_message_contacts SET status = 'pending', error_message = NULL, failed_at = NULL
         WHERE org_id = ${this.org()} AND scheduled_message_id = ${f.id} AND status IN ('failed', 'processing')`);
      await tx.execute(sql`
        UPDATE scheduled_messages
           SET status = 'scheduled', send_date = ${input.sendDate}::date, send_time = ${time}, timezone = ${zone},
               scheduled_time = ${at.toISOString()}::timestamptz, next_run_at = ${at.toISOString()}::timestamptz,
               send_attempts = 0, next_attempt_at = NULL, last_error = NULL, failure_reason = NULL, failed_at = NULL,
               node_schedule_id = NULL, completed_at = NULL
         WHERE org_id = ${this.org()} AND id = ${f.id}`);
    });
  }

  /** Any schedule can be deleted; it stops first so it cannot fire, and its unused warmer budget is given back. */
  async remove(uuid: string): Promise<void> {
    const f = await this.facts(uuid);
    await this.scheduler.cancel(this.org(), f.id);
    await this.db.tx(async (tx) => {
      await this.releaseIn(tx, f);
      await tx.execute(
        sql`DELETE FROM scheduled_messages WHERE org_id = ${this.org()} AND id = ${f.id}`,
      );
    });
  }

  // --- internals ---------------------------------------------------------------------------------

  private org(): number {
    return RequestContextStore.require().orgId;
  }

  private async facts(uuid: string): Promise<Facts> {
    const orgId = this.org();
    const res = await this.db.tx((tx) =>
      tx.execute(sql`
        SELECT id, status, provider, device_id, warmer_reserved, to_char(warmer_reserved_day, 'YYYY-MM-DD') AS warmer_reserved_day,
               total_sent, to_char(send_date, 'YYYY-MM-DD') AS send_date, send_time, timezone, schedule_type, row_version
          FROM scheduled_messages WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`),
    );
    const r = res.rows[0] as unknown as Facts | undefined;
    if (!r) throw AppError.notFound('Schedule', uuid);
    return {
      ...r,
      id: Number(r.id),
      warmer_reserved: Number(r.warmer_reserved),
      total_sent: Number(r.total_sent),
    };
  }

  private release(f: Facts): Promise<void> {
    return this.db.tx((tx) => this.releaseIn(tx, f));
  }

  private async releaseIn(tx: Tx, f: Facts): Promise<void> {
    const unused = Math.max(0, f.warmer_reserved - f.total_sent);
    if (unused > 0 && f.warmer_reserved_day && f.provider && f.device_id !== null) {
      await this.warmer.release(
        tx,
        { engine: f.provider, id: Number(f.device_id) },
        f.warmer_reserved_day,
        unused,
      );
    }
    await tx.execute(
      sql`UPDATE scheduled_messages SET warmer_reserved = 0 WHERE org_id = ${this.org()} AND id = ${f.id}`,
    );
  }
}
