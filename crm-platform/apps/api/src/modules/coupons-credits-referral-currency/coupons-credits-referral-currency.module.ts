import { Module } from '@nestjs/common';
import {
  FX_RATES,
  OpenErApiFxRates,
} from '../../infra/providers/coupons-credits-referral-currency';
import { PlatformSettingsModule } from '../platform-settings-branding-storage';
import { WalletMessageBillingModule } from '../wallet-message-billing';
import { CouponAdminService } from './coupon-admin.service';
import { CouponCheckoutService } from './coupon-checkout.service';
import { CouponsController } from './coupons.controller';
import { CpnStore } from './cpn-store';
import { CurrenciesController } from './currencies.controller';
import { CurrencyAdminService } from './currency-admin.service';
import { ReferralAttributionService } from './referral-attribution.service';
import { ReferralCodeService } from './referral-code.service';
import { ReferralRewardService } from './referral-reward.service';
import { ReferralRepository } from './referral.repository';
import { ReferralService } from './referral.service';
import { ReferralsController } from './referrals.controller';

/**
 * Coupons, the currency catalogue and the referral programme (CPN). The operator HTTP surface, the user's own affiliate routes,
 * and the service the checkout calls (`CouponCheckoutService`, exported through the barrel). The referral consumers live in the
 * worker module beside this one. It uses the auth module's operator guard, audit writer and platform
 * store (those are global through AuthModule) and the settings domain's currency helpers and general settings group.
 */
@Module({
  imports: [PlatformSettingsModule, WalletMessageBillingModule],
  controllers: [CouponsController, CurrenciesController, ReferralsController],
  providers: [
    CpnStore,
    CouponAdminService,
    CouponCheckoutService,
    CurrencyAdminService,
    ReferralCodeService,
    ReferralAttributionService,
    ReferralRewardService,
    ReferralRepository,
    ReferralService,
    { provide: FX_RATES, useClass: OpenErApiFxRates },
  ],
  exports: [
    CouponCheckoutService,
    CpnStore,
    ReferralCodeService,
    ReferralAttributionService,
    ReferralRewardService,
  ],
})
export class CouponsCreditsReferralCurrencyModule {}
