/**
 * "On leave until 20 Oct" for the assignee pickers (BL-112). `until` is a calendar day of the WORKSPACE (`YYYY-MM-DD`): it is formatted at
 * UTC midnight in UTC so it is the same day for everybody, whatever zone their browser is in. Null = an open-ended leave.
 */
export function leaveDayText(day: string, locale: string): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(y, m - 1, d)));
}
