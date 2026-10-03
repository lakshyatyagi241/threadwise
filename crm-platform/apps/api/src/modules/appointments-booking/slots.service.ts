import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  SLOTS_DEFAULT_DAYS,
  SLOTS_MAX_DAYS,
  type PreviewSlotsInput,
  type PreviewSlotsResponse,
  type SlotsQuery,
  type SlotsResponse,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import {
  APPOINTMENT_CALENDAR,
  type CalendarSyncPort,
} from '../../infra/providers/appointments-booking';
import { AppError } from '../../common/errors/app-error';
import { AppointmentsRepository } from './appointments.repository';
import {
  BookingTypesRepository,
  type BookingTypeRow,
  type TypeChildren,
} from './booking-types.repository';
import { generateSlots, type EngineBusy, type EngineInput, type EngineType } from './slot-engine';
import { addDays, daysBetween, localDateOf, startOfLocalDay } from './tz';

const DAY_MS = 86_400_000;

/** Pads the facts window so a buffer, a long duration or a time-zone edge cannot hide a booking that touches the range. */
const PAD_MS = 3 * DAY_MS;

/** A booking type with the data the engine needs, resolved in the workspace's zone. */
export interface LoadedType {
  row: BookingTypeRow;
  children: TypeChildren;
  engine: EngineType;
}

export function resolveZone(raw: string | null | undefined): string {
  if (!raw) return 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: raw });
    return raw;
  } catch {
    return 'UTC';
  }
}

export function toEngineType(row: BookingTypeRow, orgTimezone: string): EngineType {
  return {
    timezone: row.timezone ?? orgTimezone,
    durationMinutes: row.durationMinutes,
    incrementMinutes: row.incrementMinutes || row.durationMinutes,
    bufferBeforeMinutes: row.bufferBeforeMinutes,
    bufferAfterMinutes: row.bufferAfterMinutes,
    minNoticeMinutes: row.minNoticeMinutes,
    maxAdvanceDays: row.maxAdvanceDays,
    maxPerDay: row.maxPerDay,
    capacity: row.capacity,
  };
}

/**
 * Loads what the pure slot engine needs for a booking type and runs it (TW-APPT-016..019). Nothing is cached: a booking made a
 * second ago is already out of the list. The external calendar's busy intervals are fetched OUTSIDE the transaction by the caller
 * (`busyFor`), never while a lock is held.
 */
@Injectable()
export class SlotsService {
  private readonly logger = new Logger(SlotsService.name);

  constructor(
    private readonly types: BookingTypesRepository,
    private readonly appts: AppointmentsRepository,
    @Inject(APPOINTMENT_CALENDAR) private readonly calendar: CalendarSyncPort,
  ) {}

  async orgTimezone(tx: Tx, orgId: number): Promise<string> {
    return resolveZone((await this.types.org(tx, orgId)).timezone);
  }

  async load(
    tx: Tx,
    orgId: number,
    row: BookingTypeRow,
    orgTimezone?: string,
  ): Promise<LoadedType> {
    const tz = orgTimezone ?? (await this.orgTimezone(tx, orgId));
    const children = (await this.types.children(tx, orgId, [row.id])).get(row.id)!;
    return { row, children, engine: toEngineType(row, tz) };
  }

  /**
   * The calendar's busy intervals for a range, or none when the type names no calendar, nothing is connected or the call fails (an
   * outage must not stop bookings: Reference fell back to its own bookings only, and so does this).
   */
  async busyFor(
    orgId: number,
    lt: LoadedType,
    fromMs: number,
    toMs: number,
  ): Promise<EngineBusy[]> {
    try {
      const status = await this.calendar.status(orgId);
      if (!status.connected) return [];
      const busy = await this.calendar.freeBusy(
        orgId,
        lt.children.integration?.calendarId ?? null,
        new Date(fromMs),
        new Date(toMs),
        // A group type's seats are counted by its bookings: the first booking's own calendar event must not close the slot for the rest.
        { ignoreOwnEvents: lt.engine.capacity > 1 },
      );
      return busy.map((b) => ({ startMs: b.start.getTime(), endMs: b.end.getTime() }));
    } catch (err) {
      this.logger.warn({ err, orgId }, 'calendar free/busy failed: offering slots without it');
      return [];
    }
  }

  /** The engine input for a window of local dates, read in the caller's transaction. */
  async facts(
    tx: Tx,
    orgId: number,
    lt: LoadedType,
    window: { fromMs: number; toMs: number },
    opts: {
      nowMs: number;
      busy?: EngineBusy[];
      exceptAppointmentId?: number;
      exceptSessionRef?: string;
    },
  ): Promise<Omit<EngineInput, 'fromDate' | 'toDate'>> {
    const from = window.fromMs - PAD_MS;
    const to = window.toMs + PAD_MS;
    const [bookings, holds] = await Promise.all([
      this.appts.activeBookings(tx, orgId, lt.row.id, from, to, opts.exceptAppointmentId),
      this.appts.liveHolds(tx, orgId, lt.row.id, from, to, opts.exceptSessionRef),
    ]);
    return {
      type: lt.engine,
      windows: lt.children.rules,
      overrides: lt.children.overrides,
      bookings,
      busy: opts.busy ?? [],
      holds,
      nowMs: opts.nowMs,
    };
  }

  /** The window `[from, to]` of a slots query, in the type's zone, validated. */
  window(query: SlotsQuery, lt: LoadedType, nowMs: number): { fromDate: string; toDate: string } {
    const tz = lt.engine.timezone;
    const fromDate = query.from ?? localDateOf(nowMs, tz);
    const toDate = query.to ?? addDays(fromDate, SLOTS_DEFAULT_DAYS - 1);
    if (toDate < fromDate)
      throw AppError.validation('`to` is before `from`', [{ path: 'to', message: 'before_from' }]);
    if (daysBetween(fromDate, toDate) >= SLOTS_MAX_DAYS) {
      throw AppError.validation(`Ask for at most ${SLOTS_MAX_DAYS} days at a time.`, [
        { path: 'to', message: 'range_too_long' },
      ]);
    }
    return { fromDate, toDate };
  }

  async slots(
    tx: Tx,
    orgId: number,
    lt: LoadedType,
    query: SlotsQuery,
    nowMs: number,
    busy: EngineBusy[],
  ): Promise<SlotsResponse> {
    const { fromDate, toDate } = this.window(query, lt, nowMs);
    const tz = lt.engine.timezone;
    const facts = await this.facts(
      tx,
      orgId,
      lt,
      { fromMs: startOfLocalDay(fromDate, tz), toMs: startOfLocalDay(addDays(toDate, 1), tz) },
      { nowMs, busy },
    );
    const days = generateSlots({ ...facts, fromDate, toDate });
    return {
      timezone: tz,
      durationMinutes: lt.engine.durationMinutes,
      days: days.map((d) => ({
        date: d.date,
        slots: d.slots.map((s) => ({
          start: new Date(s.startMs).toISOString(),
          end: new Date(s.endMs).toISOString(),
          remaining: s.remaining,
        })),
      })),
    };
  }

  /** The wizard's stateless preview (TW-APPT-016): no bookings, no holds, no busy time; today onwards for `days` days. */
  preview(input: PreviewSlotsInput, orgTimezone: string, nowMs: number): PreviewSlotsResponse {
    const d = input.draft;
    const type: EngineType = {
      timezone: d.timezone ?? orgTimezone,
      durationMinutes: d.durationMinutes,
      incrementMinutes: d.incrementMinutes ?? d.durationMinutes,
      bufferBeforeMinutes: d.bufferBeforeMinutes,
      bufferAfterMinutes: d.bufferAfterMinutes,
      minNoticeMinutes: d.minNoticeMinutes,
      maxAdvanceDays: d.maxAdvanceDays,
      maxPerDay: d.maxPerDay ?? null,
      capacity: d.capacity,
    };
    const fromDate = localDateOf(nowMs, type.timezone);
    const days = generateSlots({
      type,
      windows: d.availability,
      overrides: d.overrides.map((o) => ({
        date: o.date,
        isClosed: o.isClosed,
        from: o.from ?? null,
        to: o.to ?? null,
      })),
      bookings: [],
      busy: [],
      holds: [],
      nowMs,
      fromDate,
      toDate: addDays(fromDate, input.days - 1),
    });
    const out = days.map((day) => ({
      date: day.date,
      slots: day.slots.map((s) => ({
        start: new Date(s.startMs).toISOString(),
        end: new Date(s.endMs).toISOString(),
        remaining: s.remaining,
      })),
    }));
    return {
      timezone: type.timezone,
      durationMinutes: type.durationMinutes,
      days: out,
      count: out.reduce((n, day) => n + day.slots.length, 0),
    };
  }
}
