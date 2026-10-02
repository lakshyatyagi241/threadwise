/** Stable codes of the coupons, credits, referral and currency domain (TW-CPN). The web switches on these, never on the wording. */
export const CPN_ERROR_CODES = {
  /** A coupon code that another coupon already uses (compared without regard to case). */
  CPN_COUPON_CODE_TAKEN: 'CPN_COUPON_CODE_TAKEN',
  /** The coupon form names a plan or add-on that does not exist. `details` lists the slugs. */
  CPN_COUPON_PLAN_UNKNOWN: 'CPN_COUPON_PLAN_UNKNOWN',
  /** The resolver refused the code at checkout; the message is the reason the buyer reads (TW-CPN-006). */
  CPN_COUPON_REJECTED: 'CPN_COUPON_REJECTED',
  /** Too many coupon checks in a short time (the preview is throttled, TW-CPN-007 rule 3). */
  CPN_COUPON_THROTTLED: 'CPN_COUPON_THROTTLED',
  CPN_CURRENCY_CODE_TAKEN: 'CPN_CURRENCY_CODE_TAKEN',
  /** The platform default currency cannot be deleted or switched off; change the default first (TW-CPN-021, 022). */
  CPN_CURRENCY_IS_DEFAULT: 'CPN_CURRENCY_IS_DEFAULT',
  /** A workspace, plan, gateway or coupon still names this currency (TW-CPN-022 port note). */
  CPN_CURRENCY_IN_USE: 'CPN_CURRENCY_IN_USE',
  /** The default currency must be an active catalog currency. */
  CPN_CURRENCY_NOT_ACTIVE: 'CPN_CURRENCY_NOT_ACTIVE',
  /** The live-rate provider answered with an error, nothing usable, or not at all. Rates are unchanged. */
  CPN_RATES_FETCH_FAILED: 'CPN_RATES_FETCH_FAILED',
  /** A workspace currency that is not in the catalog (or not active). */
  CPN_WORKSPACE_CURRENCY_INVALID: 'CPN_WORKSPACE_CURRENCY_INVALID',
} as const;
