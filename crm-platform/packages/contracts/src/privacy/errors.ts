/** Error codes of the data-subject rights service (PRIVACY). Spread into ERROR_CODES (common/errors.ts). */
export const PRIVACY_ERROR_CODES = {
  /** No such data request in this workspace. 404. */
  PRIVACY_REQUEST_NOT_FOUND: 'PRIVACY_REQUEST_NOT_FOUND',
  /** The person (contact, lead) the request names does not exist in this workspace. 404. */
  PRIVACY_SUBJECT_NOT_FOUND: 'PRIVACY_SUBJECT_NOT_FOUND',
  /** The action is not allowed from the request's status or type (details: `status`, `requestType`). 409. */
  PRIVACY_REQUEST_STATE_INVALID: 'PRIVACY_REQUEST_STATE_INVALID',
  /** Export and erasure run only after the person's identity was verified. 409. */
  PRIVACY_IDENTITY_NOT_VERIFIED: 'PRIVACY_IDENTITY_NOT_VERIFIED',
  /** The request is on legal hold: erasure is refused until the hold is released. 409. */
  PRIVACY_LEGAL_HOLD: 'PRIVACY_LEGAL_HOLD',
  /** Erasure executes only after a dry run of the same request, and with the typed confirmation phrase. 422. */
  PRIVACY_CONFIRMATION_REQUIRED: 'PRIVACY_CONFIRMATION_REQUIRED',
  /** An export of this request is already being prepared. 409. */
  PRIVACY_EXPORT_IN_PROGRESS: 'PRIVACY_EXPORT_IN_PROGRESS',
  /** No such export in this workspace. 404. */
  PRIVACY_EXPORT_NOT_FOUND: 'PRIVACY_EXPORT_NOT_FOUND',
  /** The export is not ready (still building, failed) or its file has expired. 409. */
  PRIVACY_EXPORT_NOT_READY: 'PRIVACY_EXPORT_NOT_READY',
  /**
   * The record is under a legal hold: it cannot be erased or deleted now (BL-295). The message is deliberately neutral (it never says why or
   * for what matter). On a rights erasure the case has been recorded as restricted (`restricted` in the problem details). 409.
   */
  LEGAL_HOLD_ACTIVE: 'LEGAL_HOLD_ACTIVE',
  /** The subject already has an active legal hold: extend it instead of placing a second one. 409. */
  LEGAL_HOLD_EXISTS: 'LEGAL_HOLD_EXISTS',
  /** No such legal hold in this workspace. 404. */
  LEGAL_HOLD_NOT_FOUND: 'LEGAL_HOLD_NOT_FOUND',
  /** The hold is already released or expired. 409. */
  LEGAL_HOLD_NOT_ACTIVE: 'LEGAL_HOLD_NOT_ACTIVE',
} as const;
