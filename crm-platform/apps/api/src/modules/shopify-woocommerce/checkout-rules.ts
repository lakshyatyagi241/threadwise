import type { ShopProductRow } from './shop-products.repository';

/** Pure rules of the flow shop node's store side (WD-ECOM-036). */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A store id the node holds is the integration's uuid; anything else names no store. */
export const isStoreUuid = (s: string): boolean => UUID.test(s);

/** Sellable now: active, in stock and not marked out of stock or discontinued, with stock left after holds (null stock is unlimited). */
export function sellableNow(p: ShopProductRow): boolean {
  if (!p.inStock || p.status !== 'active') return false;
  if (p.availability === 'out of stock' || p.availability === 'discontinued') return false;
  return p.stockQty === null || p.stockQty - p.reservedQty > 0;
}

/** The product a retailer id names. A retailer id wins over a sku, a sku over `wsn-<id>`, so the same id never names two products. */
export function productFor(
  ref: string,
  rows: readonly ShopProductRow[],
): ShopProductRow | undefined {
  return (
    rows.find((r) => r.metaRetailerId === ref) ??
    rows.find((r) => r.sku === ref) ??
    rows.find((r) => `wsn-${r.id}` === ref)
  );
}

/**
 * What WooCommerce is told to put in the order for a retailer id: the product's sku, else its WooCommerce id (the order takes
 * either), else the id as given (a product the mirror has not seen).
 */
export function wooReference(ref: string, row: ShopProductRow | undefined): string {
  if (!row) return ref;
  return row.sku ?? row.storeProductId;
}

/** The Storefront token a Shopify store keeps in its metadata, or null. */
export function storefrontTokenOf(metadata: unknown): string | null {
  if (typeof metadata !== 'object' || metadata === null) return null;
  const v = (metadata as Record<string, unknown>).storefrontAccessToken;
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

export const MAX_QTY = 99;
export const clampQty = (n: number): number =>
  Number.isFinite(n) ? Math.min(MAX_QTY, Math.max(1, Math.trunc(n))) : 1;
