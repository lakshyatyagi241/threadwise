/** Small display helpers. Pure. */

/** One or two capital letters from a name ("Ana Lopez" -> "AL"); "?" for nothing usable. */
export function initials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = [...words[0]!][0] ?? '';
  const last = words.length > 1 ? ([...words[words.length - 1]!][0] ?? '') : '';
  return (first + last).toUpperCase();
}

const AVATAR_COLORS = ['#0f766e', '#7c3aed', '#c2410c', '#1d4ed8', '#be185d', '#4d7c0f'] as const;

/** The same name always gets the same colour. */
export function avatarColor(name: string | null | undefined): string {
  const text = name ?? '';
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
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

/** Short date ("5 Oct") in `timeZone`, with the year only when it is not this year. */
export function formatShortDate(iso: string, locale: string, now: Date, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale, {
      day: 'numeric',
      month: 'short',
      year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
      timeZone: timeZone || undefined,
    }).format(d);
  } catch {
    return '';
  }
}

export function formatTime(iso: string, locale: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(locale, {
      timeStyle: 'short',
      timeZone: timeZone || undefined,
    }).format(d);
  } catch {
    return '';
  }
}
