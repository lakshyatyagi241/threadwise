/**
 * Error codes of the AI report assistant. Spread into ERROR_CODES (common/errors.ts) so the API and the web branch on one registry.
 * The web shows REPORT_AI_KEY_MISSING as the "Add an AI key in Settings" card rather than a generic failure.
 */
export const REPORT_ERROR_CODES = {
  /** The uploaded file's type is not one the assistant can read. */
  REPORT_DOC_TYPE_UNSUPPORTED: 'REPORT_DOC_TYPE_UNSUPPORTED',
  /** The uploaded file is over the size cap. */
  REPORT_DOC_TOO_LARGE: 'REPORT_DOC_TOO_LARGE',
  /** The file is corrupt, password protected or otherwise cannot be read. Nothing is stored. */
  REPORT_DOC_UNREADABLE: 'REPORT_DOC_UNREADABLE',
  /** The file holds no text (a scanned, image-only PDF, an empty document). Nothing is stored. */
  REPORT_DOC_NO_TEXT: 'REPORT_DOC_NO_TEXT',
  /** The library already holds the maximum number of documents. */
  REPORT_DOC_LIMIT_REACHED: 'REPORT_DOC_LIMIT_REACHED',
  /** No usable AI key: the workspace has none of its own and the platform has no active key for a model the assistant can use. */
  REPORT_AI_KEY_MISSING: 'REPORT_AI_KEY_MISSING',
  /** Keys exist, but only for vendors whose models cannot drive the assistant's tools. */
  REPORT_AI_PROVIDER_UNSUPPORTED: 'REPORT_AI_PROVIDER_UNSUPPORTED',
} as const;
