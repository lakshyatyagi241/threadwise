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
  /**
   * Set when the retailer id names a variant of the product: `sku`, `stockQty` and `reservedQty` are then the variant's, and `active`
   * says whether it can be sold at all.
   */
  variant?: { retailerId: string; active: boolean };
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
    // A retailer id can also be a variant's: its stored retailer id, its SKU, or `<product retailer id>-<position + 1>`.
    const vres = await tx.execute(sql`
      SELECT * FROM (
        SELECT coalesce(v.meta_retailer_id, v.sku,
                 coalesce(p.meta_retailer_id, p.sku, 'wsn-' || p.id::text) || '-' || (v.position + 1)::text) AS rid,
               v.sku AS variant_sku, v.stock_qty AS variant_stock, v.reserved_qty AS variant_reserved, v.active AS variant_active,
               p.id, p.sku, p.meta_retailer_id, p.${col} AS store_product_id, p.in_stock, p.availability, p.status
        FROM wa_product_variants v
        JOIN wa_products p ON p.org_id = v.org_id AND p.id = v.product_id
        WHERE v.org_id = ${orgId} AND p.${col} IS NOT NULL
      ) x WHERE x.rid IN (${any}) ORDER BY x.id`);
    const variantRows: ShopProductRow[] = (vres.rows as Raw[]).map((r) => ({
      id: Number(r.id),
      sku: typeof r.variant_sku === 'string' && r.variant_sku !== '' ? r.variant_sku : null,
      metaRetailerId: null,
      storeProductId: String(r.store_product_id),
      inStock: r.in_stock === true,
      availability: String(r.availability ?? 'in stock'),
      status: String(r.status ?? 'active'),
      stockQty:
        r.variant_stock === null || r.variant_stock === undefined ? null : Number(r.variant_stock),
      reservedQty: Number(r.variant_reserved ?? 0),
      variant: { retailerId: String(r.rid), active: r.variant_active !== false },
    }));
    return [
      ...variantRows,
      ...(res.rows as Raw[]).map((r) => ({
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
      })),
    ];
  }
}
