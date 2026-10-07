export interface BusinessHours {
  days?: Record<string, { enabled?: boolean; from?: string; to?: string } | undefined>;
}

const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

/** The workspace's hours as saved (a JSON string in WaDesk's column, or already an object). Anything unreadable is "no config". */
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
): { day: (typeof DAY_KEYS)[number]; hhmm: string } {
  const read = (tz: string) =>
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
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
  return { day: DAY_KEYS.includes(day) ? day : 'mon', hhmm: `${get('hour')}:${get('minute')}` };
}

/**
 * Whether the workspace is closed at `at` (WD-FLR-007 rule 2): no config, or no `days`, means always open; a day that is missing or
 * switched off is closed all day; otherwise the time must lie in [from, to). An overnight range (from after to, a night shift) is
 * open from `from` through midnight and until `to` the next morning; WaDesk compared the strings and made such a range closed or open
 * at random.
 */
export function isOutsideBusinessHours(
  raw: unknown,
  timeZone: string,
  at: Date = new Date(),
): boolean {
  const cfg = parseBusinessHours(raw);
  if (!cfg || !cfg.days || Object.keys(cfg.days).length === 0) return false;
  const { day, hhmm } = localParts(at, timeZone);
  const today = cfg.days[day];
  // The small hours of an overnight shift belong to yesterday's window.
  const yesterday = cfg.days[DAY_KEYS[(DAY_KEYS.indexOf(day) + 6) % 7]!];
  if (
    yesterday?.enabled &&
    (yesterday.from ?? '00:00') > (yesterday.to ?? '23:59') &&
    hhmm < (yesterday.to ?? '23:59')
  ) {
    return false;
  }
  if (!today || !today.enabled) return true;
  const from = today.from ?? '00:00';
  const to = today.to ?? '23:59';
  if (from > to) return hhmm < from; // overnight: open from `from` until midnight
  return hhmm < from || hhmm >= to;
}
