/**
 * What can go wrong talking to Google for the Email channel, reduced to the few cases the callers treat differently. Callers never look at an
 * HTTP status or an error string: they ask `kind`.
 *
 *  - `invalid_grant`: Google refuses the stored refresh token (revoked, expired, password changed, the 7-day limit of an app still in
 *    "Testing"). Only a new consent helps: the mailbox is marked `needs_reauth`.
 *  - `invalid_client`: the platform's client id or secret is wrong. Not the workspace's fault: its mailbox stays as it is.
 *  - `auth`: an access token was refused by the Gmail API (revoked or expired early): refresh once and try again.
 *  - `rate_limit`, `server`, `network`, `timeout`: try again later.
 *  - `not_found`: the message, thread or history id does not exist (any more). On a history call it means the cursor is too old.
 *  - `forbidden`: the account may not do this (a scope was not granted, the Gmail API is not enabled for the project).
 *  - `too_large`: Google refused the message size (413 or its own reason).
 *  - `bad_request`: Google rejected what we sent (a bad address, a malformed message): retrying the same request will not help.
 */
export type GoogleMailFailureKind =
  | 'invalid_grant'
  | 'invalid_client'
  | 'auth'
  | 'rate_limit'
  | 'server'
  | 'network'
  | 'timeout'
  | 'not_found'
  | 'forbidden'
  | 'too_large'
  | 'bad_request';

export class GoogleMailError extends Error {
  constructor(
    readonly kind: GoogleMailFailureKind,
    readonly status: number,
    /** Google's own short reason ("rateLimitExceeded", "invalid_grant"); safe to log. */
    readonly reason: string,
    message?: string,
  ) {
    super(message ?? `Google mail ${kind} (${status}${reason ? `, ${reason}` : ''})`);
    this.name = 'GoogleMailError';
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

/** The reason Google gave: an OAuth `error` code, or the first `errors[].reason` of a Gmail API error. */
export function googleReason(body: unknown): string {
  if (typeof body !== 'object' || body === null) return '';
  const b = body as ApiErrorBody;
  if (typeof b.error === 'string') return b.error;
  return b.error?.errors?.[0]?.reason ?? b.error?.status ?? '';
}

/** A response from the token endpoint (`/token`, `/revoke`): OAuth error codes. */
export function classifyTokenError(status: number, body: unknown): GoogleMailError {
  const reason = googleReason(body);
  if (reason === 'invalid_grant') return new GoogleMailError('invalid_grant', status, reason);
  if (reason === 'invalid_client' || reason === 'unauthorized_client') {
    return new GoogleMailError('invalid_client', status, reason);
  }
  if (status === 429) return new GoogleMailError('rate_limit', status, reason);
  if (status >= 500) return new GoogleMailError('server', status, reason);
  return new GoogleMailError('bad_request', status, reason);
}

/** A response from the Gmail API or userinfo. */
export function classifyApiError(status: number, body: unknown): GoogleMailError {
  const reason = googleReason(body);
  if (status === 401) return new GoogleMailError('auth', status, reason);
  if (status === 403) {
    return new GoogleMailError(
      RATE_LIMIT_REASONS.has(reason) ? 'rate_limit' : 'forbidden',
      status,
      reason,
    );
  }
  if (status === 429) return new GoogleMailError('rate_limit', status, reason);
  if (status === 404) return new GoogleMailError('not_found', status, reason);
  if (status === 413 || reason === 'messageTooLarge') {
    return new GoogleMailError('too_large', status, reason);
  }
  if (status >= 500) return new GoogleMailError('server', status, reason);
  return new GoogleMailError('bad_request', status, reason);
}
