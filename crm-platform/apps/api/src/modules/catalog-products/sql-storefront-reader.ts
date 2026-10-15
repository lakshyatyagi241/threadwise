import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { ProductOption } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { retailerIdOf } from './catalog-rules';
import {
  intArray,
  recomputeProductAggregate,
  textArray,
  toProductRow,
  type ProductRow,
} from './products.repository';
import {
  StorefrontProductsReader,
  type StorefrontProduct,
  type StorefrontVariant,
  type StorefrontReview,
} from './storefront-reader';

type Raw = Record<string, unknown>;

const COLUMNS = sql`p.id, p.uuid, p.storefront_id, NULL::uuid AS storefront_uuid, p.user_id, p.sku, p.name, p.slug, p.description,
  p.body_html, p.price_minor, p.compare_price_minor, p.weight_grams, p.category, p.tags_json, p.aliases_json, p.status,
  p.availability, p.condition, p.brand, p.product_url, p.google_product_category, p.currency_code, p.image_url,
  p.gallery_json, p.in_stock, p.stock_qty, p.reserved_qty, p.sort_order, p.meta_retailer_id, p.meta_sync_status,
  p.meta_synced_at, p.meta_batch_handle, p.meta_last_error, p.created_at, p.updated_at, p.row_version, p.options_json`;

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

const toOptions = (v: unknown): ProductOption[] =>
  Array.isArray(v)
    ? (v as Raw[])
        .filter((o) => o && typeof o.name === 'string')
        .map((o) => ({ name: o.name as string, values: strings(o.values) }))
    : [];

const VARIANT_COLUMNS = sql`v.id, v.uuid, v.product_id, v.option_values_json, v.title, v.sku, v.price_minor,
  v.compare_price_minor, v.image_url, v.stock_qty, v.position, v.meta_retailer_id`;

const toStorefrontProduct = (r: Raw): StorefrontProduct => {
  const p: ProductRow = toProductRow(r);
  const options = toOptions(r.options_json);
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
    ...(options.length > 0 ? { options } : {}),
  };
};

/**
 * What the public shop may show of a shop: in stock, active, and the shop's own or shared (`storefront_id IS NULL`).
 * Reference filtered on `in_stock` only, so drafts and archived products leaked onto the shop; that is fixed here on purpose.
 */
const available = (storefrontId: number): SQL =>
  sql`p.in_stock AND p.status = 'active' AND (p.storefront_id IS NULL OR p.storefront_id = ${storefrontId})
    AND (NOT EXISTS (SELECT 1 FROM wa_product_variants av WHERE av.org_id = p.org_id AND av.product_id = p.id)
      OR EXISTS (SELECT 1 FROM wa_product_variants av WHERE av.org_id = p.org_id AND av.product_id = p.id
        AND av.active AND (av.stock_qty IS NULL OR av.stock_qty - av.reserved_qty > 0)))`;

/** A product row plus its variants: the row is the aggregate older readers use, `variants` is what a buyer picks from. */
const toVariant = (
  r: Raw,
  product: { priceMinor: number; retailerId: string },
): StorefrontVariant => {
  const position = Number(r.position ?? 0);
  return {
    id: Number(r.id),
    uuid: r.uuid as string,
    title: r.title as string,
    optionValues: strings(r.option_values_json),
    sku: (r.sku as string | null) ?? null,
    priceMinor: r.price_minor === null ? product.priceMinor : Number(r.price_minor),
    comparePriceMinor: r.compare_price_minor === null ? null : Number(r.compare_price_minor),
    imageUrl: (r.image_url as string | null) ?? null,
    stockQty: r.stock_qty === null ? null : Number(r.stock_qty),
    retailerId:
      (r.meta_retailer_id as string | null) ||
      (r.sku as string | null) ||
      `${product.retailerId}-${position + 1}`,
  };
};

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
      rows: await this.withVariants(tx, orgId, res.rows as Raw[]),
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
    const [product] = await this.withVariants(tx, orgId, res.rows as Raw[]);
    return product;
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
    return this.withVariants(tx, orgId, res.rows as Raw[]);
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
    return this.withVariants(tx, orgId, res.rows as Raw[]);
  }

  /** Maps the rows and loads the active variants of every product with options in ONE query. */
  private async withVariants(tx: Tx, orgId: number, rows: Raw[]): Promise<StorefrontProduct[]> {
    const products = rows.map(toStorefrontProduct);
    const withOptions = products.filter((p) => p.options);
    if (withOptions.length === 0) return products;
    const res = await tx.execute(sql`
      SELECT ${VARIANT_COLUMNS} FROM wa_product_variants v
      WHERE v.org_id = ${orgId} AND v.active AND v.product_id = ANY(${intArray(withOptions.map((p) => p.id))})
      ORDER BY v.product_id, v.position, v.id`);
    const byProduct = new Map<number, Raw[]>();
    for (const v of res.rows as Raw[]) {
      const list = byProduct.get(Number(v.product_id)) ?? [];
      list.push(v);
      byProduct.set(Number(v.product_id), list);
    }
    for (const p of withOptions) {
      const base = { priceMinor: p.priceMinor, retailerId: retailerIdOf(p) };
      p.variants = (byProduct.get(p.id) ?? []).map((v) => toVariant(v, base));
    }
    return products;
  }

  async findVariants(
    tx: Tx,
    orgId: number,
    pairs: ReadonlyArray<{ productUuid: string; variantUuid: string }>,
  ): Promise<Array<{ productUuid: string; variant: StorefrontVariant }>> {
    if (pairs.length === 0) return [];
    const res = await tx.execute(sql`
      SELECT ${VARIANT_COLUMNS}, p.uuid AS product_uuid, p.price_minor AS product_price_minor,
        p.meta_retailer_id AS product_meta_retailer_id, p.sku AS product_sku
      FROM wa_product_variants v
      JOIN wa_products p ON p.org_id = v.org_id AND p.id = v.product_id
      WHERE v.org_id = ${orgId} AND v.active AND v.uuid::text = ANY(${textArray(pairs.map((x) => x.variantUuid))})
        AND p.uuid::text = ANY(${textArray(pairs.map((x) => x.productUuid))})`);
    const wanted = new Set(pairs.map((x) => `${x.productUuid}:${x.variantUuid}`));
    return (res.rows as Raw[])
      .filter((r) => wanted.has(`${r.product_uuid as string}:${r.uuid as string}`))
      .map((r) => ({
        productUuid: r.product_uuid as string,
        variant: toVariant(r, {
          priceMinor: Number(r.product_price_minor),
          retailerId: retailerIdOf({
            id: Number(r.product_id),
            metaRetailerId: (r.product_meta_retailer_id as string | null) ?? null,
            sku: (r.product_sku as string | null) ?? null,
          }),
        }),
      }));
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

  /** Locks the product (or the variant), so two buyers cannot both take the last unit; unlimited stock hands back the whole quantity. */
  async takeStock(
    tx: Tx,
    orgId: number,
    productId: number,
    qty: number,
    variantId?: number,
  ): Promise<number> {
    if (qty <= 0) return 0;
    if (variantId !== undefined) return this.takeVariantStock(tx, orgId, productId, variantId, qty);
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

  private async takeVariantStock(
    tx: Tx,
    orgId: number,
    productId: number,
    variantId: number,
    qty: number,
  ): Promise<number> {
    const res = await tx.execute(sql`
      SELECT stock_qty FROM wa_product_variants
      WHERE org_id = ${orgId} AND id = ${variantId} AND product_id = ${productId} AND active FOR UPDATE`);
    const row = res.rows[0] as Raw | undefined;
    if (!row) return 0;
    if (row.stock_qty === null) return qty;
    const stock = Math.max(0, Number(row.stock_qty));
    const taken = Math.min(qty, stock);
    if (taken > 0) {
      await tx.execute(sql`
        UPDATE wa_product_variants SET stock_qty = ${stock - taken} WHERE org_id = ${orgId} AND id = ${variantId}`);
      await recomputeProductAggregate(tx, orgId, productId);
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
