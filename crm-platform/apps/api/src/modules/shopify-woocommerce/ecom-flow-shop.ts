import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../infra/db/database.service';
import { CheckoutLinkService } from './checkout-link.service';
import { isStoreUuid, productFor, sellableNow } from './checkout-rules';
import { ShopProductsRepository } from './shop-products.repository';
import { StoresRepository } from './stores.repository';

type Provider = 'whatsapp_shop' | 'woocommerce' | 'shopify';

/**
 * What the flow runtime's shop node asks of the stores (TW-ECOM-036), answered here. The shapes match the flow runtime's own port
 * (`FlowShopPort`) without importing it: this module is imported BY the flow runtime, so it cannot import back; the flow runtime
 * binds this service to its gate when it starts.
 *
 *  - `inStock`: from the mirrored products (a product the mirror does not know is offered, as the store cannot say otherwise);
 *  - `sendNative`: never here, the native WhatsApp product list belongs to the catalog and its send needs a signed-in operator;
 *  - `checkoutLink`: a Shopify cart (or draft order) or a WooCommerce pending order carrying the run's reference.
 */
@Injectable()
export class EcomFlowShop {
  private readonly logger = new Logger(EcomFlowShop.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly stores: StoresRepository,
    private readonly products: ShopProductsRepository,
    private readonly links: CheckoutLinkService,
  ) {}

  async inStock(
    orgId: number,
    input: { provider: Provider; storeId: string; retailerIds: string[] },
  ): Promise<Set<string> | null> {
    if (input.provider === 'whatsapp_shop') return null;
    const rows = await this.db.txAs({ orgId }, (tx) =>
      this.products.byRetailerIds(
        tx,
        orgId,
        input.provider as 'shopify' | 'woocommerce',
        input.retailerIds,
      ),
    );
    const out = new Set<string>();
    for (const ref of input.retailerIds) {
      const row = productFor(ref, rows);
      if (!row || sellableNow(row)) out.add(ref);
    }
    return out;
  }

  sendNative(
    _orgId: number,
    _input: {
      provider: Provider;
      storeId: string;
      products: ReadonlyArray<{ retailerId: string }>;
      header: string;
      body: string;
      footer: string;
      peerKey: string;
      runRef: string;
    },
  ): Promise<boolean> {
    return Promise.resolve(false);
  }

  async checkoutLink(
    orgId: number,
    input: {
      provider: Provider;
      storeId: string;
      retailerId: string;
      qty: number;
      runRef: string;
      phone: string;
    },
  ): Promise<string | null> {
    if (input.provider === 'whatsapp_shop' || !isStoreUuid(input.storeId)) return null;
    const items = [{ reference: input.retailerId, qty: input.qty }];
    if (input.provider === 'shopify') {
      const store = await this.db.txAs({ orgId }, (tx) =>
        this.stores.shopifyByUuid(tx, orgId, input.storeId),
      );
      if (!store) return null;
      return (await this.links.shopifyLink(orgId, store, items, input.runRef))?.url ?? null;
    }
    const store = await this.db.txAs({ orgId }, (tx) =>
      this.stores.wooByUuid(tx, orgId, input.storeId),
    );
    if (!store) {
      this.logger.warn({ orgId }, '[ECOM-CHECKOUT] the flow names a store that is not connected');
      return null;
    }
    return (await this.links.wooLink(orgId, store, items, input.runRef))?.url ?? null;
  }
}
