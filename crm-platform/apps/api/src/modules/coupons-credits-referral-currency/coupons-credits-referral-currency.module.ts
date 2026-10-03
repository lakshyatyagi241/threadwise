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
import { CreditPackageAdminService } from './credit-package-admin.service';
import { CreditPackagesController } from './credit-packages.controller';
import { CurrenciesController } from './currencies.controller';
import { CurrencyAdminService } from './currency-admin.service';

/**
 * Coupons, credit packages and the currency catalogue (CPN). The operator HTTP surface plus the service the checkout calls
 * (`CouponCheckoutService`, exported through the barrel). It uses the auth module's operator guard, audit writer and platform
 * store (those are global through AuthModule) and the settings domain's currency helpers and general settings group.
 */
@Module({
  imports: [PlatformSettingsModule],
  controllers: [CouponsController, CreditPackagesController, CurrenciesController],
  providers: [
    CpnStore,
    CouponAdminService,
    CouponCheckoutService,
    CreditPackageAdminService,
    CurrencyAdminService,
    { provide: FX_RATES, useClass: OpenErApiFxRates },
  ],
  exports: [CouponCheckoutService],
})
export class CouponsCreditsReferralCurrencyModule {}
