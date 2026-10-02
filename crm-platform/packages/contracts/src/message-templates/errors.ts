/** Error codes of the message-templates domain. Spread into ERROR_CODES (common/errors.ts). */
export const TPL_ERROR_CODES = {
  TPL_NOT_FOUND: 'TPL_NOT_FOUND',
  /** A template with this name and language already exists on the connection. */
  TPL_NAME_TAKEN: 'TPL_NAME_TAKEN',
  /** The pre-submit linter found errors; `errors[]` lists them. Nothing was sent to Meta. */
  TPL_LINT_FAILED: 'TPL_LINT_FAILED',
  /** Meta refused the create. `detail` carries Meta's own reason. The row is kept so it can be fixed and retried. */
  TPL_META_REJECTED: 'TPL_META_REJECTED',
  /** The template has no connected number to submit through. */
  TPL_NO_CONNECTION: 'TPL_NO_CONNECTION',
  /** A running or scheduled broadcast uses this template. */
  TPL_IN_USE: 'TPL_IN_USE',
  /** Only a template Meta has not approved yet, or one that was rejected, can be edited in place. */
  TPL_NOT_EDITABLE: 'TPL_NOT_EDITABLE',
} as const;
