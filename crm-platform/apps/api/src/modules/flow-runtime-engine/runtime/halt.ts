import type { NodeResult, SendOutcome } from './types';

/** How long a channel that is down or capped is left alone before the run tries again. */
export const HALT_RETRY_MS = 5 * 60_000;
/** A run woken for a known instant is woken a second after it, so the decision it takes is never made a moment too early. */
const RETRY_MARGIN_MS = 1_000;
/** A known instant further away than this is not trusted (the usual retry is asked instead). */
const MAX_KNOWN_WAIT_MS = 48 * 3_600_000;

/**
 * How long a halted run waits before its step runs again: until `retryAt` (plus a second) when the halt knows the instant, else the usual
 * five minutes. An instant that is not a date, or lies more than two days away, is ignored.
 */
export function haltDelayMs(retryAt: string | undefined, now: Date): number {
  if (retryAt === undefined) return HALT_RETRY_MS;
  const at = Date.parse(retryAt);
  if (!Number.isFinite(at)) return HALT_RETRY_MS;
  const wait = at - now.getTime() + RETRY_MARGIN_MS;
  if (wait > MAX_KNOWN_WAIT_MS) return HALT_RETRY_MS;
  return Math.max(RETRY_MARGIN_MS, wait);
}

/**
 * The halt a node asks for when a send did not go out and the run should wait, not fail. A send held for the quiet hours (BL-192) knows
 * the exact instant the hours open (`retryAt`): the run then wakes at that instant instead of asking again every few minutes.
 */
export function haltOf(out: Extract<SendOutcome, { ok: false }>): NodeResult {
  return {
    kind: 'halt',
    reason: out.error,
    ...(out.retryAt !== undefined ? { retryAt: out.retryAt } : {}),
  };
}
