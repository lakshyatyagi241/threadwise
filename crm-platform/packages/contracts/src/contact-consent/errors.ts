/** Error codes of the contact consent ledger (CONSENT). Spread into ERROR_CODES (common/errors.ts). */
export const CONSENT_ERROR_CODES = {
  /** The contact does not exist in this workspace. 404. */
  CONSENT_CONTACT_NOT_FOUND: 'CONSENT_CONTACT_NOT_FOUND',
  /** A grant needs a reason / source note (a person says why the contact agreed). 422. */
  CONSENT_NOTE_REQUIRED: 'CONSENT_NOTE_REQUIRED',
  /** The same Idempotency-Key was used for a different consent event. 409. */
  CONSENT_IDEMPOTENCY_MISMATCH: 'CONSENT_IDEMPOTENCY_MISMATCH',
  /** The keyword lists or replies are not valid (empty keyword, too long, same word in both lists is allowed: opt-out wins). 422. */
  CONSENT_SETTINGS_INVALID: 'CONSENT_SETTINGS_INVALID',
  /** The ConsentGate refused a send: the contact withdrew or no consent is recorded. 422. The message says which; no override exists. */
  CONSENT_SEND_DENIED: 'CONSENT_SEND_DENIED',
  /** The unsubscribe link is not valid (altered or unknown). 404. */
  CONSENT_UNSUBSCRIBE_LINK_INVALID: 'CONSENT_UNSUBSCRIBE_LINK_INVALID',
  /** An asynchronous export of the consent proof is already being prepared for this workspace. 409. */
  CONSENT_EXPORT_IN_PROGRESS: 'CONSENT_EXPORT_IN_PROGRESS',
  /** No such export in this workspace. 404. */
  CONSENT_EXPORT_NOT_FOUND: 'CONSENT_EXPORT_NOT_FOUND',
  /** The export is not ready (still building, failed) or its file has expired. 409. */
  CONSENT_EXPORT_NOT_READY: 'CONSENT_EXPORT_NOT_READY',
  /** The consent notice could not be saved: its wording is missing or the link is not https. 422. */
  CONSENT_NOTICE_INVALID: 'CONSENT_NOTICE_INVALID',
  /** The intake point the notice belongs to (widget, booking type, store) does not exist in this workspace. 404. */
  CONSENT_NOTICE_TARGET_NOT_FOUND: 'CONSENT_NOTICE_TARGET_NOT_FOUND',
} as const;
