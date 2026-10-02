import { clockMinutes } from '@crm/contracts';
import { addDays, daysBetween, localDateOf, startOfLocalDay, wallToInstant, weekdayOf } from './tz';

/**
 * The slot engine (WD-APPT-017, 018; D-01, D-02, D-03). Pure: no database, no clock, no I/O; the caller loads the facts and passes
 * `nowMs`. See the inventory's "Slot engine" decision for the rules in words.
 *
 * Model: a booking type has SEATS 1..capacity (1 for a one-to-one type). Each seat is an independent column of time. A slot is open
 * when at least one seat is free of every active booking (buffers included) and of the calendar's busy intervals, and the seats
 * that soft-lock reservations hold do not eat the last one. For capacity 1 this is exactly WaDesk's rule; for a group type it makes
 * the buffers apply per seat, where WaDesk ignored them.
 */

export interface EngineType {
  timezone: string;
  durationMinutes: number;
  incrementMinutes: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  maxPerDay: number | null;
  capacity: number;
}

export interface EngineWindow {
  weekday: number;
  from: string;
  to: string;
}

export interface EngineOverride {
  date: string;
  isClosed: boolean;
  from: string | null;
  to: string | null;
}

/** An active (pending or confirmed) booking of this type. */
export interface EngineBooking {
  startMs: number;
  endMs: number;
  seat: number;
}

/** A busy interval from the external calendar: blocks every seat. */
export interface EngineBusy {
  startMs: number;
  endMs: number;
}

/** A live soft-lock reservation. */
export interface EngineHold {
  startMs: number;
  endMs: number;
  seats: number;
}

export interface EngineSlot {
  startMs: number;
  endMs: number;
  remaining: number;
}

export interface EngineDay {
  date: string;
  slots: EngineSlot[];
}

export interface EngineInput {
  type: EngineType;
  windows: EngineWindow[];
  overrides: EngineOverride[];
  bookings: EngineBooking[];
  busy: EngineBusy[];
  holds: EngineHold[];
  nowMs: number;
  /** Local dates, inclusive; clipped to today .. today + maxAdvanceDays - 1. */
  fromDate: string;
  toDate: string;
}

const MINUTE = 60_000;

/** The local date range a type can be booked on: today through `maxAdvanceDays` days (today counts as the first). */
export function bookableRange(
  type: Pick<EngineType, 'timezone' | 'maxAdvanceDays'>,
  nowMs: number,
): { first: string; last: string } {
  const first = localDateOf(nowMs, type.timezone);
  return { first, last: addDays(first, type.maxAdvanceDays - 1) };
}

/**
 * The intervals open on one local date: a closed override removes the day, special hours replace the weekly intervals, otherwise the
 * weekly intervals of that weekday.
 */
export function dayWindows(
  date: string,
  windows: EngineWindow[],
  overrides: EngineOverride[],
): Array<{ from: string; to: string }> {
  const o = overrides.find((x) => x.date === date);
  if (o) {
    if (o.isClosed || !o.from || !o.to) return [];
    return [{ from: o.from, to: o.to }];
  }
  const wd = weekdayOf(date);
  return windows.filter((w) => w.weekday === wd).map((w) => ({ from: w.from, to: w.to }));
}

/**
 * Buffers (D-02, WaDesk's rule kept): the candidate's clash range is [start - bufferBefore, end + bufferAfter); an existing interval
 * clashes when it overlaps that range. So `bufferBefore` is the gap needed AFTER an existing booking and `bufferAfter` the gap needed
 * BEFORE the next one.
 */
export function clashesWithBuffers(
  slotStartMs: number,
  slotEndMs: number,
  other: { startMs: number; endMs: number },
  bufferBeforeMs: number,
  bufferAfterMs: number,
): boolean {
  return other.startMs < slotEndMs + bufferAfterMs && other.endMs > slotStartMs - bufferBeforeMs;
}

/** The seats of 1..capacity that no active booking blocks for this slot (`withBuffers` false = raw overlap only). */
export function freeSeats(
  type: EngineType,
  bookings: EngineBooking[],
  startMs: number,
  endMs: number,
  withBuffers = true,
): number[] {
  const before = withBuffers ? type.bufferBeforeMinutes * MINUTE : 0;
  const after = withBuffers ? type.bufferAfterMinutes * MINUTE : 0;
  const blocked = new Set<number>();
  for (const b of bookings) {
    if (
      b.seat >= 1 &&
      b.seat <= type.capacity &&
      clashesWithBuffers(startMs, endMs, b, before, after)
    )
      blocked.add(b.seat);
  }
  const free: number[] = [];
  for (let s = 1; s <= type.capacity; s++) if (!blocked.has(s)) free.push(s);
  return free;
}

/** The lowest free seat for a slot, or null when every seat is taken. */
export function pickSeat(
  type: EngineType,
  bookings: EngineBooking[],
  startMs: number,
  endMs: number,
  withBuffers = true,
): number | null {
  return freeSeats(type, bookings, startMs, endMs, withBuffers)[0] ?? null;
}

export function generateSlots(input: EngineInput): EngineDay[] {
  const { type, nowMs } = input;
  const tz = type.timezone;
  const durationMs = type.durationMinutes * MINUTE;
  const stepMs = Math.max(5, type.incrementMinutes) * MINUTE;
  const earliestMs = nowMs + type.minNoticeMinutes * MINUTE;
  const before = type.bufferBeforeMinutes * MINUTE;
  const after = type.bufferAfterMinutes * MINUTE;

  const range = bookableRange(type, nowMs);
  const first = input.fromDate > range.first ? input.fromDate : range.first;
  const last = input.toDate < range.last ? input.toDate : range.last;
  const out: EngineDay[] = [];
  if (first > last) return out;

  // Bookings per local start date, for the per-day cap (D-02: a cap on bookings, not on offered slots).
  const perDay = new Map<string, number>();
  if (type.maxPerDay !== null) {
    for (const b of input.bookings) {
      const d = localDateOf(b.startMs, tz);
      perDay.set(d, (perDay.get(d) ?? 0) + 1);
    }
  }

  const days = daysBetween(first, last);
  for (let i = 0; i <= days; i++) {
    const date = addDays(first, i);
    if (type.maxPerDay !== null && (perDay.get(date) ?? 0) >= type.maxPerDay) continue;
    const intervals = dayWindows(date, input.windows, input.overrides);
    if (intervals.length === 0) continue;

    // Only bookings, busy intervals and holds that can touch this day are looked at.
    const dayStart = startOfLocalDay(date, tz) - after - durationMs;
    const dayEnd = startOfLocalDay(addDays(date, 1), tz) + before + durationMs;
    const bookings = input.bookings.filter((b) => b.endMs > dayStart && b.startMs < dayEnd);
    const busy = input.busy.filter((b) => b.endMs > dayStart && b.startMs < dayEnd);
    const holds = input.holds.filter((h) => h.endMs > dayStart && h.startMs < dayEnd);

    const seen = new Set<number>();
    const slots: EngineSlot[] = [];
    for (const w of intervals) {
      const ws = wallToInstant(date, clockMinutes(w.from), tz);
      const we = wallToInstant(date, clockMinutes(w.to), tz);
      for (let start = ws; start + durationMs <= we; start += stepMs) {
        if (seen.has(start)) continue;
        if (start < earliestMs) continue;
        const end = start + durationMs;
        if (busy.some((b) => clashesWithBuffers(start, end, b, before, after))) continue;
        const free = freeSeats(type, bookings, start, end).length;
        let held = 0;
        for (const h of holds) if (h.startMs < end && h.endMs > start) held += h.seats;
        const remaining = free - held;
        if (remaining <= 0) continue;
        seen.add(start);
        slots.push({ startMs: start, endMs: end, remaining });
      }
    }
    if (slots.length > 0) {
      slots.sort((a, b) => a.startMs - b.startMs);
      out.push({ date, slots });
    }
  }
  return out;
}

/**
 * Is `startMs` one of the slots the type offers right now? Returns the slot (with its remaining seats) or null. The check runs the
 * generator for that start's local date only, so it is the very same rule the list uses.
 */
export function findOpenSlot(
  input: Omit<EngineInput, 'fromDate' | 'toDate'>,
  startMs: number,
): EngineSlot | null {
  const date = localDateOf(startMs, input.type.timezone);
  const days = generateSlots({ ...input, fromDate: date, toDate: date });
  return days[0]?.slots.find((s) => s.startMs === startMs) ?? null;
}
