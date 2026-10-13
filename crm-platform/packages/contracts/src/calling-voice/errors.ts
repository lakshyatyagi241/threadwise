/**
 * Error codes of the calling and voice domain (CALL). Spread into ERROR_CODES (common/errors.ts) so the API and the web branch on one
 * registry.
 */
export const CALL_ERROR_CODES = {
  /** The number is not in this workspace. */
  CALL_NUMBER_NOT_FOUND: 'CALL_NUMBER_NOT_FOUND',
  /** The call is not in this workspace. */
  CALL_NOT_FOUND: 'CALL_NOT_FOUND',
  /** Calling is a WhatsApp Cloud API feature: the number is not one. */
  CALL_NOT_WABA: 'CALL_NOT_WABA',
  /** The number has no usable Cloud API connection (no token or phone number id): reconnect it. */
  CALL_NUMBER_NOT_CONNECTED: 'CALL_NUMBER_NOT_CONNECTED',
  /** A number that shares its line with the WhatsApp Business app (coexistence) cannot take calls. */
  CALL_COEXISTENCE_UNSUPPORTED: 'CALL_COEXISTENCE_UNSUPPORTED',
  /** Calling is switched off on the number: turn it on first. */
  CALL_NOT_ENABLED: 'CALL_NOT_ENABLED',
  /** Meta refused the request; `message` is Meta's reason in plain words. */
  CALL_META_REFUSED: 'CALL_META_REFUSED',
  /** The customer has not allowed calls yet: a permission request was sent instead, and no call was placed. */
  CALL_PERMISSION_REQUESTED: 'CALL_PERMISSION_REQUESTED',
  /** The call was already taken (another teammate accepted it) or has moved on: nothing was changed. */
  CALL_STATE_CONFLICT: 'CALL_STATE_CONFLICT',
  /** The recording could not be stored. */
  CALL_RECORDING_FAILED: 'CALL_RECORDING_FAILED',
  /** The playback link is not one we issued, has run out, or its call has no recording any more: ask for a new one. */
  CALL_PLAYBACK_LINK_INVALID: 'CALL_PLAYBACK_LINK_INVALID',
  /** The range or time zone of a call log or analytics request does not make sense (backwards, too wide, an unknown zone). */
  CALL_RANGE_INVALID: 'CALL_RANGE_INVALID',
} as const;
