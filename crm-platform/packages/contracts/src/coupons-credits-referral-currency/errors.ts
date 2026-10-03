/**
 * Error codes of the coupons, credit packages, referral and currency domain. Spread into ERROR_CODES (common/errors.ts) so the
 * API and the web branch on one registry; kept here so the domain owns its own vocabulary.
 */
export const CPN_ERROR_CODES = {
  /** Another coupon already uses this code (codes are compared case-insensitively). */
  CPN_COUPON_CODE_TAKEN: 'CPN_COUPON_CODE_TAKEN',
  /** `applicablePlans` names a plan or add-on that does not exist. `details` lists the unknown slugs. */
  CPN_COUPON_PLAN_UNKNOWN: 'CPN_COUPON_PLAN_UNKNOWN',
  /** A package or coupon names a currency that is not an active catalog currency. */
  CPN_CURRENCY_UNKNOWN: 'CPN_CURRENCY_UNKNOWN',
  CPN_CURRENCY_CODE_TAKEN: 'CPN_CURRENCY_CODE_TAKEN',
  /** The platform default currency cannot be deleted or deactivated: choose another default first. */
  CPN_CURRENCY_DEFAULT_PROTECTED: 'CPN_CURRENCY_DEFAULT_PROTECTED',
  /** A currency that plans, orders, packages or gateways still name cannot be deleted. */
  CPN_CURRENCY_IN_USE: 'CPN_CURRENCY_IN_USE',
  /** The live-rate provider failed or returned nothing; no rate was changed. */
  CPN_RATES_FETCH_FAILED: 'CPN_RATES_FETCH_FAILED',
} as const;
