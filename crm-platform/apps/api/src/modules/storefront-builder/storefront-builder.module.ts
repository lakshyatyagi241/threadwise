import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from '../../common/crypto/crypto.service';
import {
  readStorefrontEnv,
  STOREFRONT_ENV,
  type StorefrontEnv,
} from '../../config/domains/storefront-builder.env';
import {
  BRIDGE_TEXT_PORT,
  HttpBridgeTextClient,
} from '../../infra/providers/storefront-builder/bridge-text.client';
import { DNS_RESOLVER_PORT } from '../../infra/providers/storefront-builder/dns-resolver.port';
import {
  FixtureDnsResolver,
  SystemDnsResolver,
} from '../../infra/providers/storefront-builder/dns-resolver.adapters';
import { RAZORPAY_PORT } from '../../infra/providers/storefront-builder/razorpay.port';
import { RazorpayFixtureAdapter } from '../../infra/providers/storefront-builder/razorpay-fixture.adapter';
import { RazorpayLiveAdapter } from '../../infra/providers/storefront-builder/razorpay-live.adapter';
import { CatalogProductsModule } from '../catalog-products';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { EngineRecoveryNudgeSender } from './_shims/engine-recovery-nudge-sender';
import { SqlCouponDirectory } from './_shims/sql-coupon-directory';
import { SqlOrdersGateway } from './_shims/sql-orders-gateway';
import { SqlSenderDirectory } from './_shims/sql-sender-directory';
import {
  COUPON_DIRECTORY,
  ORDERS_GATEWAY,
  RECOVERY_NUDGE_SENDER,
  SENDER_DIRECTORY,
} from './_shims/tokens';
import { PaymentWebhookController } from './payments/payment-webhook.controller';
import { PaymentWebhookService } from './payments/payment-webhook.service';
import { StorefrontPaymentService } from './payments/storefront-payment.service';
import { StoreOverviewService } from './overview/store-overview.service';
import { CartPricingService } from './public/cart-pricing.service';
import { CheckoutService } from './public/checkout.service';
import { PublicCatalogService } from './public/public-catalog.service';
import { PublicRateLimitGuard } from './public/public-rate-limit.guard';
import { PublicRateLimiter } from './public/public-rate-limiter';
import { PublicShopLoader } from './public/public-shop.loader';
import { PublicStoreController } from './public/public-store.controller';
import { CartRecoveryRepository } from './recovery/cart-recovery.repository';
import { CartRecoveryService } from './recovery/cart-recovery.service';
import { ShopUrlService } from './shops/shop-url.service';
import { ShopsRepository } from './shops/shops.repository';
import { ShopsService } from './shops/shops.service';
import { StoreController } from './shops/store.controller';
import { StorefrontSettingsService } from './shops/storefront-settings.service';

/**
 * The storefront: the store dashboard, the shop wizard, the storefront settings and the public shop (STORE).
 *
 * Products and reviews come from catalog-products through its barrel; orders and coupons belong to checkout-orders-merchant-payments
 * and are reached through the shims in `_shims/` until that domain exports its own services (see `_shims/README.md`).
 * Razorpay and DNS sit behind ports (`infra/providers/storefront-builder`), chosen by `STORE_PROVIDER_MODE`.
 */
@Module({
  imports: [PlansCoreModule, CatalogProductsModule],
  controllers: [StoreController, PublicStoreController, PaymentWebhookController],
  providers: [
    CryptoService,
    {
      provide: STOREFRONT_ENV,
      inject: [ConfigService],
      useFactory: (config: ConfigService): StorefrontEnv => readStorefrontEnv(config),
    },
    {
      provide: RAZORPAY_PORT,
      inject: [STOREFRONT_ENV],
      useFactory: (env: StorefrontEnv) =>
        env.providerMode === 'fixture' ? new RazorpayFixtureAdapter() : new RazorpayLiveAdapter(),
    },
    {
      provide: DNS_RESOLVER_PORT,
      inject: [STOREFRONT_ENV],
      useFactory: (env: StorefrontEnv) =>
        env.providerMode === 'fixture' ? new FixtureDnsResolver() : new SystemDnsResolver(),
    },
    {
      provide: BRIDGE_TEXT_PORT,
      inject: [STOREFRONT_ENV],
      useFactory: (env: StorefrontEnv) => new HttpBridgeTextClient(env.bridgeUrl, env.bridgeToken),
    },
    { provide: ORDERS_GATEWAY, useClass: SqlOrdersGateway },
    { provide: COUPON_DIRECTORY, useClass: SqlCouponDirectory },
    { provide: SENDER_DIRECTORY, useClass: SqlSenderDirectory },
    { provide: RECOVERY_NUDGE_SENDER, useClass: EngineRecoveryNudgeSender },
    ShopsRepository,
    CartRecoveryRepository,
    ShopUrlService,
    ShopsService,
    StorefrontSettingsService,
    StoreOverviewService,
    StorefrontPaymentService,
    PaymentWebhookService,
    PublicRateLimiter,
    PublicRateLimitGuard,
    PublicShopLoader,
    PublicCatalogService,
    CartPricingService,
    CartRecoveryService,
    CheckoutService,
  ],
  exports: [
    ShopsService,
    ShopUrlService,
    StorefrontPaymentService,
    // The worker module's sweep reads these.
    STOREFRONT_ENV,
    SENDER_DIRECTORY,
    RECOVERY_NUDGE_SENDER,
    ShopsRepository,
    CartRecoveryRepository,
  ],
})
export class StorefrontBuilderModule {}
