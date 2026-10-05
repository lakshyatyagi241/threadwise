/**
 * Error codes of the platform payment gateways domain. Spread into ERROR_CODES (common/errors.ts) so the API and the web
 * branch on one registry; kept here so the domain owns its own vocabulary.
 */
export const PAYGW_ERROR_CODES = {
  /** Activation refused: required credential fields are empty. `details` lists the field keys. */
  PAYGW_GATEWAY_NOT_CONFIGURED: 'PAYGW_GATEWAY_NOT_CONFIGURED',
  /** The chosen gateway is inactive or does not exist (checked before any order is created). */
  PAYGW_GATEWAY_UNAVAILABLE: 'PAYGW_GATEWAY_UNAVAILABLE',
  PAYGW_CURRENCY_UNSUPPORTED: 'PAYGW_CURRENCY_UNSUPPORTED',
  /** The provider rejected or failed the call; the order is marked failed and the buyer may pick another gateway. */
  PAYGW_PROVIDER_ERROR: 'PAYGW_PROVIDER_ERROR',
  PAYGW_PLAN_NOT_PURCHASABLE: 'PAYGW_PLAN_NOT_PURCHASABLE',
  PAYGW_DOWNGRADE_NOT_ALLOWED: 'PAYGW_DOWNGRADE_NOT_ALLOWED',
  PAYGW_AMOUNT_TOO_LOW: 'PAYGW_AMOUNT_TOO_LOW',
  PAYGW_COUPON_UNAVAILABLE: 'PAYGW_COUPON_UNAVAILABLE',
  PAYGW_WEBHOOK_SECRET_MISSING: 'PAYGW_WEBHOOK_SECRET_MISSING',
  PAYGW_SIGNATURE_MISMATCH: 'PAYGW_SIGNATURE_MISMATCH',
  /** The coupon code was refused (unknown, expired, used up, wrong plan or currency...). The message says which. */
  PAYGW_COUPON_REJECTED: 'PAYGW_COUPON_REJECTED',
  /** An admin action the order's current status does not allow (cancel a paid order, void a paid invoice...). */
  PAYGW_ORDER_STATE: 'PAYGW_ORDER_STATE',
} as const;
