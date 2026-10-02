import { addDays, dayKeyOf, parseDayKey, startOfWeek, zonedDayRange, zonedParts } from './zone';

/** What the calendar needs of an appointment. */
export interface CalendarEvent {
  id: string;
  startsAt: string;
  endsAt: string;
}

export interface PlacedEvent<T extends CalendarEvent> {
  event: T;
  /** Minutes after the start of the visible day (the grid's own clock, not elapsed time: a DST day still shows 24 rows). */
  startMin: number;
  endMin: number;
  /** Column inside an overlapping cluster, and how many columns the cluster has. */
  col: number;
  cols: number;
}

export const MINUTES_PER_DAY = 24 * 60;
/** An event shorter than this still gets a clickable height. */
export const MIN_EVENT_MINUTES = 20;

/** The seven day keys of the week holding `anchor`. */
export function weekDays(anchor: string, weekStartsOn: number): string[] {
  const first = startOfWeek(anchor, weekStartsOn);
  return Array.from({ length: 7 }, (_, i) => addDays(first, i));
}

function wallMinutes(iso: string | number, zone: string): number {
  const p = zonedParts(iso, zone);
  return p.hour * 60 + p.minute;
}

/**
 * The part of an event that falls on `day` in `zone`, as grid minutes; null when it does not touch the day. An event that
 * crosses midnight is cut at the day's edges, so it shows on both days.
 */
export function clipToDay(
  e: CalendarEvent,
  day: string,
  zone: string,
): { startMin: number; endMin: number } | null {
  const s = Date.parse(e.startsAt);
  const en = Date.parse(e.endsAt);
  if (Number.isNaN(s) || Number.isNaN(en)) return null;
  const { start, end } = zonedDayRange(day, zone);
  if (en <= start.getTime() || s >= end.getTime()) {
    // A zero-length event exactly on the start still belongs to its day.
    if (!(en === s && s >= start.getTime() && s < end.getTime())) return null;
  }
  const startMin = s < start.getTime() ? 0 : wallMinutes(s, zone);
  let endMin = en >= end.getTime() ? MINUTES_PER_DAY : wallMinutes(en, zone);
  if (endMin <= startMin) endMin = Math.min(MINUTES_PER_DAY, startMin + MIN_EVENT_MINUTES);
  return { startMin, endMin };
}

/**
 * Lays one day's events out side by side where they overlap. Events are grouped into clusters of transitively overlapping
 * events; inside a cluster each takes the first free column, and every event of the cluster is as wide as the cluster is
 * deep. The result is in start order.
 */
export function layoutDay<T extends CalendarEvent>(
  events: readonly T[],
  day: string,
  zone: string,
): PlacedEvent<T>[] {
  const clipped = events
    .map((event) => ({ event, clip: clipToDay(event, day, zone) }))
    .filter((x): x is { event: T; clip: { startMin: number; endMin: number } } => x.clip !== null)
    .sort(
      (a, b) =>
        a.clip.startMin - b.clip.startMin ||
        b.clip.endMin - a.clip.endMin ||
        (a.event.id < b.event.id ? -1 : 1),
    );

  const placed: PlacedEvent<T>[] = [];
  let cluster: PlacedEvent<T>[] = [];
  let clusterEnd = -1;
  let columnEnds: number[] = [];

  const flush = () => {
    for (const p of cluster) p.cols = Math.max(1, columnEnds.length);
    placed.push(...cluster);
    cluster = [];
    columnEnds = [];
    clusterEnd = -1;
  };

  for (const { event, clip } of clipped) {
    // Visual end: a short event still occupies its minimum height, so it competes for space with what follows.
    const visualEnd = Math.max(clip.endMin, clip.startMin + MIN_EVENT_MINUTES);
    if (cluster.length > 0 && clip.startMin >= clusterEnd) flush();
    let col = columnEnds.findIndex((end) => end <= clip.startMin);
    if (col === -1) {
      col = columnEnds.length;
      columnEnds.push(visualEnd);
    } else columnEnds[col] = visualEnd;
    cluster.push({ event, startMin: clip.startMin, endMin: clip.endMin, col, cols: 1 });
    clusterEnd = Math.max(clusterEnd, visualEnd);
  }
  flush();
  return placed;
}

export interface HourRange {
  /** First and last hour shown, 0 to 24; `to` is exclusive. */
  from: number;
  to: number;
}

/**
 * The hours the week grid shows: the working day (8 to 19) widened to take in every event of the week, so nothing is cut off
 * and an empty week does not scroll through the night.
 */
export function hourRange(
  events: readonly CalendarEvent[],
  days: readonly string[],
  zone: string,
  base: HourRange = { from: 8, to: 19 },
): HourRange {
  let from = base.from;
  let to = base.to;
  for (const day of days) {
    for (const e of events) {
      const clip = clipToDay(e, day, zone);
      if (!clip) continue;
      from = Math.min(from, Math.floor(clip.startMin / 60));
      to = Math.max(to, Math.ceil(clip.endMin / 60));
    }
  }
  return { from: Math.max(0, from), to: Math.min(24, Math.max(to, from + 1)) };
}

/** Percentage of the visible hours: where an event starts and how tall it is. */
export function eventBox(
  p: Pick<PlacedEvent<CalendarEvent>, 'startMin' | 'endMin'>,
  range: HourRange,
): { top: number; height: number } {
  const span = (range.to - range.from) * 60;
  const top = ((Math.max(p.startMin, range.from * 60) - range.from * 60) / span) * 100;
  const end = Math.min(p.endMin, range.to * 60);
  const minutes = Math.max(MIN_EVENT_MINUTES, end - Math.max(p.startMin, range.from * 60));
  return { top, height: Math.min(100 - top, (minutes / span) * 100) };
}

/** Events that touch `day` in `zone`, in start order (the month cell and the day list). */
export function eventsOnDay<T extends CalendarEvent>(
  events: readonly T[],
  day: string,
  zone: string,
): T[] {
  return events
    .filter((e) => clipToDay(e, day, zone) !== null)
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || (a.id < b.id ? -1 : 1));
}

/** The line across today's column: minutes after midnight on the grid's clock, or null when `now` is not on `day`. */
export function nowMinutes(now: Date, day: string, zone: string): number | null {
  return dayKeyOf(now, zone) === day ? wallMinutes(now.getTime(), zone) : null;
}

/** First instant and the instant after the last one of the visible span of days (the range the calendar asks the API for). */
export function rangeOf(days: readonly string[], zone: string): { from: string; to: string } {
  const first = days[0]!;
  const last = days[days.length - 1]!;
  return {
    from: zonedDayRange(first, zone).start.toISOString(),
    to: zonedDayRange(last, zone).end.toISOString(),
  };
}

/** The days the month view covers: whole weeks around the month, as one flat list. */
export function monthSpan(anchor: string, weekStartsOn: number): string[] {
  const p = parseDayKey(anchor);
  if (!p) return [];
  const first = `${anchor.slice(0, 7)}-01`;
  const lastDay = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
  const last = `${anchor.slice(0, 7)}-${String(lastDay).padStart(2, '0')}`;
  const start = startOfWeek(first, weekStartsOn);
  const end = addDays(startOfWeek(last, weekStartsOn), 6);
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}
