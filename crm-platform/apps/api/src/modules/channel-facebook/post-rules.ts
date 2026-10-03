import type { GraphInsightMetric } from '../../infra/providers/channel-facebook/facebook.port';

/** Pure rules of posting and of the insights screen (TW-FB-016 to 019). */

/** Meta's schedule window: at least 10 minutes ahead and at most 75 days. */
export const SCHEDULE_MIN_MS = 10 * 60_000;
export const SCHEDULE_MAX_MS = 75 * 24 * 3_600_000;
export const MAX_PHOTOS = 10;
export const PAGE_SIZE = 15;
/** A post's error is kept to 990 characters on the row. */
export const POST_ERROR_LIMIT = 990;

export const SCHEDULE_TOO_SOON = 'Scheduled time must be at least 10 minutes from now.';
export const SCHEDULE_TOO_FAR = 'Scheduled time cannot be more than 75 days out.';

export type ScheduleCheck =
  { ok: true; at: Date | null; ts: number | null } | { ok: false; message: string };

/** No time publishes now; otherwise the instant must fall inside Meta's window. */
export function checkSchedule(at: Date | null, now: Date): ScheduleCheck {
  if (at === null) return { ok: true, at: null, ts: null };
  const ahead = at.getTime() - now.getTime();
  if (ahead < SCHEDULE_MIN_MS) return { ok: false, message: SCHEDULE_TOO_SOON };
  if (ahead > SCHEDULE_MAX_MS) return { ok: false, message: SCHEDULE_TOO_FAR };
  return { ok: true, at, ts: Math.floor(at.getTime() / 1000) };
}

export type PostType = 'text' | 'link' | 'photo' | 'multi_photo' | 'video' | 'reel';

/** What a post is: a video (or reel) wins; then photos; then a link; else text. */
export function postType(o: {
  photos: readonly string[];
  link: string;
  video: string;
  asReel: boolean;
}): PostType {
  if (o.video !== '') return o.asReel ? 'reel' : 'video';
  if (o.photos.length > 0) return o.photos.length > 1 ? 'multi_photo' : 'photo';
  return o.link !== '' ? 'link' : 'text';
}

/** The photo addresses kept: blanks and repeats dropped, at most ten. */
export const keepPhotos = (urls: readonly string[]): string[] =>
  [...new Set(urls.map((u) => u.trim()).filter((u) => u !== ''))].slice(0, MAX_PHOTOS);

/** Why a post cannot be made as written, in Reference's words; null when it can. A video needs nothing else. */
export function contentProblem(o: {
  message: string;
  link: string;
  photos: readonly string[];
  video: string;
}): string | null {
  if (o.video !== '')
    return /^https:\/\//i.test(o.video) ? null : 'The video URL must be a public HTTPS link.';
  if (o.message === '' && o.link === '' && o.photos.length === 0) {
    return 'Write something, add a link, or attach a photo.';
  }
  // Meta rejects a feed post that carries both a link preview and photos.
  if (o.photos.length > 0 && o.link !== '')
    return 'A post can have photos or a link, not both. Remove one.';
  return null;
}

/** The list filter's earliest creation time for a range, or null for all time. */
export function rangeSince(range: string, now: Date): Date | null {
  const days = range === '7d' ? 7 : range === '30d' ? 30 : range === '90d' ? 90 : 0;
  return days === 0 ? null : new Date(now.getTime() - days * 86_400_000);
}

/** A search term for `ILIKE`, with the wildcard characters taken literally. */
export const likePattern = (q: string): string => `%${q.replace(/[\\%_]/g, '\\$&')}%`;

const asInt = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};

/** The latest value of each metric Meta returned, by name. A metric Meta has dropped is absent, not an error. */
export function kpisFrom(metrics: readonly GraphInsightMetric[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of metrics) {
    if (!m.name) continue;
    const last = m.values?.at(-1);
    out[m.name] = asInt(last?.value);
  }
  return out;
}

/** Impressions and engaged users of one post. */
export function postStats(metrics: readonly GraphInsightMetric[]): {
  impressions: number;
  engaged: number;
} {
  const k = kpisFrom(metrics);
  return { impressions: k.post_impressions ?? 0, engaged: k.post_engaged_users ?? 0 };
}

/** The viewer's time zone when it is a real IANA name, else UTC. */
export function validTimeZone(tz: string | undefined): string {
  if (!tz) return 'UTC';
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return tz;
  } catch {
    return 'UTC';
  }
}

/** `YYYY-MM-DD` of an instant in a time zone. */
export function dayIn(tz: string, at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/**
 * The last `n` days ending today in the time zone, oldest first. Today is read in the zone, then stepped back as plain calendar
 * dates, so a daylight saving change can neither skip nor repeat a day.
 */
export function lastDays(tz: string, now: Date, n: number): string[] {
  const today = Date.parse(`${dayIn(tz, now)}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) =>
    new Date(today - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10),
  );
}
