import { Injectable, Logger } from '@nestjs/common';
import { microsoftCalendarEnv } from '../../config/domains/microsoft-calendar.env';
import {
  buildGraphEventBody,
  graphEventStateOf,
  joinUrlOf,
  MicrosoftCalendarClient,
  MicrosoftCalendarError,
  withoutOwnEvents,
  type CalendarBusyInterval,
  type CalendarEventRequest,
  type CalendarEventResult,
  type CalendarEventState,
  type CalendarFreeBusyOptions,
  type CalendarStatus,
  type CalendarSyncPort,
  type MicrosoftEventResult,
} from '../../infra/providers/appointments-booking';
import { MicrosoftCalendarConfig } from './microsoft-calendar-config.service';
import type { MicrosoftConnectionRow } from './microsoft-calendar-connection.repository';
import {
  microsoftGrantCovers,
  MicrosoftCalendarTokens,
  MicrosoftNotConnectedError,
} from './microsoft-calendar-tokens.service';

/** A Teams room is made by Graph a moment after the event: one more look, then the booking goes ahead without a link. */
const MEETING_RECHECK_MS = 600;
const BUSY_CACHE_MAX = 300;

const usable = (conn: MicrosoftConnectionRow | null): conn is MicrosoftConnectionRow =>
  conn !== null && conn.status === 'active' && microsoftGrantCovers(conn);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The calendar port, served by the workspace's Outlook / Microsoft 365 calendar (BL-035). A workspace with no connection behaves like the
 * stub (nothing connected, nothing written, nothing busy). Same contract as the Google adapter:
 *
 * Writes are idempotent on the appointment. Graph does not let a client choose an event id, so a create carries `transactionId` (Graph's
 * own key for a repeated POST), and a create that still meets a conflict finds the event by the private property we put on it and
 * updates that one instead. A failure throws, and the outbox drain retries it with backoff.
 *
 * Reading busy time must never hold a booking back: the answer is cached briefly, and after a failure the next calls answer at once for a
 * short while instead of each waiting out Microsoft's timeout. The caller turns the throw into "no busy data" and logs it.
 *
 * "Meet" is a Teams meeting here: a virtual booking type (or `createMeet`) asks Graph for one; a personal Microsoft account that cannot
 * have one is written without the link rather than failing the booking.
 */
@Injectable()
export class MicrosoftCalendarAdapter implements CalendarSyncPort {
  readonly provider = 'microsoft';
  private readonly logger = new Logger(MicrosoftCalendarAdapter.name);
  private readonly busyCache = new Map<string, { at: number; busy: CalendarBusyInterval[] }>();
  private readonly failedAt = new Map<number, number>();

  constructor(
    private readonly tokens: MicrosoftCalendarTokens,
    private readonly config: MicrosoftCalendarConfig,
    private readonly client: MicrosoftCalendarClient,
  ) {}

  /** Connected means events can be written and busy time read right now: a live grant AND a platform app to refresh it with. */
  async status(orgId: number): Promise<CalendarStatus> {
    const conn = await this.tokens.connection(orgId);
    if (!conn) return { connected: false, account: null };
    if (!usable(conn) || !(await this.config.credentials())) {
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
    const env = microsoftCalendarEnv();
    const now = Date.now();
    const failed = this.failedAt.get(orgId);
    if (failed !== undefined && now - failed < env.MICROSOFT_CALENDAR_BUSY_BACKOFF_SECONDS * 1000) {
      throw new MicrosoftCalendarError(
        'server',
        0,
        'backoff',
        'Microsoft Calendar failed a moment ago',
      );
    }
    const conn = await this.tokens.connection(orgId);
    if (!usable(conn)) return [];
    const target = calendarId ?? conn.calendarId;

    const key = `${orgId}|${target}|${from.getTime()}|${to.getTime()}|${options.ignoreOwnEvents ? 1 : 0}`;
    const hit = this.busyCache.get(key);
    if (hit && now - hit.at < env.MICROSOFT_CALENDAR_BUSY_CACHE_SECONDS * 1000) return hit.busy;

    try {
      const busy = await this.tokens.withToken(orgId, async (token) => {
        const { busy: all, own } = await this.client.busy(
          token,
          target,
          from,
          to,
          options.ignoreOwnEvents === true,
        );
        return options.ignoreOwnEvents ? withoutOwnEvents(all, own) : all;
      });
      this.remember(key, busy);
      this.failedAt.delete(orgId);
      return busy;
    } catch (err) {
      // "Not connected" is a state, not an outage: nothing to hold the next call back for.
      if (err instanceof MicrosoftNotConnectedError) return [];
      this.failedAt.set(orgId, Date.now());
      throw err;
    }
  }

  async upsertEvent(req: CalendarEventRequest): Promise<CalendarEventResult | null> {
    const conn = await this.tokens.connection(req.orgId);
    if (!usable(conn)) return null;
    try {
      const result = await this.tokens.withToken(req.orgId, async (token, live) => {
        const calendarId = req.calendarId ?? live.calendarId;
        const insert = () => this.insert(token, calendarId, req);
        const patch = (eventId: string) =>
          this.client.patchEvent(token, eventId, buildGraphEventBody(req, 'patch'));

        let event: MicrosoftEventResult;
        if (req.existingEventId) {
          // Updating in place; an event somebody deleted on the Microsoft side is written again.
          const existing = req.existingEventId;
          event = await patch(existing).catch((err: unknown) => {
            if (
              err instanceof MicrosoftCalendarError &&
              (err.kind === 'not_found' || err.kind === 'gone')
            ) {
              return insert();
            }
            throw err;
          });
        } else {
          // First write: `transactionId` makes a repeat of this create return the event it already made; a conflict is met by finding that
          // event through our private property and updating it.
          event = await insert().catch(async (err: unknown) => {
            if (!(err instanceof MicrosoftCalendarError) || err.kind !== 'conflict') throw err;
            const found = await this.client.findByAppointment(token, calendarId, req.appointmentId);
            if (!found) throw err;
            return patch(found.id);
          });
        }

        let meetUrl = joinUrlOf(event);
        let etag = event['@odata.etag'] ?? null;
        if (req.createMeet && !meetUrl) {
          await sleep(MEETING_RECHECK_MS);
          const again = await this.client.getEvent(token, event.id).catch(() => null);
          meetUrl = joinUrlOf(again);
          etag = again?.['@odata.etag'] ?? etag;
        }
        return {
          eventId: event.id,
          calendarId,
          meetUrl,
          etag,
          provider: 'microsoft',
        } satisfies CalendarEventResult;
      });
      this.dropBusy(req.orgId);
      return result;
    } catch (err) {
      if (err instanceof MicrosoftNotConnectedError) {
        this.logger.warn(
          { orgId: req.orgId, reason: err.reason },
          'calendar event not written: Microsoft Calendar is not usable',
        );
        return null;
      }
      throw err;
    }
  }

  /** The create, with the Teams room asked for; a refusal of the room (a personal account has none) is retried without it. */
  private async insert(
    token: string,
    calendarId: string | null,
    req: CalendarEventRequest,
  ): Promise<MicrosoftEventResult> {
    try {
      return await this.client.insertEvent(token, calendarId, buildGraphEventBody(req, 'insert'));
    } catch (err) {
      if (
        !req.createMeet ||
        !(err instanceof MicrosoftCalendarError) ||
        err.kind !== 'bad_request'
      ) {
        throw err;
      }
      this.logger.warn(
        { orgId: req.orgId, reason: err.reason },
        'Microsoft refused the online meeting: writing the event without one',
      );
      return this.client.insertEvent(
        token,
        calendarId,
        buildGraphEventBody({ ...req, createMeet: false }, 'insert'),
      );
    }
  }

  async deleteEvent(orgId: number, _calendarId: string | null, eventId: string): Promise<void> {
    const conn = await this.tokens.connection(orgId);
    if (!usable(conn)) return;
    try {
      await this.tokens.withToken(orgId, (token) => this.client.deleteEvent(token, eventId));
      this.dropBusy(orgId);
    } catch (err) {
      if (err instanceof MicrosoftNotConnectedError) {
        this.logger.warn(
          { orgId, reason: err.reason },
          'calendar event not deleted: Microsoft Calendar is not usable',
        );
        return;
      }
      // Already gone is the outcome we wanted: a redelivered delete succeeds.
      if (
        err instanceof MicrosoftCalendarError &&
        (err.kind === 'not_found' || err.kind === 'gone')
      ) {
        this.dropBusy(orgId);
        return;
      }
      throw err;
    }
  }

  /**
   * The event as Microsoft shows it now. 404 is `missing`, 410 and a cancelled event are `deleted`; anything else that fails to answer
   * (outage, throttling, a refused grant) throws, so the reconcile stops instead of reading "could not look" as "gone".
   */
  async readEvent(
    orgId: number,
    _calendarId: string | null,
    eventId: string,
  ): Promise<CalendarEventState> {
    const conn = await this.tokens.connection(orgId);
    if (!usable(conn)) throw new MicrosoftNotConnectedError('none');
    try {
      const event = await this.tokens.withToken(orgId, (token) =>
        this.client.getEvent(token, eventId),
      );
      return graphEventStateOf(event);
    } catch (err) {
      if (err instanceof MicrosoftCalendarError) {
        if (err.kind === 'not_found') return { kind: 'missing' };
        if (err.kind === 'gone') return { kind: 'deleted' };
      }
      throw err;
    }
  }

  async calendarExists(orgId: number, calendarId: string | null): Promise<boolean> {
    const conn = await this.tokens.connection(orgId);
    if (!usable(conn)) throw new MicrosoftNotConnectedError('none');
    try {
      await this.tokens.withToken(orgId, (token, live) =>
        this.client.getCalendar(token, calendarId ?? live.calendarId),
      );
      return true;
    } catch (err) {
      if (
        err instanceof MicrosoftCalendarError &&
        (err.kind === 'not_found' || err.kind === 'gone')
      ) {
        return false;
      }
      throw err;
    }
  }

  private remember(key: string, busy: CalendarBusyInterval[]): void {
    if (this.busyCache.size >= BUSY_CACHE_MAX) {
      const oldest = this.busyCache.keys().next().value;
      if (oldest !== undefined) this.busyCache.delete(oldest);
    }
    this.busyCache.set(key, { at: Date.now(), busy });
  }
}
