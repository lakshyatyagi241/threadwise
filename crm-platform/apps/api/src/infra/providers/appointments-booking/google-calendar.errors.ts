import type { ErrorCode } from '@crm/contracts';

/**
 * What can go wrong talking to Google, reduced to the few cases the adapter treats differently. The adapter never looks at an HTTP
 * status or an error string: it asks `kind`.
 *
 *  - `invalid_grant`: Google refuses the stored refresh token (revoked, expired, the password changed, the 7-day limit of an app still in
 *    "Testing"). Only a new consent helps: the connection is marked `needs_reconnect`.
 *  - `invalid_client`: the platform's client id or secret is wrong. Not the workspace's fault, so its connection stays as it is.
 *  - `auth`: an access token was refused by the Calendar API (revoked or expired early): refresh once and try again.
 *  - `rate_limit`, `server`, `network`, `timeout`: try again later (the outbox drain retries a write with backoff).
 *  - `not_found` / `gone`: the calendar or the event does not exist (any more).
 *  - `conflict`: an event with that id exists already (how a retried insert is recognised).
 *  - `forbidden`: the account may not do this (read-only calendar or file, a file that is not shared with it).
 *  - `scope`: the token was issued without the permission this call needs (Google: `ACCESS_TOKEN_SCOPE_INSUFFICIENT`). The workspace adds
 *    the capability on the Google account page; retrying does not help.
 *  - `api_disabled`: the platform's Google Cloud project has not enabled this API (`accessNotConfigured`, `SERVICE_DISABLED`). The
 *    operator fixes it in the Cloud console; the workspace can do nothing.
 *  - `bad_request`: Google rejected what we sent: retrying the same request will not help.
 */
/** The codes a failed Google CALL carries (not the consent or drift codes of the account page). */
export type GoogleErrorCode = Exclude<
  Extract<ErrorCode, `GOOGLE_${string}`>,
  `GOOGLE_CONSENT_${string}` | 'GOOGLE_SYNC_NOT_DRIFTED'
>;

export type GoogleFailureKind =
  | 'invalid_grant'
  | 'invalid_client'
  | 'auth'
  | 'rate_limit'
  | 'server'
  | 'network'
  | 'timeout'
  | 'not_found'
  | 'gone'
  | 'conflict'
  | 'forbidden'
  | 'scope'
  | 'api_disabled'
  | 'bad_request';

export class GoogleCalendarError extends Error {
  /** Seconds Google asked us to wait (`Retry-After`) on a 429 or 503; set by the transport, not by the classifier. */
  retryAfterSeconds: number | null = null;

  constructor(
    readonly kind: GoogleFailureKind,
    readonly status: number,
    /** Google's own short reason ("rateLimitExceeded", "invalid_grant"); safe to log. */
    readonly reason: string,
    message?: string,
  ) {
    super(message ?? `Google Calendar ${kind} (${status}${reason ? `, ${reason}` : ''})`);
    this.name = 'GoogleCalendarError';
  }

  /** A later attempt may succeed without anyone changing anything. */
  get retryable(): boolean {
    return (
      this.kind === 'rate_limit' ||
      this.kind === 'server' ||
      this.kind === 'network' ||
      this.kind === 'timeout' ||
      this.kind === 'auth'
    );
  }
}

const RATE_LIMIT_REASONS = new Set([
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'quotaExceeded',
  'dailyLimitExceeded',
]);

interface ApiErrorBody {
  error?:
    | string
    | { code?: number; message?: string; status?: string; errors?: Array<{ reason?: string }> };
  error_description?: string;
}

/** The reason Google gave: an OAuth `error` code, or the first `errors[].reason` of a Calendar API error. */
export function googleReason(body: unknown): string {
  if (typeof body !== 'object' || body === null) return '';
  const b = body as ApiErrorBody;
  const raw =
    typeof b.error === 'string' ? b.error : (b.error?.errors?.[0]?.reason ?? b.error?.status ?? '');
  // A reason ends up in logs and error messages: only Google's own short identifiers pass, never free text from a response body.
  return typeof raw === 'string' && /^[A-Za-z0-9_.:-]{1,64}$/.test(raw) ? raw : '';
}

const bodyText = (body: unknown): string => {
  try {
    return typeof body === 'string' ? body : JSON.stringify(body ?? '');
  } catch {
    return '';
  }
};

/** A response from the token endpoint (`/token`, `/revoke`): OAuth error codes. */
export function classifyTokenError(status: number, body: unknown): GoogleCalendarError {
  const reason = googleReason(body);
  if (reason === 'invalid_grant') return new GoogleCalendarError('invalid_grant', status, reason);
  if (reason === 'invalid_client' || reason === 'unauthorized_client') {
    return new GoogleCalendarError('invalid_client', status, reason);
  }
  if (status === 429) return new GoogleCalendarError('rate_limit', status, reason);
  if (status >= 500) return new GoogleCalendarError('server', status, reason);
  return new GoogleCalendarError('bad_request', status, reason);
}

/** A response from the Calendar API or userinfo. */
export function classifyApiError(status: number, body: unknown): GoogleCalendarError {
  const reason = googleReason(body);
  if (status === 401) return new GoogleCalendarError('auth', status, reason);
  if (status === 403) {
    if (RATE_LIMIT_REASONS.has(reason))
      return new GoogleCalendarError('rate_limit', status, reason);
    // Google words a transient fault of its own as a 403 `backendError`: a server fault (repeated only where repeating is safe), not a quota.
    if (reason === 'backendError') return new GoogleCalendarError('server', status, reason);
    // The Sheets, Docs, Forms and Drive APIs word these inside `details`/`message` rather than in `errors[].reason`.
    const text = bodyText(body);
    if (reason === 'accessNotConfigured' || text.includes('SERVICE_DISABLED')) {
      return new GoogleCalendarError('api_disabled', status, reason || 'SERVICE_DISABLED');
    }
    if (
      text.includes('ACCESS_TOKEN_SCOPE_INSUFFICIENT') ||
      text.toLowerCase().includes('insufficient authentication scopes')
    ) {
      return new GoogleCalendarError('scope', status, reason || 'ACCESS_TOKEN_SCOPE_INSUFFICIENT');
    }
    return new GoogleCalendarError('forbidden', status, reason);
  }
  if (status === 429) return new GoogleCalendarError('rate_limit', status, reason);
  if (status === 404) return new GoogleCalendarError('not_found', status, reason);
  if (status === 410) return new GoogleCalendarError('gone', status, reason);
  if (status === 409) return new GoogleCalendarError('conflict', status, reason);
  if (status >= 500) return new GoogleCalendarError('server', status, reason);
  return new GoogleCalendarError('bad_request', status, reason);
}

/**
 * `Retry-After` is either a number of seconds or an HTTP date. Anything else (or a date in the past) is "no hint".
 * Exported for the unit test.
 */
export function parseRetryAfter(
  value: string | null | undefined,
  nowMs = Date.now(),
): number | null {
  if (!value) return null;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Math.min(Number(v), 3600);
  const at = Date.parse(v);
  if (Number.isNaN(at)) return null;
  const s = Math.ceil((at - nowMs) / 1000);
  return s > 0 ? Math.min(s, 3600) : null;
}

/**
 * The stable `GOOGLE_*` code (`ERROR_CODES`) for a failure: what the Google account page, the run log of a flow and the staff API say, so
 * nothing branches on Google's wording. `invalid_client` is the platform's own client being wrong, which a workspace cannot fix, so it
 * reads as "not configured".
 */
export function googleFailureCode(err: GoogleCalendarError): GoogleErrorCode {
  switch (err.kind) {
    case 'invalid_grant':
    case 'auth':
      return 'GOOGLE_ACCOUNT_NEEDS_RECONNECT';
    case 'invalid_client':
      return 'GOOGLE_ACCOUNT_NOT_CONFIGURED';
    case 'api_disabled':
      return 'GOOGLE_API_NOT_ENABLED';
    case 'scope':
      return 'GOOGLE_SCOPE_MISSING';
    case 'rate_limit':
      return 'GOOGLE_RATE_LIMITED';
    case 'not_found':
    case 'gone':
      return 'GOOGLE_NOT_FOUND';
    case 'forbidden':
      return 'GOOGLE_ACCESS_DENIED';
    case 'server':
    case 'network':
    case 'timeout':
      return 'GOOGLE_UNAVAILABLE';
    case 'conflict':
    case 'bad_request':
      return 'GOOGLE_BAD_REQUEST';
  }
}

/** Failures that say something about the account or the platform's setup (shown on the Google account page), not about one flow's input. */
export const ACCOUNT_HEALTH_CODES: ReadonlySet<GoogleErrorCode> = new Set([
  'GOOGLE_ACCOUNT_NEEDS_RECONNECT',
  'GOOGLE_ACCOUNT_NOT_CONFIGURED',
  'GOOGLE_API_NOT_ENABLED',
  'GOOGLE_SCOPE_MISSING',
  'GOOGLE_RATE_LIMITED',
  'GOOGLE_UNAVAILABLE',
]);
