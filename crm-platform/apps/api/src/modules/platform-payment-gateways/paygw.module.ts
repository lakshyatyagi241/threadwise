import { Module } from '@nestjs/common';
import { AddonsExtensionRegistryModule } from '../addons-extension-registry';
import { CryptoService } from '../../common/crypto/crypto.service';
import { CouponsCreditsReferralCurrencyModule } from '../coupons-credits-referral-currency';
import { PlatformSettingsModule } from '../platform-settings-branding-storage';
import { WalletMessageBillingModule } from '../wallet-message-billing';
import { CheckoutController } from './checkout.controller';
import { CheckoutService } from './checkout.service';
import { CheckoutSettingsService } from './checkout-settings.service';
import { FulfilmentService } from './fulfilment.service';
import { GatewayService } from './gateway.service';
import { OrdersRepository } from './orders.repository';
import { OrdersService } from './orders.service';
import { PaygwStore } from './paygw.store';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PlatformGatewaysController } from './platform-gateways.controller';

/**
 * Platform payment gateways, checkout and order history (PAYGW). Registered in app.module.ts. AuthModule, the database, config
 * and the kernel are global providers, as in PlansModule.
 */
@Module({
  imports: [
    AddonsExtensionRegistryModule,
    WalletMessageBillingModule,
    CouponsCreditsReferralCurrencyModule,
    PlatformSettingsModule,
  ],
  controllers: [PlatformGatewaysController, CheckoutController, PaymentsController],
  providers: [
    CryptoService,
    PaygwStore,
    GatewayService,
    CheckoutSettingsService,
    OrdersRepository,
    OrdersService,
    FulfilmentService,
    CheckoutService,
    PaymentsService,
  ],
  exports: [GatewayService],
})
export class PlatformPaymentGatewaysModule {}
