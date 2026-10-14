/**
 * Calendar days and local midnights for the CRM dashboard. Pure, DST-safe: a "day" here is a calendar date string and the instant a
 * zone's day begins is looked up at the offset that holds at that instant (not guessed as a multiple of 24 hours).
 */

const DAY_MS = 86_400_000;

const ymdToUtc = (ymd: string): number => {
  const [y, m, d] = ymd.split('-').map(Number) as [number, number, number];
  return Date.UTC(y, m - 1, d);
};
const utcToYmd = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export const addDays = (ymd: string, n: number): string => utcToYmd(ymdToUtc(ymd) + n * DAY_MS);
export const daysBetween = (a: string, b: string): number =>
  Math.round((ymdToUtc(b) - ymdToUtc(a)) / DAY_MS);

/** Offset of `tz` from UTC at an instant, in ms (positive east of Greenwich). */
function zoneOffsetMs(tz: string, at: Date): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    })
      .formatToParts(at)
      .map((x) => [x.type, Number(x.value)]),
  ) as Record<string, number>;
  const local = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!, p.second!);
  return local - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant the zone's calendar day `ymd` begins. */
export function zonedMidnight(ymd: string, tz: string): Date {
  const guess = ymdToUtc(ymd);
  const first = guess - zoneOffsetMs(tz, new Date(guess));
  const second = guess - zoneOffsetMs(tz, new Date(first));
  return new Date(second);
}
