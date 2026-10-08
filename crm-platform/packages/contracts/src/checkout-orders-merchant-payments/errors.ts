/**
 * Error codes of the merchant side of the store (orders, coupons, customers, groups, workspace gateways, payments). Spread into
 * ERROR_CODES (common/errors.ts) so the API and the web branch on one registry.
 */
export const CHK_ERROR_CODES = {
  /** A coupon with that code exists in the workspace (compared ignoring case). */
  STORE_COUPON_CODE_TAKEN: 'STORE_COUPON_CODE_TAKEN',
  /** A group already carries that ordering code. */
  STORE_GROUP_CODE_TAKEN: 'STORE_GROUP_CODE_TAKEN',
  /** The order has no buyer phone, so nothing can be sent. */
  STORE_ORDER_NO_PHONE: 'STORE_ORDER_NO_PHONE',
  /** No gateway is configured for this order (per-store override, workspace default, or the shop's own keys). */
  STORE_GATEWAY_NOT_CONFIGURED: 'STORE_GATEWAY_NOT_CONFIGURED',
  /** The gateway is known but this build has no driver for it, or it cannot make a payment link a buyer can open. */
  STORE_GATEWAY_UNAVAILABLE: 'STORE_GATEWAY_UNAVAILABLE',
  /** The gateway refused to create the link (bad keys, amount under its minimum). */
  STORE_PAYMENT_LINK_FAILED: 'STORE_PAYMENT_LINK_FAILED',
} as const;
