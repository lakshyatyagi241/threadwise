import type { HealthResponse } from '@crm/contracts';

export type PillState = 'ok' | 'warn' | 'down';
export interface Pill {
  state: PillState;
  /** Failed jobs across the queues (state `warn`). */
  stuck: number;
}

/**
 * The header health pill (WD-ASHELL-006), from the console's health snapshot. WaDesk pings the database, then counts
 * jobs reserved for over ten minutes; here the database probe is the same and a failed job in any queue is the "stuck" count,
 * because BullMQ keeps a job that ran out of retries rather than leaving it reserved. No snapshot yet reads as normal,
 * like a WaDesk page whose probe could not run.
 */
export function pillFor(snapshot: HealthResponse | undefined): Pill {
  if (!snapshot) return { state: 'ok', stuck: 0 };
  if (snapshot.checks.some((c) => c.key === 'database' && c.state === 'down')) {
    return { state: 'down', stuck: 0 };
  }
  const stuck = snapshot.queues.reduce((n, q) => n + q.failed, 0);
  return stuck > 0 ? { state: 'warn', stuck } : { state: 'ok', stuck: 0 };
}

/** "3 minutes ago" in the page language; a future or unparseable time reads as now. */
export function timeAgo(iso: string, now: number, locale: string): string {
  const then = Date.parse(iso);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (Number.isNaN(then)) return rtf.format(0, 'second');
  const secs = Math.max(0, Math.round((now - then) / 1000));
  const steps: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  for (const [unit, size] of steps) {
    if (secs >= size) return rtf.format(-Math.floor(secs / size), unit);
  }
  return rtf.format(0, 'second');
}

/** First letters of the first two words of the name, upper-cased ("Ana Maria Lopez" gives "AM"); WA when there is no name. */
export function initials(name: string | null | undefined, email?: string): string {
  const base = (name?.trim() || email?.split('@')[0] || '').trim();
  const parts = base.split(/\s+/).filter(Boolean);
  const text = `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase();
  return text || 'WA';
}
