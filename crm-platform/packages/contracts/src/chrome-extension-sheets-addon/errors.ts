/**
 * Error codes of the Google Sheets add-on (EXT, `chrome-extension-sheets-addon`). Spread into ERROR_CODES (common/errors.ts) so the API, the
 * web page and the Apps Script client branch on one registry. The add-on routes answer `{ ok: false, error, code }` (see
 * docs/api/chrome-extension-sheets-addon.md); `code` is one of these or a shared one (`UNAUTHENTICATED`, `FORBIDDEN`, `VALIDATION_FAILED`,
 * `RATE_LIMITED`, `PLAN_FEATURE_LOCKED`, `WSP_ORG_SUSPENDED`).
 */
export const EXT_ERROR_CODES = {
  /** No `Authorization: Bearer` header on an add-on route. */
  EXT_KEY_MISSING: 'EXT_KEY_MISSING',
  /** The key is malformed, unknown, revoked or replaced by a newer one, or its owner is no longer active. One answer for all of them. */
  EXT_KEY_INVALID: 'EXT_KEY_INVALID',
  /** The workspace has not installed the Google Sheets add-on (or an admin disabled it), so neither a key nor the add-on API works. */
  EXT_APP_NOT_INSTALLED: 'EXT_APP_NOT_INSTALLED',
  /** The install consent does not cover what the call needs (for example `contacts.write`), whatever the member's role says. */
  EXT_SCOPE_NOT_GRANTED: 'EXT_SCOPE_NOT_GRANTED',
} as const;
