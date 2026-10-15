/** Error codes of the Compliance center (COMPLIANCE). Spread into ERROR_CODES (common/errors.ts). */
export const COMPLIANCE_ERROR_CODES = {
  /** The settings could not be saved: a window, a time zone or a language is not valid. 422. */
  COMPLIANCE_SETTINGS_INVALID: 'COMPLIANCE_SETTINGS_INVALID',
  /** No such sub-processor in this workspace. 404. */
  COMPLIANCE_SUBPROCESSOR_NOT_FOUND: 'COMPLIANCE_SUBPROCESSOR_NOT_FOUND',
  /** The workspace already lists a sub-processor with this name. 409. */
  COMPLIANCE_SUBPROCESSOR_DUPLICATE: 'COMPLIANCE_SUBPROCESSOR_DUPLICATE',
  /** The workspace has no public trust page (the switch is off or the workspace does not exist). 404. */
  COMPLIANCE_TRUST_PAGE_NOT_FOUND: 'COMPLIANCE_TRUST_PAGE_NOT_FOUND',
  /** An outbound call was refused because the workspace's calling window is closed for this contact. A call is live and cannot wait, so it is refused (BL-177); the answer says when the window opens. 422. */
  COMPLIANCE_CALL_OUTSIDE_WINDOW: 'COMPLIANCE_CALL_OUTSIDE_WINDOW',
} as const;
