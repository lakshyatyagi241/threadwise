/**
 * Error codes of AI Training (AIAG). Spread into ERROR_CODES (common/errors.ts) so the API and the web branch on one registry.
 * Field problems of a form (a missing label, a Q&A with no answer) are the generic VALIDATION_FAILED with one path per field.
 */
export const AIAG_ERROR_CODES = {
  /** The uploaded file's type is not one of TXT, Markdown, CSV, HTML, PDF or DOCX (a legacy `.doc` gets its own hint in the message). */
  AIAG_FILE_TYPE_UNSUPPORTED: 'AIAG_FILE_TYPE_UNSUPPORTED',
  /** The uploaded file is over the size cap. */
  AIAG_FILE_TOO_LARGE: 'AIAG_FILE_TOO_LARGE',
  /** The file is corrupt, password protected or otherwise cannot be read. */
  AIAG_FILE_UNREADABLE: 'AIAG_FILE_UNREADABLE',
  /** The file holds no text (a scanned, image-only PDF, an empty document). */
  AIAG_FILE_NO_TEXT: 'AIAG_FILE_NO_TEXT',
} as const;
