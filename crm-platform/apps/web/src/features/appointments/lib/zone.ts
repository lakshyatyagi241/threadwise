/**
 * Time-zone arithmetic on top of `Intl`, with no library. A "day key" is a calendar date written `YYYY-MM-DD` and is always
 * read in a stated IANA zone; "wall time" is the clock reading in that zone. Everything here is pure and works for zones
 * with daylight saving: a day can be 23 or 25 hours long, a wall time can be skipped (spring forward) or happen twice
 * (fall back).
 */

export interface ZonedParts {
  year: number;
  /** 1 to 12. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  /** 0 = Sunday ... 6 = Saturday. */
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(zone, f);
  }
  return f;
}

export function isValidZone(zone: string | null | undefined): zone is string {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The browser's own zone, or UTC when it cannot be read. */
export function browserZone(): string {
  try {
    const z = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidZone(z) ? z : 'UTC';
  } catch {
    return 'UTC';
  }
}

/** `zone` when it is a real IANA zone, else `fallback`, else UTC. */
export function safeZone(zone: string | null | undefined, fallback?: string | null): string {
  if (isValidZone(zone)) return zone;
  return isValidZone(fallback) ? fallback : 'UTC';
}

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** The clock reading in `zone` at the instant `at`. */
export function zonedParts(at: Date | string | number, zone: string): ZonedParts {
  const d = at instanceof Date ? at : new Date(at);
  const out: Record<string, number> = {};
  for (const p of formatterFor(zone).formatToParts(d)) {
    if (p.type !== 'literal') out[p.type] = Number(p.value);
  }
  const year = out.year!;
  const month = out.month!;
  const day = out.day!;
  return {
    year,
    month,
    day,
    hour: out.hour! % 24,
    minute: out.minute!,
    second: out.second!,
    weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
  };
}

/** Minutes the zone is ahead of UTC at the instant `at` (IST +330, New York -240 in summer). */
export function zoneOffsetMinutes(at: Date | string | number, zone: string): number {
  const d = at instanceof Date ? at : new Date(at);
  const p = zonedParts(d, zone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(d.getTime() / 1000) * 1000) / 60_000);
}

export const keyOf = (year: number, month: number, day: number): string =>
  `${pad(year, 4)}-${pad(month)}-${pad(day)}`;

export interface DayParts {
  year: number;
  month: number;
  day: number;
}

const KEY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Splits a day key; null when it is not a real calendar date. */
export function parseDayKey(key: string): DayParts | null {
  const m = KEY.exec(key);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  )
    return null;
  return { year, month, day };
}

/** The calendar day of an instant in `zone`. */
export function dayKeyOf(at: Date | string | number, zone: string): string {
  const p = zonedParts(at, zone);
  return keyOf(p.year, p.month, p.day);
}

/** Calendar arithmetic on a day key (zone free: a calendar day is a calendar day). */
export function addDays(key: string, n: number): string {
  const p = parseDayKey(key);
  if (!p) return key;
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + n));
  return keyOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** First day of the month holding `key`. */
export const startOfMonth = (key: string): string => `${key.slice(0, 7)}-01`;

export function addMonths(key: string, n: number): string {
  const p = parseDayKey(key);
  if (!p) return key;
  const d = new Date(Date.UTC(p.year, p.month - 1 + n, 1));
  return keyOf(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}

export function daysInMonth(key: string): number {
  const p = parseDayKey(key);
  if (!p) return 30;
  return new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
}

/** 0 = Sunday ... 6 = Saturday. */
export function weekdayOf(key: string): number {
  const p = parseDayKey(key);
  return p ? new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay() : 0;
}

/** Whole days from `a` to `b` (negative when b is earlier). */
export function diffDays(a: string, b: string): number {
  const pa = parseDayKey(a);
  const pb = parseDayKey(b);
  if (!pa || !pb) return 0;
  return Math.round(
    (Date.UTC(pb.year, pb.month - 1, pb.day) - Date.UTC(pa.year, pa.month - 1, pa.day)) /
      86_400_000,
  );
}

/** The first day of the week holding `key`; `weekStartsOn` is 0 (Sunday) to 6 (Saturday). */
export function startOfWeek(key: string, weekStartsOn: number): string {
  const back = (weekdayOf(key) - weekStartsOn + 7) % 7;
  return addDays(key, -back);
}

/**
 * The instant at which the clock in `zone` reads `day` + `minutes` after midnight. A wall time the zone skips (spring
 * forward) lands on the first instant after the gap; one that happens twice (fall back) takes the earlier occurrence.
 */
export function zonedTimeToUtc(day: string, minutes: number, zone: string): Date {
  const p = parseDayKey(day);
  if (!p) return new Date(NaN);
  const wall = Date.UTC(p.year, p.month - 1, p.day, 0, minutes);
  // Offsets a day either side of the wall time: whichever lands back on the wall time is the answer.
  const guesses = [
    wall - zoneOffsetMinutes(new Date(wall), zone) * 60_000,
    wall - zoneOffsetMinutes(new Date(wall - 86_400_000), zone) * 60_000,
    wall - zoneOffsetMinutes(new Date(wall + 86_400_000), zone) * 60_000,
  ];
  const valid = guesses
    .filter((g) => {
      const q = zonedParts(new Date(g), zone);
      return Date.UTC(q.year, q.month - 1, q.day, q.hour, q.minute) === wall;
    })
    .sort((a, b) => a - b);
  if (valid.length > 0) return new Date(valid[0]!);
  // In the gap: use the offset from before the gap, which moves the time forward by the gap's length.
  const before = zoneOffsetMinutes(new Date(wall - 86_400_000), zone);
  return new Date(wall - before * 60_000);
}

/** Midnight at the start of `day` in `zone`. */
export const startOfZonedDay = (day: string, zone: string): Date => zonedTimeToUtc(day, 0, zone);

/** `[start, end)` of a day in `zone` as instants; 23, 24 or 25 hours long. */
export function zonedDayRange(day: string, zone: string): { start: Date; end: Date } {
  return { start: startOfZonedDay(day, zone), end: startOfZonedDay(addDays(day, 1), zone) };
}

/** "09:30" to 570; null when it is not a valid 24-hour time. */
export function parseClock(text: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** 570 to "09:30". */
export const formatClock = (minutes: number): string =>
  `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

let zoneList: string[] | null = null;

const FALLBACK_ZONES = [
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Istanbul',
  'Asia/Dubai',
  'Asia/Riyadh',
  'Asia/Karachi',
  'Asia/Kolkata',
  'Asia/Dhaka',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
  'Africa/Cairo',
  'Africa/Lagos',
  'Africa/Johannesburg',
  'America/Sao_Paulo',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
];

/** Every zone the browser knows (a short list when it cannot enumerate them), UTC first. */
export function listZones(): string[] {
  if (zoneList) return zoneList;
  let all: string[] = [];
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf;
    all = fn ? fn('timeZone') : [];
  } catch {
    all = [];
  }
  if (all.length === 0) all = FALLBACK_ZONES;
  zoneList = ['UTC', ...all.filter((z) => z !== 'UTC')];
  return zoneList;
}

/** The zone list with `extra` (a zone not in it, such as "Etc/GMT+5") added so a stored value always shows. */
export function zonesWith(extra: string | null | undefined): string[] {
  const all = listZones();
  return extra && isValidZone(extra) && !all.includes(extra) ? [extra, ...all] : all;
}

/** "GMT+5:30" / "GMT-4" for the zone at the instant `at`, in English digits. */
export function offsetLabel(at: Date | string | number, zone: string): string {
  const mins = zoneOffsetMinutes(at, zone);
  if (mins === 0) return 'GMT';
  const abs = Math.abs(mins);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `GMT${mins < 0 ? '-' : '+'}${h}${m ? `:${pad(m)}` : ''}`;
}
