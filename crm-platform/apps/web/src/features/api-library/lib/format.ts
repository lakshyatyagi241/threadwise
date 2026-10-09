import type { ApiLibraryErrorKind } from '@crm/contracts';

export const ERROR_KINDS: readonly ApiLibraryErrorKind[] = [
  'blocked',
  'function',
  'timeout',
  'network',
  'status',
  'invalid',
];

/** 2xx is green, everything else (and "no answer") is red. */
export const statusTone = (code: number | null): 'success' | 'danger' | 'neutral' =>
  code === null ? 'neutral' : code >= 200 && code < 300 ? 'success' : 'danger';

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

/** A body as indented JSON when it is JSON, otherwise unchanged. */
export function prettyBody(text: string | null): string {
  if (text === null || text === '') return '';
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/** Header maps hold a string or a list of strings per name. */
export function headerLines(h: Record<string, string | string[]>): Array<[string, string]> {
  return Object.entries(h).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v]);
}

/** Short host + path of a URL for table cells; the full URL stays in the title. */
export function shortUrl(url: string, max = 60): string {
  const t = url.replace(/^https?:\/\//i, '');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** `1.2 KB` style size of an answer. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const STEPS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/** "3 days ago", "in 2 hours", "now": the largest unit that fits, in the viewer's language. */
export function relativeTime(iso: string, now: number, locale: string): string {
  const seconds = Math.round((new Date(iso).getTime() - now) / 1000);
  const fmt = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, size] of STEPS) {
    if (Math.abs(seconds) >= size) return fmt.format(Math.round(seconds / size), unit);
  }
  return fmt.format(0, 'second');
}
