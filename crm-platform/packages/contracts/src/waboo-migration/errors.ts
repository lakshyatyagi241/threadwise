/** Error codes of the Waboo migration panel (WMIG). Spread into ERROR_CODES (common/errors.ts). */
export const WABOO_MIGRATION_ERROR_CODES = {
  /** Another run for this client is queued or running. */
  WMIG_RUN_ACTIVE: 'WMIG_RUN_ACTIVE',
  /** A load needs the organization id (or, for a batch, the number of organizations) typed again. */
  WMIG_CONFIRM_MISMATCH: 'WMIG_CONFIRM_MISMATCH',
  /** A load needs a green dry run for every organization from the last 24 hours. */
  WMIG_DRY_RUN_REQUIRED: 'WMIG_DRY_RUN_REQUIRED',
  /** Only a queued run or batch can be cancelled; a running run cannot in v1. */
  WMIG_NOT_CANCELLABLE: 'WMIG_NOT_CANCELLABLE',
  /** The derived client key is already used by a different Waboo organization (or twice in one batch). */
  WMIG_CLIENT_COLLISION: 'WMIG_CLIENT_COLLISION',
  /** run_at is in the past or more than 90 days ahead. */
  WMIG_SCHEDULE_INVALID: 'WMIG_SCHEDULE_INVALID',
} as const;
