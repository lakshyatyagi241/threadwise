/**
 * Error codes of meeting video conferencing and calendar connections (BL-360..BL-369). Spread into ERROR_CODES (common/errors.ts) so the
 * API and the web branch on one registry.
 */
export const CONF_ERROR_CODES = {
  /** The platform operator has not set up the OAuth app of this provider (Zoom, or the Microsoft app for Teams): nobody can connect. */
  CONF_NOT_CONFIGURED: 'CONF_NOT_CONFIGURED',
  /** The workspace has not installed the provider's integration (Zoom, Microsoft Teams) from the Marketplace. */
  CONF_APP_NOT_INSTALLED: 'CONF_APP_NOT_INSTALLED',
  /** The person has no working connection to the provider: connect it from Settings, Video meetings. */
  CONF_NOT_CONNECTED: 'CONF_NOT_CONNECTED',
  /** The provider no longer honours the stored grant (revoked, password changed): connect again. */
  CONF_NEEDS_RECONNECT: 'CONF_NEEDS_RECONNECT',
  /** The provider did not answer or refused the request. The meeting itself is saved; the link can be retried. */
  CONF_PROVIDER_FAILED: 'CONF_PROVIDER_FAILED',
  /** Confirming a consent another person started (a forwarded link), or in another workspace. Nothing was stored. */
  CONF_CONFIRM_NOT_YOURS: 'CONF_CONFIRM_NOT_YOURS',
  /** The consent ticket is malformed, expired or already used. Press Connect again. */
  CONF_CONFIRM_INVALID: 'CONF_CONFIRM_INVALID',
} as const;
export type ConfErrorCode = (typeof CONF_ERROR_CODES)[keyof typeof CONF_ERROR_CODES];
