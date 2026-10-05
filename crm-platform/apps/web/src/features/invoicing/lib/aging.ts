import { AGING_BUCKETS, type AgingBucket } from '@crm/contracts';
import { addDays } from './dates';
import { exponentOf } from './money';

/**
 * Aging is computed by the server (`GET /payments/aging`: per currency, five buckets by days past the due date). What lives
 * here is presentation only: the bucket order, the shares of the total (integer math, never floats on money) and the invoice-list
 * range a bucket opens.
 */
export const BUCKETS = AGING_BUCKETS;
export type BucketKey = AgingBucket;

/** A major-units decimal string ("1250.00", "-3.5") as exact minor units of `currency`. */
export function minorBig(major: string | null | undefined, currency: string): bigint {
  if (!major) return 0n;
  const exp = exponentOf(currency);
  const neg = major.startsWith('-');
  const [i = '0', f = ''] = major.replace(/^[-+]/, '').split('.');
  const minor = BigInt((i || '0') + f.padEnd(exp, '0').slice(0, exp));
  return neg ? -minor : minor;
}

/** The same, as a number (every amount the API sends is far below 2^53 minor units). */
export const minorNum = (major: string | null | undefined, currency: string): number =>
  Number(minorBig(major, currency));

/** Share of `part` in `total` in tenths of a percent (417 = 41.7%), rounded half up; 0 when there is no total. */
export function shareTenths(part: bigint, total: bigint): number {
  if (total <= 0n || part <= 0n) return 0;
  return Number((part * 2000n + total) / (2n * total));
}

/** "41.7%" (a whole number when it is one: "50%"). */
export function shareLabel(tenths: number): string {
  const whole = Math.floor(tenths / 10);
  const frac = tenths % 10;
  return frac === 0 ? `${whole}%` : `${whole}.${frac}%`;
}

export interface BucketRow {
  bucket: BucketKey;
  amount: bigint;
  invoices: number;
  tenths: number;
}

interface WireBucket {
  bucket: BucketKey;
  amount: string;
  invoices: number;
}

/** The five buckets in display order (a bucket the server left out counts as zero), with their share of the total. */
export function bucketRows(buckets: readonly WireBucket[], currency: string): BucketRow[] {
  const byKey = new Map(buckets.map((b) => [b.bucket, b]));
  const amounts = BUCKETS.map((b) => minorBig(byKey.get(b)?.amount, currency));
  const total = amounts.reduce((a, b) => a + b, 0n);
  return BUCKETS.map((bucket, i) => ({
    bucket,
    amount: amounts[i]!,
    invoices: byKey.get(bucket)?.invoices ?? 0,
    tenths: shareTenths(amounts[i]!, total),
  }));
}

/**
 * The due-date window of a bucket as of `asOf`: `current` is not yet due (due today or later), `d1_30` was due 1 to 30 days
 * ago, and `d90_plus` has only an upper end.
 */
export function bucketRange(bucket: BucketKey, asOf: string): { dueFrom?: string; dueTo?: string } {
  switch (bucket) {
    case 'current':
      return { dueFrom: asOf };
    case 'd1_30':
      return { dueFrom: addDays(asOf, -30), dueTo: addDays(asOf, -1) };
    case 'd31_60':
      return { dueFrom: addDays(asOf, -60), dueTo: addDays(asOf, -31) };
    case 'd61_90':
      return { dueFrom: addDays(asOf, -90), dueTo: addDays(asOf, -61) };
    case 'd90_plus':
      return { dueTo: addDays(asOf, -91) };
  }
}

export const OPEN_STATUSES = 'issued,partially_paid,overdue';

/** The invoice list that holds a bucket's invoices (optionally of one currency or contact). */
export function bucketHref(
  bucket: BucketKey,
  asOf: string,
  narrow: { currency?: string; contact?: string } = {},
): string {
  const p = new URLSearchParams({ status: OPEN_STATUSES });
  const r = bucketRange(bucket, asOf);
  if (r.dueFrom) p.set('dueFrom', r.dueFrom);
  if (r.dueTo) p.set('dueTo', r.dueTo);
  if (narrow.currency) p.set('currency', narrow.currency);
  if (narrow.contact) p.set('contact', narrow.contact);
  return `/invoices?${p.toString().replace(/%2C/g, ',')}`;
}
