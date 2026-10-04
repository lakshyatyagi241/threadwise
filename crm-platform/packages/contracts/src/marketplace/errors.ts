/**
 * Error codes of the Marketplace (catalogue, installations, connectors, requests, operator API). Spread into ERROR_CODES
 * (common/errors.ts) so the API and the web branch on one registry.
 */
export const MKT_ERROR_CODES = {
  /** No such app, or it is not visible to this workspace (draft, in review, hidden and not installed, killed and not installed). */
  MKT_APP_NOT_FOUND: 'MKT_APP_NOT_FOUND',
  /** The workspace already has this app installed. */
  MKT_ALREADY_INSTALLED: 'MKT_ALREADY_INSTALLED',
  MKT_NOT_INSTALLED: 'MKT_NOT_INSTALLED',
  /** The app is not offered right now: not published, killed or hidden. */
  MKT_APP_UNAVAILABLE: 'MKT_APP_UNAVAILABLE',
  /** The accepted scopes do not equal what the version asks for: the admin must confirm the full permission list. */
  MKT_CONSENT_REQUIRED: 'MKT_CONSENT_REQUIRED',
  /** A newer version asks for more permissions than were granted; the installation keeps running on the old version until consent. */
  MKT_RECONSENT_REQUIRED: 'MKT_RECONSENT_REQUIRED',
  /** The person installing does not hold a permission one of the requested scopes stands for (no privilege escalation by installing). */
  MKT_SCOPE_EXCEEDS_INSTALLER: 'MKT_SCOPE_EXCEEDS_INSTALLER',
  /** The installation was disabled by the platform (kill switch). Only uninstalling is possible. */
  MKT_INSTALLATION_KILLED: 'MKT_INSTALLATION_KILLED',
  MKT_INSTALLATION_DISABLED: 'MKT_INSTALLATION_DISABLED',
  /** The app is behind a plan feature or an installable module the workspace does not have. */
  MKT_APP_LOCKED: 'MKT_APP_LOCKED',
  /** A required credential field was not given. */
  MKT_CREDENTIAL_MISSING: 'MKT_CREDENTIAL_MISSING',
  /** The manifest does not follow manifest v1. */
  MKT_MANIFEST_INVALID: 'MKT_MANIFEST_INVALID',
  /** The recipe does not follow the recipe schema, or contradicts the manifest. */
  MKT_RECIPE_INVALID: 'MKT_RECIPE_INVALID',
  /** A URL in a manifest or recipe is refused (not https, not a public host, resolves to a private address). */
  MKT_URL_REFUSED: 'MKT_URL_REFUSED',
  /** The connector type has no working implementation yet, so a listing that uses it cannot be published. */
  MKT_CONNECTOR_NOT_AVAILABLE: 'MKT_CONNECTOR_NOT_AVAILABLE',
  MKT_SLUG_TAKEN: 'MKT_SLUG_TAKEN',
  MKT_CATEGORY_NOT_FOUND: 'MKT_CATEGORY_NOT_FOUND',
  MKT_CATEGORY_IN_USE: 'MKT_CATEGORY_IN_USE',
  /** The version is not in a state that allows the action (publish needs an approved version, edits need a draft). */
  MKT_VERSION_STATE: 'MKT_VERSION_STATE',
  MKT_VERSION_EXISTS: 'MKT_VERSION_EXISTS',
  /** The lead pipeline is not available, so a delivery cannot be accepted. The sender should retry. */
  MKT_LEAD_PIPELINE_UNAVAILABLE: 'MKT_LEAD_PIPELINE_UNAVAILABLE',
  /** The delivery to a connection address failed authentication. */
  MKT_WEBHOOK_UNAUTHORIZED: 'MKT_WEBHOOK_UNAUTHORIZED',
  MKT_WEBHOOK_BAD_PAYLOAD: 'MKT_WEBHOOK_BAD_PAYLOAD',
  /** This installation has no connection that does what was asked (test, sample lead, rotate). */
  MKT_NO_CONNECTION: 'MKT_NO_CONNECTION',
  /** A paid app needs a subscription (or an included plan) before it can be installed or switched back on. */
  MKT_SUBSCRIPTION_REQUIRED: 'MKT_SUBSCRIPTION_REQUIRED',
  /** The platform has stopped selling this app to new subscribers. */
  MKT_NOT_FOR_SALE: 'MKT_NOT_FOR_SALE',
  /** The free trial is not offered (the app has none, or the workspace has had its subscription already). */
  MKT_TRIAL_UNAVAILABLE: 'MKT_TRIAL_UNAVAILABLE',
  MKT_SUBSCRIPTION_NOT_FOUND: 'MKT_SUBSCRIPTION_NOT_FOUND',
  /** The action does not fit the subscription's state (cancelling a comp, comping a workspace that already pays, resuming what was not cancelled). */
  MKT_SUBSCRIPTION_STATE: 'MKT_SUBSCRIPTION_STATE',
} as const;
