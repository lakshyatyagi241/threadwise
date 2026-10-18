export interface BusinessHoursWindow {
  from?: string;
  to?: string;
}

export interface BusinessHoursDay extends BusinessHoursWindow {
  enabled?: boolean;
  /** Further windows of the same day after the first (a lunch break makes two). */
  extra?: BusinessHoursWindow[];
}

export interface BusinessHours {
  days?: Record<string, BusinessHoursDay | undefined>;
  /** Dates ("YYYY-MM-DD", workspace zone) closed all day. */
  holidays?: Array<{ date?: string; label?: string } | undefined>;
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** The workspace's hours as saved (a JSON string in Reference's column, or already an object). Anything unreadable is "no config". */
export function parseBusinessHours(raw: unknown): BusinessHours | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'object') return raw as BusinessHours;
  try {
    const v = JSON.parse(String(raw)) as unknown;
    return v !== null && typeof v === 'object' ? (v as BusinessHours) : null;
  } catch {
    return null;
  }
}

/** Day and "HH:mm" of an instant in a time zone; an unknown zone falls back to UTC. */
export function localParts(
  at: Date,
  timeZone: string,
): { day: (typeof DAY_KEYS)[number]; hhmm: string; date: string } {
  const read = (tz: string) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at);
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = read(timeZone || 'UTC');
  } catch {
    parts = read('UTC');
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const day = get('weekday').slice(0, 3).toLowerCase() as (typeof DAY_KEYS)[number];
  return {
    day: DAY_KEYS.includes(day) ? day : 'mon',
    hhmm: `${get('hour')}:${get('minute')}`,
    date: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

/** The windows a day is open in, in the order saved; none when the day is missing or switched off. */
export function windowsOf(day: BusinessHoursDay | undefined): Array<{ from: string; to: string }> {
  if (!day || !day.enabled) return [];
  const all = [day, ...(Array.isArray(day.extra) ? day.extra : [])];
  return all.map((w) => ({ from: w?.from ?? '00:00', to: w?.to ?? '23:59' }));
}

/** Whether the workspace is closed all of `date` ("YYYY-MM-DD" in its zone) by a listed holiday. */
export function isHoliday(cfg: BusinessHours, date: string): boolean {
  return Array.isArray(cfg.holidays) && cfg.holidays.some((h) => h?.date === date);
}

/** Whether `hhmm` falls in a window of the same day: [from, to), where "24:00" is the end of the day and an overnight window reaches midnight. */
function inWindow(hhmm: string, w: { from: string; to: string }): boolean {
  return w.from > w.to ? hhmm >= w.from : hhmm >= w.from && hhmm < w.to;
}

/**
 * Whether the workspace is closed at `at` (TW-FLR-007 rule 2): no config, or no `days`, means always open; a holiday (a listed date in
 * the workspace zone) is closed all day; a day that is missing or switched off is closed all day; otherwise the time must lie in one of
 * the day's windows [from, to). A window may end at "24:00". An overnight window (from after to, a night shift) is open from `from`
 * through midnight and until `to` the next morning; Reference compared the strings and made such a range closed or open at random.
 */
export function isOutsideBusinessHours(
  raw: unknown,
  timeZone: string,
  at: Date = new Date(),
): boolean {
  const cfg = parseBusinessHours(raw);
  if (!cfg || !cfg.days || Object.keys(cfg.days).length === 0) return false;
  const { day, hhmm, date } = localParts(at, timeZone);
  if (isHoliday(cfg, date)) return true;
  // The small hours of an overnight window belong to yesterday's day.
  const yesterday = cfg.days[DAY_KEYS[(DAY_KEYS.indexOf(day) + 6) % 7]!];
  if (windowsOf(yesterday).some((w) => w.from > w.to && hhmm < w.to)) return false;
  return !windowsOf(cfg.days[day]).some((w) => inWindow(hhmm, w));
}

/** Whether the schedule has more than one window on some day, so an open hour is not necessarily open throughout. */
export function hasSplitDays(raw: unknown): boolean {
  const cfg = parseBusinessHours(raw);
  return Object.values(cfg?.days ?? {}).some(
    (d) => d?.enabled === true && Array.isArray(d.extra) && d.extra.length > 0,
  );
}
