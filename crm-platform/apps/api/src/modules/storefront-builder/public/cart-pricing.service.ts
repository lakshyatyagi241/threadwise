import { Injectable } from '@nestjs/common';
import type { Tx } from '@crm/db';
import { StorefrontProductsReader, type StorefrontProduct } from '../../catalog-products';
import { mergeRequested, priceLines, type PricedLine } from '../rules/pricing';
import type { ShopHandle } from './public-shop.loader';

/**
 * Re-prices a cart from the database (Reference `priceItems`). Shared by the coupon quote, the abandoned-cart beacon and the
 * checkout, so the three can never disagree. Only product ids and quantities come from the client.
 */
@Injectable()
export class CartPricingService {
  constructor(private readonly products: StorefrontProductsReader) {}

  async price(
    tx: Tx,
    handle: ShopHandle,
    items: ReadonlyArray<{ id: string; variantId?: string | undefined; qty: number }>,
  ): Promise<{ lines: PricedLine[]; subtotalMinor: number }> {
    const requested = mergeRequested(items);
    const found = await this.products.findAvailableByUuids(tx, handle.orgId, handle.storefrontId, [
      ...new Set([...requested.values()].map((r) => r.productUuid)),
    ]);
    const byUuid = new Map<string, StorefrontProduct>(found.map((p) => [p.uuid, p]));
    return priceLines(byUuid, requested);
  }
}
