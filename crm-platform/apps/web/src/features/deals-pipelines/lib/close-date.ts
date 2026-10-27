/**
 * The expected close date of an OPEN deal is when the person expects to win it, so a new one is today or later. A deal already past
 * its date stays overdue (the card says so) until its date is moved forward or it is won or lost: only a date that is being SET to a day
 * that has gone is refused. The same rule runs on the server (`isPastCloseDate` in deal-rules), with a day of grace for time zones.
 */

const pad = (n: number): string => String(n).padStart(2, '0');

/** Today in the browser's time zone as `YYYY-MM-DD`, what a date input's `min` takes. */
export function todayInput(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** True when `day` (`YYYY-MM-DD`) is before today. */
export function isPastCloseDate(day: string, now: Date = new Date()): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && day < todayInput(now);
}
