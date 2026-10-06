/**
 * Public surface of the coupons, credit packages, referral and currency domain. Other modules import from here only.
 *
 * The payment-gateways domain calls `CouponCheckoutService.quote` (preview and the binding re-check when an order is placed) and
 * `CouponCheckoutService.redeemForOrder` (inside the paid transition). The money helpers are pure.
 */
export { CouponsCreditsReferralCurrencyModule } from './coupons-credits-referral-currency.module';
export {
  CouponCheckoutService,
  type CouponQuote,
  type CouponQuoteInput,
} from './coupon-checkout.service';
export {
  decimalToScaled,
  majorDecimalToMinor,
  resolveCoupon,
  type CouponFacts,
  type Resolution,
} from './coupon-rules';
export { CouponsCreditsReferralCurrencyWorkerModule } from './coupons-credits-referral-currency-worker.module';
