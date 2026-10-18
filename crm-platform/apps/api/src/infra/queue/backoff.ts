/**
 * Retry timing shared by the queues (RET-011 to RET-013). BullMQ's own `backoff.jitter` covers the built-in exponential and fixed
 * strategies; this covers a custom strategy that has to honour a provider's wait, where the wait is a floor and never shortened.
 */

/** Share of the delay that is randomised: 0.5 spreads a retry over the upper half of its delay, so a recovered provider is not hit by every job in the same second. */
export const RETRY_JITTER = 0.5;

/** An exponential delay `base * 2^(attempt-1)`, capped, then spread over `[delay * (1 - jitter), delay]`. `random` returns [0, 1). */
export function exponentialDelayMs(
  baseMs: number,
  attempt: number,
  capMs: number,
  jitter = RETRY_JITTER,
  random: () => number = Math.random,
): number {
  const raw = Math.min(baseMs * 2 ** Math.max(attempt - 1, 0), capMs);
  return Math.floor(raw * (1 - jitter) + raw * jitter * random());
}

/**
 * A wait the provider asked for (rate limit, `Retry-After`) is a minimum: add up to a quarter on top so jobs that were throttled
 * together do not all come back at the same instant, and never exceed `capMs`.
 */
export function providerWaitMs(
  hintMs: number,
  capMs: number,
  random: () => number = Math.random,
): number {
  return Math.min(Math.floor(hintMs * (1 + 0.25 * random())), capMs);
}

/**
 * The wait a `Retry-After` header asks for: whole seconds or an HTTP date. Null when absent, unreadable or not in the future, so the
 * caller keeps its own schedule. Not capped here: the caller caps it with {@link providerWaitMs}.
 */
export function retryAfterMs(
  value: string | string[] | undefined,
  now: number = Date.now(),
): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const text = raw.trim();
  if (/^\d+$/.test(text)) {
    const ms = Number(text) * 1000;
    return ms > 0 ? ms : null;
  }
  const at = Date.parse(text);
  return Number.isFinite(at) && at > now ? at - now : null;
}
