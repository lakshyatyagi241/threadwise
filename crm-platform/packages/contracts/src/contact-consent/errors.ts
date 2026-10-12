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
} as const;
