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
 *  - `forbidden`: the account may not do this (read-only calendar, a missing scope).
 *  - `bad_request`: Google rejected what we sent: retrying the same request will not help.
 */
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
  | 'bad_request';

export class GoogleCalendarError extends Error {
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
  'backendError',
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
  if (typeof b.error === 'string') return b.error;
  return b.error?.errors?.[0]?.reason ?? b.error?.status ?? '';
}

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
    return new GoogleCalendarError(
      RATE_LIMIT_REASONS.has(reason) ? 'rate_limit' : 'forbidden',
      status,
      reason,
    );
  }
  if (status === 429) return new GoogleCalendarError('rate_limit', status, reason);
  if (status === 404) return new GoogleCalendarError('not_found', status, reason);
  if (status === 410) return new GoogleCalendarError('gone', status, reason);
  if (status === 409) return new GoogleCalendarError('conflict', status, reason);
  if (status >= 500) return new GoogleCalendarError('server', status, reason);
  return new GoogleCalendarError('bad_request', status, reason);
}
