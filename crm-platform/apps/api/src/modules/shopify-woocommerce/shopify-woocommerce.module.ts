import { Module } from '@nestjs/common';
import { BroadcastsModule } from '../broadcasts';
import { NodeBridgeRuntimeModule } from '../node-bridge-runtime';
import { CryptoService } from '../../common/crypto/crypto.service';
import { SHOPIFY, WOOCOMMERCE } from '../../infra/providers/ecom/ecom.port';
import { HttpShopifyFactory } from '../../infra/providers/ecom/shopify-admin.client';
import { HttpWooFactory } from '../../infra/providers/ecom/woocommerce-rest.client';
import { OpenEcomPlanGate } from './_shims/open-gates';
import { SqlStoreMirror } from './_shims/sql-store-mirror';
import { SqlEcomTemplates } from './_shims/sql-ecom-templates';
import { COMMERCE_SENDER, ECOM_PLAN_GATE, ECOM_TEMPLATES, STORE_MIRROR } from './_shims/tokens';
import { EngineCommerceSender } from './_shims/engine-commerce-sender';
import { EcomPublicController } from './ecom-public.controller';
import { AutomationsController } from './automations.controller';
import { AutomationsService } from './automations.service';
import { BroadcastController } from './broadcast.controller';
import { BroadcastService } from './broadcast.service';
import { CartRepository } from './cart.repository';
import { CartService } from './cart.service';
import { CodRepository } from './cod.repository';
import { CodService } from './cod.service';
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
import { WebhookPipelineService } from './webhook-pipeline.service';
import { EcomWebhookController } from './webhook.controller';
import { WebhookService } from './webhook.service';
import { WoocommerceService } from './woocommerce.service';

/**
 * The Shopify and WooCommerce integrations (ECOM). The shims below stand in for services other domains own; each is replaced by
 * binding the real one to the same token (see `_shims/tokens.ts`).
 */
@Module({
  imports: [BroadcastsModule, NodeBridgeRuntimeModule],
  controllers: [
    EcomPlatformSettingsController,
    ShopifyController,
    WoocommerceController,
    EcomPublicController,
    EcomWebhookController,
    AutomationsController,
    BroadcastController,
    DashboardController,
  ],
  providers: [
    CryptoService,
    EcomSettingsService,
    StoresRepository,
    ShopifyService,
    WoocommerceService,
    ImportService,
    EventsRepository,
    AutomationsService,
    ComplianceService,
    CodRepository,
    CodService,
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
    HttpShopifyFactory,
    HttpWooFactory,
    { provide: SHOPIFY, useExisting: HttpShopifyFactory },
    { provide: WOOCOMMERCE, useExisting: HttpWooFactory },
    { provide: ECOM_PLAN_GATE, useClass: OpenEcomPlanGate },
    { provide: STORE_MIRROR, useClass: SqlStoreMirror },
    { provide: ECOM_TEMPLATES, useClass: SqlEcomTemplates },
    { provide: COMMERCE_SENDER, useClass: EngineCommerceSender },
  ],
  exports: [
    EcomSettingsService,
    StoresRepository,
    ShopifyService,
    WoocommerceService,
    ImportService,
    EcomInboundService,
  ],
})
export class ShopifyWoocommerceModule {}
