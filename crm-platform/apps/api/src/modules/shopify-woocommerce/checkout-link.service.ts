import { Inject, Injectable, Logger } from '@nestjs/common';
import { CryptoService } from '../../common/crypto/crypto.service';
import { DatabaseService } from '../../infra/db/database.service';
import {
  SHOPIFY,
  WOOCOMMERCE,
  type CheckoutLine,
  type ShopifyCheckoutApi,
  type ShopifyFactory,
  type WooFactory,
} from '../../infra/providers/ecom/ecom.port';
import { clampQty, productFor, storefrontTokenOf, wooReference } from './checkout-rules';
import { flowNoteOf } from './order-hooks';
import type { ShopProductRow } from './shop-products.repository';
import { ShopProductsRepository } from './shop-products.repository';
import type { ShopifyRow, WooRow } from './stores.repository';

export interface CheckoutItem {
  /** The product's retailer id: a retailer id, a sku, `wsn-<id>`, or (WooCommerce) a numeric product id. */
  reference: string;
  qty: number;
}

export interface CheckoutLink {
  url: string;
  /** The store's own id for what was made: the WooCommerce order, the Shopify cart or draft order. */
  ref: string | null;
}

/**
 * The one place a payment link for a store is made (TW-ECOM-036): the flow shop node's checkout and the WooCommerce concierge's
 * re-order (TW-ECOM-031) both come here. Each answers null when no link could be made, never throws.
 *
 *  - WooCommerce: a pending order for the items, tagged `_wa_flow_session` with the run, and the order's pay link;
 *  - Shopify: the variant of each item's sku is found through the Admin API, then a Storefront cart carrying the note
 *    `threadwise-flow:<run>`; a store with no Storefront token (or whose cart failed) gets a draft order with the same note.
 */
@Injectable()
export class CheckoutLinkService {
  private readonly logger = new Logger(CheckoutLinkService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly crypto: CryptoService,
    private readonly products: ShopProductsRepository,
    @Inject(SHOPIFY) private readonly shopify: ShopifyFactory,
    @Inject(WOOCOMMERCE) private readonly woo: WooFactory,
  ) {}

  async wooLink(
    orgId: number,
    store: WooRow,
    items: readonly CheckoutItem[],
    runRef: string | null,
  ): Promise<CheckoutLink | null> {
    if (store.consumerKey === '' || items.length === 0) return null;
    const rows = await this.db.txAs({ orgId }, (tx) =>
      this.products.byRetailerIds(
        tx,
        orgId,
        'woocommerce',
        items.map((i) => i.reference),
      ),
    );
    const lines = items.map((i) => ({
      reference: wooReference(i.reference, productFor(i.reference, rows)),
      qty: clampQty(i.qty),
    }));
    try {
      const made = await this.woo
        .store(
          store.storeUrl,
          this.crypto.decrypt(store.consumerKey),
          this.crypto.decrypt(store.consumerSecret),
        )
        .createPendingOrder(lines, runRef);
      return made ? { url: made.url, ref: made.orderId } : null;
    } catch (err) {
      this.logger.warn({ orgId, err }, '[ECOM-CHECKOUT] woocommerce order failed');
      return null;
    }
  }

  async shopifyLink(
    orgId: number,
    store: ShopifyRow,
    items: readonly CheckoutItem[],
    runRef: string | null,
  ): Promise<CheckoutLink | null> {
    if (store.accessToken === '' || items.length === 0) return null;
    try {
      const api = this.shopify.checkout(store.storeUrl, this.crypto.decrypt(store.accessToken));
      const rows = await this.db.txAs({ orgId }, (tx) =>
        this.products.byRetailerIds(
          tx,
          orgId,
          'shopify',
          items.map((i) => i.reference),
        ),
      );
      const lines: CheckoutLine[] = [];
      for (const item of items) {
        const variantId = await this.variantOf(
          api,
          item.reference,
          productFor(item.reference, rows),
        );
        if (variantId) lines.push({ variantId, qty: clampQty(item.qty) });
      }
      if (lines.length === 0) return null;

      const note = runRef ? flowNoteOf(runRef) : null;
      const token = storefrontTokenOf(store.metadata);
      if (token) {
        const cart = await api.createStorefrontCart(token, lines, note);
        if (cart) return { url: cart.url, ref: cart.cartId };
      }
      // No Storefront token, or the cart did not come: a draft order is slower to check out but needs no second token.
      const draft = await api.createDraftOrder(lines, note);
      return draft ? { url: draft.url, ref: draft.draftId } : null;
    } catch (err) {
      this.logger.warn({ orgId, err }, '[ECOM-CHECKOUT] shopify checkout failed');
      return null;
    }
  }

  /** The variant a retailer id stands for: its sku's variant; a product with no sku has its first variant. */
  private async variantOf(
    api: ShopifyCheckoutApi,
    reference: string,
    row: ShopProductRow | undefined,
  ): Promise<string | null> {
    if (!row) return api.variantIdBySku(reference);
    if (row.sku) return api.variantIdBySku(row.sku);
    return api.firstVariantId(row.storeProductId);
  }
}
