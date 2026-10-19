/**
 * The pure rules of pulling a Meta lead form ("Sync now" and backfill, BL-204, BL-210): how a date range is cut into windows, when a window
 * is cut again, and how long to wait when Meta slows us down. No database, no Meta call and no clock, so each rule is a unit test.
 */

/** Meta keeps a lead about 90 days. A backfill reaches this far and no further. */
export const PULL_REACH_DAYS = 90;
export const PULL_REACH_MS = PULL_REACH_DAYS * 86_400_000;

/** A range is read in windows this long. A quiet form is one or two requests; a busy one is cut again (below). */
export const PULL_WINDOW_MS = 7 * 86_400_000;
/** A window that holds more leads than this is read again as two halves, so no answer is ever held in memory whole for a very busy form. */
export const PULL_SPLIT_ABOVE = 1_000;
/** A window this short is not cut again. */
export const PULL_MIN_WINDOW_MS = 3_600_000;
/** The most leads read from a window that cannot be cut again; the run then says it is incomplete. */
export const PULL_HARD_CAP = 5_000;
/** Leads per request (Meta's own maximum for this edge is 100). */
export const PULL_PAGE_SIZE = 100;
/** A guard against a loop in Meta's own paging. */
export const PULL_MAX_PAGES = 100;
/** No two requests of one run closer than this: a backfill is the heaviest thing that asks Meta for leads. */
export const PULL_PACE_MS = 1_000;
/** A request Meta slowed down or failed is tried again this many times before the run stops. */
export const PULL_MAX_RETRIES = 4;
/** A wait is cut into pieces this long so the run can say it is alive (the sweep frees a run that stays silent for twenty minutes). */
export const PULL_REST_PIECE_MS = 10_000;
/** The least time between two manual pulls of one form that the form's source asks the lead module for. */
export const PULL_MIN_INTERVAL_SECONDS = 60;

/** A time range, in milliseconds since the epoch: `from` is included, `to` is not. */
export interface PullWindow {
  from: number;
  to: number;
}

/** The range cut into windows, oldest first. An empty or reversed range has none. */
export function windowsOf(from: number, to: number): PullWindow[] {
  const out: PullWindow[] = [];
  for (let start = from; start < to; start += PULL_WINDOW_MS) {
    out.push({ from: start, to: Math.min(start + PULL_WINDOW_MS, to) });
  }
  return out;
}

/** Whether a window may be read as two halves. */
export const canSplit = (w: PullWindow): boolean => w.to - w.from > PULL_MIN_WINDOW_MS;

/** The two halves of a window, cut at a whole second. */
export function halves(w: PullWindow): [PullWindow, PullWindow] {
  const mid = Math.floor((w.from + (w.to - w.from) / 2) / 1000) * 1000;
  return [
    { from: w.from, to: mid },
    { from: mid, to: w.to },
  ];
}

/**
 * The bounds Meta's `time_created` filter takes (whole seconds, both exclusive) for a window: `time_created > since` and
 * `time_created < until` select exactly the leads created at a whole second `t` with `from <= t * 1000 < to`.
 */
export const sinceOf = (w: PullWindow): number => Math.ceil(w.from / 1000) - 1;
export const untilOf = (w: PullWindow): number => Math.ceil(w.to / 1000);

/** Whether a lead's time falls in the window (a lead with no time is taken in: Meta's own filter has already chosen it). */
export function inWindow(createdTime: string | null, w: PullWindow): boolean {
  if (!createdTime) return true;
  const t = Date.parse(createdTime);
  return Number.isNaN(t) || (t >= w.from && t < w.to);
}

/** Meta's "slow down" codes: the app, the Page or the call rate limit (4, 17, 32, 341, 613 and 80000 to 80014). */
export function isRateLimited(code: number | undefined): boolean {
  if (code === undefined) return false;
  return (
    code === 4 ||
    code === 17 ||
    code === 32 ||
    code === 341 ||
    code === 613 ||
    (code >= 80000 && code <= 80014)
  );
}

/**
 * How long to wait before asking again after a failed request, the first retry being `attempt` 0. Meta's own limits are measured in
 * minutes, so a "slow down" waits 30, 60, 120 and 240 seconds; a request that merely failed (Meta's 1 and 2, a network error) 2, 5,
 * 15 and 30.
 */
export function backoffMs(code: number | undefined, attempt: number): number {
  const steps = isRateLimited(code)
    ? [30_000, 60_000, 120_000, 240_000]
    : [2_000, 5_000, 15_000, 30_000];
  return steps[Math.min(Math.max(0, attempt), steps.length - 1)]!;
}

/** The range a backfill may ask for: clamped to what Meta keeps and to now; null when nothing is left of it. */
export function clampRange(from: Date, to: Date, now: Date): { from: number; to: number } | null {
  const start = Math.max(from.getTime(), now.getTime() - PULL_REACH_MS);
  const end = Math.min(to.getTime(), now.getTime());
  return end - start < 1000 ? null : { from: start, to: end };
}
