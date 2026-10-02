import type { Coupon } from '@crm/contracts';

/** "10.0000" -> "10", "12.50" -> "12.5". Display only; the string is never turned back into a number. */
export function trimDecimal(amount: string): string {
  const s = amount.trim();
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * The Discount column. A percent coupon is the trimmed number and "%". A fixed coupon is formatted in the coupon's own currency
 * lock when it has one; without a lock the amount is plain (a fixed coupon applies in whatever currency the order is in, so there
 * is no honest symbol to prefix: documented deviation from Reference, which used the viewer's currency).
 */
export function formatDiscount(
  c: Pick<Coupon, 'type' | 'amount' | 'currencyCode'>,
  locale: string,
): string {
  if (c.type === 'percent') return `${trimDecimal(c.amount)}%`;
  const n = Number(c.amount);
  if (c.currencyCode) {
    try {
      return new Intl.NumberFormat(locale, { style: 'currency', currency: c.currencyCode }).format(
        n,
      );
    } catch {
      return `${c.currencyCode} ${trimDecimal(c.amount)}`;
    }
  }
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(n);
}

/** "12 / 100" or "12 / ∞" when uncapped. */
export function formatUses(usesCount: number, maxUses: number | null, locale: string): string {
  const nf = new Intl.NumberFormat(locale);
  return `${nf.format(usesCount)} / ${maxUses ? nf.format(maxUses) : '∞'}`;
}

export type Validity =
  { kind: 'forever' } | { kind: 'range'; start: string | null; end: string | null };

/** The Validity column: `null` start/end mean the "now" / "forever" placeholders; nothing at all is plain "forever". */
export function validityOf(
  c: Pick<Coupon, 'startsAt' | 'expiresAt'>,
  locale: string,
  timeZone?: string,
): Validity {
  if (!c.startsAt && !c.expiresAt) return { kind: 'forever' };
  const fmt = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone }).format(new Date(iso))
      : null;
  return { kind: 'range', start: fmt(c.startsAt), end: fmt(c.expiresAt) };
}

/** "in 5 days" / "3 days ago", like Reference's diffForHumans. */
export function relativeTo(iso: string, now: Date, locale: string): string {
  const diff = new Date(iso).getTime() - now.getTime();
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'always' });
  const DAY = 86_400_000;
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 365 * DAY],
    ['month', 30 * DAY],
    ['week', 7 * DAY],
    ['day', DAY],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ];
  for (const [unit, ms] of units) {
    if (Math.abs(diff) >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return rtf.format(Math.round(diff / 1000), 'second');
}

/** Cursor pagination as a stack: `cursors[i]` fetches page i (the first page has none). Prev pops, Next pushes. */
export interface CursorStack {
  cursors: ReadonlyArray<string | undefined>;
}
export const firstPage = (): CursorStack => ({ cursors: [undefined] });
export const pageIndexOf = (s: CursorStack): number => s.cursors.length - 1;
export const currentCursor = (s: CursorStack): string | undefined =>
  s.cursors[s.cursors.length - 1];
export const pushCursor = (s: CursorStack, next: string): CursorStack => ({
  cursors: [...s.cursors, next],
});
export const popCursor = (s: CursorStack): CursorStack =>
  s.cursors.length > 1 ? { cursors: s.cursors.slice(0, -1) } : s;

/** "Showing a-b of N": 0-0 when the page is empty. */
export function showingRange(
  pageIndex: number,
  pageSize: number,
  rowsOnPage: number,
): { from: number; to: number } {
  if (rowsOnPage === 0) return { from: 0, to: 0 };
  const from = pageIndex * pageSize + 1;
  return { from, to: from + rowsOnPage - 1 };
}
