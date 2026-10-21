/** Small display helpers. Pure. */

/** One or two capital letters from a name ("Ana Lopez" -> "AL"); "?" for nothing usable. The one shared rule. */
export { initials } from '@/lib/initials';

const AVATAR_COLORS = ['#0f766e', '#7c3aed', '#c2410c', '#1d4ed8', '#be185d', '#4d7c0f'] as const;

/** The same name always gets the same colour. */
export function avatarColor(name: string | null | undefined): string {
  const text = name ?? '';
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

/** A calendar date (`YYYY-MM-DD`, no time) as "5 Oct 2026". It never shifts with the viewer's time zone. */
export function formatDay(day: string | null | undefined, locale: string): string {
  if (!day) return '';
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(d);
  } catch {
    return day.slice(0, 10);
  }
}

/** Medium date and short time in `timeZone`; empty for a missing or unparseable value. */
export function formatDateTime(
  iso: string | null | undefined,
  locale: string,
  timeZone?: string,
): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timeZone || undefined,
    }).format(d);
  } catch {
    return '';
  }
}

/** Date only, in the viewer's or the workspace's zone ("5 Oct 2026"), for a moment (created, sent). */
export function formatInstantDay(
  iso: string | null | undefined,
  locale: string,
  timeZone?: string,
): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: timeZone || undefined,
    }).format(d);
  } catch {
    return '';
  }
}

/** `18` for 1800 bp, `7.5` for 750 bp: how a tax rate or discount is printed ("Tax (18%)"). */
export const percentText = (bp: number): string => String(Math.round(bp) / 100);

/** A quantity as printed: up to 2 decimals, zeros trimmed ("2", "0.5", "1.25"). */
export function qtyText(qty: string, locale: string): string {
  const n = Number(qty.replace(',', '.'));
  if (!Number.isFinite(n)) return qty;
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(n);
}

/** Digits only, for a WhatsApp link (`+1 (555) 010-1234` -> `15550101234`). */
export const phoneDigits = (phone: string): string => phone.replace(/\D/g, '');

/**
 * What a person typed as a phone number, in the form the API stores (E.164: `+` and 7 to 15 digits, no spaces), or null when
 * it cannot be one. A number needs its country code: without it there is no telling which country it is in.
 */
export function normalizePhone(text: string): string | null {
  let s = text.trim().replace(/[\s().-]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  return /^\+[1-9]\d{6,14}$/.test(s) ? s : null;
}
