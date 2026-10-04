import { Injectable, type OnModuleInit } from '@nestjs/common';
import { EcomFlowShop } from '../../../../shopify-woocommerce';
import { CatalogShopAdapter } from './catalog-shop.adapter';
import { FlowShopGate, type FlowShopPort } from './shop-port';

/**
 * Hands the shop node's gate its adapters when the app starts (TW-ECOM-036, TW-FLR-041). The store domain is imported by the flow
 * runtime, so it cannot import the gate; this is the one place they meet. WhatsApp Shop stock and its native product list belong to the
 * catalog (`CatalogShopAdapter`); WooCommerce and Shopify stock and the checkout link belong to the store (`EcomFlowShop`). The two
 * answer for disjoint providers, so one gate serves both and neither replaces the other.
 */
@Injectable()
export class ShopGateBinder implements OnModuleInit {
  constructor(
    private readonly gate: FlowShopGate,
    private readonly ecom: EcomFlowShop,
    private readonly catalog: CatalogShopAdapter,
  ) {}

  onModuleInit(): void {
    const whatsapp = (provider: string) => provider === 'whatsapp_shop';
    const both: FlowShopPort = {
      inStock: (orgId, input) =>
        whatsapp(input.provider)
          ? this.catalog.inStock(orgId, input)
          : this.ecom.inStock(orgId, input),
      sendNative: (orgId, input) =>
        whatsapp(input.provider)
          ? this.catalog.sendNative(orgId, input)
          : this.ecom.sendNative(orgId, input),
      checkoutLink: (orgId, input) => this.ecom.checkoutLink(orgId, input),
    };
    this.gate.use(both);
  }
}
