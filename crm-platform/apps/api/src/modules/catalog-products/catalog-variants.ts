import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { buildMetaItem, retailerIdOf, type MetaItemSource } from './catalog-rules';
import { variantRetailerId, variantSellable } from './variant-rules';

/**
 * Variants on the WhatsApp / Meta side: each active variant is its own catalog item (`retailer_id` per invariant 5, grouped by
 * `item_group_id` = the product's retailer id), a cart line naming a variant's retailer id resolves to (product, variant), and a
 * send of a product with variants offers one of its variants. The pure rules first, then the one SQL read other domains share.
 */

/** The part of a variant these rules read. `ProductsRepository`'s `VariantRow` satisfies it. */
export interface CatalogVariant {
  id: number;
  title: string;
  sku: string | null;
  priceMinor: number | null;
  imageUrl: string | null;
  stockQty: number | null;
  reservedQty: number;
  active: boolean;
  position: number;
  metaRetailerId: string | null;
  optionValues: string[];
}

/** The retailer id a variant has on Meta and in a WhatsApp message. */
export const retailerIdOfVariant = (
  product: { id: number; sku: string | null; metaRetailerId: string | null },
  v: Pick<CatalogVariant, 'metaRetailerId' | 'sku' | 'position'>,
): string => variantRetailerId(v, retailerIdOf(product));

/** The price a variant sells at: its own, else the product's. */
export const variantPriceOf = (
  v: Pick<CatalogVariant, 'priceMinor'>,
  productPriceMinor: number,
): number => v.priceMinor ?? productPriceMinor;

const OPTION_FIELDS: Record<string, 'color' | 'size' | 'material' | 'pattern'> = {
  color: 'color',
  colour: 'color',
  size: 'size',
  material: 'material',
  pattern: 'pattern',
};

/**
 * The `items_batch` body of one variant: the product's item with the variant's own id, title ("<name> - <variant title>"), price,
 * image and availability, tied to its siblings by `item_group_id`. An inactive variant is sent hidden and out of stock, which is how
 * Meta takes an item off the shop without deleting it.
 */
export function buildMetaVariantItem(
  p: MetaItemSource & { options?: ReadonlyArray<{ name: string }> },
  v: CatalogVariant,
  shopUrl: string,
): Record<string, unknown> {
  const base = buildMetaItem(p, shopUrl);
  const sellable = variantSellable(v) && p.status === 'active' && p.availability !== 'discontinued';
  const data: Record<string, unknown> = {
    ...base,
    retailer_id: retailerIdOfVariant(p, v),
    item_group_id: retailerIdOf(p),
    name: `${p.name} - ${v.title}`,
    price: undefined,
    image_url: v.imageUrl || p.imageUrl,
    availability: sellable
      ? 'in stock'
      : p.availability === 'discontinued' || p.status !== 'active'
        ? 'discontinued'
        : 'out of stock',
    inventory: v.stockQty === null ? undefined : v.stockQty,
  };
  const merged = buildMetaItem({ ...p, priceMinor: variantPriceOf(v, p.priceMinor) }, shopUrl);
  data.price = merged.price;
  (p.options ?? []).forEach((o, i) => {
    const field = OPTION_FIELDS[o.name.trim().toLowerCase()];
    const value = v.optionValues[i];
    if (field && value) data[field] = value;
  });
  if (!v.active) data.visibility = 'hidden';
  return Object.fromEntries(
    Object.entries(data).filter(([, x]) => x !== null && x !== undefined && x !== ''),
  );
}

/**
 * Everything a product pushes to Meta: one item per variant when it has variants (inactive ones hidden), else its one item. A
 * product that turned into one with variants also hides its own old item, unless a variant already carries that id.
 */
export function metaItemsOf(
  p: MetaItemSource & { options?: ReadonlyArray<{ name: string }>; metaSyncStatus?: string | null },
  variants: readonly CatalogVariant[],
  shopUrl: string,
): Array<{ retailerId: string; data: Record<string, unknown> }> {
  if (variants.length === 0)
    return [{ retailerId: retailerIdOf(p), data: buildMetaItem(p, shopUrl) }];
  const items = variants.map((v) => ({
    retailerId: retailerIdOfVariant(p, v),
    data: buildMetaVariantItem(p, v, shopUrl),
  }));
  const own = retailerIdOf(p);
  if (p.metaSyncStatus && !items.some((i) => i.retailerId === own)) {
    items.push({
      retailerId: own,
      data: { ...buildMetaItem(p, shopUrl), availability: 'out of stock', visibility: 'hidden' },
    });
  }
  return items;
}

/**
 * The retailer id to offer for a product in a message: a product with variants is shown through one of them (the first sellable
 * one, else the first active one), because only the variants exist as items on Meta; a product without variants is its own id.
 */
export function shareRetailerId(
  p: { id: number; sku: string | null; metaRetailerId: string | null },
  variants: readonly CatalogVariant[],
): string {
  const pick = variants.find(variantSellable) ?? variants.find((v) => v.active);
  return pick ? retailerIdOfVariant(p, pick) : retailerIdOf(p);
}

export interface ResolvedVariantRef {
  retailerId: string;
  productId: number;
  variantId: number;
  variantUuid: string;
  title: string;
  priceMinor: number | null;
  imageUrl: string | null;
  stockQty: number | null;
  reservedQty: number;
  active: boolean;
  productPriceMinor: number;
}

/**
 * The variants these retailer ids name, in one query (the retailer id is the stored one, else the SKU, else
 * `<product retailer id>-<position + 1>`, computed in SQL). A cart line that is not in the result is not a variant.
 */
export async function resolveVariantRetailerIds(
  tx: Tx,
  orgId: number,
  ids: readonly string[],
): Promise<Map<string, ResolvedVariantRef>> {
  const out = new Map<string, ResolvedVariantRef>();
  const list = [...new Set(ids.filter((i) => i !== ''))];
  if (list.length === 0) return out;
  const res = await tx.execute(sql`
    SELECT * FROM (
      SELECT coalesce(v.meta_retailer_id, v.sku,
               coalesce(p.meta_retailer_id, p.sku, 'wsn-' || p.id::text) || '-' || (v.position + 1)::text) AS rid,
             v.id, v.uuid, v.product_id, v.title, v.price_minor, v.image_url, v.stock_qty, v.reserved_qty, v.active,
             p.price_minor AS product_price
      FROM wa_product_variants v
      JOIN wa_products p ON p.org_id = v.org_id AND p.id = v.product_id
      WHERE v.org_id = ${orgId}
    ) x
    WHERE x.rid IN (${sql.join(
      list.map((i) => sql`${i}`),
      sql`, `,
    )})
    ORDER BY x.id`);
  for (const r of res.rows as Array<Record<string, unknown>>) {
    const rid = String(r.rid);
    if (out.has(rid)) continue;
    out.set(rid, {
      retailerId: rid,
      productId: Number(r.product_id),
      variantId: Number(r.id),
      variantUuid: String(r.uuid),
      title: String(r.title),
      priceMinor: r.price_minor === null ? null : Number(r.price_minor),
      imageUrl: (r.image_url as string | null) ?? null,
      stockQty: r.stock_qty === null ? null : Number(r.stock_qty),
      reservedQty: Number(r.reserved_qty ?? 0),
      active: r.active !== false,
      productPriceMinor: Number(r.product_price),
    });
  }
  return out;
}
