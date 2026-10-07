import {
  DEFAULT_REFERRAL_RANGE,
  ERROR_CODES,
  REFERRAL_PAGE_SIZE,
  walletMinorToMajor,
  type ReferralBucket,
  type ReferralListQuery,
  type ReferralOverview,
  type ReferralRange,
  type ReferralRow,
  type ReferralVolumePoint,
} from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

/**
 * Pure helpers of the Affiliate screen (TW-CPN-035..037). Nothing here touches React or the network, so each rule is a
 * plain unit test. Money is an integer count of hundredths of the platform currency, next to the `currency` code.
 */

export const SEARCH_DEBOUNCE_MS = 250;
export const MIN_BAR_PERCENT = 2;

export interface AffiliateFilters {
  range: ReferralRange;
  bucket: ReferralBucket;
  /** What is applied to the API (already debounced). */
  q: string;
}

/** The bucket the screen starts a range on: daily up to 14 days, weekly up to 90, monthly beyond. Always sent to the API. */
export function defaultBucketFor(range: ReferralRange): ReferralBucket {
  switch (range) {
    case '7d':
      return 'daily';
    case '30d':
    case '90d':
      return 'weekly';
    case 'all':
      return 'monthly';
  }
}

export function initialFilters(): AffiliateFilters {
  return {
    range: DEFAULT_REFERRAL_RANGE,
    bucket: defaultBucketFor(DEFAULT_REFERRAL_RANGE),
    q: '',
  };
}

/** A new range brings its own default bucket (a 7-day window drawn monthly would be one bar). */
export function withRange(f: AffiliateFilters, range: ReferralRange): AffiliateFilters {
  return { ...f, range, bucket: defaultBucketFor(range) };
}

/** The list request. The selected bucket is ALWAYS sent, so choosing Daily really returns daily points. */
export function buildListQuery(f: AffiliateFilters, cursor: string | undefined): ReferralListQuery {
  const q = f.q.trim();
  return {
    range: f.range,
    bucket: f.bucket,
    q: q === '' ? undefined : q,
    cursor,
    limit: REFERRAL_PAGE_SIZE,
  };
}

export const hasSearch = (f: AffiliateFilters): boolean => f.q.trim() !== '';

/** Amount in the platform currency; an unknown code falls back to "CODE 2.50". The ONE formatter of the screen. */
export function money(minor: number, currency: string, locale: string): string {
  const major = walletMinorToMajor(minor);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(major as unknown as number);
  } catch {
    return `${currency} ${major}`;
  }
}

/** "+12%", "-5%" or "0%": the change against the previous window of the same length. */
export function formatDelta(deltaPercent: number): string {
  if (deltaPercent > 0) return `+${deltaPercent}%`;
  if (deltaPercent < 0) return `-${Math.abs(deltaPercent)}%`;
  return '0%';
}

export type DeltaTone = 'success' | 'danger' | 'neutral';
export const deltaTone = (deltaPercent: number): DeltaTone =>
  deltaPercent > 0 ? 'success' : deltaPercent < 0 ? 'danger' : 'neutral';

/** What the reward sentence says: nothing is paid right now, or an amount and (pay-per-message only) the messages it covers. */
export type RewardLine =
  { kind: 'none' } | { kind: 'reward'; rewardMinor: number; messages: number | null };

export function rewardLine(
  o: Pick<ReferralOverview, 'rewardMinor' | 'payPerMessage' | 'messagePriceMinor'>,
): RewardLine {
  if (o.rewardMinor <= 0) return { kind: 'none' };
  return {
    kind: 'reward',
    rewardMinor: o.rewardMinor,
    messages: o.payPerMessage ? Math.floor(o.rewardMinor / o.messagePriceMinor) : null,
  };
}

/** Width of a top-code bar: proportional to the busiest code, never thinner than 2% so a code with one referral is visible. */
export function barPercent(value: number, max: number): number {
  if (max <= 0) return MIN_BAR_PERCENT;
  return Math.min(100, Math.max(MIN_BAR_PERCENT, Math.round((value / max) * 100)));
}

/** First letters of the first and last word of the name (or of the email when there is no name). */
export function initials(row: Pick<ReferralRow, 'refereeName' | 'refereeEmail'>): string {
  const source = (row.refereeName ?? '').trim() || (row.refereeEmail ?? '').trim();
  const words = source.split(/[\s@._-]+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]!.charAt(0);
  const last = words.length > 1 ? words[words.length - 1]!.charAt(0) : '';
  return (first + last).toUpperCase();
}

/** The first block of a wallet entry id ("1f3a9c2e"), for the table; the full id is the cell's title. */
export const shortTxId = (id: string): string => id.slice(0, 8);

/** "1-20 of 45": the rows on screen given how many pages were left behind. Null when the table is empty. */
export function shownRange(
  pageIndex: number,
  limit: number,
  rowCount: number,
  total: number,
): { from: number; to: number; total: number } | null {
  if (rowCount <= 0) return null;
  const from = pageIndex * limit + 1;
  return { from, to: from + rowCount - 1, total: Math.max(total, from + rowCount - 1) };
}

/** The cursors visited so far; the last one is the page on screen (`undefined` = the first page). */
export type CursorStack = ReadonlyArray<string | undefined>;
export const FIRST_PAGE: CursorStack = [undefined];
export const pushCursor = (s: CursorStack, cursor: string): CursorStack => [...s, cursor];
export const popCursor = (s: CursorStack): CursorStack => (s.length > 1 ? s.slice(0, -1) : s);
export const currentCursor = (s: CursorStack): string | undefined => s[s.length - 1];
export const pageIndexOf = (s: CursorStack): number => s.length - 1;

export interface ChartData {
  labels: string[];
  signups: number[];
  creditsMinor: number[];
}

/** Bucket start (UTC `YYYY-MM-DD`) as an axis label: "Mar 5" for days and weeks, "Mar 2026" for months. */
export function bucketLabel(start: string, bucket: ReferralBucket, locale: string): string {
  const d = new Date(`${start}T00:00:00Z`);
  const opts: Intl.DateTimeFormatOptions =
    bucket === 'monthly'
      ? { month: 'short', year: 'numeric', timeZone: 'UTC' }
      : { month: 'short', day: 'numeric', timeZone: 'UTC' };
  return new Intl.DateTimeFormat(locale, opts).format(d);
}

export function chartData(
  volume: readonly ReferralVolumePoint[],
  bucket: ReferralBucket,
  locale: string,
): ChartData {
  return {
    labels: volume.map((p) => bucketLabel(p.start, bucket, locale)),
    signups: volume.map((p) => p.signups),
    creditsMinor: volume.map((p) => p.creditsMinor),
  };
}

/** Runs `fire` with the last value once `ms` passed without a newer one. */
export function createDebouncer<T>(ms: number, fire: (value: T) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    push(value: T) {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        fire(value);
      }, ms);
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}

export type AffiliateErrorKind =
  'unauthenticated' | 'forbidden' | 'rateLimited' | 'validation' | 'network' | 'generic';

/** Which sentence a failed call gets. Branches on the problem+json `code` and status, never on the API's wording. */
export function affiliateErrorKind(error: unknown): AffiliateErrorKind {
  if (!(error instanceof ApiError)) return 'network';
  switch (error.code) {
    case ERROR_CODES.UNAUTHENTICATED:
      return 'unauthenticated';
    case ERROR_CODES.FORBIDDEN:
      return 'forbidden';
    case ERROR_CODES.RATE_LIMITED:
      return 'rateLimited';
    case ERROR_CODES.VALIDATION_FAILED:
      return 'validation';
  }
  if (error.status === 401) return 'unauthenticated';
  if (error.status === 403) return 'forbidden';
  if (error.status === 429) return 'rateLimited';
  return 'generic';
}

export const requestIdOf = (error: unknown): string | undefined =>
  error instanceof ApiError ? error.requestId : undefined;

export interface CopyDeps {
  copy: (text: string) => Promise<boolean>;
  notify: (kind: 'copied' | 'copyFailed') => void;
}

/** Copies the referral link and says whether it worked. A refused clipboard is a message, never a thrown error. */
export async function copyReferralLink(link: string, deps: CopyDeps): Promise<boolean> {
  let ok = false;
  try {
    ok = await deps.copy(link);
  } catch {
    ok = false;
  }
  deps.notify(ok ? 'copied' : 'copyFailed');
  return ok;
}

export interface ExportDeps {
  download: (range: ReferralRange) => Promise<{ blob: Blob; fileName: string }>;
  save: (blob: Blob, fileName: string) => void;
  notify: (kind: 'exported' | 'failed', detail: string) => void;
}

/** The CSV of the current range (search is not applied: the export is the whole range). */
export async function runExport(range: ReferralRange, deps: ExportDeps): Promise<void> {
  try {
    const { blob, fileName } = await deps.download(range);
    deps.save(blob, fileName);
    deps.notify('exported', fileName);
  } catch (err) {
    deps.notify('failed', affiliateErrorKind(err));
  }
}
