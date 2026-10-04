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
} as const;
