/** Display helpers of the AI screens. Pure, so each is tested without a browser. */

/** 1,250,000 as "1.3M" in the person's language; small numbers stay whole. */
export function compactNumber(n: number, locale: string): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/** A bar's width as a whole percent of the largest value; any non-zero value shows at least a sliver. */
export function barPercent(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.max(2, Math.min(100, Math.round((value / max) * 100)));
}

export function maxOf(values: readonly number[]): number {
  return values.reduce((m, v) => (v > m ? v : m), 0);
}

/** "2026-10-02" as a short day label ("2 Oct") in the person's language, read as UTC so it never shifts a day. */
export function shortDay(date: string, locale: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? date
    : new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
        d,
      );
}

/** "0.01" as a dollar amount in the person's language. The API sends money as a decimal string. */
export function dollars(amount: string, locale: string): string {
  const n = Number(amount);
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(
    Number.isFinite(n) ? n : 0,
  );
}
