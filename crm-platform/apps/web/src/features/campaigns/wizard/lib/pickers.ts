/** Pure helpers behind the date and time pickers (kept apart so they are unit-tested without a browser). */

export interface ClockTime {
  /** 1-12 */
  hour: number;
  /** 0-59 */
  minute: number;
  pm: boolean;
}

/** "HH:MM" (24 hours) to the clock's parts; midnight is 12 AM. A bad value gives 9:00 AM. */
export function parseClock(value: string): ClockTime {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  const h24 = m ? Number(m[1]) : 9;
  const minute = m ? Number(m[2]) : 0;
  if (h24 > 23 || minute > 59) return { hour: 9, minute: 0, pm: false };
  return { hour: h24 % 12 === 0 ? 12 : h24 % 12, minute, pm: h24 >= 12 };
}

/** The clock's parts to "HH:MM" (24 hours). */
export function formatClock(c: ClockTime): string {
  const h24 = (c.hour % 12) + (c.pm ? 12 : 0);
  return `${String(h24).padStart(2, '0')}:${String(c.minute).padStart(2, '0')}`;
}

/** The label shown on the field: "09:58 AM". */
export function clockLabel(value: string): string {
  const c = parseClock(value);
  return `${String(c.hour).padStart(2, '0')}:${String(c.minute).padStart(2, '0')} ${c.pm ? 'PM' : 'AM'}`;
}

/** Where a click at (x, y) relative to the clock's centre points, as a value on a dial of `steps` marks (0 at the top, clockwise). */
export function dialValue(x: number, y: number, steps: number): number {
  const turns = (Math.atan2(x, -y) + 2 * Math.PI) % (2 * Math.PI);
  return Math.round((turns / (2 * Math.PI)) * steps) % steps;
}

/** The centre of mark `i` of `steps`, as offsets in percent of the dial's radius (for placing the numbers). */
export function dialPoint(i: number, steps: number, radius: number): { x: number; y: number } {
  const a = (i / steps) * 2 * Math.PI;
  return { x: Math.sin(a) * radius, y: -Math.cos(a) * radius };
}

export interface CalendarDay {
  iso: string;
  day: number;
  inMonth: boolean;
}

const pad = (n: number) => String(n).padStart(2, '0');
export const isoOf = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;

/** The weeks of a month (Sunday first), padded with the neighbouring months' days: always whole weeks. */
export function monthGrid(year: number, month0: number): CalendarDay[][] {
  const first = new Date(Date.UTC(year, month0, 1));
  const start = new Date(Date.UTC(year, month0, 1 - first.getUTCDay()));
  const weeks: CalendarDay[][] = [];
  const cursor = new Date(start);
  for (let w = 0; w < 6; w++) {
    const week: CalendarDay[] = [];
    for (let d = 0; d < 7; d++) {
      week.push({
        iso: isoOf(cursor.getUTCFullYear(), cursor.getUTCMonth(), cursor.getUTCDate()),
        day: cursor.getUTCDate(),
        inMonth: cursor.getUTCMonth() === month0,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
    if (cursor.getUTCMonth() !== month0 && w >= 3) break;
  }
  return weeks;
}

/** "2026-09-22" to "22/09/2026". */
export function dateLabel(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/** Moves a year-month by `delta` months. */
export function shiftMonth(
  year: number,
  month0: number,
  delta: number,
): { year: number; month0: number } {
  const t = year * 12 + month0 + delta;
  return { year: Math.floor(t / 12), month0: ((t % 12) + 12) % 12 };
}
