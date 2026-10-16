/**
 * Error codes of the Meta lead ads door (MLA). Spread into ERROR_CODES (common/errors.ts) so the API and the web branch on one registry.
 */
export const MLA_ERROR_CODES = {
  /** No Meta app is set on this install (app id / secret): lead ads cannot be connected until an administrator adds one. */
  MLA_NOT_CONFIGURED: 'MLA_NOT_CONFIGURED',
  /** The Page was connected without the lead permissions (or Meta has since withdrawn them): it needs the "Grant lead access" login. */
  MLA_LEAD_ACCESS_MISSING: 'MLA_LEAD_ACCESS_MISSING',
  /** The Page's token is no longer valid: the Page has to be reconnected before anything is read from Meta. */
  MLA_PAGE_RECONNECT: 'MLA_PAGE_RECONNECT',
  /** Meta refused to subscribe the Page to the `leadgen` webhook field (details: Meta's own words). */
  MLA_SUBSCRIBE_FAILED: 'MLA_SUBSCRIBE_FAILED',
  /** Meta did not answer the request for the Page's lead forms (details: Meta's own words). */
  MLA_FORMS_UNAVAILABLE: 'MLA_FORMS_UNAVAILABLE',
  /** The form is not one of this Page's lead forms (deleted at Meta, or an id from another Page). */
  MLA_FORM_NOT_FOUND: 'MLA_FORM_NOT_FOUND',
  /** Lead sync is not switched on for this Page: turn it on before choosing forms. */
  MLA_SYNC_OFF: 'MLA_SYNC_OFF',
} as const;
