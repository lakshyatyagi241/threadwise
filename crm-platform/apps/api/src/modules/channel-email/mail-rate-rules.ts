/**
 * Pure window math of the mail limits (TW-MAIL-032). A sliding window: the hits inside the last `windowMs` count, the oldest one leaving
 * the window frees a slot. No I/O, so the rule is tested without Redis.
 */

export interface WindowVerdict {
  allowed: boolean;
  /** Hits inside the window now. */
  count: number;
  /** When over the limit: ms until a slot frees (the oldest hit leaves the window). 0 when allowed. */
  retryAfterMs: number;
}

/** Would one more hit fit? `hits` are the timestamps (ms) already recorded. */
export function slidingWindow(
  hits: readonly number[],
  now: number,
  windowMs: number,
  limit: number,
): WindowVerdict {
  const live = hits.filter((t) => t > now - windowMs).sort((a, b) => a - b);
  if (live.length < limit) return { allowed: true, count: live.length, retryAfterMs: 0 };
  // Over: the slot frees when enough of the oldest hits have left the window to get below the limit.
  const freeing = live[live.length - limit]!;
  return {
    allowed: false,
    count: live.length,
    retryAfterMs: Math.max(1, freeing + windowMs - now),
  };
}

/** The hourly cap of a mailbox: its own setting, else the platform default. */
export const effectiveSendLimit = (own: number | null, platformDefault: number): number =>
  own ?? platformDefault;

/** "about 12 minutes" for the composer error. */
export function waitWords(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 90) return `${s} second${s === 1 ? '' : 's'}`;
  const m = Math.ceil(s / 60);
  if (m < 90) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.ceil(m / 60);
  return `${h} hour${h === 1 ? '' : 's'}`;
}
