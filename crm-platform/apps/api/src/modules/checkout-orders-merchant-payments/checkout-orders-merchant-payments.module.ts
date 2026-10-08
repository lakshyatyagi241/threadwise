import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from '../../common/crypto/crypto.service';
import { readStorefrontEnv } from '../../config/domains/storefront-builder.env';
import {
  fixtureGatewayHttp,
  liveGatewayHttp,
} from '../../infra/providers/checkout-orders-merchant-payments/gateway-http';
import { RAZORPAY_PORT } from '../../infra/providers/storefront-builder/razorpay.port';
import { RazorpayFixtureAdapter } from '../../infra/providers/storefront-builder/razorpay-fixture.adapter';
import { RazorpayLiveAdapter } from '../../infra/providers/storefront-builder/razorpay-live.adapter';
import { GatewayLinkService } from './gateways/gateway-link.service';
import { GatewayPaymentRegistry } from './gateways/gateway-payment.registry';
import { GatewayWebhookController } from './gateways/gateway-webhook.controller';
import { GatewayWebhookService } from './gateways/gateway-webhook.service';
import { MerchantGatewaysController } from './gateways/merchant-gateways.controller';
import { MerchantGatewaysRepository } from './gateways/merchant-gateways.repository';
import { MerchantGatewaysService } from './gateways/merchant-gateways.service';
import { StoreKeysMirror } from './gateways/store-keys-mirror.service';
import { GATEWAY_HTTP, WorkspaceGatewayResolver } from './gateways/workspace-gateway.resolver';

/**
 * The shared workspace payment gateway (CHK): where the keys are saved, which gateway wins for a shop or an invoice, and the one
 * webhook address each gateway has. It depends on nothing of the store or of invoicing: the storefront and Sales invoices import
 * this barrel, and register how they settle a payment (`GatewayPaymentRegistry`), so there is no import cycle between the domains.
 * Driver HTTP is a fixture in `STORE_PROVIDER_MODE=fixture` (tests, demos), the real network otherwise.
 */
@Module({
  controllers: [MerchantGatewaysController, GatewayWebhookController],
  providers: [
    CryptoService,
    {
      provide: GATEWAY_HTTP,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        readStorefrontEnv(config).providerMode === 'fixture' ? fixtureGatewayHttp : liveGatewayHttp,
    },
    {
      provide: RAZORPAY_PORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        readStorefrontEnv(config).providerMode === 'fixture'
          ? new RazorpayFixtureAdapter()
          : new RazorpayLiveAdapter(),
    },
    MerchantGatewaysRepository,
    WorkspaceGatewayResolver,
    GatewayLinkService,
    GatewayPaymentRegistry,
    MerchantGatewaysService,
    GatewayWebhookService,
    StoreKeysMirror,
  ],
  exports: [
    WorkspaceGatewayResolver,
    GatewayLinkService,
    GatewayPaymentRegistry,
    StoreKeysMirror,
    GATEWAY_HTTP,
  ],
})
export class CheckoutOrdersMerchantPaymentsModule {}
