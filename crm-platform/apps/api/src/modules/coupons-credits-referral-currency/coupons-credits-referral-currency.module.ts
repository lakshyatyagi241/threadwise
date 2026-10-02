import { Global, Module } from '@nestjs/common';
import {
  FX_RATE_PROVIDER,
  OpenErApiProvider,
} from '../../infra/providers/coupons-credits-referral-currency';
import { ONBOARDING_BILLING_SOURCE } from '../auth';
import { PlatformSettingsModule } from '../platform-settings-branding-storage';
import { WalletMessageBillingModule } from '../wallet-message-billing';
import { AffiliateController } from './affiliate.controller';
import { CouponResolverService } from './coupon-resolver.service';
import { CouponsService } from './coupons.service';
import { CurrenciesService } from './currencies.service';
import { OnboardingBillingSourceImpl } from './onboarding-billing.source';
import { PlatformCouponsController } from './platform-coupons.controller';
import { PlatformCurrenciesController } from './platform-currencies.controller';
import { ReferralCodeService } from './referral-code.service';
import { ReferralService } from './referral.service';
import { WorkspaceCurrencyController } from './workspace-currency.controller';
import { WorkspaceCurrencyService } from './workspace-currency.service';

/**
 * Coupons, referral/affiliate and the currency catalog (CPN). Registered in app.module.ts. The credit-package catalogue stays in
 * the wallet module (TW-WALLET-019), which owns the wallet it feeds. AuthModule, the database, config and the kernel are global.
 */
/**
 * Global so the auth domain's sign-up plan step can find its optional `ONBOARDING_BILLING_SOURCE` without importing this domain.
 */
@Global()
@Module({
  imports: [PlatformSettingsModule, WalletMessageBillingModule],
  controllers: [
    PlatformCouponsController,
    PlatformCurrenciesController,
    WorkspaceCurrencyController,
    AffiliateController,
  ],
  providers: [
    CouponsService,
    CouponResolverService,
    CurrenciesService,
    WorkspaceCurrencyService,
    ReferralService,
    ReferralCodeService,
    OpenErApiProvider,
    { provide: FX_RATE_PROVIDER, useExisting: OpenErApiProvider },
    OnboardingBillingSourceImpl,
    { provide: ONBOARDING_BILLING_SOURCE, useExisting: OnboardingBillingSourceImpl },
  ],
  exports: [CouponResolverService, ReferralCodeService, ONBOARDING_BILLING_SOURCE],
})
export class CouponsCreditsReferralCurrencyModule {}
