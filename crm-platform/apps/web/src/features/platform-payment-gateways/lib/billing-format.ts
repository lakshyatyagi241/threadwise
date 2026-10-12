/**
 * Display helpers of the operator billing screens. Money arrives as decimal strings and is only ever formatted here (never
 * added up or sent back), so Number() is safe.
 */

export function money(amount: string, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}

/** "$12.4k": the KPI cards' short money (Reference printed the platform symbol and k/M by hand). */
export function shortMoney(amount: string, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      notation: 'compact',
      // No trailing zero: $85, not $85.0 (compact currency otherwise keeps one fraction digit).
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
    }).format(Number(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}

/** Whole-currency money for the big KPI numbers ($1,234). */
export function wholeMoney(amount: string, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(Number(amount));
  } catch {
    return `${amount} ${currency}`;
  }
}

/** +12.3% / -4.5% / +0% */
export function signedPct(n: number): string {
  return `${n >= 0 ? '+' : ''}${n}%`;
}

/** Y-m-d (Reference's order history date). */
export const ymd = (iso: string): string => iso.slice(0, 10);

/** Y-m-d H:i (Reference's billing history timestamp), in UTC like the server's windows. */
export const ymdHm = (iso: string): string => `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;

/** "1 to 12 of 30": the table footer. */
export function pageRange(page: number, pageSize: number, total: number) {
  if (total === 0) return { from: 0, to: 0 };
  return { from: (page - 1) * pageSize + 1, to: Math.min(total, page * pageSize) };
}

/** The pager's buttons: first, last, the current page and one on each side, with gaps marked (Laravel's onEachSide(1)). */
export function pageWindow(page: number, pages: number): Array<number | 'gap'> {
  const keep = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const sorted = [...keep].sort((a, b) => a - b);
  const out: Array<number | 'gap'> = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1]! > 1) out.push('gap');
    out.push(p);
  });
  return out;
}

export const capitalize = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Saves text the API built (CSV) as a file download. */
export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** One month or one year after the issue date (the service period under the item). */
export function periodEnd(iso: string, period: 'monthly' | 'yearly' | null): string {
  const d = new Date(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + (period === 'yearly' ? 12 : 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString();
}

/** Minor units of a major-unit amount typed by a person ("12.50" in INR is "1250"); null when it is not a positive amount. */
export function toMinorUnits(input: string, currency: string): string | null {
  const text = input.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(text)) return null;
  let digits = 2;
  try {
    digits =
      new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions()
        .maximumFractionDigits ?? 2;
  } catch {
    // an unknown code: two decimals
  }
  const [whole = '0', frac = ''] = text.split('.');
  if (frac.length > digits) return null;
  const minor = BigInt(whole + frac.padEnd(digits, '0'));
  return minor > 0n ? minor.toString() : null;
}
