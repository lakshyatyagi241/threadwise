/**
 * Error codes of the WhatsApp number domain. Spread into ERROR_CODES (common/errors.ts) so the API and the web branch on one
 * registry. `message` always carries Meta's own words (translated, see WD-WABA-051); the code says what to do about it.
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
  /** A reply to a WhatsApp group thread (`g:<group id>`): sending to a group is not built yet, and the individual-send path would reach a stranger's number. Non-retryable; reply from the WhatsApp Business app. */
  WABA_GROUP_SEND_UNAVAILABLE: 'WABA_GROUP_SEND_UNAVAILABLE',
  /** Groups (BL-094): Meta answered 131215. The number is not an Official Business Account, or runs on the Business app. Not retryable. */
  WABA_GROUPS_NOT_ELIGIBLE: 'WABA_GROUPS_NOT_ELIGIBLE',
  /** The number is reached through Interakt or a registry provider; the Groups API is not verified to pass through them. */
  WABA_GROUPS_PROVIDER_UNSUPPORTED: 'WABA_GROUPS_PROVIDER_UNSUPPORTED',
  /** The group is not in this workspace and number, or Meta says it is gone (131041). */
  WABA_GROUP_NOT_FOUND: 'WABA_GROUP_NOT_FOUND',
  /** Meta suspended the group for a policy violation (131207). */
  WABA_GROUP_SUSPENDED: 'WABA_GROUP_SUSPENDED',
  /** A group or participant limit was reached (131204, 131211). */
  WABA_GROUP_LIMIT_REACHED: 'WABA_GROUP_LIMIT_REACHED',
  /** Too many group operations (131208, or our per-number throttle). Wait and retry. */
  WABA_GROUP_RATE_LIMITED: 'WABA_GROUP_RATE_LIMITED',
  /** Meta refused the group call for another reason; `message` is the operator wording and `details[metaCode]` Meta's code. */
  WABA_GROUP_META_REJECTED: 'WABA_GROUP_META_REJECTED',
} as const;
