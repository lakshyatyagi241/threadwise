/**
 * The window every card of the dashboard shows: two calendar days (YYYY-MM-DD, both included), cut at midnight in the workspace's
 * time zone by the API. Every window goes to the API as `range=custom&from&to`, so "last 7 days" and a hand-picked fortnight are the
 * same request. The API takes at most 366 days.
 */
export interface DashWindow {
  from: string;
  to: string;
}

/** The query a window becomes. */
export const windowQuery = (win: DashWindow) => ({
  range: 'custom' as const,
  from: win.from,
  to: win.to,
});

const day = (date: string) => new Date(`${date}T00:00:00Z`);

/** "13 Sep – 12 Oct 2026": the window as a person reads it, in the app's language. */
export function windowLabel(win: DashWindow, locale: string): string {
  const short = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  const full = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
  if (win.from === win.to) return full.format(day(win.to));
  return `${short.format(day(win.from))} – ${full.format(day(win.to))}`;
}
