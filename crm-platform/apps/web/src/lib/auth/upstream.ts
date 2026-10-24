import * as Sentry from '@sentry/nextjs';

const safePath = (url: string): string => {
  try {
    return new URL(url).pathname;
  } catch {
    return 'unparseable';
  }
};

/**
 * How long the API has to START answering a call made by the web app's server side (the proxy, the session reads, the token refresh).
 * Without a deadline a stalled API holds every request, and every page render that reads the session, until the platform gives up.
 */
export const UPSTREAM_TIMEOUT_MS = 30_000;

/**
 * `fetch` with a deadline on the first byte of the answer (the headers). Once the answer has started, the body streams on its own
 * clock, so a large download or export is not cut off. Rejects with an AbortError when the API did not answer in time.
 */
export async function upstreamFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = UPSTREAM_TIMEOUT_MS,
): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctl.signal });
  } catch (err) {
    // Every caller turns this into a 502 or a fallback page and the error ends there; report it once, here, then let them decide.
    // Only the path is attached: the host is internal and a query string can carry a token (the global scrub also drops it).
    Sentry.captureException(err, {
      tags: { module: 'upstream', timeout: String(isUpstreamTimeout(err)) },
      extra: { path: safePath(url) },
    });
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** True when an error from `upstreamFetch` was the deadline rather than a refused or reset connection. */
export const isUpstreamTimeout = (e: unknown): boolean =>
  e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError');
