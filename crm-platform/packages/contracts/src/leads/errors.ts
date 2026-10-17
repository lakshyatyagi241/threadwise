/**
 * Error codes of the lead pipeline (lead sources, events, the public lead hook). Spread into ERROR_CODES (common/errors.ts) so the
 * API and the web branch on one registry.
 */
export const LEAD_ERROR_CODES = {
  /** Another source of this workspace already has the name (any case). */
  LEAD_SOURCE_NAME_TAKEN: 'LEAD_SOURCE_NAME_TAKEN',
  /** The mapping names a contact property that does not exist or cannot take a mapped value (details: one path per property). */
  LEAD_MAPPING_INVALID: 'LEAD_MAPPING_INVALID',
  /** A user, pipeline, stage or lifecycle stage in the source's defaults is not one of this workspace's (details: the path). */
  LEAD_DEFAULTS_INVALID: 'LEAD_DEFAULTS_INVALID',
  /** The event is not `needs_review` or `failed`, so there is nothing to retry. */
  LEAD_EVENT_NOT_RETRYABLE: 'LEAD_EVENT_NOT_RETRYABLE',
  /** The event's payload was purged after its retention period: a retry has nothing to read. */
  LEAD_PAYLOAD_PURGED: 'LEAD_PAYLOAD_PURGED',
  /** The source is paused; a lead cannot be tested or retried through it. */
  LEAD_SOURCE_PAUSED: 'LEAD_SOURCE_PAUSED',
  /** The source cannot be pulled (a webhook sends its own leads), or cannot backfill (its source keeps no date-based history). */
  LEAD_SYNC_NOT_SUPPORTED: 'LEAD_SYNC_NOT_SUPPORTED',
  /** A sync or a backfill of this source is already queued or running: one at a time per source. */
  LEAD_SYNC_IN_PROGRESS: 'LEAD_SYNC_IN_PROGRESS',
  /** The source's own rate limit: ask again after `retryAfterSeconds`. */
  LEAD_SYNC_TOO_SOON: 'LEAD_SYNC_TOO_SOON',
  /** The backfill range reaches back further than the source keeps leads, or into the future. */
  LEAD_BACKFILL_RANGE_INVALID: 'LEAD_BACKFILL_RANGE_INVALID',
} as const;
