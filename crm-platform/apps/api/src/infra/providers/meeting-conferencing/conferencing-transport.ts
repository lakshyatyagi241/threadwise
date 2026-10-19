import { meetingConferencingEnv } from '../../../config/domains/meeting-conferencing.env';
import { parseRetryAfter } from '../appointments-booking/google-calendar.errors';
import { ConferencingError, type ConferencingFailureKind } from './conferencing.errors';

export interface ConferencingRequest {
  method?: string;
  /** Sent as `Authorization: Bearer`. */
  token?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Turns a failed answer into a typed error (token endpoints and the REST APIs word their errors differently). */
  classify: (status: number, body: unknown) => ConferencingError;
  /**
   * Extra attempts after a transient failure (429, 5xx, timeout, network). Default is the environment's `CONFERENCING_RETRIES`. Pass 0
   * for a call that cannot be repeated: the one-time code exchange, and the create of a Zoom meeting (a repeat after a lost answer would
   * make a second meeting).
   */
  retries?: number;
  timeoutMs?: number;
  /** A stand-in for `fetch` (tests). */
  fetchImpl?: typeof fetch;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const TRANSIENT: ReadonlySet<ConferencingFailureKind> = new Set([
  'rate_limit',
  'server',
  'network',
  'timeout',
]);

/**
 * One HTTPS call to a video provider, with a timeout, a typed error and bounded retries (only transient kinds; the wait before attempt n is
 * a random time up to `base x 2^n`; a `Retry-After` longer than the cap is NOT slept on, the error carries the hint). The same policy as
 * the calendar transports (`googleRequest`, `microsoftRequest`).
 */
export async function conferencingRequest(url: string, req: ConferencingRequest): Promise<unknown> {
  const env = meetingConferencingEnv();
  const retries = req.retries ?? env.CONFERENCING_RETRIES;
  let last: ConferencingError | null = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0 && last) {
      const hint = last.retryAfterSeconds;
      const capMs = env.CONFERENCING_RETRY_AFTER_CAP_SECONDS * 1000;
      if (hint !== null && hint * 1000 > capMs) throw last;
      const ceiling = Math.min(env.CONFERENCING_RETRY_BASE_MS * 2 ** (attempt - 1), capMs);
      const wait = hint !== null ? hint * 1000 : Math.random() * ceiling;
      await sleep(Math.max(1, Math.round(wait)));
    }
    try {
      return await once(url, req, req.timeoutMs ?? env.CONFERENCING_HTTP_TIMEOUT_MS);
    } catch (err) {
      if (!(err instanceof ConferencingError) || !TRANSIENT.has(err.kind)) throw err;
      last = err;
    }
  }
  throw last!;
}

async function once(url: string, req: ConferencingRequest, timeoutMs: number): Promise<unknown> {
  const headers: Record<string, string> = { accept: 'application/json', ...req.headers };
  if (req.token) headers.authorization = `Bearer ${req.token}`;
  let res: Response;
  let text: string;
  try {
    res = await (req.fetchImpl ?? fetch)(url, {
      method: req.method ?? 'GET',
      headers,
      body: req.body,
      // A redirect is never expected from these APIs; following one would send the bearer token somewhere else.
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    text = await res.text();
  } catch (err) {
    const timedOut =
      err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new ConferencingError(
      timedOut ? 'timeout' : 'network',
      0,
      timedOut ? 'timeout' : ((err as { cause?: { code?: string } }).cause?.code ?? 'network'),
    );
  }
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  if (!res.ok) {
    const error = req.classify(res.status, parsed);
    error.retryAfterSeconds = parseRetryAfter(res.headers.get('retry-after'));
    throw error;
  }
  return parsed ?? {};
}
