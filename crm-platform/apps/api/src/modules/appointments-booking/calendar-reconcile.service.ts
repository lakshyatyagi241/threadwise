import { Inject, Injectable, Logger } from '@nestjs/common';
import { APPOINTMENT_CALENDAR_DRIFTED } from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import {
  APPOINTMENT_CALENDAR,
  GoogleCalendarError,
  type CalendarSyncPort,
} from '../../infra/providers/appointments-booking';
import { AuditService } from '../../kernel/audit/audit.service';
import { APPOINTMENT_MODULE } from './appointment-rules';
import { judgeDrift, nextReconcileDelayMs, type DriftVerdict } from './calendar-drift.rules';
import { GoogleCalendarConnectionRepository } from './google-calendar-connection.repository';
import {
  CalendarNotConnectedError,
  GoogleCalendarTokens,
  grantCovers,
} from './google-calendar-tokens.service';
import { AppointmentsRepository, type AppointmentRow } from './appointments.repository';
import { AppointmentsSupport } from './appointments.support';

/** How far ahead appointments are looked at, and how many one pass looks at: a bounded, gentle read of one workspace's calendar. */
export const RECONCILE_HORIZON_DAYS = 60;
export const RECONCILE_BATCH = 100;
/** An appointment looked at within this long is not read again: with the hour between passes, each is read about once an hour. */
export const RECONCILE_RECHECK_MS = 50 * 60_000;
/** Pause between two reads of one workspace's events, so a pass never bursts against Google's per-user quota. */
const PACE_MS = 150;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface ReconcileReport {
  /**
   * `ok`; `not_connected`: nothing to look at; `needs_reconnect`: the grant died during the pass; `failed`: Google could not be asked;
   * `calendar_missing`: the calendar itself is gone (an error on the connection, no appointment is reported).
   */
  outcome: 'ok' | 'not_connected' | 'needs_reconnect' | 'failed' | 'calendar_missing';
  looked: number;
  inSync: number;
  pending: number;
  drifted: number;
  /** Events Google would not show (forbidden, bad request): marked looked-at, never drift, the pass went on. */
  unreadable: number;
  newlyDrifted: number;
  cleared: number;
}

const empty = (outcome: ReconcileReport['outcome']): ReconcileReport => ({
  outcome,
  looked: 0,
  inSync: 0,
  pending: 0,
  drifted: 0,
  unreadable: 0,
  newlyDrifted: 0,
  cleared: 0,
});

/**
 * Failures that are about ONE event, not about the connection: Google refuses or rejects that event and would answer the next one normally.
 * Everything else (outage, quota, timeout, a refused grant, a missing permission, a disabled API) says nothing about any event and stops the pass.
 */
const PER_EVENT_KINDS: ReadonlySet<string> = new Set(['forbidden', 'bad_request', 'conflict']);

/**
 * The bounded reconcile (TW-GACC-011). Google is NOT the source of truth for an appointment, so this only LOOKS: for one workspace, the
 * confirmed appointments of the next 60 days that have a Google event are read one event at a time (never a watch channel or a sync token),
 * and the result is stored next to the appointment. It never changes, moves or cancels an appointment: a person does that, from the badge.
 *
 *  - an event that no longer matches what we last wrote (deleted, cancelled, missing, moved, other guests) is `drifted`, with the reason; the
 *    FIRST detection writes an audit row and the outbox event that tells the appointment's owner, once;
 *  - an event that matches again (somebody put it back by hand) clears the drift;
 *  - our own changes are never drift: see `judgeDrift` (the comparison is with the last push, and an unpushed appointment is `pending`);
 *  - ONE unreadable event (Google says forbidden or bad request for it) is marked `unreadable` and looked-at, with no notification, and the
 *    pass goes on: it must not blind the workspace's other appointments;
 *  - a 404 for an event is "missing" only when the calendar itself still exists; if the calendar is gone the connection gets an error and
 *    no appointment is reported;
 *  - when Google cannot be asked (outage, quota, a grant that died mid-pass) the pass stops and says nothing about any appointment: "could
 *    not look" is never read as "gone". The workspace's schedule backs off 5, 10, 20 ... minutes up to six hours;
 *  - writes only on a real change: a look that found nothing new is one batched `google_checked_at` update, and the monitoring columns do not
 *    bump `row_version` (migration trigger `touch_appointment`), so staff never get a 409 because of a look.
 */
@Injectable()
export class CalendarReconcileService {
  private readonly logger = new Logger(CalendarReconcileService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly appts: AppointmentsRepository,
    private readonly support: AppointmentsSupport,
    private readonly tokens: GoogleCalendarTokens,
    private readonly connections: GoogleCalendarConnectionRepository,
    private readonly audit: AuditService,
    @Inject(APPOINTMENT_CALENDAR) private readonly calendar: CalendarSyncPort,
  ) {}

  async reconcileOrg(orgId: number, now: Date = new Date()): Promise<ReconcileReport> {
    return RequestContextStore.run(
      {
        requestId: `calendar-reconcile-${orgId}-${now.getTime()}`,
        orgId,
        actorType: 'system',
        actorId: null,
        userId: null,
      },
      () => this.run(orgId, now),
    );
  }

  private async run(orgId: number, now: Date): Promise<ReconcileReport> {
    const conn = await this.tokens.connection(orgId, { fresh: true });
    if (!conn || conn.status !== 'active' || !grantCovers(conn, 'calendar')) {
      await this.schedule(orgId, conn?.id ?? null, { failures: 0, moreWaiting: false, ok: false });
      return empty('not_connected');
    }
    const to = new Date(now.getTime() + RECONCILE_HORIZON_DAYS * 86_400_000);
    const batch = await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.appts.reconcileCandidates(
        tx,
        orgId,
        now,
        to,
        RECONCILE_BATCH,
        new Date(now.getTime() - RECONCILE_RECHECK_MS),
      ),
    );
    const report = empty('ok');
    /** Rows whose look found nothing new: ONE statement at the end sets their `google_checked_at`. */
    const checkedOnly: number[] = [];
    const calendarExists = new Map<string, boolean>();
    const finish = async (outcome: ReconcileReport['outcome']): Promise<ReconcileReport> => {
      if (checkedOnly.length > 0) {
        await this.db.txAs({ orgId, userId: null }, (tx) =>
          this.appts.markChecked(tx, orgId, checkedOnly, now),
        );
      }
      return { ...report, outcome };
    };
    const stop = async (
      outcome: 'needs_reconnect' | 'failed' | 'calendar_missing',
      failures: number,
    ): Promise<ReconcileReport> => {
      await this.schedule(orgId, conn.id, { failures, moreWaiting: failures > 0, ok: false });
      return finish(outcome);
    };
    // The addresses that never appear as a guest of an event (see `judgeDrift`).
    const ignore = [conn.accountEmail ?? ''].filter((a) => a !== '');

    for (const row of batch) {
      const calendarId = row.calendarId ?? conn.calendarId;
      let verdict: DriftVerdict;
      try {
        let event = await this.calendar.readEvent(orgId, calendarId, row.calendarEventId!);
        if (event.kind === 'missing') {
          // A 404 for the event may be a 404 for the whole calendar (deleted, access lost): ask once per calendar before blaming the event.
          let there = calendarExists.get(calendarId);
          if (there === undefined) {
            there = await this.calendar.calendarExists(orgId, calendarId);
            calendarExists.set(calendarId, there);
          }
          if (!there) {
            this.tokens.noteProblem(orgId, 'GOOGLE_NOT_FOUND', 'calendar');
            this.logger.warn(
              { orgId },
              'calendar reconcile stopped: the calendar no longer exists',
            );
            return stop('calendar_missing', conn.reconcileFailures + 1);
          }
          event = { kind: 'missing' };
        }
        verdict = judgeDrift(
          row,
          {
            startsAt: row.googlePushedStartsAt,
            endsAt: row.googlePushedEndsAt,
            attendee: row.googlePushedAttendee,
            etag: row.googleEventEtag,
          },
          event,
          [...ignore, calendarId],
        );
      } catch (err) {
        // A grant that died: stop, and claim nothing about this or any later appointment.
        if (err instanceof CalendarNotConnectedError) return stop('needs_reconnect', 0);
        if (err instanceof GoogleCalendarError) {
          if (PER_EVENT_KINDS.has(err.kind)) {
            verdict = {
              kind: 'unreadable',
              reason: err.kind === 'forbidden' ? 'event_forbidden' : 'event_unreadable',
            };
          } else {
            this.logger.warn(
              { orgId, kind: err.kind, status: err.status },
              'calendar reconcile stopped: Google could not be asked',
            );
            return stop('failed', conn.reconcileFailures + 1);
          }
        } else {
          throw err;
        }
      }
      report.looked += 1;
      const applied = await this.apply(orgId, row, verdict, now);
      if (verdict.kind === 'in_sync') report.inSync += 1;
      if (verdict.kind === 'pending') report.pending += 1;
      if (verdict.kind === 'drifted') report.drifted += 1;
      if (verdict.kind === 'unreadable') report.unreadable += 1;
      if (applied === 'new_drift') report.newlyDrifted += 1;
      if (applied === 'cleared') report.cleared += 1;
      if (applied === 'checked') checkedOnly.push(row.id);
      await sleep(PACE_MS);
    }
    await this.schedule(orgId, conn.id, {
      failures: 0,
      moreWaiting: batch.length >= RECONCILE_BATCH,
      ok: true,
    });
    return finish('ok');
  }

  /**
   * Writes one verdict only when it changes something (a real transition), under the row's lock and only if the appointment is still what
   * was read. A look that changed nothing returns `checked`: the caller batches those into one `google_checked_at` update.
   */
  private async apply(
    orgId: number,
    read: AppointmentRow,
    verdict: DriftVerdict,
    now: Date,
  ): Promise<'new_drift' | 'drift_updated' | 'cleared' | 'transition' | 'checked' | 'stale'> {
    const sameInstant = (a: Date | null, b: Date | null) =>
      (a === null && b === null) || (a !== null && b !== null && a.getTime() === b.getTime());
    // Nothing new to record: no transaction, no write now.
    if (verdict.kind === 'pending') return 'checked';
    if (
      verdict.kind === 'in_sync' &&
      read.googleSyncState === 'in_sync' &&
      (verdict.etag ?? read.googleEventEtag) === read.googleEventEtag
    ) {
      return 'checked';
    }
    if (
      verdict.kind === 'unreadable' &&
      (read.googleSyncState === 'drifted' ||
        (read.googleSyncState === 'unreadable' && read.googleSyncReason === verdict.reason))
    ) {
      return 'checked';
    }
    if (
      verdict.kind === 'drifted' &&
      read.googleSyncState === 'drifted' &&
      read.googleSyncReason === verdict.reason &&
      sameInstant(read.googleDriftStartsAt, verdict.googleStartsAt) &&
      sameInstant(read.googleDriftEndsAt, verdict.googleEndsAt)
    ) {
      return 'checked';
    }

    return this.db.txAs({ orgId, userId: null }, async (tx) => {
      const row = await this.appts.findById(tx, orgId, read.id, true);
      // A person acted while Google was being asked (moved, cancelled, pushed): this look is out of date, the next one will see it.
      if (
        !row ||
        row.status !== 'confirmed' ||
        row.calendarEventId !== read.calendarEventId ||
        row.startsAt.getTime() !== read.startsAt.getTime() ||
        row.endsAt.getTime() !== read.endsAt.getTime() ||
        row.googlePushedAt?.getTime() !== read.googlePushedAt?.getTime()
      ) {
        return 'stale';
      }
      if (verdict.kind === 'in_sync') {
        const wasDrifted = row.googleSyncState === 'drifted';
        await this.appts.update(tx, orgId, row.id, undefined, {
          google_sync_state: 'in_sync',
          google_sync_reason: null,
          google_drift_detected_at: null,
          google_drift_starts_at: null,
          google_drift_ends_at: null,
          // The etag is remembered so the next look can skip the comparison; Google's own churn (a guest answering) is absorbed here.
          google_event_etag: verdict.etag ?? row.googleEventEtag,
          google_checked_at: now,
        });
        if (wasDrifted) {
          await this.audit.record(tx, {
            module: APPOINTMENT_MODULE,
            recordId: row.id,
            action: 'update',
            delta: { googleSync: { old: row.googleSyncReason, new: 'in_sync' } },
          });
          return 'cleared';
        }
        return 'transition';
      }
      if (verdict.kind === 'unreadable') {
        await this.appts.update(tx, orgId, row.id, undefined, {
          google_sync_state: 'unreadable',
          google_sync_reason: verdict.reason,
          google_checked_at: now,
        });
        return 'transition';
      }
      const first = row.googleSyncState !== 'drifted';
      const changedReason = !first && row.googleSyncReason !== verdict.reason;
      await this.appts.update(tx, orgId, row.id, undefined, {
        google_sync_state: 'drifted',
        google_sync_reason: verdict.reason,
        google_drift_detected_at: first ? now : row.googleDriftDetectedAt,
        google_drift_starts_at: verdict.googleStartsAt,
        google_drift_ends_at: verdict.googleEndsAt,
        google_checked_at: now,
      });
      if (!first && !changedReason) return 'transition';
      await this.support.record(tx, row, {
        orgId,
        audit: {
          action: 'update',
          delta: { googleSync: { old: row.googleSyncReason ?? 'in_sync', new: verdict.reason } },
        },
        // One event, one in-app note, when it is first found drifted; a different reason later is a quiet update.
        ...(first
          ? {
              event: {
                type: APPOINTMENT_CALENDAR_DRIFTED,
                extra: {
                  reason: verdict.reason,
                  title: row.title,
                  // The person to tell: the host, else whoever booked it.
                  ownerUserId: row.hostId ?? row.createdById,
                },
              },
            }
          : {}),
      });
      return first ? 'new_drift' : 'drift_updated';
    });
  }

  private async schedule(
    orgId: number,
    connectionId: number | null,
    s: { failures: number; moreWaiting: boolean; ok: boolean },
  ): Promise<void> {
    if (connectionId === null) return;
    const delay = nextReconcileDelayMs({ failures: s.failures, moreWaiting: s.moreWaiting });
    await this.db.txAs({ orgId, userId: null }, (tx) =>
      this.connections.setReconcileSchedule(tx, orgId, connectionId, {
        nextAt: new Date(Date.now() + delay),
        failures: s.failures,
        ran: s.ok,
      }),
    );
  }
}
