import { WA_GROUP_ERROR_CODES } from './groups';

/**
 * Error codes of the personal-number (unofficial WhatsApp) devices API (docs/specs/personal-whatsapp-connect.md section 10).
 * Spread into ERROR_CODES (common/errors.ts) so the API and the web branch on one registry. The 422 `WA_UNOFFICIAL_DISABLED`
 * and `PLAN_LIMIT_REACHED` codes are shared with other domains and live in common/errors.ts.
 */
export const WADEV_ERROR_CODES = {
  /** The caller has not accepted the CURRENT version of the risk notice (409). `errors[]` carries `requiredVersion`. */
  PERSONAL_WA_NOTICE_REQUIRED: 'PERSONAL_WA_NOTICE_REQUIRED',
  /** The workspace already has a personal number with these digits (409). `errors[]` carries `existingId`. */
  DEVICE_ALREADY_EXISTS: 'DEVICE_ALREADY_EXISTS',
  /** The pilot cap on personal numbers per workspace is reached, whatever the plan allows (422). */
  DEVICE_PILOT_CAP_REACHED: 'DEVICE_PILOT_CAP_REACHED',
  /** Too many pairing starts for this device or workspace (429). `errors[]` carries `retryAfterS`. */
  DEVICE_PAIRING_RATE_LIMITED: 'DEVICE_PAIRING_RATE_LIMITED',
  /** Too many devices created in the last hour (429). `errors[]` carries `retryAfterS`. */
  DEVICE_CREATE_RATE_LIMITED: 'DEVICE_CREATE_RATE_LIMITED',
  /** Another person (or this one) already has a pairing attempt running on this device (409). `errors[]` carries `startedBy`, `retryAfterS`. */
  DEVICE_PAIRING_IN_PROGRESS: 'DEVICE_PAIRING_IN_PROGRESS',
  /** The device is linked or holds a healthy saved session: send `relink: true` to forget it and pair again (409). */
  DEVICE_NOT_PAIRABLE: 'DEVICE_NOT_PAIRABLE',
  /** There is no pairing attempt to read (it ended, expired or never started) (404). */
  DEVICE_NO_PAIRING: 'DEVICE_NO_PAIRING',
  /** The number is typed with fewer digits than a pairing code needs, or is not a phone number (422). */
  DEVICE_PHONE_INVALID: 'DEVICE_PHONE_INVALID',
  /** The number cannot be edited while a session exists (409): disconnect first. */
  DEVICE_NUMBER_LOCKED: 'DEVICE_NUMBER_LOCKED',
  /** No worker answered the command in time or none is running (503). Safe to retry in a few minutes. */
  WA_WORKER_UNAVAILABLE: 'WA_WORKER_UNAVAILABLE',
  /** WhatsApp did not produce the QR or the code in time (504). Counts toward the pairing limit. */
  DEVICE_PAIRING_TIMEOUT: 'DEVICE_PAIRING_TIMEOUT',
  /** The history import has nothing to cancel in this state (409). */
  HISTORY_IMPORT_NOT_ACTIVE: 'HISTORY_IMPORT_NOT_ACTIVE',
  // --- groups of a personal number (see groups.ts) ---
  ...WA_GROUP_ERROR_CODES,
} as const;
