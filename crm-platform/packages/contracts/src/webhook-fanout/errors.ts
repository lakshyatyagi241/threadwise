/** Error codes of the webhook fan-out domain. Spread into ERROR_CODES (common/errors.ts). */
export const WEBHOOK_FANOUT_ERROR_CODES = {
  /** The target URL is not https, or resolves to a private/reserved address. */
  WFWD_URL_REJECTED: 'WFWD_URL_REJECTED',
} as const;
