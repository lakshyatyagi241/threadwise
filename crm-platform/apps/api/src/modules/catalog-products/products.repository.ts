import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { ERROR_CODES, type ProductOption } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { computeAggregate, type ProductAggregate, type VariantWrite } from './variant-rules';

/** One variant as the SQL returns it. */
export interface VariantRow {
  id: number;
  uuid: string;
  productId: number;
  optionValues: string[];
  title: string;
  sku: string | null;
  /** Null reads as the product's price (the API always stores a concrete amount). */
  priceMinor: number | null;
  comparePriceMinor: number | null;
  imageUrl: string | null;
  weightGrams: number | null;
  stockQty: number | null;
  reservedQty: number;
  active: boolean;
  position: number;
  metaRetailerId: string | null;
  rowVersion: number;
}

/** One product as the SQL returns it. Internal ids stay here; the mapper puts `uuid` on the wire. */
export interface ProductRow {
  id: number;
  uuid: string;
  storefrontId: number | null;
  storefrontUuid: string | null;
  userId: number | null;
  sku: string | null;
  name: string;
  slug: string;
  description: string | null;
  bodyHtml: string | null;
  priceMinor: number;
  comparePriceMinor: number | null;
  weightGrams: number | null;
  category: string | null;
  tags: string[];
  aliases: unknown;
  status: string;
  availability: string;
  condition: string;
  brand: string | null;
  productUrl: string | null;
  googleProductCategory: string | null;
  currencyCode: string;
  imageUrl: string | null;
  gallery: string[];
  /** The named options of the product (empty without variants). */
  options: ProductOption[];
  /** Loaded by the repository's reads (not by the raw `PRODUCT_SELECT`, where it is empty). */
  variants: VariantRow[];
  inStock: boolean;
  stockQty: number | null;
  reservedQty: number;
  sortOrder: number;
  metaRetailerId: string | null;
  metaSyncStatus: string | null;
  metaSyncedAt: Date | null;
  metaBatchHandle: string | null;
  metaLastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  rowVersion: number;
}

type Raw = Record<string, unknown>;
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const s = (v: unknown): string | null => (v === null || v === undefined ? null : (v as string));
const d = (v: unknown): Date | null => (v ? new Date(v as string) : null);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

const toOptions = (v: unknown): ProductOption[] =>
  Array.isArray(v)
    ? v.flatMap((o) => {
        const x = o as { name?: unknown; values?: unknown };
        return typeof x?.name === 'string' && Array.isArray(x.values)
          ? [{ name: x.name, values: strings(x.values) }]
          : [];
      })
    : [];

export const toVariantRow = (r: Raw): VariantRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  productId: Number(r.product_id),
  optionValues: strings(r.option_values_json),
  title: r.title as string,
  sku: s(r.sku),
  priceMinor: n(r.price_minor),
  comparePriceMinor: n(r.compare_price_minor),
  imageUrl: s(r.image_url),
  weightGrams: n(r.weight_grams),
  stockQty: n(r.stock_qty),
  reservedQty: Number(r.reserved_qty ?? 0),
  active: r.active !== false,
  position: Number(r.position ?? 0),
  metaRetailerId: s(r.meta_retailer_id),
  rowVersion: Number(r.row_version),
});

export const VARIANT_SELECT = sql`id, uuid, product_id, option_values_json, title, sku, price_minor, compare_price_minor,
  image_url, weight_grams, stock_qty, reserved_qty, active, position, meta_retailer_id, row_version`;

export const toProductRow = (r: Raw): ProductRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  storefrontId: n(r.storefront_id),
  storefrontUuid: s(r.storefront_uuid),
  userId: n(r.user_id),
  sku: s(r.sku),
  name: r.name as string,
  slug: r.slug as string,
  description: s(r.description),
  bodyHtml: s(r.body_html),
  priceMinor: Number(r.price_minor),
  comparePriceMinor: n(r.compare_price_minor),
  weightGrams: n(r.weight_grams),
  category: s(r.category),
  tags: strings(r.tags_json),
  aliases: r.aliases_json ?? null,
  status: r.status as string,
  availability: r.availability as string,
  condition: r.condition as string,
  brand: s(r.brand),
  productUrl: s(r.product_url),
  googleProductCategory: s(r.google_product_category),
  currencyCode: r.currency_code as string,
  imageUrl: s(r.image_url),
  gallery: strings(r.gallery_json),
  options: toOptions(r.options_json),
  variants: [],
  inStock: r.in_stock === true,
  stockQty: n(r.stock_qty),
  reservedQty: Number(r.reserved_qty ?? 0),
  sortOrder: Number(r.sort_order ?? 0),
  metaRetailerId: s(r.meta_retailer_id),
  metaSyncStatus: s(r.meta_sync_status),
  metaSyncedAt: d(r.meta_synced_at),
  metaBatchHandle: s(r.meta_batch_handle),
  metaLastError: s(r.meta_last_error),
  createdAt: new Date(r.created_at as string),
  updatedAt: new Date(r.updated_at as string),
  rowVersion: Number(r.row_version),
});

/** The columns of a product with its shop's uuid, aliased `p` and `sf`. */
export const PRODUCT_SELECT = sql`
  p.id, p.uuid, p.storefront_id, sf.uuid AS storefront_uuid, p.user_id, p.sku, p.name, p.slug, p.description, p.body_html,
  p.price_minor, p.compare_price_minor, p.weight_grams, p.category, p.tags_json, p.aliases_json, p.status, p.availability,
  p.condition, p.brand, p.product_url, p.google_product_category, p.currency_code, p.image_url, p.gallery_json, p.options_json, p.in_stock,
  p.stock_qty, p.reserved_qty, p.sort_order, p.meta_retailer_id, p.meta_sync_status, p.meta_synced_at, p.meta_batch_handle,
  p.meta_last_error, p.created_at, p.updated_at, p.row_version`;

const FROM = sql`FROM wa_products p
  LEFT JOIN wa_storefronts sf ON sf.org_id = p.org_id AND sf.id = p.storefront_id`;

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

/** Columns a write may set, with the SQL cast their value needs. */
const WRITABLE: Record<string, string> = {
  storefront_id: '',
  sku: '',
  name: '',
  slug: '',
  description: '',
  body_html: '',
  price_minor: '',
  compare_price_minor: '',
  currency_code: '',
  image_url: '',
  gallery_json: '::jsonb',
  options_json: '::jsonb',
  in_stock: '',
  stock_qty: '',
  reserved_qty: '',
  sort_order: '',
  status: '',
  weight_grams: '',
  category: '',
  tags_json: '::jsonb',
  aliases_json: '::jsonb',
  availability: '',
  condition: '',
  brand: '',
  product_url: '',
  google_product_category: '',
  user_id: '',
  meta_retailer_id: '',
  meta_sync_status: '',
  meta_synced_at: '',
  meta_batch_handle: '',
  meta_last_error: '',
};

export type ProductPatch = Partial<Record<keyof typeof WRITABLE, unknown>>;

const JSON_COLUMNS = new Set(['gallery_json', 'options_json', 'tags_json', 'aliases_json']);

function valueSql(column: string, value: unknown): SQL {
  if (value === null || value === undefined) return sql`NULL`;
  if (JSON_COLUMNS.has(column)) return sql`${JSON.stringify(value)}${sql.raw(WRITABLE[column]!)}`;
  if (value instanceof Date) return sql`${value.toISOString()}::timestamptz`;
  return sql`${value}`;
}

function setClause(patch: ProductPatch): SQL {
  const parts = Object.entries(patch)
    .filter(([k]) => k in WRITABLE)
    .map(([k, v]) => sql`${sql.raw(k)} = ${valueSql(k, v)}`);
  if (parts.length === 0) throw new Error('empty product patch');
  return sql.join(parts, sql`, `);
}

/** The keyset of the product list: Reference's order, `sort_order` ascending then newest (`id` descending). */
export interface ProductCursor {
  sortOrder: number;
  id: number;
}

export const encodeProductCursor = (c: ProductCursor): string =>
  Buffer.from(`${c.sortOrder}|${c.id}`, 'utf8').toString('base64url');

export function decodeProductCursor(raw: string): ProductCursor {
  const [so, id] = Buffer.from(raw, 'base64url').toString('utf8').split('|');
  const sortOrder = Number.parseInt(so ?? '', 10);
  const idNum = Number.parseInt(id ?? '', 10);
  if (Number.isNaN(sortOrder) || Number.isNaN(idNum)) {
    throw new AppError(ERROR_CODES.VALIDATION_FAILED, 'Invalid pagination cursor', 400);
  }
  return { sortOrder, id: idNum };
}

@Injectable()
export class ProductsRepository {
  private searchCond(q: string | undefined): SQL {
    if (!q) return sql``;
    const like = `%${escapeLike(q)}%`;
    return sql`AND (p.name ILIKE ${like} OR p.sku ILIKE ${like})`;
  }

  /** `limit + 1` rows so the caller can tell whether there is a next page without a count. */
  async list(
    tx: Tx,
    orgId: number,
    f: { q?: string; limit: number; cursor?: ProductCursor },
  ): Promise<ProductRow[]> {
    const after = f.cursor
      ? sql`AND (p.sort_order, -p.id) > (${f.cursor.sortOrder}, ${-f.cursor.id})`
      : sql``;
    const res = await tx.execute(sql`
      SELECT ${PRODUCT_SELECT} ${FROM}
      WHERE p.org_id = ${orgId} ${this.searchCond(f.q)} ${after}
      ORDER BY p.sort_order, p.id DESC
      LIMIT ${f.limit + 1}`);
    return this.withVariants(tx, orgId, (res.rows as Raw[]).map(toProductRow));
  }

  async count(tx: Tx, orgId: number, q?: string): Promise<number> {
    const res = await tx.execute(
      sql`SELECT count(*) AS c FROM wa_products p WHERE p.org_id = ${orgId} ${this.searchCond(q)}`,
    );
    return Number((res.rows[0] as Raw).c);
  }

  async findByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
    forUpdate = false,
  ): Promise<ProductRow | undefined> {
    const res = await tx.execute(sql`
      SELECT ${PRODUCT_SELECT} ${FROM}
      WHERE p.org_id = ${orgId} AND p.uuid = ${uuid}::uuid
      ${forUpdate ? sql`FOR UPDATE OF p` : sql``}`);
    const row = res.rows[0] as Raw | undefined;
    return row ? this.withVariantsOne(tx, orgId, toProductRow(row)) : undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<ProductRow | undefined> {
    const res = await tx.execute(
      sql`SELECT ${PRODUCT_SELECT} ${FROM} WHERE p.org_id = ${orgId} AND p.id = ${id}`,
    );
    const row = res.rows[0] as Raw | undefined;
    return row ? this.withVariantsOne(tx, orgId, toProductRow(row)) : undefined;
  }

  /** The products of this organization among these uuids, optionally only the `active` ones; unknown uuids are absent. */
  async findByUuids(
    tx: Tx,
    orgId: number,
    uuids: readonly string[],
    opts: { activeOnly?: boolean } = {},
  ): Promise<ProductRow[]> {
    if (uuids.length === 0) return [];
    const res = await tx.execute(sql`
      SELECT ${PRODUCT_SELECT} ${FROM}
      WHERE p.org_id = ${orgId} AND p.uuid::text = ANY(${textArray(uuids)})
        ${opts.activeOnly ? sql`AND p.status = 'active'` : sql``}`);
    return this.withVariants(tx, orgId, (res.rows as Raw[]).map(toProductRow));
  }

  async findByIds(tx: Tx, orgId: number, ids: readonly number[]): Promise<ProductRow[]> {
    if (ids.length === 0) return [];
    const res = await tx.execute(sql`
      SELECT ${PRODUCT_SELECT} ${FROM}
      WHERE p.org_id = ${orgId} AND p.id = ANY(${intArray(ids)})`);
    return this.withVariants(tx, orgId, (res.rows as Raw[]).map(toProductRow));
  }

  async insert(tx: Tx, orgId: number, values: ProductPatch): Promise<number> {
    const cols = Object.keys(values).filter((k) => k in WRITABLE);
    const res = await tx.execute(sql`
      INSERT INTO wa_products (org_id, ${sql.raw(cols.join(', '))})
      VALUES (${orgId}, ${sql.join(
        cols.map((c) => valueSql(c, values[c])),
        sql`, `,
      )})
      RETURNING id`);
    return Number((res.rows[0] as Raw).id);
  }

  /** Updates one product; with `expectedVersion` it only matches the row version the caller read (false = someone else changed it). */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    expectedVersion: number | undefined,
    patch: ProductPatch,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE wa_products SET ${setClause(patch)}
      WHERE org_id = ${orgId} AND id = ${id}
        ${expectedVersion !== undefined ? sql`AND row_version = ${expectedVersion}` : sql``}
      RETURNING id`);
    return res.rows.length > 0;
  }

  async delete(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM wa_products WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** Slugs of the organization that are `base` or `base-<n>`, so the free one can be chosen without a query per try. */
  async slugsLike(tx: Tx, orgId: number, base: string, excludeId?: number): Promise<Set<string>> {
    const res = await tx.execute(sql`
      SELECT slug FROM wa_products
      WHERE org_id = ${orgId} AND (slug = ${base} OR slug LIKE ${`${escapeLike(base)}-%`})
        ${excludeId !== undefined ? sql`AND id <> ${excludeId}` : sql``}`);
    return new Set((res.rows as Raw[]).map((r) => r.slug as string));
  }

  /** Active, in-stock products for the pickers, Reference's order, capped at `limit`. */
  async picker(
    tx: Tx,
    orgId: number,
    f: { q?: string; shopId?: number; limit: number },
  ): Promise<ProductRow[]> {
    const shop =
      f.shopId !== undefined
        ? sql`AND (p.storefront_id IS NULL OR p.storefront_id = ${f.shopId})`
        : sql``;
    const res = await tx.execute(sql`
      SELECT ${PRODUCT_SELECT} ${FROM}
      WHERE p.org_id = ${orgId} AND p.status = 'active' AND p.in_stock ${this.searchCond(f.q)} ${shop}
      ORDER BY p.sort_order, p.id DESC
      LIMIT ${f.limit}`);
    return (res.rows as Raw[]).map(toProductRow);
  }

  // --- variants ------------------------------------------------------------------------------------------------------------

  /** Attaches every product's variants with ONE query (no N+1 on the list). */
  async withVariants(tx: Tx, orgId: number, rows: ProductRow[]): Promise<ProductRow[]> {
    if (rows.length === 0) return rows;
    const byProduct = await this.variantsOf(
      tx,
      orgId,
      rows.map((r) => r.id),
    );
    return rows.map((r) => ({ ...r, variants: byProduct.get(r.id) ?? [] }));
  }

  private async withVariantsOne(tx: Tx, orgId: number, row: ProductRow): Promise<ProductRow> {
    return (await this.withVariants(tx, orgId, [row]))[0]!;
  }

  /** The variants of these products by product id, in position order; `forUpdate` locks them (stock moves, writes). */
  async variantsOf(
    tx: Tx,
    orgId: number,
    productIds: readonly number[],
    forUpdate = false,
  ): Promise<Map<number, VariantRow[]>> {
    const out = new Map<number, VariantRow[]>();
    if (productIds.length === 0) return out;
    const res = await tx.execute(sql`
      SELECT ${VARIANT_SELECT} FROM wa_product_variants
      WHERE org_id = ${orgId} AND product_id = ANY(${intArray(productIds)})
      ORDER BY product_id, position, id
      ${forUpdate ? sql`FOR UPDATE` : sql``}`);
    for (const r of res.rows as Raw[]) {
      const v = toVariantRow(r);
      const list = out.get(v.productId);
      if (list) list.push(v);
      else out.set(v.productId, [v]);
    }
    return out;
  }

  async insertVariant(tx: Tx, orgId: number, productId: number, w: VariantWrite): Promise<void> {
    await tx.execute(sql`
      INSERT INTO wa_product_variants (org_id, product_id, option_values_json, title, sku, price_minor, compare_price_minor,
        image_url, weight_grams, stock_qty, active, position)
      VALUES (${orgId}, ${productId}, ${JSON.stringify(w.optionValues)}::jsonb, ${w.title}, ${w.sku}, ${w.priceMinor},
        ${w.comparePriceMinor}, ${w.imageUrl}, ${w.weightGrams}, ${w.stockQty}, ${w.active}, ${w.position})`);
  }

  async updateVariant(tx: Tx, orgId: number, id: number, w: VariantWrite): Promise<void> {
    await tx.execute(sql`
      UPDATE wa_product_variants SET option_values_json = ${JSON.stringify(w.optionValues)}::jsonb, title = ${w.title},
        sku = ${w.sku}, price_minor = ${w.priceMinor}, compare_price_minor = ${w.comparePriceMinor}, image_url = ${w.imageUrl},
        weight_grams = ${w.weightGrams}, stock_qty = ${w.stockQty}, active = ${w.active}, position = ${w.position}
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /**
   * Frees the unique title and SKU of variants about to change them, so two kept variants can swap values in one save without a
   * transient unique violation (their final values are written right after).
   */
  async parkVariantKeys(tx: Tx, orgId: number, ids: readonly number[]): Promise<void> {
    if (ids.length === 0) return;
    await tx.execute(sql`
      UPDATE wa_product_variants SET title = uuid::text, sku = NULL
      WHERE org_id = ${orgId} AND id = ANY(${intArray(ids)})`);
  }

  /** Deletes variants; their holds go with them (the reservation rows cascade) and the caller recomputes the aggregate. */
  async deleteVariants(tx: Tx, orgId: number, ids: readonly number[]): Promise<void> {
    if (ids.length === 0) return;
    await tx.execute(sql`
      DELETE FROM wa_product_variants WHERE org_id = ${orgId} AND id = ANY(${intArray(ids)})`);
  }

  async countAll(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(
      sql`SELECT count(*) AS c FROM wa_products WHERE org_id = ${orgId}`,
    );
    return Number((res.rows[0] as Raw).c);
  }
}

/** A text[] parameter built from validated strings. */
export function textArray(values: readonly string[]): SQL {
  return sql`ARRAY[${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )}]::text[]`;
}

export function intArray(values: readonly number[]): SQL {
  return sql`ARRAY[${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )}]::bigint[]`;
}

/**
 * Invariant 1: while a product has variants, its row is the aggregate older readers use (lowest active variant price, summed
 * stock, held total, in stock). Call it in the SAME transaction as every variant write or stock move, after the variant rows are
 * written (and locked). A product without variants is left alone. Returns the aggregate it wrote, or null.
 */
export async function recomputeProductAggregate(
  tx: Tx,
  orgId: number,
  productId: number,
): Promise<ProductAggregate | null> {
  const vs = await tx.execute(sql`
    SELECT price_minor, stock_qty, reserved_qty, active FROM wa_product_variants
    WHERE org_id = ${orgId} AND product_id = ${productId}`);
  const rows = vs.rows as Raw[];
  if (rows.length === 0) return null;
  const pr = await tx.execute(
    sql`SELECT price_minor FROM wa_products WHERE org_id = ${orgId} AND id = ${productId}`,
  );
  const product = pr.rows[0] as Raw | undefined;
  if (!product) return null;
  const agg = computeAggregate(
    rows.map((r) => ({
      priceMinor: n(r.price_minor),
      stockQty: n(r.stock_qty),
      reservedQty: Number(r.reserved_qty ?? 0),
      active: r.active !== false,
    })),
    Number(product.price_minor),
  );
  if (!agg) return null;
  await tx.execute(sql`
    UPDATE wa_products
    SET price_minor = ${agg.priceMinor}, stock_qty = ${agg.stockQty}, reserved_qty = ${agg.reservedQty},
        in_stock = ${agg.inStock}
    WHERE org_id = ${orgId} AND id = ${productId}
      AND (price_minor IS DISTINCT FROM ${agg.priceMinor} OR stock_qty IS DISTINCT FROM ${agg.stockQty}
        OR reserved_qty IS DISTINCT FROM ${agg.reservedQty} OR in_stock IS DISTINCT FROM ${agg.inStock})`);
  return agg;
}
