/**
 * Error codes of the Forms add-on (docs/specs/forms-builder-app.md section 7). Spread into ERROR_CODES (common/errors.ts) so the API and
 * the web branch on one registry. A public visitor only ever sees FORMS_VALIDATION (their own input), RATE_LIMITED, FORMS_ORIGIN_DENIED
 * (a browser submit from an origin the form does not allow) and the one 404 for an unknown, closed or plan-locked form.
 */
export const FORMS_ERROR_CODES = {
  /** Another active form of this workspace already has the name (any case). */
  FORMS_NAME_TAKEN: 'FORMS_NAME_TAKEN',
  /** The action does not apply in the form's current status (publish an archived form, delete a published one, ...). */
  FORMS_STATE_INVALID: 'FORMS_STATE_INVALID',
  /** The definition is not a valid form (details: one path per problem). */
  FORMS_DEFINITION_INVALID: 'FORMS_DEFINITION_INVALID',
  /** Publishing is refused: the form cannot work as built (details: one `path: reason` per problem, e.g. `crm_required_unbound`). */
  FORMS_PUBLISH_INVALID: 'FORMS_PUBLISH_INVALID',
  /** The visitor's answers do not pass the form (details: `path` = the field id, `message` = the rule that failed). */
  FORMS_VALIDATION: 'FORMS_VALIDATION',
  /** A browser submit from an origin the form does not allow. */
  FORMS_ORIGIN_DENIED: 'FORMS_ORIGIN_DENIED',
  /** The submission is not `needs_review` or `failed`, so there is nothing to retry. */
  FORMS_SUBMISSION_NOT_RETRYABLE: 'FORMS_SUBMISSION_NOT_RETRYABLE',
  /** The submission's answers were purged by the retention sweep or erased, so a retry has nothing to read. */
  FORMS_SUBMISSION_PURGED: 'FORMS_SUBMISSION_PURGED',
  /** The template key is not one of the gallery's. */
  FORMS_TEMPLATE_UNKNOWN: 'FORMS_TEMPLATE_UNKNOWN',
  /** The version number does not exist for the form. */
  FORMS_VERSION_UNKNOWN: 'FORMS_VERSION_UNKNOWN',
} as const;
