/**
 * Error codes of the FAQ knowledge base (FAQ). Spread into ERROR_CODES (common/errors.ts) so the API and the web branch on one registry.
 * Field problems of a form are the generic VALIDATION_FAILED with one path per field.
 */
export const FAQ_ERROR_CODES = {
  /** The platform operator switched the FAQ engine off for every workspace. 422. */
  FAQ_ENGINE_DISABLED: 'FAQ_ENGINE_DISABLED',
  /** The workspace is at its FAQ or variation cap (the platform sets both). 422. */
  FAQ_LIMIT_REACHED: 'FAQ_LIMIT_REACHED',
  /** Another FAQ of the workspace already has this question (compared ignoring case and spacing). 409. */
  FAQ_DUPLICATE_QUESTION: 'FAQ_DUPLICATE_QUESTION',
  /** The flow an FAQ should start is not in this workspace. 422. */
  FAQ_FLOW_NOT_FOUND: 'FAQ_FLOW_NOT_FOUND',
  /** No AI key resolves for the embedding provider, or the provider refused or timed out. 422 for a missing key, 502 otherwise. */
  FAQ_EMBEDDING_UNAVAILABLE: 'FAQ_EMBEDDING_UNAVAILABLE',
  /**
   * The embedding model is not on the platform's allow-list (it must answer in the table's vector width). 422. Reserved: today an unlisted
   * model is refused by the request schema as VALIDATION_FAILED; this code is for the day the allow-list is data rather than a constant.
   */
  FAQ_MODEL_NOT_ALLOWED: 'FAQ_MODEL_NOT_ALLOWED',
} as const;
