import type { PreviewDraft } from '../api/schemas';
import {
  addDays,
  dayKeyOf,
  parseClock,
  startOfZonedDay,
  weekdayOf,
  zonedDayRange,
  zonedParts,
  zonedTimeToUtc,
} from './zone';
import type { Slot } from './slots';

/**
 * Which times a booking type offers, computed from its configuration: weekly windows, date overrides, duration, start step,
 * buffers, minimum notice, how far ahead, per-day cap, capacity, and what is already booked. This is Reference's slot engine
 * (windows cut into steps, buffers around busy time, closed dates dropped, shared slots counted by seat) written for the
 * client. The real server decides what is bookable; this is used by the development stand-in and to explain the editor's
 * preview, and is tested here so the two stay in agreement.
 */

export interface BusyInterval {
  start: number;
  end: number;
  /** Seats the booking holds (1 for a single booking). */
  seats: number;
}

export interface SlotRequest {
  draft: PreviewDraft;
  /** The instant "now" for notice and the horizon. */
  now: Date;
  /** The range of days to list, as instants: `[from, to)`. */
  from: Date;
  to: Date;
  busy?: readonly BusyInterval[];
  limit?: number;
}

const MIN = 60_000;

/** Windows for a date: an override's custom hours, nothing when it is closed, else that weekday's weekly rules. */
export function windowsFor(day: string, draft: PreviewDraft): Array<{ from: number; to: number }> {
  const o = draft.overrides.find((x) => x.date === day);
  if (o) {
    if (o.closed) return [];
    const f = parseClock(o.from ?? '');
    const t = parseClock(o.to ?? '');
    return f !== null && t !== null && t > f ? [{ from: f, to: t }] : [];
  }
  const wd = weekdayOf(day);
  return draft.availability
    .filter((r) => r.weekday === wd)
    .flatMap((r) => {
      const f = parseClock(r.from);
      const t = parseClock(r.to);
      return f !== null && t !== null && t > f ? [{ from: f, to: t }] : [];
    })
    .sort((a, b) => a.from - b.from);
}

export function generateSlots(req: SlotRequest): Slot[] {
  const { draft, now } = req;
  const zone = draft.timezone;
  const duration = Math.max(1, draft.durationMinutes);
  const step = Math.max(1, draft.incrementMinutes || duration);
  const cap = Math.max(1, draft.capacity);
  const earliest = now.getTime() + draft.minNoticeMinutes * MIN;
  const horizon = startOfZonedDay(
    addDays(dayKeyOf(now, zone), draft.maxAdvanceDays + 1),
    zone,
  ).getTime();
  const busy = req.busy ?? [];
  const out: Slot[] = [];
  const limit = req.limit ?? 500;

  const firstDay = dayKeyOf(req.from, zone);
  const lastDay = dayKeyOf(new Date(req.to.getTime() - 1), zone);
  for (let day = firstDay; day <= lastDay; day = addDays(day, 1)) {
    const range = zonedDayRange(day, zone);
    // A day that already holds its cap of bookings offers nothing more.
    if (
      draft.maxPerDay !== null &&
      busy.filter((b) => dayKeyOf(b.start, zone) === day).length >= draft.maxPerDay
    )
      continue;
    for (const w of windowsFor(day, draft)) {
      for (let m = w.from; m + duration <= w.to; m += step) {
        const start = zonedTimeToUtc(day, m, zone).getTime();
        const end = start + duration * MIN;
        if (start < range.start.getTime() || start >= range.end.getTime()) continue;
        // A wall time the zone skips (spring forward) does not exist, so nothing is offered at it.
        const read = zonedParts(start, zone);
        if (read.hour * 60 + read.minute !== m) continue;
        if (start < req.from.getTime() || start >= req.to.getTime()) continue;
        if (start < earliest || start >= horizon) continue;
        if (out.length >= limit) return out;

        const from = start - draft.bufferBeforeMinutes * MIN;
        const until = end + draft.bufferAfterMinutes * MIN;
        let used = 0;
        for (const b of busy) if (b.start < until && b.end > from) used += b.seats;
        if (used >= cap) continue;
        out.push({
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
          remaining: cap - used,
        });
      }
    }
  }
  return out;
}
