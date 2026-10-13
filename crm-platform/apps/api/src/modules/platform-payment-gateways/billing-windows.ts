import type { BillingWindow, InvoiceWindow, OrderWindow } from '@crm/contracts';

/**
 * Time windows, trend buckets and percent changes of the operator billing screens (TW-PAYGW-037, 041, 042, 043). Pure and in
 * UTC, so a report never depends on the server's time zone. The rules are Reference's: the window ends at the end of today, the
 * "previous" window is the same number of days right before it, and the trend picks its own bucket size.
 */

const DAY = 86_400_000;

export interface Range {
  from: Date;
  to: Date;
  prevFrom: Date;
  prevTo: Date;
}

export const startOfDay = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
export const endOfDay = (d: Date): Date => new Date(startOfDay(d).getTime() + DAY - 1);

function lastDays(days: number, now: Date): Range {
  const to = endOfDay(now);
  const from = startOfDay(new Date(to.getTime() - days * DAY));
  const prevTo = new Date(from.getTime() - 1000);
  const prevFrom = startOfDay(new Date(prevTo.getTime() - days * DAY));
  return { from, to, prevFrom, prevTo };
}

/** The `from`/`to` days (YYYY-MM-DD) of a `custom` window; the contract has already checked them. */
export interface CustomDays {
  from?: string;
  to?: string;
}

/** Whole days between the two bounds, both included, and the window that ends at the end of `to`. */
function customRange(c: CustomDays | undefined): Range | null {
  if (!c?.from || !c.to) return null;
  const from = new Date(`${c.from}T00:00:00Z`);
  const to = endOfDay(new Date(`${c.to}T00:00:00Z`));
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) return null;
  const days = Math.round((startOfDay(to).getTime() - from.getTime()) / DAY) + 1;
  const prevTo = new Date(from.getTime() - 1000);
  const prevFrom = startOfDay(new Date(prevTo.getTime() - (days - 1) * DAY));
  return { from, to, prevFrom, prevTo };
}

/** Order history: 90 days (also any unknown value), "this year" = days since 1 January (at least 1), "all" = 5 years. */
export function orderRange(
  window: OrderWindow | string,
  now = new Date(),
  custom?: CustomDays,
): Range {
  if (window === 'custom') return customRange(custom) ?? lastDays(90, now);
  if (window === 'this_year') {
    const jan = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    return lastDays(Math.max(1, Math.floor((now.getTime() - jan.getTime()) / DAY)), now);
  }
  return lastDays(window === 'all' ? 365 * 5 : 90, now);
}

/** Billing history and analytics: 7d, 30d, 90d (default), 1y, all (5 years). */
export function billingRange(
  window: BillingWindow | string,
  now = new Date(),
  custom?: CustomDays,
): Range {
  if (window === 'custom') return customRange(custom) ?? lastDays(90, now);
  const days =
    window === '7d'
      ? 7
      : window === '30d'
        ? 30
        : window === '1y'
          ? 365
          : window === 'all'
            ? 365 * 5
            : 90;
  return lastDays(days, now);
}

/** Invoices: all time, this month, last month, this quarter, this year. */
export function invoiceRange(
  window: InvoiceWindow | string,
  now = new Date(),
): { from: Date; to: Date } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const to = endOfDay(now);
  switch (window) {
    case 'all':
      return { from: new Date(Date.UTC(y - 50, m, 1)), to };
    case 'last_month':
      return {
        from: new Date(Date.UTC(y, m - 1, 1)),
        to: new Date(Date.UTC(y, m, 1) - 1),
      };
    case 'this_quarter':
      return { from: new Date(Date.UTC(y, m - (m % 3), 1)), to };
    case 'this_year':
      return { from: new Date(Date.UTC(y, 0, 1)), to };
    default:
      return { from: new Date(Date.UTC(y, m, 1)), to };
  }
}

/** `((now - prev) / prev) x 100`, one decimal; no previous value gives 100 when there is a current one, else 0. */
export function deltaPct(now: number, prev: number): number {
  if (prev <= 0) return now > 0 ? 100 : 0;
  return Math.round(((now - prev) / prev) * 1000) / 10;
}

export interface Bucket {
  start: Date;
  end: Date;
  label: string;
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const md = (d: Date) => `${MON[d.getUTCMonth()]} ${d.getUTCDate()}`;

/**
 * Daily up to 31 days, Monday-anchored weeks up to 100, calendar months up to 400, quarters beyond. The last bucket is cut at
 * `to`, so the buckets tile the window with no gap and no overlap.
 */
export function buckets(from: Date, to: Date): Bucket[] {
  const days = Math.floor((to.getTime() - from.getTime()) / DAY) + 1;
  const out: Bucket[] = [];
  if (days <= 31) {
    for (let c = startOfDay(from); c.getTime() <= to.getTime(); c = new Date(c.getTime() + DAY)) {
      out.push({ start: c, end: endOfDay(c), label: md(c) });
    }
    return out;
  }
  const clip = (d: Date) => (d.getTime() > to.getTime() ? new Date(to) : d);
  if (days <= 100) {
    let c = startOfDay(from);
    c = new Date(c.getTime() - ((c.getUTCDay() + 6) % 7) * DAY);
    for (; c.getTime() <= to.getTime(); c = new Date(c.getTime() + 7 * DAY)) {
      out.push({ start: c, end: clip(new Date(c.getTime() + 7 * DAY - 1)), label: `wk ${md(c)}` });
    }
    return out;
  }
  if (days <= 400) {
    for (
      let c = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
      c.getTime() <= to.getTime();
      c = new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + 1, 1))
    ) {
      const next = new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + 1, 1));
      out.push({
        start: c,
        end: clip(new Date(next.getTime() - 1)),
        label: `${MON[c.getUTCMonth()]} ${c.getUTCFullYear()}`,
      });
    }
    return out;
  }
  for (
    let c = new Date(
      Date.UTC(from.getUTCFullYear(), from.getUTCMonth() - (from.getUTCMonth() % 3), 1),
    );
    c.getTime() <= to.getTime();
    c = new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + 3, 1))
  ) {
    const next = new Date(Date.UTC(c.getUTCFullYear(), c.getUTCMonth() + 3, 1));
    out.push({
      start: c,
      end: clip(new Date(next.getTime() - 1)),
      label: `Q${Math.floor(c.getUTCMonth() / 3) + 1} ${c.getUTCFullYear()}`,
    });
  }
  return out;
}
