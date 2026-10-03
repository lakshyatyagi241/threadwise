import { Inject, Injectable } from '@nestjs/common';
import { STOREFRONT_ENV, type StorefrontEnv } from '../../../config/domains/storefront-builder.env';
import { publicUrl, trackUrl, type ShopAddress } from '../rules/shop-url';

/**
 * The address buyers use for a shop (TW-STORE-022). Exported from the barrel for the catalog (product share links, Meta
 * catalog sync), the inbox and flows: one function, so the consumers stop disagreeing about the link.
 */
@Injectable()
export class ShopUrlService {
  constructor(@Inject(STOREFRONT_ENV) readonly env: StorefrontEnv) {}

  /** The verified custom domain, else `https://<slug>.<STOREFRONT_HOST>`, else `<web app>/s/<slug>`. */
  publicUrl(shop: ShopAddress): string {
    return publicUrl(shop, this.env);
  }

  /** Absolute link of an order's tracking page. */
  trackUrl(shop: ShopAddress, token: string): string {
    return trackUrl(shop, token, this.env);
  }
}
