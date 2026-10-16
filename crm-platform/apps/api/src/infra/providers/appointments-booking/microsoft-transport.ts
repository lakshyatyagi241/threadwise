import { microsoftCalendarEnv } from '../../../config/domains/microsoft-calendar.env';
import { parseRetryAfter } from './google-calendar.errors';
import { MicrosoftCalendarError, type MicrosoftFailureKind } from './microsoft-calendar.errors';

export interface MicrosoftRequest {
  method?: string;
  token?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Turns a failed answer into a typed error (the token endpoint and Graph word their errors differently). */
  classify: (status: number, body: unknown) => MicrosoftCalendarError;
  /**
   * Extra attempts after a transient failure (429, 5xx, timeout, network). Default is the environment's `MICROSOFT_CALENDAR_RETRIES`; pass
   * 0 for a call that must answer at once (the busy-time lookup a visitor waits on) or that cannot be repeated (the one-time code exchange).
   */
  retries?: number;
  /** Ceiling for one attempt in ms; default is the environment's `MICROSOFT_CALENDAR_HTTP_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** A stand-in for `fetch` (tests). */
  fetchImpl?: typeof fetch;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The failure kinds a later attempt can fix on its own. `auth` is excluded: the token layer refreshes and repeats it, not the transport. */
const TRANSIENT: ReadonlySet<MicrosoftFailureKind> = new Set([
  'rate_limit',
  'server',
  'network',
  'timeout',
]);

/**
 * One HTTPS call to the Microsoft identity platform or Graph, with a timeout, a typed error and bounded retries. The retry policy is the one
 * `googleRequest` uses: only transient kinds are repeated; the wait before attempt n is a random time up to `base x 2^n` (full jitter); a
 * `Retry-After` longer than the cap is NOT slept on here (the error carries the hint for whoever retries later, the outbox drain).
 * Callers pass only calls that are safe to repeat: creates carry a `transactionId`, patches, deletes, reads, refreshes.
 */
export async function microsoftRequest(url: string, req: MicrosoftRequest): Promise<unknown> {
  const env = microsoftCalendarEnv();
  const retries = req.retries ?? env.MICROSOFT_CALENDAR_RETRIES;
  let last: MicrosoftCalendarError | null = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0 && last) {
      const hint = last.retryAfterSeconds;
      const capMs = env.MICROSOFT_CALENDAR_RETRY_AFTER_CAP_SECONDS * 1000;
      if (hint !== null && hint * 1000 > capMs) throw last;
      const ceiling = Math.min(env.MICROSOFT_CALENDAR_RETRY_BASE_MS * 2 ** (attempt - 1), capMs);
      const wait = hint !== null ? hint * 1000 : Math.random() * ceiling;
      await sleep(Math.max(1, Math.round(wait)));
    }
    try {
      return await once(url, req, req.timeoutMs ?? env.MICROSOFT_CALENDAR_HTTP_TIMEOUT_MS);
    } catch (err) {
      if (!(err instanceof MicrosoftCalendarError) || !TRANSIENT.has(err.kind)) throw err;
      last = err;
    }
  }
  throw last!;
}

async function once(url: string, req: MicrosoftRequest, timeoutMs: number): Promise<unknown> {
  const headers: Record<string, string> = { accept: 'application/json', ...req.headers };
  if (req.token) headers.authorization = `Bearer ${req.token}`;
  let res: Response;
  let text: string;
  try {
    res = await (req.fetchImpl ?? fetch)(url, {
      method: req.method ?? 'GET',
      headers,
      body: req.body,
      // A redirect from Graph or the login host is never expected; following one would send the bearer token somewhere else.
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    // The body is read inside the same guard: the timeout also covers a response that stalls after its headers.
    text = await res.text();
  } catch (err) {
    const timedOut =
      err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new MicrosoftCalendarError(
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
