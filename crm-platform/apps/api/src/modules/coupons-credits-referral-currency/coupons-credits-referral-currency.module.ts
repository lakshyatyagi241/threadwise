import { Module } from '@nestjs/common';
import {
  FX_RATES,
  OpenErApiFxRates,
} from '../../infra/providers/coupons-credits-referral-currency';
import { PlatformSettingsModule } from '../platform-settings-branding-storage';
import { CouponAdminService } from './coupon-admin.service';
import { CouponCheckoutService } from './coupon-checkout.service';
import { CouponsController } from './coupons.controller';
import { CpnStore } from './cpn-store';
import { CurrenciesController } from './currencies.controller';
import { CurrencyAdminService } from './currency-admin.service';

/**
 * Coupons and the currency catalogue (CPN). The operator HTTP surface plus the service the checkout calls
 * (`CouponCheckoutService`, exported through the barrel). It uses the auth module's operator guard, audit writer and platform
 * store (those are global through AuthModule) and the settings domain's currency helpers and general settings group.
 */
@Module({
  imports: [PlatformSettingsModule],
  controllers: [CouponsController, CurrenciesController],
  providers: [
    CpnStore,
    CouponAdminService,
    CouponCheckoutService,
    CurrencyAdminService,
    { provide: FX_RATES, useClass: OpenErApiFxRates },
  ],
  exports: [CouponCheckoutService],
})
export class CouponsCreditsReferralCurrencyModule {}
