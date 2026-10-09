/**
 * Error codes of the API Library (ALIB). Spread into ERROR_CODES (common/errors.ts) so the API and the web branch on one registry.
 * A failed *run* of a saved API (blocked address, timeout, a non-2xx answer, a processing function that throws) is not an HTTP error of
 * ours: the test route answers 200 with `ok: false` and an `errorKind` (see run.ts). These codes are for the management routes.
 */
export const ALIB_ERROR_CODES = {
  /** Another API of this workspace already has the name (names are unique ignoring case). 409. */
  ALIB_NAME_TAKEN: 'ALIB_NAME_TAKEN',
  /** The API is used by flows; delete again with `?force=true` to remove it anyway. 409. */
  ALIB_IN_USE: 'ALIB_IN_USE',
  /** The workspace already has the maximum number of saved APIs. 422. */
  ALIB_LIMIT_REACHED: 'ALIB_LIMIT_REACHED',
} as const;
