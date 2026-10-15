import { Module } from '@nestjs/common';
import { PlansCoreModule } from '../plans-subscriptions-trials';
import { BroadcastsModule } from '../broadcasts';
import { ContactConsentModule } from '../contact-consent';
import { CrmModule } from '../crm';
import { NodeBridgeRuntimeModule } from '../node-bridge-runtime';
import { PlatformSettingsModule } from '../platform-settings-branding-storage';
import { CryptoService } from '../../common/crypto/crypto.service';
import { SHOPIFY, WOOCOMMERCE } from '../../infra/providers/ecom/ecom.port';
import { HttpShopifyFactory } from '../../infra/providers/ecom/shopify-admin.client';
import { HttpWooFactory } from '../../infra/providers/ecom/woocommerce-rest.client';
import { PlanEcomGate } from './_shims/plan-gate';
import { SqlStoreMirror } from './_shims/sql-store-mirror';
import { SqlEcomTemplates } from './_shims/sql-ecom-templates';
import {
  COMMERCE_SENDER,
  ECOM_PLAN_GATE,
  ECOM_TEMPLATES,
  PAID_ORDER_HOOK,
  STORE_MIRROR,
} from './_shims/tokens';
import { EngineCommerceSender } from './_shims/engine-commerce-sender';
import { EcomPublicController } from './ecom-public.controller';
import { EmbeddedShopifyController } from './embedded.controller';
import { EmbeddedShopifyService } from './embedded.service';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';
import { BroadcastController } from './broadcast.controller';
import { BroadcastService } from './broadcast.service';
import { CartRepository } from './cart.repository';
import { CartService } from './cart.service';
import { CodRepository } from './cod.repository';
import { CodService } from './cod.service';
import { CheckoutLinkService } from './checkout-link.service';
import { EcomFlowShop } from './ecom-flow-shop';
import { ShopProductsRepository } from './shop-products.repository';
import { ConciergeService } from './concierge.service';
import { ComplianceService } from './compliance.service';
import { DashboardController } from './dashboard.controller';
import { DashboardRepository } from './dashboard.repository';
import { DashboardService } from './dashboard.service';
import { EcomInboundService } from './ecom-inbound.service';
import { EventMessageService } from './event-message.service';
import { EventsRepository } from './events.repository';
import { ImportService } from './import.service';
import { MirrorRepository } from './mirror.repository';
import { EcomPlatformSettingsController } from './platform-settings.controller';
import { EcomSettingsService } from './platform-settings.service';
import { ShopifyController } from './shopify.controller';
import { ShopifyService } from './shopify.service';
import { StoresRepository } from './stores.repository';
import { WoocommerceController } from './woocommerce.controller';
import { SegmentsRepository } from './segments.repository';
import { StockRepository } from './stock.repository';
import { StockService } from './stock.service';
import { EcomOrderHooks } from './order-hooks';
import { InvoiceHandoffRepository } from './invoice-handoff.repository';
import { InvoicePolicyController } from './invoice-policy.controller';
import { InvoicePolicyService } from './invoice-policy.service';
import { InvoicingPaidOrderHook } from './invoicing-paid-order-hook';
import { WebhookPipelineService } from './webhook-pipeline.service';
import { EcomWebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { WoocommerceService } from './woocommerce.service';

/**
 * The Shopify and WooCommerce integrations (ECOM). The shims below stand in for services other domains own; each is replaced by
 * binding the real one to the same token (see `_shims/tokens.ts`).
 */
@Module({
  imports: [
    BroadcastsModule,
    NodeBridgeRuntimeModule,
    PlansCoreModule,
    ContactConsentModule,
    CrmModule,
    PlatformSettingsModule,
  ],
  controllers: [
    EcomPlatformSettingsController,
    ShopifyController,
    WoocommerceController,
    EcomPublicController,
    EmbeddedShopifyController,
    EcomWebhookController,
    AutomationsController,
    InvoicePolicyController,
    BroadcastController,
    DashboardController,
  ],
  providers: [
    CryptoService,
    EcomSettingsService,
    StoresRepository,
    ShopifyService,
    EmbeddedShopifyService,
    WoocommerceService,
    ImportService,
    EventsRepository,
    AutomationsService,
    ComplianceService,
    CodRepository,
    CodService,
    ShopProductsRepository,
    CheckoutLinkService,
    EcomFlowShop,
    ConciergeService,
    EcomInboundService,
    CartRepository,
    CartService,
    SegmentsRepository,
    DashboardRepository,
    DashboardService,
    BroadcastService,
    StockRepository,
    StockService,
    MirrorRepository,
    EventMessageService,
    WebhookService,
    WebhookPipelineService,
    EcomOrderHooks,
    InvoiceHandoffRepository,
    InvoicePolicyService,
    InvoicingPaidOrderHook,
    { provide: PAID_ORDER_HOOK, useExisting: InvoicingPaidOrderHook },
    HttpShopifyFactory,
    HttpWooFactory,
    { provide: SHOPIFY, useExisting: HttpShopifyFactory },
    { provide: WOOCOMMERCE, useExisting: HttpWooFactory },
    { provide: ECOM_PLAN_GATE, useClass: PlanEcomGate },
    { provide: STORE_MIRROR, useClass: SqlStoreMirror },
    { provide: ECOM_TEMPLATES, useClass: SqlEcomTemplates },
    { provide: COMMERCE_SENDER, useClass: EngineCommerceSender },
  ],
  exports: [
    // Pipeline, cart and broadcast services: the worker's EcomWebhookProcessor (ShopifyWoocommerceWorkerModule) injects them.
    WebhookPipelineService,
    CartService,
    BroadcastService,
    EcomSettingsService,
    StoresRepository,
    ShopifyService,
    WoocommerceService,
    ImportService,
    EcomInboundService,
    EcomOrderHooks,
    // What the flow runtime binds to its shop node (TW-ECOM-036).
    EcomFlowShop,
    CheckoutLinkService,
  ],
})
export class ShopifyWoocommerceModule {}
