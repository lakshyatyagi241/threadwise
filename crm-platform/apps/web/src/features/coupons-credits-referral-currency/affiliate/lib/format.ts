import { walletMinorToMajor, type ReferralBucket, type ReferralRange } from '@crm/contracts';

/**
 * Pure helpers of the Affiliate screens (TW-CPN-035..037). Money is one convention everywhere: the API sends hundredths
 * (`*Minor`) of the platform currency and the screens show money in that currency (Reference's history page showed the raw
 * integers as "credits" while its account tab showed money).
 */

/** Hundredths to text in `currency`; Intl formats the decimal string itself, so no float ever holds an amount. */
export function formatMoney(minor: number, currency: string, locale: string): string {
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

/** "+$2.50": a payout or reward is always shown as money coming in. */
export const plusMoney = (minor: number, currency: string, locale: string): string =>
  `+${formatMoney(minor, currency, locale)}`;

export const RANGES: readonly ReferralRange[] = ['7d', '30d', '90d', 'all'];
export const DEFAULT_RANGE: ReferralRange = '90d';
export const BUCKETS: readonly ReferralBucket[] = ['daily', 'weekly', 'monthly'];

/** Reference treated "all time" as 1825 days when bucketing. */
const RANGE_DAYS: Record<ReferralRange, number> = { '7d': 7, '30d': 30, '90d': 90, all: 1825 };
export const rangeDays = (range: ReferralRange): number => RANGE_DAYS[range];

/**
 * The bucket used when the person has not picked one: daily up to 14 days, weekly up to 90, else monthly. The client
 * always sends it explicitly (Reference left Daily off the query, so the server picked weekly for 90 days).
 */
export function defaultBucket(range: ReferralRange): ReferralBucket {
  const days = rangeDays(range);
  return days <= 14 ? 'daily' : days <= 90 ? 'weekly' : 'monthly';
}

export const isRange = (v: string | null | undefined): v is ReferralRange =>
  RANGES.includes(v as ReferralRange);
export const isBucket = (v: string | null | undefined): v is ReferralBucket =>
  BUCKETS.includes(v as ReferralBucket);

/** The screen's filters. `bucket` is null until the person picks a tab. */
export interface AffiliateFilters {
  range: ReferralRange;
  bucket: ReferralBucket | null;
  q: string;
}
export const EMPTY_FILTERS: AffiliateFilters = { range: DEFAULT_RANGE, bucket: null, q: '' };

export const effectiveBucket = (f: AffiliateFilters): ReferralBucket =>
  f.bucket ?? defaultBucket(f.range);

export function parseFilters(params: { get(name: string): string | null }): AffiliateFilters {
  const range = params.get('range');
  const bucket = params.get('bucket');
  return {
    range: isRange(range) ? range : DEFAULT_RANGE,
    bucket: isBucket(bucket) ? bucket : null,
    q: (params.get('q') ?? '').trim(),
  };
}

/** The visible address: only what differs from the defaults, as Reference kept it. Empty string for the plain page. */
export function toSearch(f: AffiliateFilters): string {
  const p = new URLSearchParams();
  if (f.range !== DEFAULT_RANGE) p.set('range', f.range);
  if (f.bucket) p.set('bucket', f.bucket);
  if (f.q) p.set('q', f.q);
  const s = p.toString();
  return s ? `?${s}` : '';
}

/** "+12%" / "0%" / "-8%", and whether it reads as good (zero counts as good, as in Reference). */
export function deltaView(pct: number): { text: string; tone: 'success' | 'danger' } {
  return { text: `${pct > 0 ? '+' : ''}${pct}%`, tone: pct >= 0 ? 'success' : 'danger' };
}

/** First letter of the first and last word of the name; "?" for an empty one. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0]!;
  const last = words.length > 1 ? words[words.length - 1]! : '';
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
}

export const AVATAR_GRADIENTS = 5;

/** Which of the five gradients a referee gets. Reference used the numeric id modulo 5; ours are uuids, so the number is the id's first 32 bits. */
export function avatarIndex(id: string): number {
  const n = parseInt(id.replace(/[^0-9a-f]/gi, '').slice(0, 8) || '0', 16);
  return (Number.isFinite(n) ? n : 0) % AVATAR_GRADIENTS;
}

/** The wallet transaction label of a paid row: "tx-" and the first 8 characters of its id; null for an unpaid row. */
export const txLabel = (walletTxId: string | null): string | null =>
  walletTxId ? `tx-${walletTxId.slice(0, 8)}` : null;

/** "a" and "b" of "Showing a-b of N" for page `page` (1-based) holding `rows` rows. */
export function shownRange(
  page: number,
  pageSize: number,
  rows: number,
): { from: number; to: number } {
  if (rows <= 0) return { from: 0, to: 0 };
  const from = (page - 1) * pageSize + 1;
  return { from, to: from + rows - 1 };
}

/** The most labels the volume chart draws on its x axis. */
export const MAX_X_LABELS = 10;

/** Evenly spread indexes of at most `max` labels, always including the first and the last. */
export function labelIndexes(count: number, max = MAX_X_LABELS): number[] {
  if (count <= 0) return [];
  if (count <= max) return Array.from({ length: count }, (_, i) => i);
  const step = (count - 1) / (max - 1);
  return [...new Set(Array.from({ length: max }, (_, i) => Math.round(i * step)))];
}

/**
 * A round axis top for `value` and the evenly spaced ticks from 0 to it (`steps` intervals). `whole` keeps every tick an
 * integer (a count of people); an empty series still gets a readable 0..steps axis.
 */
export function niceScale(
  value: number,
  steps = 4,
  whole = false,
): { max: number; ticks: number[] } {
  const raw = value > 0 ? value : whole ? steps : 1;
  const per = raw / steps;
  const pow = 10 ** Math.floor(Math.log10(per));
  let unit = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((u) => u >= per) ?? 10 * pow;
  if (whole) unit = Math.max(1, Math.ceil(unit));
  return { max: unit * steps, ticks: Array.from({ length: steps + 1 }, (_, i) => unit * i) };
}

/** 1200 -> "1.2k": axis labels stay short. */
export function compactNumber(n: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/** The cursors visited so far; "Previous" pops one. `undefined` is the first page. */
export type CursorStack = ReadonlyArray<string | undefined>;
export const FIRST_PAGE: CursorStack = [undefined];
export const pushCursor = (s: CursorStack, cursor: string): CursorStack => [...s, cursor];
export const popCursor = (s: CursorStack): CursorStack => (s.length > 1 ? s.slice(0, -1) : s);
export const currentCursor = (s: CursorStack): string | undefined => s[s.length - 1];
export const pageNumber = (s: CursorStack): number => s.length;
