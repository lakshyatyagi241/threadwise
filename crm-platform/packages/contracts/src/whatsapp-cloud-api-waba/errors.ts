/**
 * Error codes of the WhatsApp number domain. Spread into ERROR_CODES (common/errors.ts) so the API and the web branch on one
 * registry. `message` always carries Meta's own words (translated, see TW-WABA-051); the code says what to do about it.
 */
export const WABA_ERROR_CODES = {
  /** The platform has no Meta app (or Interakt partner) configured: Embedded Signup cannot run. Ask the platform admin. */
  WABA_NOT_CONFIGURED: 'WABA_NOT_CONFIGURED',
  /** Meta or Interakt refused a call (token, permission or parameter). `message` is the translated reason. */
  WABA_PROVIDER_REJECTED: 'WABA_PROVIDER_REJECTED',
  /** Meta or Interakt did not answer in time or could not be reached. Safe to retry. */
  WABA_PROVIDER_UNAVAILABLE: 'WABA_PROVIDER_UNAVAILABLE',
  /** The token lacks `whatsapp_business_management`: regenerate it with both WhatsApp scopes. */
  WABA_MISSING_PERMISSION: 'WABA_MISSING_PERMISSION',
  /** Embedded Signup finished without a WhatsApp Business Account. */
  WABA_NO_WABA: 'WABA_NO_WABA',
  /** The WABA has no phone number yet (Meta can take a minute after Embedded Signup). */
  WABA_NO_PHONE: 'WABA_NO_PHONE',
  /** The number is still on the retired On-Premises API: register it on the Cloud API in WhatsApp Manager first. */
  WABA_ON_PREMISE: 'WABA_ON_PREMISE',
  /** The ids the browser sent are not ones this token was granted. */
  WABA_ID_MISMATCH: 'WABA_ID_MISMATCH',
  /** Another workspace already has this number connected. */
  WABA_NUMBER_IN_USE: 'WABA_NUMBER_IN_USE',
  /** The connection holds no token (disconnected, or a coexistence connect that left it empty): reconnect or paste one. */
  WABA_NO_CREDENTIALS: 'WABA_NO_CREDENTIALS',
} as const;
