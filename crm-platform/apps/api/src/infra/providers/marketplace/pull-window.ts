import type { PullWindow } from '@crm/contracts';

/**
 * The time arithmetic of a windowed pull (a portal that answers "the leads between two times"), kept pure so it can be tested to the
 * second. The connection keeps one number, the high-water mark: the end of the last window it fetched. The next window starts a little
 * before it (the overlap) and ends now or one window's width later, whichever is sooner, so a connection that was away catches up one
 * window per poll and nothing falls between two polls.
 */

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const two = (n: number): string => String(n).padStart(2, '0');

/**
 * Writes an instant in the portal's format and zone. Tokens: `YYYY`, `MM`, `DD`, `HH`, `mm`, `ss`, `MON` (JAN) and `Mon` (Jan); the word
 * `epoch` alone is whole seconds since 1970 (zone-free). Anything else is copied as typed, so `DD-MM-YYYYHH:mm:ss` (IndiaMART: no space
 * between the date and the time) is written exactly so.
 */
export function formatWindowTime(at: Date, format: string, utcOffsetMinutes: number): string {
  if (format === 'epoch') return String(Math.floor(at.getTime() / 1000));
  const shifted = new Date(at.getTime() + utcOffsetMinutes * 60_000);
  const parts: Record<string, string> = {
    YYYY: String(shifted.getUTCFullYear()),
    MON: MONTHS[shifted.getUTCMonth()]!,
    Mon:
      MONTHS[shifted.getUTCMonth()]!.charAt(0) +
      MONTHS[shifted.getUTCMonth()]!.slice(1).toLowerCase(),
    MM: two(shifted.getUTCMonth() + 1),
    DD: two(shifted.getUTCDate()),
    HH: two(shifted.getUTCHours()),
    mm: two(shifted.getUTCMinutes()),
    ss: two(shifted.getUTCSeconds()),
  };
  return format.replace(/YYYY|MON|Mon|MM|DD|HH|mm|ss/g, (t) => parts[t]!);
}

export interface WindowPlan {
  start: Date;
  end: Date;
  /** The window ends before now: more time is left to cover, so the next poll should not wait a whole interval. */
  behind: boolean;
  /** The start was pulled forward because the portal keeps no history that old (a connection away for longer than that loses the gap). */
  clamped: boolean;
  /** Nothing to ask: the cursor is at (or past) now. */
  empty: boolean;
}

/** Seconds the portal's history reaches back, less a margin so the first request is never refused for being exactly at the limit. */
const HISTORY_MARGIN_SECONDS = 3600;
/** When the recipe states no history limit. */
const DEFAULT_HISTORY_SECONDS = 365 * 86_400;

export function planWindow(
  w: PullWindow,
  cursor: Date | null,
  now: Date,
  spanSeconds: number | null | undefined,
): WindowPlan {
  const history = (w.maxLookbackSeconds ?? DEFAULT_HISTORY_SECONDS) - HISTORY_MARGIN_SECONDS;
  const floor = now.getTime() - Math.max(history, w.maxSeconds) * 1000;
  let start = cursor
    ? cursor.getTime() - w.overlapSeconds * 1000
    : now.getTime() - w.initialLookbackSeconds * 1000;
  // A cursor in the future (a clock that was set back) is read as now.
  start = Math.min(start, now.getTime());
  let clamped = false;
  if (start < floor) {
    start = floor;
    clamped = true;
  }
  const span = Math.min(spanSeconds && spanSeconds > 0 ? spanSeconds : w.maxSeconds, w.maxSeconds);
  const end = Math.min(start + span * 1000, now.getTime());
  return {
    start: new Date(start),
    end: new Date(end),
    behind: end < now.getTime() - 1000,
    clamped,
    empty: end - start < 1000,
  };
}

/** Half the window, never narrower than the smallest span that still moves forward past the overlap. Null when it cannot get narrower. */
export function narrowerSpan(
  w: PullWindow,
  currentSeconds: number | null | undefined,
): number | null {
  const current = Math.min(
    currentSeconds && currentSeconds > 0 ? currentSeconds : w.maxSeconds,
    w.maxSeconds,
  );
  const smallest = Math.max(300, w.overlapSeconds * 2 + 60);
  const half = Math.floor(current / 2);
  return half >= smallest ? half : null;
}

/** After a poll that fit, the window grows back toward the recipe's width (null = the recipe's own width). */
export function widerSpan(w: PullWindow, currentSeconds: number | null | undefined): number | null {
  if (!currentSeconds) return null;
  const doubled = currentSeconds * 2;
  return doubled >= w.maxSeconds ? null : doubled;
}
