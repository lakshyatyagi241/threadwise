import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { textArray, toProductRow, type ProductRow } from './products.repository';
import {
  StorefrontProductsReader,
  type StorefrontProduct,
  type StorefrontReview,
} from './storefront-reader';

type Raw = Record<string, unknown>;

const COLUMNS = sql`p.id, p.uuid, p.storefront_id, NULL::uuid AS storefront_uuid, p.user_id, p.sku, p.name, p.slug, p.description,
  p.body_html, p.price_minor, p.compare_price_minor, p.weight_grams, p.category, p.tags_json, p.aliases_json, p.status,
  p.availability, p.condition, p.brand, p.product_url, p.google_product_category, p.currency_code, p.image_url,
  p.gallery_json, p.in_stock, p.stock_qty, p.reserved_qty, p.sort_order, p.meta_retailer_id, p.meta_sync_status,
  p.meta_synced_at, p.meta_batch_handle, p.meta_last_error, p.created_at, p.updated_at, p.row_version`;

const toStorefrontProduct = (r: Raw): StorefrontProduct => {
  const p: ProductRow = toProductRow(r);
  return {
    id: p.id,
    uuid: p.uuid,
    slug: p.slug,
    sku: p.sku,
    name: p.name,
    description: p.description,
    bodyHtml: p.bodyHtml,
    priceMinor: p.priceMinor,
    comparePriceMinor: p.comparePriceMinor,
    currencyCode: p.currencyCode,
    imageUrl: p.imageUrl,
    galleryUrls: p.gallery,
    category: p.category,
    brand: p.brand,
    stockQty: p.stockQty,
    metaRetailerId: p.metaRetailerId,
    createdAt: p.createdAt,
    weightGrams: p.weightGrams,
    tags: p.tags,
  };
};

/**
 * What the public shop may show of a shop: in stock, active, and the shop's own or shared (`storefront_id IS NULL`).
 * WaDesk filtered on `in_stock` only, so drafts and archived products leaked onto the shop; that is fixed here on purpose.
 */
const available = (storefrontId: number): SQL =>
  sql`p.in_stock AND p.status = 'active' AND (p.storefront_id IS NULL OR p.storefront_id = ${storefrontId})`;

/**
 * The one door the storefront-builder domain uses into products and reviews. It runs inside the shop's transaction (already
 * scoped to the organization), so it takes the transaction it is given and opens none.
 */
@Injectable()
export class SqlStorefrontProductsReader extends StorefrontProductsReader {
  async listAvailable(
    tx: Tx,
    orgId: number,
    storefrontId: number,
    page: { offset: number; limit: number },
  ): Promise<{ rows: StorefrontProduct[]; total: number }> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM wa_products p
      WHERE p.org_id = ${orgId} AND ${available(storefrontId)}
      ORDER BY p.sort_order, p.id DESC
      OFFSET ${page.offset} LIMIT ${page.limit}`);
    const total = await tx.execute(sql`
      SELECT count(*) AS c FROM wa_products p WHERE p.org_id = ${orgId} AND ${available(storefrontId)}`);
    return {
      rows: (res.rows as Raw[]).map(toStorefrontProduct),
      total: Number((total.rows[0] as Raw).c),
    };
  }

  async findAvailableBySlug(
    tx: Tx,
    orgId: number,
    storefrontId: number,
    slug: string,
  ): Promise<StorefrontProduct | undefined> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM wa_products p
      WHERE p.org_id = ${orgId} AND p.slug = ${slug} AND ${available(storefrontId)}`);
    const row = res.rows[0] as Raw | undefined;
    return row ? toStorefrontProduct(row) : undefined;
  }

  async findAvailableByUuids(
    tx: Tx,
    orgId: number,
    storefrontId: number,
    uuids: readonly string[],
  ): Promise<StorefrontProduct[]> {
    if (uuids.length === 0) return [];
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM wa_products p
      WHERE p.org_id = ${orgId} AND p.uuid::text = ANY(${textArray(uuids)}) AND ${available(storefrontId)}
      ORDER BY p.sort_order, p.id DESC`);
    return (res.rows as Raw[]).map(toStorefrontProduct);
  }

  async related(
    tx: Tx,
    orgId: number,
    storefrontId: number,
    product: StorefrontProduct,
    limit: number,
  ): Promise<StorefrontProduct[]> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM wa_products p
      WHERE p.org_id = ${orgId} AND p.id <> ${product.id} AND ${available(storefrontId)}
      ORDER BY (p.category IS NOT NULL AND p.category = ${product.category}) DESC, p.sort_order, p.id DESC
      LIMIT ${limit}`);
    return (res.rows as Raw[]).map(toStorefrontProduct);
  }

  async approvedReviews(
    tx: Tx,
    orgId: number,
    productId: number,
    limit: number,
  ): Promise<StorefrontReview[]> {
    const res = await tx.execute(sql`
      SELECT uuid, customer_name, rating, body, created_at FROM wa_product_reviews
      WHERE org_id = ${orgId} AND product_id = ${productId} AND status = 'approved'
      ORDER BY created_at DESC, id DESC
      LIMIT ${limit}`);
    return (res.rows as Raw[]).map((r) => ({
      uuid: r.uuid as string,
      customerName: (r.customer_name as string | null) ?? null,
      rating: Number(r.rating),
      body: (r.body as string | null) ?? null,
      createdAt: new Date(r.created_at as string),
    }));
  }

  async createPendingReview(
    tx: Tx,
    orgId: number,
    input: {
      storefrontId: number;
      productUuid: string;
      customerName: string;
      rating: number;
      body: string | null;
    },
  ): Promise<boolean> {
    const product = await tx.execute(
      sql`SELECT id FROM wa_products WHERE org_id = ${orgId} AND uuid = ${input.productUuid}::uuid`,
    );
    const row = product.rows[0] as Raw | undefined;
    if (!row) return false;
    await tx.execute(sql`
      INSERT INTO wa_product_reviews (org_id, storefront_id, product_id, customer_name, rating, body, status)
      VALUES (${orgId}, ${input.storefrontId}, ${Number(row.id)}, ${input.customerName}, ${input.rating}, ${input.body}, 'pending')`);
    return true;
  }

  /** Locks the product, so two buyers cannot both take the last unit; unlimited stock hands back the whole quantity. */
  async takeStock(tx: Tx, orgId: number, productId: number, qty: number): Promise<number> {
    if (qty <= 0) return 0;
    const res = await tx.execute(sql`
      SELECT stock_qty FROM wa_products WHERE org_id = ${orgId} AND id = ${productId} FOR UPDATE`);
    const row = res.rows[0] as Raw | undefined;
    if (!row) return 0;
    if (row.stock_qty === null) return qty;
    const stock = Math.max(0, Number(row.stock_qty));
    const taken = Math.min(qty, stock);
    if (taken > 0) {
      await tx.execute(sql`
        UPDATE wa_products SET stock_qty = ${stock - taken} WHERE org_id = ${orgId} AND id = ${productId}`);
    }
    return taken;
  }

  async countProducts(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(
      sql`SELECT count(*) AS c FROM wa_products WHERE org_id = ${orgId}`,
    );
    return Number((res.rows[0] as Raw).c);
  }

  /** The store reset: reviews and holds follow by their foreign keys; collections only keep stale ids, which they tolerate. */
  async deleteAllProducts(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(sql`DELETE FROM wa_products WHERE org_id = ${orgId} RETURNING id`);
    return res.rows.length;
  }
}
