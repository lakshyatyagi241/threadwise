import {
  REFERRAL_CODE_ALPHABET,
  REFERRAL_LIMITS,
  type ReferralBucket,
  type ReferralRange,
} from '@crm/contracts';
import { randomInt } from 'node:crypto';

/** Pure rules of the referral program: code generation, the history windows and chart buckets, the CSV cell. */

/** A fresh code: 10 characters from the confusion-free alphabet, drawn with a cryptographic random (TW-CPN-029). */
export function generateReferralCode(random: (max: number) => number = randomInt): string {
  let code = '';
  for (let i = 0; i < REFERRAL_LIMITS.codeLength; i++) {
    code += REFERRAL_CODE_ALPHABET[random(REFERRAL_CODE_ALPHABET.length)];
  }
  return code;
}

export interface RangeWindow {
  key: ReferralRange;
  from: Date;
  to: Date;
  /** Days the window spans; "all time" counts as 1825 for bucketing, as Reference. */
  days: number;
}

const DAY_MS = 86_400_000;

/** `7d`, `30d`, `90d` or `all` (from 2020-01-01); anything else is 90d. The window ends one second from now. */
export function resolveRange(key: string | undefined, now: Date): RangeWindow {
  const to = new Date(now.getTime() + 1000);
  const days: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90 };
  if (key === 'all') return { key: 'all', from: new Date(Date.UTC(2020, 0, 1)), to, days: 1825 };
  const n = days[key ?? ''] ?? 90;
  const k = (days[key ?? ''] ? key : '90d') as ReferralRange;
  return { key: k, from: new Date(now.getTime() - n * DAY_MS), to, days: n };
}

/** Daily up to 14 days, weekly up to 90, else monthly: only when the caller gave no bucket. */
export function defaultBucket(days: number): ReferralBucket {
  return days <= 14 ? 'daily' : days <= 90 ? 'weekly' : 'monthly';
}

/** Signups vs the previous window of equal length, whole percent (PHP `round`: halves away from zero). */
export function deltaPct(current: number, previous: number): number {
  if (previous <= 0) return current > 0 ? 100 : 0;
  const v = ((current - previous) / previous) * 100;
  return v < 0 ? -Math.round(-v) : Math.round(v);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const md = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, '0')}`;

/** Monday 00:00 UTC of the week containing `d`. */
function weekStart(d: Date): Date {
  const day = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
}

export interface VolumePoint {
  at: Date;
  creditsMinor: number;
}

export interface Volume {
  labels: string[];
  signups: number[];
  creditsMinor: number[];
  bucket: ReferralBucket;
}

/**
 * The signups-and-credits series. Points are anchored to today and run backwards: `days` daily points, `ceil(days/7)` weeks
 * starting Monday, or `ceil(days/30)` months (TW-CPN-035 rule 2). UTC throughout (Reference used the server timezone).
 */
export function volumeSeries(
  points: readonly VolumePoint[],
  days: number,
  bucket: ReferralBucket,
  now: Date,
): Volume {
  let keys: string[];
  let labels: string[];
  let keyOf: (d: Date) => string;
  if (bucket === 'monthly') {
    const n = Math.max(1, Math.ceil(days / 30));
    keyOf = (d) => d.toISOString().slice(0, 7);
    const months = Array.from({ length: n }, (_, i) => {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (n - 1 - i), 1));
      return d;
    });
    keys = months.map((d) => d.toISOString().slice(0, 7));
    labels = months.map((d) => MONTHS[d.getUTCMonth()]!);
  } else if (bucket === 'weekly') {
    const n = Math.max(1, Math.ceil(days / 7));
    keyOf = (d) => ymd(weekStart(d));
    const weeks = Array.from({ length: n }, (_, i) =>
      weekStart(new Date(now.getTime() - (n - 1 - i) * 7 * DAY_MS)),
    );
    keys = weeks.map(ymd);
    labels = weeks.map(md);
  } else {
    keyOf = ymd;
    const dayList = Array.from(
      { length: days },
      (_, i) => new Date(now.getTime() - (days - 1 - i) * DAY_MS),
    );
    keys = dayList.map(ymd);
    labels = dayList.map((d) => (days <= 7 ? WEEKDAYS[d.getUTCDay()]! : md(d)));
  }
  const signups = new Map<string, number>();
  const credits = new Map<string, number>();
  for (const p of points) {
    const k = keyOf(p.at);
    signups.set(k, (signups.get(k) ?? 0) + 1);
    credits.set(k, (credits.get(k) ?? 0) + p.creditsMinor);
  }
  return {
    labels,
    signups: keys.map((k) => signups.get(k) ?? 0),
    creditsMinor: keys.map((k) => credits.get(k) ?? 0),
    bucket,
  };
}

/** A CSV cell: quoted when it needs it, and a leading `=`, `+`, `-` or `@` is defused so a spreadsheet never runs a name as a formula. */
export function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && typeof v === 'string') s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Initials for the referee's avatar: first letters of the first and last words (TW-CPN-035 rule 6). */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '··';
  const first = [...parts[0]!][0] ?? '';
  const last = parts.length > 1 ? ([...parts[parts.length - 1]!][0] ?? '') : '';
  return `${first}${last}`.toUpperCase() || '··';
}
