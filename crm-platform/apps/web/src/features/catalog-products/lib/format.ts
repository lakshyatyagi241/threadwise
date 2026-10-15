/** Small display helpers shared by the catalog screens. No React, no I/O. */

export const SYNC_STATUSES = ['unsynced', 'pending', 'synced', 'failed'] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

/** Never pushed (null) reads "unsynced"; the legacy value `error` counts as failed; anything else unknown is unsynced. */
export function syncStatus(raw: string | null | undefined): SyncStatus {
  if (!raw) return 'unsynced';
  if (raw === 'error') return 'failed';
  return (SYNC_STATUSES as readonly string[]).includes(raw) ? (raw as SyncStatus) : 'unsynced';
}

/** "meta_cloud" reads "META CLOUD", "dialog_360" reads "DIALOG 360" (the header pill of Reference). */
export const providerLabel = (provider: string): string =>
  provider.replace(/_/g, ' ').toUpperCase();

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** The count of a status bucket; products never pushed are under `unsynced`. */
export const bucket = (buckets: Record<string, number>, key: string): number => buckets[key] ?? 0;

/** "Oct 02, 14:30" in the viewer's language (Reference: `M d, H:i`). */
export function formatWhen(iso: string, locale: string, timeZone?: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(d);
}

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "5 minutes ago", "1 day ago", "6 seconds ago": Carbon's `diffForHumans`, which never says "yesterday" or "now". */
export function timeAgo(iso: string, now: Date, locale: string): string {
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'always' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.trunc(seconds / size), unit);
  }
  return rtf.format(Math.min(seconds, 0) || -0, 'second');
}
