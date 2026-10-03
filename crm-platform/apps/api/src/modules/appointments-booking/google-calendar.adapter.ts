import { Injectable, Logger } from '@nestjs/common';
import { googleCalendarEnv } from '../../config/domains/appointments-booking.env';
import {
  buildEventBody,
  eventIdFor,
  GoogleCalendarClient,
  GoogleCalendarError,
  meetUrlOf,
  withoutOwnEvents,
  type CalendarBusyInterval,
  type CalendarEventRequest,
  type CalendarEventResult,
  type CalendarFreeBusyOptions,
  type CalendarStatus,
  type CalendarSyncPort,
  type GoogleEventResult,
} from '../../infra/providers/appointments-booking';
import { GoogleCalendarConfig } from './google-calendar-config.service';
import { CalendarNotConnectedError, GoogleCalendarTokens } from './google-calendar-tokens.service';

/** Meet rooms are made by Google a moment after the event: one more look, then the booking goes ahead without a link. */
const MEET_RECHECK_MS = 600;
const BUSY_CACHE_MAX = 300;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The calendar port, served by the workspace's Google Calendar (WD-APPT-012, 028, 029; D-08). Bound to `APPOINTMENT_CALENDAR` where the
 * stub used to be: a workspace with no connection behaves exactly as the stub did (nothing connected, nothing written, nothing busy).
 *
 * Writes are idempotent on the appointment: the Google event id is derived from the appointment uuid, so an insert whose answer was lost
 * (the event exists, the id never reached the appointment) is met by Google's 409 on the retry and becomes an update of that same
 * event. A failure throws, and the outbox drain retries it with backoff (the port's contract).
 *
 * Reading busy time is the opposite: it must never hold a booking back. The answer is cached briefly, and after a failure the next
 * calls answer at once for a short while instead of each waiting out Google's timeout. The caller (SlotsService.busyFor) turns the
 * throw into "no busy data" and logs it.
 */
@Injectable()
export class GoogleCalendarAdapter implements CalendarSyncPort {
  readonly provider = 'google';
  private readonly logger = new Logger(GoogleCalendarAdapter.name);
  private readonly busyCache = new Map<string, { at: number; busy: CalendarBusyInterval[] }>();
  private readonly failedAt = new Map<number, number>();

  constructor(
    private readonly tokens: GoogleCalendarTokens,
    private readonly config: GoogleCalendarConfig,
    private readonly client: GoogleCalendarClient,
  ) {}

  /** Connected means events can be written and busy time read right now: a live grant AND a platform client to refresh it with. */
  async status(orgId: number): Promise<CalendarStatus> {
    const conn = await this.tokens.connection(orgId);
    if (!conn) return { connected: false, account: null };
    if (conn.status !== 'active' || !(await this.config.credentials())) {
      return { connected: false, account: conn.accountEmail };
    }
    return { connected: true, account: conn.accountEmail };
  }

  /** Called by the connect service when the grant or the chosen calendar changes: nothing cached for the workspace is true any more. */
  forget(orgId: number): void {
    this.tokens.invalidate(orgId);
    this.failedAt.delete(orgId);
    this.dropBusy(orgId);
  }

  /** A write of ours changes what is busy: do not serve the cached answer for this workspace. */
  private dropBusy(orgId: number): void {
    for (const key of this.busyCache.keys())
      if (key.startsWith(`${orgId}|`)) this.busyCache.delete(key);
  }

  async freeBusy(
    orgId: number,
    calendarId: string | null,
    from: Date,
    to: Date,
    options: CalendarFreeBusyOptions = {},
  ): Promise<CalendarBusyInterval[]> {
    const env = googleCalendarEnv();
    const now = Date.now();
    const failed = this.failedAt.get(orgId);
    if (failed !== undefined && now - failed < env.GOOGLE_BUSY_BACKOFF_SECONDS * 1000) {
      throw new GoogleCalendarError('server', 0, 'backoff', 'Google Calendar failed a moment ago');
    }
    const conn = await this.tokens.connection(orgId);
    if (!conn || conn.status !== 'active') return [];
    const target = calendarId ?? conn.calendarId;

    const key = `${orgId}|${target}|${from.getTime()}|${to.getTime()}|${options.ignoreOwnEvents ? 1 : 0}`;
    const hit = this.busyCache.get(key);
    if (hit && now - hit.at < env.GOOGLE_BUSY_CACHE_SECONDS * 1000) return hit.busy;

    try {
      const busy = await this.tokens.withToken(orgId, async (token) => {
        const all = await this.client.freeBusy(token, target, from, to);
        if (!options.ignoreOwnEvents) return all;
        try {
          const own = await this.client.ownEventIntervals(token, target, from, to);
          return withoutOwnEvents(all, own);
        } catch (err) {
          // Keeping the block is the safe side: a seat is wrongly shown full, never wrongly shown free.
          this.logger.debug(
            { err, orgId },
            'could not list our own events: leaving them in the busy time',
          );
          return all;
        }
      });
      this.remember(key, busy);
      this.failedAt.delete(orgId);
      return busy;
    } catch (err) {
      // "Not connected" is a state, not an outage: nothing to hold the next call back for.
      if (err instanceof CalendarNotConnectedError) return [];
      this.failedAt.set(orgId, Date.now());
      throw err;
    }
  }

  async upsertEvent(req: CalendarEventRequest): Promise<CalendarEventResult | null> {
    const conn = await this.tokens.connection(req.orgId);
    if (!conn || conn.status !== 'active') return null;
    try {
      const result = await this.tokens.withToken(req.orgId, async (token, live) => {
        const calendarId = req.calendarId ?? live.calendarId;
        const eventId = req.existingEventId ?? eventIdFor(req.appointmentId);
        const opts = { conference: req.createMeet, sendUpdates: Boolean(req.attendeeEmail) };
        const insert = () =>
          this.client.insertEvent(token, calendarId, buildEventBody(req, eventId, 'insert'), opts);
        const patch = () =>
          this.client.patchEvent(
            token,
            calendarId,
            eventId,
            buildEventBody(req, eventId, 'patch'),
            opts,
          );

        let event: GoogleEventResult;
        if (req.existingEventId) {
          // Updating in place; an event somebody deleted on the Google side is written again under the same id.
          event = await patch().catch((err: unknown) => {
            if (
              err instanceof GoogleCalendarError &&
              (err.kind === 'not_found' || err.kind === 'gone')
            ) {
              return insert().catch((e: unknown) => this.onConflict(e, patch));
            }
            throw err;
          });
        } else {
          // First write: the fixed id makes a repeat of this insert a 409, which is an update of the event that is already there.
          event = await insert().catch((err: unknown) => this.onConflict(err, patch));
        }

        let meetUrl = meetUrlOf(event);
        if (req.createMeet && !meetUrl) {
          await sleep(MEET_RECHECK_MS);
          meetUrl = meetUrlOf(
            await this.client.getEvent(token, calendarId, event.id ?? eventId).catch(() => null),
          );
        }
        return { eventId: event.id ?? eventId, calendarId, meetUrl } satisfies CalendarEventResult;
      });
      this.dropBusy(req.orgId);
      return result;
    } catch (err) {
      if (err instanceof CalendarNotConnectedError) {
        this.logger.warn(
          { orgId: req.orgId, reason: err.reason },
          'calendar event not written: Google Calendar is not usable',
        );
        return null;
      }
      throw err;
    }
  }

  async deleteEvent(orgId: number, calendarId: string | null, eventId: string): Promise<void> {
    const conn = await this.tokens.connection(orgId);
    if (!conn || conn.status !== 'active') return;
    try {
      await this.tokens.withToken(orgId, (token, live) =>
        this.client.deleteEvent(token, calendarId ?? live.calendarId, eventId),
      );
      this.dropBusy(orgId);
    } catch (err) {
      if (err instanceof CalendarNotConnectedError) {
        this.logger.warn(
          { orgId, reason: err.reason },
          'calendar event not deleted: Google Calendar is not usable',
        );
        return;
      }
      throw err;
    }
  }

  /** An insert that meets 409 found its own event from an earlier try: update it (which also restores one that was deleted). */
  private onConflict(
    err: unknown,
    patch: () => Promise<GoogleEventResult>,
  ): Promise<GoogleEventResult> {
    if (err instanceof GoogleCalendarError && err.kind === 'conflict') return patch();
    throw err;
  }

  private remember(key: string, busy: CalendarBusyInterval[]): void {
    if (this.busyCache.size >= BUSY_CACHE_MAX) {
      const oldest = this.busyCache.keys().next().value;
      if (oldest !== undefined) this.busyCache.delete(oldest);
    }
    this.busyCache.set(key, { at: Date.now(), busy });
  }
}
