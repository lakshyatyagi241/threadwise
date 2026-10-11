import { ApiError } from '@/lib/api';
import { latinDigits } from '@/lib/format/numbers';

/** Display helpers for the dashboard. Pure. */

export type Greeting = 'morning' | 'afternoon' | 'evening';

/** The greeting in the workspace's time zone: before noon, before five, else evening (TW-DASH-001). */
export function greetingKey(now: Date, timezone: string): Greeting {
  let hour: number;
  try {
    hour = Number(
      new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: 'numeric',
        hourCycle: 'h23',
      }).format(now),
    );
  } catch {
    hour = now.getHours();
  }
  if (!Number.isFinite(hour)) hour = now.getHours();
  return hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
}

/** "Saturday, October 10" in the person's language and the workspace's zone. */
export function longDate(now: Date, locale: string, timezone: string): string {
  const options = { weekday: 'long', month: 'long', day: 'numeric' } as const;
  try {
    return new Intl.DateTimeFormat(latinDigits(locale), { timeZone: timezone, ...options }).format(
      now,
    );
  } catch {
    return now.toDateString();
  }
}

/** The hour of a chart bucket ("14:00") or its day ("Oct 10"), in the workspace's zone. */
export function bucketLabel(
  iso: string,
  hourly: boolean,
  locale: string,
  timezone: string,
): string {
  const options = hourly
    ? ({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' } as const)
    : ({ month: 'short', day: 'numeric' } as const);
  try {
    return new Intl.DateTimeFormat(latinDigits(locale), { timeZone: timezone, ...options }).format(
      new Date(iso),
    );
  } catch {
    return iso.slice(hourly ? 11 : 5, hourly ? 16 : 10);
  }
}

/** An amount in a currency, grouped for the locale; a currency the runtime does not know falls back to the code and the number. */
export function formatMoney(amount: number, currency: string, locale: string, digits = 2): string {
  try {
    return new Intl.NumberFormat(latinDigits(locale), {
      style: 'currency',
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(digits)}`;
  }
}

export type AgoUnit = 'minute' | 'hour' | 'day';

/** How long ago an instant was, as a whole number of the largest fitting unit: 5 minutes, 3 hours, 2 days. */
export function ago(from: string | Date, now: Date): { unit: AgoUnit; count: number } {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(from).getTime()) / 60_000));
  if (minutes < 60) return { unit: 'minute', count: minutes };
  if (minutes < 1_440) return { unit: 'hour', count: Math.round(minutes / 60) };
  return { unit: 'day', count: Math.round(minutes / 1_440) };
}

/** Followers read as 1.2k from a thousand up (TW-DASH-008). */
export const followersLabel = (n: number): string =>
  n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n);

/** "order_paid" -> "Order paid". */
export const humanize = (value: string): string =>
  value.charAt(0).toUpperCase() + value.slice(1).replaceAll('_', ' ');

/** The role is not allowed on the dashboard (the web sends such a person to the inbox; the app has no inbox yet). */
export const isForbidden = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 403;

/** The plan does not include the feature. */
export const isPlanLocked = (error: unknown): boolean =>
  error instanceof ApiError && error.code === 'PLAN_FEATURE_LOCKED';
