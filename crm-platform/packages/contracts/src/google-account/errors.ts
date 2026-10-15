/**
 * Error codes of the workspace's Google account (`/google-account`) and of the flow nodes that use it. They reach consumers through
 * ERROR_CODES. The flow nodes do not throw them at an HTTP caller: a Google node writes the code and an actionable sentence into the
 * run log, so a support person can search the log for the code and the web can show the sentence in the reader's language.
 */
export const GOOGLE_ERROR_CODES = {
  /** The platform operator has not set up (or switched off) the Google OAuth client: nobody can connect Google. */
  GOOGLE_ACCOUNT_NOT_CONFIGURED: 'GOOGLE_ACCOUNT_NOT_CONFIGURED',
  /** The workspace has no Google account connected: "Connect Google" on the Google account page. */
  GOOGLE_ACCOUNT_NOT_CONNECTED: 'GOOGLE_ACCOUNT_NOT_CONNECTED',
  /** Google no longer honours the stored grant (revoked, password changed, 7-day limit of an unpublished app): connect again. */
  GOOGLE_ACCOUNT_NEEDS_RECONNECT: 'GOOGLE_ACCOUNT_NEEDS_RECONNECT',
  /** The connected account was not given the permission this feature needs: add it on the Google account page. */
  GOOGLE_SCOPE_MISSING: 'GOOGLE_SCOPE_MISSING',
  /** Google is limiting requests (quota or rate): retried a moment later. */
  GOOGLE_RATE_LIMITED: 'GOOGLE_RATE_LIMITED',
  /** The platform's Google Cloud project has not enabled this API (Sheets, Docs, Drive, Forms, Calendar): the operator enables it. */
  GOOGLE_API_NOT_ENABLED: 'GOOGLE_API_NOT_ENABLED',
  /** The sheet, document, form or calendar does not exist, or the connected account cannot see it. */
  GOOGLE_NOT_FOUND: 'GOOGLE_NOT_FOUND',
  /** The connected account may not do this (a read-only file, a missing share). */
  GOOGLE_ACCESS_DENIED: 'GOOGLE_ACCESS_DENIED',
  /** Google rejected what was sent (a tab name that does not exist, a malformed range). Retrying the same request will not help. */
  GOOGLE_BAD_REQUEST: 'GOOGLE_BAD_REQUEST',
  /** Google did not answer (timeout, network, 5xx). */
  GOOGLE_UNAVAILABLE: 'GOOGLE_UNAVAILABLE',
  /** Confirming a Google consent that someone else started (a forwarded link), or in another workspace. Nothing was stored. */
  GOOGLE_CONSENT_NOT_YOURS: 'GOOGLE_CONSENT_NOT_YOURS',
  /** The consent was started too long ago (ten minutes): press Connect again. */
  GOOGLE_CONSENT_EXPIRED: 'GOOGLE_CONSENT_EXPIRED',
  /** The consent was already confirmed, cancelled or rejected: a link is good once. */
  GOOGLE_CONSENT_USED: 'GOOGLE_CONSENT_USED',
  /** No such consent in progress (or the callback has not completed yet). */
  GOOGLE_CONSENT_NOT_FOUND: 'GOOGLE_CONSENT_NOT_FOUND',
  /** A calendar drift action on an appointment whose Google event is not drifted. */
  GOOGLE_SYNC_NOT_DRIFTED: 'GOOGLE_SYNC_NOT_DRIFTED',
} as const;
