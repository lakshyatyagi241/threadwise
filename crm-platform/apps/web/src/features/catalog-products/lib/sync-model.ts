import type { SyncProductsInput, SyncProductsResponse } from '@crm/contracts';

/**
 * The Setup tab pushes products in chunks: it posts again while the server says `hasMore` (Reference's loop). The loop is a
 * plain function over an injected `sync` call so its rules can be tested without a network.
 */

/** A runaway guard: 1000 products per call, so 200 calls is 200,000 products. */
export const MAX_CHUNKS = 200;

export interface SyncCounts {
  synced: number;
  pending: number;
  failed: number;
}

/** The bar's width: capped at 95 until the server reports nothing more to push, then 100. */
export function progressPercent(res: SyncProductsResponse): number {
  if (!res.hasMore) return 100;
  const sent = res.totalSynced + res.totalPending;
  return Math.min(95, (sent / Math.max(1, sent + res.totalFailed + 1)) * 100);
}

export interface SyncHooks {
  /** One chunk came back. */
  onChunk: (res: SyncProductsResponse, percent: number) => void;
}

export interface SyncOutcome {
  /** Products pushed over all chunks. */
  total: number;
  /** The last counts the server gave, or null when the first call failed. */
  last: SyncProductsResponse | null;
  /** Set when a call threw; the chunks before it still count. */
  error: unknown;
  /** The loop stopped because a chunk pushed nothing while the server still said `hasMore`. */
  stalled: boolean;
}

export async function runSyncLoop(
  sync: (body: SyncProductsInput) => Promise<SyncProductsResponse>,
  hooks: SyncHooks,
): Promise<SyncOutcome> {
  const outcome: SyncOutcome = { total: 0, last: null, error: null, stalled: false };
  for (let i = 0; i < MAX_CHUNKS; i++) {
    let res: SyncProductsResponse;
    try {
      res = await sync({});
    } catch (error) {
      outcome.error = error;
      return outcome;
    }
    outcome.last = res;
    outcome.total += res.pushed;
    hooks.onChunk(res, progressPercent(res));
    if (!res.hasMore) return outcome;
    // The reference looped forever here when the same chunk was selected again; never loop on a chunk that moved nothing.
    if (res.pushed === 0) {
      outcome.stalled = true;
      return outcome;
    }
  }
  outcome.stalled = true;
  return outcome;
}

/** "5 waiting": products never pushed plus those that failed. */
export const waiting = (buckets: Record<string, number>): number =>
  (buckets.unsynced ?? 0) + (buckets.failed ?? 0);

export interface LogLine {
  id: number;
  at: string;
  tone: 'info' | 'ok' | 'error';
  text: string;
}

/** Newest first, like the Reference progress panel; bounded so a long session does not grow without end. */
export function pushLog(log: LogLine[], line: Omit<LogLine, 'id'>, max = 100): LogLine[] {
  const id = (log[0]?.id ?? 0) + 1;
  return [{ ...line, id }, ...log].slice(0, max);
}
