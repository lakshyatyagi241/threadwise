import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { StoreKind } from './mirror-rules';

/** A mirrored product as the flow's shop node needs it: how the store names it, and whether it can be sold now. */
export interface ShopProductRow {
  id: number;
  sku: string | null;
  metaRetailerId: string | null;
  /** The store's own product id (Shopify product id or WooCommerce product id), per the kind asked for. */
  storeProductId: string;
  inStock: boolean;
  availability: string;
  status: string;
  stockQty: number | null;
  reservedQty: number;
}

type Raw = Record<string, unknown>;

/** The mirrored products (`wa_products`), read inside the caller's tenant transaction. */
@Injectable()
export class ShopProductsRepository {
  /**
   * The store's mirrored products that a retailer id names: the stored retailer id, the sku, or `wsn-<id>` (the id a product without
   * either gets). Only products that came from this kind of store are returned.
   */
  async byRetailerIds(
    tx: Tx,
    orgId: number,
    kind: StoreKind,
    refs: readonly string[],
  ): Promise<ShopProductRow[]> {
    const list = [...new Set(refs.filter((r) => r !== ''))];
    if (list.length === 0) return [];
    const col = sql.raw(kind === 'shopify' ? 'shopify_product_id' : 'woo_product_id');
    const any = sql.join(
      list.map((r) => sql`${r}`),
      sql`, `,
    );
    const res = await tx.execute(sql`
      SELECT id, sku, meta_retailer_id, ${col} AS store_product_id, in_stock, availability, status, stock_qty, reserved_qty
      FROM wa_products
      WHERE org_id = ${orgId} AND ${col} IS NOT NULL
        AND (sku IN (${any}) OR meta_retailer_id IN (${any}) OR 'wsn-' || id::text IN (${any}))
      ORDER BY id`);
    return (res.rows as Raw[]).map((r) => ({
      id: Number(r.id),
      sku: typeof r.sku === 'string' && r.sku !== '' ? r.sku : null,
      metaRetailerId:
        typeof r.meta_retailer_id === 'string' && r.meta_retailer_id !== ''
          ? r.meta_retailer_id
          : null,
      storeProductId: String(r.store_product_id),
      inStock: r.in_stock === true,
      availability: String(r.availability ?? 'in stock'),
      status: String(r.status ?? 'active'),
      stockQty: r.stock_qty === null || r.stock_qty === undefined ? null : Number(r.stock_qty),
      reservedQty: Number(r.reserved_qty ?? 0),
    }));
  }
}
