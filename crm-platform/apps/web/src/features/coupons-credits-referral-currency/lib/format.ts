import type { CouponItem } from '@crm/contracts';

/** The page numbers around the current one: first, last, and one either side (Laravel's `onEachSide(1)`), with gaps as null. */
export function pageWindow(page: number, pageCount: number): Array<number | null> {
  const keep = new Set(
    [1, pageCount, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pageCount),
  );
  const out: Array<number | null> = [];
  let last = 0;
  for (const n of [...keep].sort((a, b) => a - b)) {
    if (n - last > 1) out.push(null);
    out.push(n);
    last = n;
  }
  return out;
}

/** "Mar 5, 2026" in the viewer's locale; WaDesk used `M j, Y`. */
export function shortDate(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(iso));
}

/** What the Validity column says: "start → end" with `now` / `forever` for an open end, or just `forever`. */
export function validityParts(
  c: Pick<CouponItem, 'startsAt' | 'expiresAt'>,
  locale: string,
): { kind: 'forever' } | { kind: 'range'; from: string | null; to: string | null } {
  if (!c.startsAt && !c.expiresAt) return { kind: 'forever' };
  return {
    kind: 'range',
    from: c.startsAt ? shortDate(c.startsAt, locale) : null,
    to: c.expiresAt ? shortDate(c.expiresAt, locale) : null,
  };
}

/** A fixed amount in a currency, with the currency's own decimals; falls back to "CODE amount" for an unknown code. */
export function money(amount: string, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(amount));
  } catch {
    return `${currency} ${amount}`;
  }
}

/** "in 3 months", "2 days ago": WaDesk's `diffForHumans`, in the viewer's locale. */
export function relativeTime(iso: string, locale: string, now: number = Date.now()): string {
  const diffSec = (new Date(iso).getTime() - now) / 1000;
  const abs = Math.abs(diffSec);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const steps: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['second', 60],
    ['minute', 3600],
    ['hour', 86_400],
    ['day', 2_592_000],
    ['month', 31_536_000],
  ];
  let divisor = 1;
  for (const [unit, limit] of steps) {
    if (abs < limit) return rtf.format(Math.round(diffSec / divisor), unit);
    divisor = limit;
  }
  return rtf.format(Math.round(diffSec / 31_536_000), 'year');
}
