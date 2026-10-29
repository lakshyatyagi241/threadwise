/**
 * Public surface of the coupons, credit packages, referral and currency domain. Other modules import from here only.
 *
 * Coupon resolution and redemption for checkout are in platform-payment-gateways (one engine, #1068). The money helpers are pure.
 */
export { CouponsCreditsReferralCurrencyModule } from './coupons-credits-referral-currency.module';
export {
  decimalToScaled,
  majorDecimalToMinor,
  resolveCoupon,
  type CouponFacts,
  type Resolution,
} from './coupon-rules';
export { CouponsCreditsReferralCurrencyWorkerModule } from './coupons-credits-referral-currency-worker.module';
