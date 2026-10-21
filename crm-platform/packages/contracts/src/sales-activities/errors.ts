/**
 * Error codes of the sales activities settings (ACTIVITY). Spread into ERROR_CODES (common/errors.ts) so the API and the web branch on one
 * registry.
 */
export const ACTIVITY_ERROR_CODES = {
  /** A default activity (Task, Meeting, Phone, Email, Reminder, SMS, Chat) cannot be renamed, re-shaped or removed. 409. */
  ACTIVITY_DEFAULT_LOCKED: 'ACTIVITY_DEFAULT_LOCKED',
  /** An activity of that name exists already. 409. */
  ACTIVITY_NAME_TAKEN: 'ACTIVITY_NAME_TAKEN',
  /** The task type or outcome is not one of this activity's current lists (it was removed, or it belongs to another activity). 422. */
  ACTIVITY_OPTION_INVALID: 'ACTIVITY_OPTION_INVALID',
  /** The activity does not offer an outcome, a task type or this switch. 422. */
  ACTIVITY_FEATURE_OFF: 'ACTIVITY_FEATURE_OFF',
  /** The workspace turned "Allow users to mark this activity as completed" off. 409. */
  ACTIVITY_COMPLETION_DISABLED: 'ACTIVITY_COMPLETION_DISABLED',
  /** The workspace did not allow editing the completed date and time of this activity. 409. */
  ACTIVITY_EDIT_COMPLETED_DISABLED: 'ACTIVITY_EDIT_COMPLETED_DISABLED',
  /** Too many custom activities, or too many task types or outcomes on one activity. 422. */
  ACTIVITY_LIMIT_REACHED: 'ACTIVITY_LIMIT_REACHED',
} as const;
