import type { Tx } from '@crm/db';

/**
 * What the public shop (storefront-builder, STORE) needs from the product list. It is the one door into `wa_products` and
 * `wa_product_reviews` for another domain: STORE codes against this class, catalog-products binds `SqlStorefrontProductsReader`
 * to it (see `catalog-products.module.ts`) and exports it from the barrel.
 *
 * Every method takes the caller's transaction (already scoped to the shop's organization by `DatabaseService.txAs`) and the
 * organization id. Internal ids (`id`) are returned for the order-writing code; they never go on the wire, `uuid` does.
 *
 * "Available" (decision D-03 of the STORE inventory, a deliberate fix of a Reference leak): the product is `in_stock`, its status
 * is `active` (Reference checked only `in_stock`, so drafts and archived products showed on the public shop), and it belongs to
 * this shop: `storefront_id IS NULL` (every shop of the workspace) or equal to the shop. Everything is ordered by
 * `sort_order` then newest first, as Reference did.
 */
export interface StorefrontProduct {
  id: number;
  uuid: string;
  slug: string;
  sku: string | null;
  name: string;
  description: string | null;
  bodyHtml: string | null;
  priceMinor: number;
  comparePriceMinor: number | null;
  currencyCode: string;
  imageUrl: string | null;
  galleryUrls: string[];
  category: string | null;
  brand: string | null;
  /** Null means unlimited. */
  stockQty: number | null;
  metaRetailerId: string | null;
  /** Optional so older fixtures still type-check; the public shop shows them ("New" badge, weight and tags in the meta list). */
  createdAt?: Date;
  weightGrams?: number | null;
  tags?: string[];
}

export interface StorefrontReview {
  uuid: string;
  customerName: string | null;
  rating: number;
  body: string | null;
  createdAt: Date;
}

export abstract class StorefrontProductsReader {
  /**
   * The shop's catalogue page. `offset`/`limit` are the shop's own "show more" paging (48 per page), not an API cursor.
   * `total` counts every available product of the shop (not only this page).
   */
  abstract listAvailable(
    tx: Tx,
    orgId: number,
    storefrontId: number,
    page: { offset: number; limit: number },
  ): Promise<{ rows: StorefrontProduct[]; total: number }>;

  abstract findAvailableBySlug(
    tx: Tx,
    orgId: number,
    storefrontId: number,
    slug: string,
  ): Promise<StorefrontProduct | undefined>;

  /** Live, available products among these uuids; ones that vanished or sold out are simply absent. */
  abstract findAvailableByUuids(
    tx: Tx,
    orgId: number,
    storefrontId: number,
    uuids: readonly string[],
  ): Promise<StorefrontProduct[]>;

  /** Up to `limit` other available products: same category first, then anything else, never the product itself. */
  abstract related(
    tx: Tx,
    orgId: number,
    storefrontId: number,
    product: StorefrontProduct,
    limit: number,
  ): Promise<StorefrontProduct[]>;

  /** Approved reviews of a product, newest first. */
  abstract approvedReviews(
    tx: Tx,
    orgId: number,
    productId: number,
    limit: number,
  ): Promise<StorefrontReview[]>;

  /**
   * A review from the public shop, stored `pending`. Returns false when the product uuid is not a product of this organization
   * (the shop answers 422 "Unknown product").
   */
  abstract createPendingReview(
    tx: Tx,
    orgId: number,
    input: {
      storefrontId: number;
      productUuid: string;
      customerName: string;
      rating: number;
      body: string | null;
    },
  ): Promise<boolean>;

  /**
   * Checkout stock decrement (TW-STORE-013): lowers `stock_qty` by `qty` (never below 0) for a product that tracks stock, and
   * does nothing for an unlimited one. Row-locks the product (`FOR UPDATE`) and returns the quantity really taken, so two
   * buyers cannot both take the last unit (decision D-08). It does NOT push to Meta: the resync sweep settles Meta stock.
   */
  abstract takeStock(tx: Tx, orgId: number, productId: number, qty: number): Promise<number>;

  /** Number of products of the organization (the dashboard tile counts every one, whatever its status). */
  abstract countProducts(tx: Tx, orgId: number): Promise<number>;

  /**
   * The store reset (TW-STORE-005): hard-deletes every product of the organization (reviews, reservations and collection
   * membership follow by foreign key or are cleaned in the same call). Returns the number of products removed.
   */
  abstract deleteAllProducts(tx: Tx, orgId: number): Promise<number>;
}
