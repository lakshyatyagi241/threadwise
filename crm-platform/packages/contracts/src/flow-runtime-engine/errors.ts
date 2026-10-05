/**
 * Error codes of the flow runtime engine (FLR). Spread into ERROR_CODES (common/errors.ts) so the API and the web branch on one
 * registry.
 */
export const FLR_ERROR_CODES = {
  /** The flow id is not in this workspace. */
  FLR_FLOW_NOT_FOUND: 'FLR_FLOW_NOT_FOUND',
  /** The flow is paused or switched off: nothing may be enrolled into it (manual and API enrollment need an active flow). */
  FLR_FLOW_INACTIVE: 'FLR_FLOW_INACTIVE',
  /** The flow has no usable graph (no nodes): a run cannot start. */
  FLR_FLOW_EMPTY: 'FLR_FLOW_EMPTY',
  FLR_RUN_NOT_FOUND: 'FLR_RUN_NOT_FOUND',
  FLR_SUBSCRIBER_NOT_FOUND: 'FLR_SUBSCRIBER_NOT_FOUND',
  /** The contact is not in this workspace (or not found by the phone given). */
  FLR_CONTACT_NOT_FOUND: 'FLR_CONTACT_NOT_FOUND',
  /** The enrollment could not start a run; `details.reason` says why (no connected sender, no usable number). */
  FLR_ENROLL_FAILED: 'FLR_ENROLL_FAILED',
  /** The run is already over, or in a state the action does not apply to. */
  FLR_RUN_STATE_CONFLICT: 'FLR_RUN_STATE_CONFLICT',
  /** Only a failed run can be retried. */
  FLR_NOT_RETRYABLE: 'FLR_NOT_RETRYABLE',
  /** The run was retried less than FLOW_RETRY_COOLDOWN_SECONDS ago. */
  FLR_RETRY_TOO_SOON: 'FLR_RETRY_TOO_SOON',
  /** The conversation named to start a flow on is not in this workspace. */
  FLR_CONVERSATION_NOT_FOUND: 'FLR_CONVERSATION_NOT_FOUND',
} as const;
