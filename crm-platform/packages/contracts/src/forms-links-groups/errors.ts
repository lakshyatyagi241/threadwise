/**
 * Error codes of the forms-links-groups (WFL) domain. Spread into ERROR_CODES (common/errors.ts) so the API and the
 * web branch on one registry. See docs/threadwise-port/inventory/forms-links-groups.md.
 */
export const WFL_ERROR_CODES = {
  /** The workspace has no Cloud API (WABA) engine enabled: WhatsApp Forms is Cloud-API-only (Reference parity). */
  WFL_FORM_ENGINE_NOT_ENABLED: 'WFL_FORM_ENGINE_NOT_ENABLED',
  /** No connected WABA provider config has both an access token and a WABA id: publish cannot resolve credentials. */
  WFL_FORM_NO_WABA_CREDENTIALS: 'WFL_FORM_NO_WABA_CREDENTIALS',
  /** Meta rejected the uploaded Flow JSON asset; `details` carries the first validation error Meta reported. */
  WFL_FORM_META_VALIDATION_FAILED: 'WFL_FORM_META_VALIDATION_FAILED',
  /** Meta refused to publish because the Business Account is blocked by its Integrity review (error 139000/4233020). */
  WFL_FORM_ACCOUNT_VERIFICATION_REQUIRED: 'WFL_FORM_ACCOUNT_VERIFICATION_REQUIRED',
  /** Meta refused the publish call for another reason; `message` carries Meta's own wording. */
  WFL_FORM_PUBLISH_FAILED: 'WFL_FORM_PUBLISH_FAILED',
  /** The public link is missing, paused or past its expiry. */
  WFL_LINK_NOT_LIVE: 'WFL_LINK_NOT_LIVE',
} as const;
export type WflErrorCode = (typeof WFL_ERROR_CODES)[keyof typeof WFL_ERROR_CODES];
