/** Display helpers for the merchant screens. Pure, no React. Money on the wire is integer minor units (major x 100, Reference's convention). */

export function minorToMajor(minor: number): number {
  return minor / 100;
}

/** "₹3,000.00" in the viewer's language; an unknown currency code falls back to "CODE 3,000.00". */
export function formatMoney(minor: number, currency: string, locale: string): string {
  const major = minorToMajor(minor);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    return `${currency} ${major.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

export function formatInt(n: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(n);
}

/** "Oct 02, 14:05" in the viewer's language and the browser's time zone; empty for a missing or invalid time. */
export function formatWhen(iso: string | null | undefined, locale: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d);
}

/** "Oct 02, 2026". */
export function formatDay(iso: string | null | undefined, locale: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(d);
}

/** The shop switcher choice written into an address: `/store/orders?shop=<id>`. Existing query text is kept. */
export function withShop(path: string, shopId: string | null | undefined): string {
  if (!shopId) return path;
  return `${path}${path.includes('?') ? '&' : '?'}shop=${encodeURIComponent(shopId)}`;
}

/** Digits only, for comparing phones. */
export const digits = (s: string): string => s.replace(/\D+/g, '');

/** "+9198..." as Reference prints a phone: a plus in front of the digits; empty stays empty. */
export function displayPhone(phone: string | null | undefined): string {
  const d = digits(phone ?? '');
  return d ? `+${d}` : '';
}
