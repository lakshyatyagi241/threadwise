import { Injectable } from '@nestjs/common';
import type { ShopProduct } from '../../../graph/commerce-shapes';

export type ShopProvider = 'whatsapp_shop' | 'woocommerce' | 'shopify';

/**
 * What the Commerce shop node needs from the store domains (WD-FLR-041). WaDesk's Node runtime asked Laravel over three endpoints
 * (`check-inventory`, `waba-send-products`, `checkout-link`); here they are one port the owning domains bind.
 *
 * None of the three is built in the store domains yet (shopify-woocommerce and catalog-products have no checkout minting, no
 * native product-list send for a conversation and no stock lookup by retailer id), so until they bind an adapter every method says
 * "cannot": no stock information (everything is offered), no native list (the card stack is sent) and no link (the customer is told
 * to try again, and the run leaves by `abandoned` when the wait ends), which is WaDesk's own failure path.
 */
export interface FlowShopPort {
  /**
   * The retailer ids that are in stock right now, or null when the store cannot say (the node then offers everything, as WaDesk
   * did when its stock check failed).
   */
  inStock(
    orgId: number,
    input: { provider: ShopProvider; storeId: string; retailerIds: string[] },
  ): Promise<Set<string> | null>;

  /**
   * Sends the products as the channel's own product list (WhatsApp's catalog message, with its cart and checkout) to the customer.
   * `runRef` rides along so the order can find the run again. False when it cannot be done here.
   */
  sendNative(
    orgId: number,
    input: {
      provider: ShopProvider;
      storeId: string;
      products: ShopProduct[];
      header: string;
      body: string;
      footer: string;
      peerKey: string;
      runRef: string;
    },
  ): Promise<boolean>;

  /**
   * A single-use checkout link for one picked product, tagged with `runRef` (`wadesk-flow:<runRef>` in the order's note) so the
   * order webhook can resume the run. Null when none could be made.
   */
  checkoutLink(
    orgId: number,
    input: {
      provider: ShopProvider;
      storeId: string;
      retailerId: string;
      qty: number;
      runRef: string;
      phone: string;
    },
  ): Promise<string | null>;
}

/** The tag a checkout carries so an order finds its run: the shop node's side of `flowRefOf` in the store domain. */
export const flowTag = (runRef: string): string => `wadesk-flow:${runRef}`;

/**
 * The port the node holds. A store domain's module binds its adapter with `use` when it starts; until then the answers are the
 * "cannot" ones above.
 */
@Injectable()
export class FlowShopGate implements FlowShopPort {
  private impl: FlowShopPort | null = null;

  use(adapter: FlowShopPort): void {
    this.impl = adapter;
  }

  get bound(): boolean {
    return this.impl !== null;
  }

  inStock(orgId: number, input: Parameters<FlowShopPort['inStock']>[1]) {
    return this.impl ? this.impl.inStock(orgId, input) : Promise.resolve(null);
  }

  sendNative(orgId: number, input: Parameters<FlowShopPort['sendNative']>[1]) {
    return this.impl ? this.impl.sendNative(orgId, input) : Promise.resolve(false);
  }

  checkoutLink(orgId: number, input: Parameters<FlowShopPort['checkoutLink']>[1]) {
    return this.impl ? this.impl.checkoutLink(orgId, input) : Promise.resolve(null);
  }
}
