import { Inject, Injectable, Logger } from '@nestjs/common';
import { CALENDAR_BACKFILL_HORIZON_DAYS } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import {
  APPOINTMENT_CALENDAR,
  type CalendarSyncPort,
} from '../../infra/providers/appointments-booking';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { AppointmentCalendarWriter } from './appointment-calendar-writer.service';
import { AppointmentsRepository } from './appointments.repository';

/** Bookings written per pass. A busier workspace is continued by the next job, so one pass is bounded in time and in calls. */
export const BACKFILL_PASS_LIMIT = 200;
/** Calls per page of candidates. */
const PAGE = 50;
/** Bookings refused one after the other before the pass gives up: the refusal is then the account's (a tenant policy, no mailbox), not each booking's. */
const GIVE_UP_AFTER = 5;
/** A pause between two writes: a back-fill is a burst the calendar's rate limit would otherwise meet all at once. */
const PACE_MS = 120;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface BackfillCursor {
  startsAt: string;
  id: number;
}

export interface BackfillReport {
  /** `not_connected`: no calendar can receive events; `ok`: the pass ran (see `moreWaiting`). */
  outcome: 'ok' | 'not_connected';
  looked: number;
  written: number;
  /** Bookings the calendar refused for a reason that retrying will not fix (a malformed request): left for a person, the pass goes on. */
  failed: number;
  /** The pass hit its limit: the next job continues from `next`. */
  moreWaiting: boolean;
  next: BackfillCursor | null;
}

const none = (outcome: BackfillReport['outcome']): BackfillReport => ({
  outcome,
  looked: 0,
  written: 0,
  failed: 0,
  moreWaiting: false,
  next: null,
});

/** The module name of the pass's audit row: it concerns the workspace, so its record id is the workspace's. */
export const BACKFILL_AUDIT_MODULE = 'appointment_calendar_backfill';

/**
 * Back-fill of calendar events (BL-035). Bookings made while no calendar was connected (or while the grant needed reconnecting) have no event,
 * and a replaced account takes its events with it; Reference and the first version of this port said so ("a reconnect does not back-fill").
 * After a connect, a reconnect or a change of the calendar bookings go to, this writes the missing events of the CONFIRMED bookings that have
 * not ended and start within `CALENDAR_BACKFILL_HORIZON_DAYS`. Nothing older and nothing further out is touched.
 *
 * It only calls `AppointmentCalendarWriter.sync`, the one code path a booking change takes, so a back-filled event is the same event a live one
 * would be, and a repeat is harmless: a booking whose event is already in the right calendar is not a candidate, one that is being written by
 * its own outbox event meets the same idempotent write (the event id is derived from the appointment), and the booking is read again at
 * the moment of writing, so one cancelled since is deleted or skipped, never written.
 *
 * A failure that is not the booking's own (the calendar is down, throttling, a grant that just died) stops the pass and is thrown, so the job
 * is retried later with backoff; one booking the calendar rejects is counted and the pass moves on.
 */
@Injectable()
export class CalendarBackfillService {
  private readonly logger = new Logger(CalendarBackfillService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly appts: AppointmentsRepository,
    private readonly writer: AppointmentCalendarWriter,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(APPOINTMENT_CALENDAR) private readonly calendar: CalendarSyncPort,
  ) {}

  /** Where new events go for this workspace, or null when nothing is connected. */
  private async target(orgId: number): Promise<'google' | 'microsoft' | null> {
    const t = this.calendar.writeTarget ? await this.calendar.writeTarget(orgId) : null;
    return t === 'google' || t === 'microsoft' ? t : null;
  }

  /** How many bookings are waiting for an event right now (the settings page's "N upcoming bookings are not in your calendar"). */
  async pending(orgId: number, now: Date = new Date()): Promise<number> {
    const provider = await this.target(orgId);
    if (!provider) return 0;
    const to = new Date(now.getTime() + CALENDAR_BACKFILL_HORIZON_DAYS * 86_400_000);
    return this.db.txAs({ orgId, userId: null }, (tx) =>
      this.appts.backfillCount(tx, orgId, now, to, provider),
    );
  }

  async backfillOrg(
    orgId: number,
    after: BackfillCursor | null = null,
    now: Date = new Date(),
    limit: number = BACKFILL_PASS_LIMIT,
  ): Promise<BackfillReport> {
    return RequestContextStore.run(
      {
        requestId: `calendar-backfill-${orgId}-${now.getTime()}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      () => this.run(orgId, after, now, limit),
    );
  }

  private async run(
    orgId: number,
    from: BackfillCursor | null,
    now: Date,
    limit: number,
  ): Promise<BackfillReport> {
    const provider = await this.target(orgId);
    if (!provider) return none('not_connected');
    const to = new Date(now.getTime() + CALENDAR_BACKFILL_HORIZON_DAYS * 86_400_000);
    const report = none('ok');
    let cursor = from ? { startsAt: new Date(from.startsAt), id: from.id } : null;
    let refusedInARow = 0;

    while (report.looked < limit && refusedInARow < GIVE_UP_AFTER) {
      const page = await this.db.txAs({ orgId, userId: null }, (tx) =>
        this.appts.backfillCandidates(
          tx,
          orgId,
          now,
          to,
          provider,
          Math.min(PAGE, limit - report.looked),
          cursor,
        ),
      );
      if (page.length === 0) break;
      for (const candidate of page) {
        report.looked += 1;
        cursor = { startsAt: candidate.startsAt, id: candidate.id };
        try {
          const done = await this.writer.sync(orgId, candidate.uuid);
          if (done === 'written') report.written += 1;
          refusedInARow = 0;
        } catch (err) {
          // The calendar cannot be asked right now (or the grant just died): the rest would fail the same way. Stop, and let the queue retry.
          if (!isThisBookingsOwn(err)) {
            await this.record(orgId, provider, report);
            throw err;
          }
          report.failed += 1;
          refusedInARow += 1;
          this.logger.warn(
            { orgId, appointment: candidate.uuid, err: String(err) },
            'calendar back-fill: this booking was refused, moving on',
          );
        }
        await sleep(PACE_MS);
        if (refusedInARow >= GIVE_UP_AFTER) break;
      }
    }
    // The pass ended at its limit, not because the candidates ran out: ask whether any are left past the cursor.
    if (report.looked >= limit && refusedInARow < GIVE_UP_AFTER && cursor) {
      const more = await this.db.txAs({ orgId, userId: null }, (tx) =>
        this.appts.backfillCandidates(tx, orgId, now, to, provider, 1, cursor),
      );
      if (more.length > 0) {
        report.moreWaiting = true;
        report.next = { startsAt: cursor.startsAt.toISOString(), id: cursor.id };
      }
    }
    await this.record(orgId, provider, report);
    return report;
  }

  /** One audit row and one event per pass that did something, written together: the trail of "the system wrote N events for this workspace". */
  private async record(
    orgId: number,
    provider: 'google' | 'microsoft',
    report: BackfillReport,
  ): Promise<void> {
    if (report.written === 0 && report.failed === 0) return;
    await this.db.txAs({ orgId, userId: null }, async (tx) => {
      await this.audit.record(tx, {
        module: BACKFILL_AUDIT_MODULE,
        recordId: orgId,
        action: 'update',
        delta: {
          written: { old: 0, new: report.written },
          failed: { old: 0, new: report.failed },
        },
      });
      await this.outbox.emit(tx, {
        orgId,
        aggregateModule: BACKFILL_AUDIT_MODULE,
        aggregateId: orgId,
        eventType: 'appointment_calendar.backfilled',
        payload: {
          provider,
          written: report.written,
          failed: report.failed,
          moreWaiting: report.moreWaiting,
        },
      });
    });
  }
}

/**
 * Whether a write failure belongs to the one booking (the calendar understood the request and refused it) and not to the calendar being
 * unreachable: `retryable` errors (outage, throttling, timeouts, a refused token) say nothing about the booking and stop the pass.
 */
export function isThisBookingsOwn(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { kind?: unknown };
  if (typeof e.kind !== 'string') return false;
  // `forbidden` and `bad_request` are per-event answers; `invalid_*`, `scope`, `api_disabled` are the account's or the platform's.
  return e.kind === 'bad_request' || e.kind === 'forbidden' || e.kind === 'conflict';
}
