/** Two letters for an avatar: the one shared rule (`@/lib/initials`). */
export { initials } from '@/lib/initials';

/** Eight avatar colours; the same person always gets the same one. Whole class names, so the style scanner finds them. */
export const AVATAR_COLORS = [
  'bg-emerald-600',
  'bg-sky-600',
  'bg-violet-600',
  'bg-amber-700',
  'bg-rose-600',
  'bg-teal-700',
  'bg-indigo-600',
  'bg-orange-700',
] as const;

export function avatarColor(id: string): (typeof AVATAR_COLORS)[number] {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}

/** `B`, `KB`, `MB` with one decimal above a kilobyte. */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The calendar day of an instant in `timeZone` (the person's display zone: `useTimeZone()` in a component), the key of a day
 * separator. Left out, it is the browser's zone.
 */
export function dayKey(iso: string, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    timeZone,
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function formatDay(iso: string, locale: string, timeZone?: string): string {
  return new Date(iso).toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone,
  });
}

/** Today: `HH:MM`; another day: `Mon D, HH:MM` (Reference's rule). */
export function formatStamp(iso: string, now: Date, locale: string, timeZone?: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', timeZone });
  if (dayKey(iso, timeZone) === dayKey(now.toISOString(), timeZone)) return time;
  return `${d.toLocaleDateString(locale, { month: 'short', day: 'numeric', timeZone })}, ${time}`;
}

/** The edit window of a message in minutes, shared with the API (15). */
export const EDIT_WINDOW_MS = 15 * 60_000;
export function canEditNow(createdAt: string, now: number): boolean {
  return now - new Date(createdAt).getTime() <= EDIT_WINDOW_MS;
}

/** Keep following new messages only when the reader is already near the bottom (100 px). */
export function nearBottom(scrollHeight: number, scrollTop: number, clientHeight: number): boolean {
  return scrollHeight - scrollTop - clientHeight < 100;
}

/** Where the browser fetches an attachment: the web app's own route (inline for images, a download for the rest). */
export function attachmentHref(messageId: string, name: string): string {
  return `/team-chat/files/${messageId}?name=${encodeURIComponent(name)}`;
}
