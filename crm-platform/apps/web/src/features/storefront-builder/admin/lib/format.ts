/** Display helpers for the store dashboard. Pure, no React. */

/** Order totals are kept as the major amount times 100 whatever the currency (WaDesk's convention). */
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
      minimumFractionDigits: Number.isInteger(major) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    return `${currency} ${major.toLocaleString(locale)}`;
  }
}

export function formatInt(n: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(n);
}

/** "Oct 02, 14:05": WaDesk's `M d, H:i`, in the viewer's language and the browser's time zone. */
export function formatWhen(iso: string, locale: string): string {
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

export type OrderTone = 'success' | 'danger' | 'neutral';

/** Paid is green, cancelled is red, anything else is plain. */
export function orderTone(status: string): OrderTone {
  if (status === 'paid') return 'success';
  if (status === 'cancelled') return 'danger';
  return 'neutral';
}

/** Width of a bestseller bar as a percentage of the leader's, never thinner than 2. */
export function barPercent(qty: number, leaderQty: number): number {
  if (leaderQty <= 0) return 2;
  return Math.max(2, Math.round((qty / leaderQty) * 100));
}

/** The shop switcher choice written into the address: `/store?shop=<id>`. */
export function shopHref(path: string, shopId: string | null | undefined): string {
  return shopId ? `${path}?shop=${encodeURIComponent(shopId)}` : path;
}

/** Display name of a shop: its name, else a short id-based label. */
export function shopLabel(shop: { shopName: string | null; id: string }, fallback: string): string {
  return shop.shopName?.trim() || `${fallback} ${shop.id.slice(0, 6)}`;
}
