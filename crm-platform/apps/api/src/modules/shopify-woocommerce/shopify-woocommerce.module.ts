import { Module } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { SHOPIFY, WOOCOMMERCE } from '../../infra/providers/ecom/ecom.port';
import { HttpShopifyFactory } from '../../infra/providers/ecom/shopify-admin.client';
import { HttpWooFactory } from '../../infra/providers/ecom/woocommerce-rest.client';
import { OpenEcomPlanGate } from './_shims/open-gates';
import { ECOM_PLAN_GATE } from './_shims/tokens';
import { EcomPublicController } from './ecom-public.controller';
import { EcomPlatformSettingsController } from './platform-settings.controller';
import { EcomSettingsService } from './platform-settings.service';
import { ShopifyController } from './shopify.controller';
import { ShopifyService } from './shopify.service';
import { StoresRepository } from './stores.repository';
import { WoocommerceController } from './woocommerce.controller';
import { WoocommerceService } from './woocommerce.service';

/**
 * The Shopify and WooCommerce integrations (ECOM). The shims below stand in for services other domains own; each is replaced by
 * binding the real one to the same token (see `_shims/tokens.ts`).
 */
@Module({
  controllers: [
    EcomPlatformSettingsController,
    ShopifyController,
    WoocommerceController,
    EcomPublicController,
  ],
  providers: [
    CryptoService,
    EcomSettingsService,
    StoresRepository,
    ShopifyService,
    WoocommerceService,
    HttpShopifyFactory,
    HttpWooFactory,
    { provide: SHOPIFY, useExisting: HttpShopifyFactory },
    { provide: WOOCOMMERCE, useExisting: HttpWooFactory },
    { provide: ECOM_PLAN_GATE, useClass: OpenEcomPlanGate },
  ],
  exports: [EcomSettingsService, StoresRepository, ShopifyService, WoocommerceService],
})
export class ShopifyWoocommerceModule {}
