import { createHash } from 'node:crypto';
import type { SummaryCaveat } from '@crm/contracts';
import { AppError } from '../../../common/errors/app-error';

/** Pure rules of the director summary: windows, the median, the day buckets, the cursor and the cache key. */

const DAY_MS = 86_400_000;

/** How long a computed summary is reused: reopening the page and a polling screen cost one computation a minute. */
export const SUMMARY_CACHE_SECONDS = 60;
/** A figure that has not come back by now is not worth holding a connection for. */
export const SUMMARY_TIMEOUT_MS = 20_000;
export const MAX_DAY_BUCKETS = 31;

/** The median is worked out by the database (`percentile_cont`) in seconds; the screen reads hours, one decimal. */
export const secondsToHours = (secs: number): number => Math.round((secs / 3600) * 10) / 10;

/**
 * The constant time range every message probe is bounded by, so Postgres can drop the monthly partitions that cannot hold a reply:
 * from the earliest send to the latest send plus the window. Null when nothing was sent.
 */
export function windowBounds(
  firstSentAt: Date | null,
  lastSentAt: Date | null,
  days: number,
): { from: Date; to: Date } | null {
  if (!firstSentAt || !lastSentAt) return null;
  return { from: firstSentAt, to: new Date(lastSentAt.getTime() + days * DAY_MS) };
}

/** The UTC day of an instant, `YYYY-MM-DD`. */
export const utcDay = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Zero-fills nothing: the days that have a reply, oldest first, capped at the contract's 31. When there are more days than that the
 * earliest ones are kept (the chart starts at the send).
 */
export function dayBuckets(
  rows: ReadonlyArray<{ day: string; count: number }>,
): Array<{ day: string; count: number }> {
  return [...rows].sort((a, b) => a.day.localeCompare(b.day)).slice(0, MAX_DAY_BUCKETS);
}

export interface SummaryFlags {
  notTrackable: number;
  hasFilledForm: boolean;
  optedOutWroteBack: boolean;
  inOtherCampaigns: boolean;
}

/** The reasons a number is a floor, in the order the screen lists them. */
export function caveatsOf(f: SummaryFlags): SummaryCaveat[] {
  const out: SummaryCaveat[] = [];
  if (f.notTrackable > 0) out.push('recipients_without_contact');
  if (f.hasFilledForm) out.push('contact_match_only');
  if (f.optedOutWroteBack) out.push('opted_out_excluded');
  if (f.inOtherCampaigns) out.push('counted_in_other_campaigns');
  return out;
}

/**
 * The Redis key of a computed summary. The picked forms are sorted and hashed so the same set in any order is one entry; the
 * workspace is part of the key, so a copied campaign id from another tenant can never read this one's numbers.
 */
export function cacheKey(
  orgId: number,
  kind: 'campaign' | 'broadcast',
  id: string,
  days: number,
  formIds: readonly string[],
): string {
  const forms =
    formIds.length === 0
      ? 'all'
      : createHash('sha256')
          .update([...new Set(formIds)].sort().join(','))
          .digest('hex')
          .slice(0, 16);
  return `camp-summary:${orgId}:${kind}:${id}:${days}:${forms}`;
}

/** A page position: the person's sort instant (microseconds since the epoch, exact) and the tiebreak key. */
export interface SummaryCursor {
  /** Microseconds since the epoch; null sorts last. */
  at: string | null;
  key: string;
}

export function encodeCursor(c: SummaryCursor): string {
  return Buffer.from(JSON.stringify([c.at, c.key]), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string | undefined): SummaryCursor | null {
  if (raw === undefined || raw === '') return null;
  const bad = () =>
    AppError.validation('The cursor is not valid', [{ path: 'cursor', message: 'invalid' }]);
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw bad();
  }
  if (!Array.isArray(parsed) || parsed.length !== 2) throw bad();
  const [at, key] = parsed as [unknown, unknown];
  if (at !== null && !(typeof at === 'string' && /^\d{1,19}$/.test(at))) throw bad();
  if (typeof key !== 'string' || key.length === 0 || key.length > 80) throw bad();
  return { at, key };
}
