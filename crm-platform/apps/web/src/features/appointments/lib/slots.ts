import {
  addDays,
  dayKeyOf,
  keyOf,
  parseDayKey,
  startOfMonth,
  startOfWeek,
  weekdayOf,
  zonedParts,
} from './zone';

/** One bookable start. `start` and `end` are instants (ISO 8601); `remaining` is the free seats of a shared slot. */
export interface Slot {
  start: string;
  end: string;
  remaining?: number | null;
}

export interface DaySlots {
  /** `YYYY-MM-DD` in the zone the slots were grouped for. */
  day: string;
  slots: Slot[];
}

/**
 * Slots grouped by the calendar day they start on, in `zone` (the visitor's zone, which may differ from the booking type's:
 * a 23:30 Tokyo slot is 14:30 the same day in London, a 08:00 Sydney slot is the previous evening in Los Angeles). Days and
 * the slots within a day come out in time order; the same start twice is kept once.
 */
export function groupSlotsByDay(slots: readonly Slot[], zone: string): DaySlots[] {
  const byDay = new Map<string, Map<number, Slot>>();
  for (const s of slots) {
    const t = Date.parse(s.start);
    if (Number.isNaN(t)) continue;
    const day = dayKeyOf(t, zone);
    let bucket = byDay.get(day);
    if (!bucket) {
      bucket = new Map();
      byDay.set(day, bucket);
    }
    if (!bucket.has(t)) bucket.set(t, s);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([day, bucket]) => ({
      day,
      slots: [...bucket.entries()].sort(([a], [b]) => a - b).map(([, s]) => s),
    }));
}

/** day key -> number of slots, for the date picker's dots and the "N times" hint. */
export function slotCounts(slots: readonly Slot[], zone: string): Map<string, number> {
  return new Map(groupSlotsByDay(slots, zone).map((d) => [d.day, d.slots.length]));
}

/** The first day with a slot on or after `from`; null when there is none. */
export function firstDayWithSlots(groups: readonly DaySlots[], from?: string): string | null {
  const hit = groups.find((g) => g.slots.length > 0 && (!from || g.day >= from));
  return hit ? hit.day : null;
}

export interface MonthCell {
  day: string;
  inMonth: boolean;
}

/**
 * The weeks of the month holding `anchor`, each of 7 days, starting on `weekStartsOn` (0 = Sunday). Always whole weeks, so
 * the grid is 4 to 6 rows tall; days outside the month are flagged so they can be dimmed.
 */
export function monthMatrix(anchor: string, weekStartsOn: number): MonthCell[][] {
  const first = startOfMonth(anchor);
  const month = first.slice(0, 7);
  const p = parseDayKey(first);
  if (!p) return [];
  const lastDay = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
  const last = keyOf(p.year, p.month, lastDay);
  const start = startOfWeek(first, weekStartsOn);
  const end = addDays(startOfWeek(last, weekStartsOn), 6);
  const rows: MonthCell[][] = [];
  for (let d = start; d <= end; d = addDays(d, 7)) {
    rows.push(
      Array.from({ length: 7 }, (_, i) => ({
        day: addDays(d, i),
        inMonth: addDays(d, i).startsWith(month),
      })),
    );
  }
  return rows;
}

/** Weekday headings for a month grid: `weekStartsOn`, then the six days after it (0 = Sunday ... 6 = Saturday). */
export const weekdayOrder = (weekStartsOn: number): number[] =>
  Array.from({ length: 7 }, (_, i) => (weekStartsOn + i) % 7);

/** Mon..Sun in the order the availability editor lists them (WaDesk's order), as 0 = Sunday ... 6 = Saturday. */
export const MONDAY_FIRST = [1, 2, 3, 4, 5, 6, 0] as const;

/** The clock reading of a slot in `zone`, "14:30", for sorting and tests (display goes through `Intl`). */
export function slotClock(iso: string, zone: string): string {
  const p = zonedParts(iso, zone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

export { weekdayOf };
