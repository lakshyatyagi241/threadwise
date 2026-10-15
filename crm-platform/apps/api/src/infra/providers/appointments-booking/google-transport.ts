import { googleCalendarEnv } from '../../../config/domains/appointments-booking.env';
import {
  GoogleCalendarError,
  parseRetryAfter,
  type GoogleFailureKind,
} from './google-calendar.errors';

export interface GoogleRequest {
  method?: string;
  token?: string;
  headers?: Record<string, string>;
  body?: string;
  /** Turns a failed answer into a typed error (the OAuth endpoints and the REST APIs word their errors differently). */
  classify: (status: number, body: unknown) => GoogleCalendarError;
  /**
   * Extra attempts after a transient failure (429, 5xx, timeout, network). Default is the environment's `GOOGLE_RETRIES`; pass 0 for a
   * call that must answer at once (the busy-time lookup a visitor waits on) or that cannot be repeated (the one-time code exchange).
   */
  retries?: number;
  /** Ceiling for one attempt in ms; default is the environment's `GOOGLE_HTTP_TIMEOUT_MS`. */
  timeoutMs?: number;
  /**
   * False for a call that creates something with no way to recognise a repeat (a sheet row, a copied document): a 5xx or a timeout may
   * have happened AFTER the work, so only a 429 (refused before any work) is repeated. Default true.
   */
  idempotent?: boolean;
  /** A stand-in for `fetch` (tests). */
  fetchImpl?: typeof fetch;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The failure kinds a later attempt can fix on its own. `auth` is excluded: the token layer refreshes and repeats it, not the transport. */
const TRANSIENT: ReadonlySet<GoogleFailureKind> = new Set([
  'rate_limit',
  'server',
  'network',
  'timeout',
]);

/**
 * One HTTPS call to a Google API, with a timeout, a typed error and bounded retries. The shared transport of the calendar client and of
 * the flow nodes' Google adapter: every Google call in the platform behaves the same under quota and outage.
 *
 * Retry policy (why each choice): only transient kinds are repeated; the wait before attempt n is a random time up to
 * `base x 2^n` ("full jitter", so a burst of workers that all failed together do not come back together); when Google sends
 * `Retry-After` longer than the cap, the call is NOT repeated here (a worker would sit on its slot) and the error carries the hint
 * for whoever retries later (the outbox drain, a flow run). Callers pass only calls that are safe to repeat: inserts with a fixed event
 * id, patches, deletes, reads, refreshes.
 */
export async function googleRequest(url: string, req: GoogleRequest): Promise<unknown> {
  const env = googleCalendarEnv();
  const retries = req.retries ?? env.GOOGLE_RETRIES;
  let last: GoogleCalendarError | null = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (attempt > 0 && last) {
      const hint = last.retryAfterSeconds;
      const capMs = env.GOOGLE_RETRY_AFTER_CAP_SECONDS * 1000;
      if (hint !== null && hint * 1000 > capMs) throw last;
      // Our own back-off obeys the same ceiling as Google's hint: a worker slot is not held longer than the cap per wait.
      const ceiling = Math.min(env.GOOGLE_RETRY_BASE_MS * 2 ** (attempt - 1), capMs);
      const wait = hint !== null ? hint * 1000 : Math.random() * ceiling;
      await sleep(Math.max(1, Math.round(wait)));
    }
    try {
      return await once(url, req, req.timeoutMs ?? env.GOOGLE_HTTP_TIMEOUT_MS);
    } catch (err) {
      if (!(err instanceof GoogleCalendarError) || !TRANSIENT.has(err.kind)) throw err;
      if (req.idempotent === false && err.kind !== 'rate_limit') throw err;
      last = err;
    }
  }
  throw last!;
}

async function once(url: string, req: GoogleRequest, timeoutMs: number): Promise<unknown> {
  const headers: Record<string, string> = { accept: 'application/json', ...req.headers };
  if (req.token) headers.authorization = `Bearer ${req.token}`;
  let res: Response;
  let text: string;
  try {
    res = await (req.fetchImpl ?? fetch)(url, {
      method: req.method ?? 'GET',
      headers,
      body: req.body,
      // A redirect from a Google API is never expected; following one would send the bearer token somewhere else.
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    });
    // The body is read inside the same guard: the timeout also covers a response that stalls after its headers.
    text = await res.text();
  } catch (err) {
    const timedOut =
      err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new GoogleCalendarError(
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
