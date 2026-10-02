/**
 * Public surface of the coupons / referral / currency domain. Other modules import from here, never from the files behind it.
 *
 *   CouponResolverService  resolve(): does this code apply to this order, and for how much; recordRedemption(): count it when paid
 *   ReferralCodeService    ensure(): a user's referral code
 *   seedPlatformDefaults   the installer's currencies, demo coupons and credit-package bundles (idempotent)
 *
 * Referral attribution and the first-payment bonus are not called: they react to `referral.attributed` and `paygw.order.paid`.
 */
export { CouponsCreditsReferralCurrencyModule } from './coupons-credits-referral-currency.module';
export { CouponsCreditsReferralCurrencyWorkerModule } from './coupons-credits-referral-currency-worker.module';
export {
  CouponResolverService,
  type CouponDecision,
  type CouponRequest,
} from './coupon-resolver.service';
export { ReferralCodeService } from './referral-code.service';
export { seedPlatformDefaults, type SeededDefaults } from './seed-defaults';
