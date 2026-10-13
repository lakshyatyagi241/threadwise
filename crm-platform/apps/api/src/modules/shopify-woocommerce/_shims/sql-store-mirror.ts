import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { CONTACT_RESOLVER, type ContactResolverPort } from '../../crm/contact-resolver.port';
import { recomputeProductAggregate } from '../../catalog-products';
import {
  CUSTOMER_GROUP,
  type MirrorCustomer,
  type MirrorOrder,
  type MirrorProduct,
  type StoreKind,
} from '../mirror-rules';
import type { StoreMirror } from './tokens';

/** The store's id column on `wa_products` and `wa_orders`. Constants, never user input. */
const PRODUCT_ID = { shopify: 'shopify_product_id', woocommerce: 'woo_product_id' } as const;
const ORDER_ID = { shopify: 'shopify_order_id', woocommerce: 'woo_order_id' } as const;
const CUSTOMER_KEY = { shopify: 'shopify_customer_id', woocommerce: 'woo_customer_id' } as const;

const lock = (tx: Tx, key: string) =>
  tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);

/**
 * Writes `wa_products`, `wa_orders`, `contacts` and the store's customer group directly until the catalog, checkout and contacts
 * domains export their own writers. Every row is found by the store's id first, under a lock on that id, so two imports (or an
 * import and a webhook) cannot make two rows for one product or order.
 */
@Injectable()
export class SqlStoreMirror implements StoreMirror {
  constructor(@Inject(CONTACT_RESOLVER) private readonly contacts: ContactResolverPort) {}

  async upsertProduct(
    tx: Tx,
    orgId: number,
    kind: StoreKind,
    userId: number | null,
    p: MirrorProduct,
  ): Promise<void> {
    const col = sql.raw(PRODUCT_ID[kind]);
    await lock(tx, `ecom-product:${orgId}:${kind}:${p.storeId}`);
    const found = await tx.execute(
      sql`SELECT id FROM wa_products WHERE org_id = ${orgId} AND ${col} = ${p.storeId} ORDER BY id LIMIT 1`,
    );
    const existing = found.rows[0] as { id: number | string } | undefined;
    const availability = p.inStock ? 'in stock' : 'out of stock';
    const base = p.slug || `${kind}-${p.storeId}`;

    // A slug is unique per organization. A second product with the same slug (two stores, or a store that repeats one) gets the
    // store id on the end instead of failing the row.
    await lock(tx, `ecom-slug:${orgId}:${base}`);
    const taken = await tx.execute(sql`
      SELECT 1 FROM wa_products WHERE org_id = ${orgId} AND slug = ${base}
        ${existing ? sql`AND id <> ${Number(existing.id)}` : sql``} LIMIT 1`);
    const slug = taken.rows.length > 0 ? `${base}-${p.storeId}` : base;

    if (existing) {
      await tx.execute(sql`
        UPDATE wa_products SET user_id = ${userId}, sku = ${p.sku}, name = ${p.name}, slug = ${slug}, description = ${p.description},
               body_html = ${p.bodyHtml}, price_minor = ${p.priceMinor}, compare_price_minor = ${p.comparePriceMinor},
               currency_code = ${p.currency}, image_url = ${p.imageUrl}, gallery_json = ${JSON.stringify(p.gallery)}::jsonb,
               in_stock = ${p.inStock}, availability = ${availability}, status = ${p.status}, category = ${p.category},
               brand = ${p.brand}, product_url = ${p.productUrl}, tags_json = ${JSON.stringify(p.tags)}::jsonb
        WHERE org_id = ${orgId} AND id = ${Number(existing.id)}`);
      await this.syncVariants(tx, orgId, Number(existing.id), p, true);
      return;
    }
    const made = await tx.execute(sql`
      INSERT INTO wa_products (org_id, ${col}, user_id, sku, name, slug, description, body_html, price_minor, compare_price_minor,
                               currency_code, image_url, gallery_json, in_stock, availability, status, category, brand,
                               product_url, tags_json)
      VALUES (${orgId}, ${p.storeId}, ${userId}, ${p.sku}, ${p.name}, ${slug}, ${p.description}, ${p.bodyHtml}, ${p.priceMinor},
              ${p.comparePriceMinor}, ${p.currency}, ${p.imageUrl}, ${JSON.stringify(p.gallery)}::jsonb, ${p.inStock},
              ${availability}, ${p.status}, ${p.category}, ${p.brand}, ${p.productUrl}, ${JSON.stringify(p.tags)}::jsonb)
      RETURNING id`);
    await this.syncVariants(
      tx,
      orgId,
      Number((made.rows[0] as { id: number | string }).id),
      p,
      false,
    );
  }

  /**
   * The store's variants (Shopify variants, WooCommerce variations) as `wa_product_variants`, with the product's options. Variants are
   * matched to the stored ones by title, then SKU, so their holds (`reserved_qty`) and ids survive a re-import; the store's price,
   * stock, image and weight win; one the store no longer has is removed. The product row is then re-derived as the aggregate
   * (invariant 1) in the same transaction. A product the store sells without variants is a plain product again.
   */
  private async syncVariants(
    tx: Tx,
    orgId: number,
    productId: number,
    p: MirrorProduct,
    existed: boolean,
  ): Promise<void> {
    if (p.keepVariants) return;
    if (p.variants.length === 0) {
      if (!existed) return;
      await tx.execute(
        sql`DELETE FROM wa_product_variants WHERE org_id = ${orgId} AND product_id = ${productId}`,
      );
      await tx.execute(
        sql`UPDATE wa_products SET options_json = NULL WHERE org_id = ${orgId} AND id = ${productId} AND options_json IS NOT NULL`,
      );
      return;
    }
    await tx.execute(
      sql`UPDATE wa_products SET options_json = ${JSON.stringify(p.options)}::jsonb WHERE org_id = ${orgId} AND id = ${productId}`,
    );
    const stored = (
      await tx.execute(sql`
        SELECT id, title, sku FROM wa_product_variants
        WHERE org_id = ${orgId} AND product_id = ${productId} ORDER BY id FOR UPDATE`)
    ).rows as Array<{ id: number | string; title: string; sku: string | null }>;
    // A SKU another product's variant already holds stays free of this one (SKUs are unique per workspace).
    const skus = p.variants.map((v) => v.sku);
    const taken = new Set<string>();
    if (skus.length > 0) {
      const clash = await tx.execute(sql`
        SELECT sku FROM wa_product_variants
        WHERE org_id = ${orgId} AND product_id <> ${productId}
          AND sku IN (${sql.join(
            skus.map((k) => sql`${k}`),
            sql`, `,
          )})`);
      for (const r of clash.rows as Array<{ sku: string }>) taken.add(r.sku);
    }
    // Free the unique title and SKU of every stored variant first, so two variants can swap values in one pass.
    await tx.execute(sql`
      UPDATE wa_product_variants SET title = uuid::text, sku = NULL
      WHERE org_id = ${orgId} AND product_id = ${productId}`);
    const byTitle = new Map(stored.map((s) => [s.title.toLowerCase(), s]));
    const bySku = new Map(stored.filter((s) => s.sku).map((s) => [String(s.sku), s]));
    const claimed = new Set<number>();
    let position = 0;
    for (const v of p.variants) {
      const match =
        [byTitle.get(v.title.toLowerCase()), bySku.get(v.sku)].find(
          (s) => s && !claimed.has(Number(s.id)),
        ) ?? undefined;
      const sku = taken.has(v.sku) ? null : v.sku;
      if (match) {
        claimed.add(Number(match.id));
        await tx.execute(sql`
          UPDATE wa_product_variants
          SET option_values_json = ${JSON.stringify(v.optionValues)}::jsonb, title = ${v.title}, sku = ${sku},
              price_minor = ${v.priceMinor}, compare_price_minor = ${v.comparePriceMinor}, image_url = ${v.imageUrl},
              weight_grams = ${v.weightGrams}, stock_qty = ${v.stockQty}, active = ${v.active}, position = ${position}
          WHERE org_id = ${orgId} AND id = ${Number(match.id)}`);
      } else {
        await tx.execute(sql`
          INSERT INTO wa_product_variants (org_id, product_id, option_values_json, title, sku, price_minor, compare_price_minor,
                                           image_url, weight_grams, stock_qty, active, position)
          VALUES (${orgId}, ${productId}, ${JSON.stringify(v.optionValues)}::jsonb, ${v.title}, ${sku}, ${v.priceMinor},
                  ${v.comparePriceMinor}, ${v.imageUrl}, ${v.weightGrams}, ${v.stockQty}, ${v.active}, ${position})`);
      }
      position += 1;
    }
    const gone = stored.filter((s) => !claimed.has(Number(s.id))).map((s) => Number(s.id));
    if (gone.length > 0) {
      await tx.execute(sql`
        DELETE FROM wa_product_variants WHERE org_id = ${orgId} AND id IN (${sql.join(
          gone.map((i) => sql`${i}`),
          sql`, `,
        )})`);
    }
    await recomputeProductAggregate(tx, orgId, productId);
  }

  async upsertOrder(tx: Tx, orgId: number, kind: StoreKind, o: MirrorOrder): Promise<number> {
    const col = sql.raw(ORDER_ID[kind]);
    await lock(tx, `ecom-order:${orgId}:${kind}:${o.storeId}`);
    const found = await tx.execute(
      sql`SELECT id FROM wa_orders WHERE org_id = ${orgId} AND ${col} = ${o.storeId} ORDER BY id LIMIT 1`,
    );
    const existing = found.rows[0] as { id: number | string } | undefined;
    const items = JSON.stringify(o.items);
    const meta = JSON.stringify(o.meta);
    // The buyer is a contact of the workspace, found or created by phone (an order without a usable number stays unlinked).
    const link = await this.contacts.findOrCreateByPhone(tx, orgId, {
      phone: o.phone,
      name: o.name,
      email: o.email,
      source: kind,
      tag: 'Store customer',
      saveProfile: true,
    });
    const contactId = link.outcome === 'skipped' ? null : link.contactId;
    if (existing) {
      await tx.execute(sql`
        UPDATE wa_orders SET source = ${kind}, customer_phone = ${o.phone}, customer_name = ${o.name},
               customer_email = ${o.email}, items_json = ${items}::jsonb, total_minor = ${o.totalMinor},
               currency_code = ${o.currency}, status = ${o.status}, meta_json = ${meta}::jsonb,
               contact_id = coalesce(${contactId}, contact_id)
        WHERE org_id = ${orgId} AND id = ${Number(existing.id)}`);
      return Number(existing.id);
    }
    const made = await tx.execute(sql`
      INSERT INTO wa_orders (org_id, ${col}, source, customer_phone, customer_name, customer_email, items_json, total_minor,
                             currency_code, status, meta_json, contact_id)
      VALUES (${orgId}, ${o.storeId}, ${kind}, ${o.phone}, ${o.name}, ${o.email}, ${items}::jsonb, ${o.totalMinor},
              ${o.currency}, ${o.status}, ${meta}::jsonb, ${contactId})
      RETURNING id`);
    return Number((made.rows[0] as { id: number | string }).id);
  }

  async ensureGroup(
    tx: Tx,
    orgId: number,
    userId: number | null,
    kind: StoreKind,
    cachedId: number | null,
  ): Promise<number> {
    if (cachedId !== null) {
      const kept = await tx.execute(
        sql`SELECT id FROM contact_groups WHERE org_id = ${orgId} AND id = ${cachedId}`,
      );
      if (kept.rows.length > 0) return cachedId;
    }
    const g = CUSTOMER_GROUP[kind];
    const made = await tx.execute(sql`
      INSERT INTO contact_groups (org_id, created_by, name, color)
      VALUES (${orgId}, ${userId}, ${g.name}, ${g.color}) RETURNING id`);
    return Number((made.rows[0] as { id: number | string }).id);
  }

  async upsertCustomer(
    tx: Tx,
    orgId: number,
    userId: number | null,
    kind: StoreKind,
    c: MirrorCustomer,
    groupId: number,
  ): Promise<boolean> {
    await lock(tx, `ecom-customer:${orgId}:${c.phone}`);
    // A contact is found by its number, as digits or with a leading `+`: the stored number may be either.
    const found = await tx.execute(sql`
      SELECT id FROM contacts WHERE org_id = ${orgId} AND normalized_phone IN (${c.phone}, ${`+${c.phone}`})
      ORDER BY id LIMIT 1`);
    const existing = found.rows[0] as { id: number | string } | undefined;
    let contactId: number;
    let created = false;
    if (existing) {
      contactId = Number(existing.id);
      // The order that brought the customer may have made the contact first, with no email and no store keys: fill an empty email and
      // add the store's keys, never replace anything the contact already holds.
      await tx.execute(sql`
        UPDATE contacts
        SET email = coalesce(email, ${c.email || null}),
            data = ${JSON.stringify({
              [CUSTOMER_KEY[kind]]: c.storeId,
              orders_count: c.ordersCount,
              total_spent: c.totalSpent,
            })}::jsonb || coalesce(data, '{}'::jsonb)
        WHERE org_id = ${orgId} AND id = ${contactId}`);
    } else {
      const made = await tx.execute(sql`
        INSERT INTO contacts (org_id, name, email, phone, owner_id, data)
        VALUES (${orgId}, ${c.name}, ${c.email || null}, ${c.phone}, ${userId},
                ${JSON.stringify({
                  [CUSTOMER_KEY[kind]]: c.storeId,
                  orders_count: c.ordersCount,
                  total_spent: c.totalSpent,
                })}::jsonb)
        RETURNING id`);
      contactId = Number((made.rows[0] as { id: number | string }).id);
      created = true;
    }
    await tx.execute(sql`
      INSERT INTO contact_group_members (org_id, contact_id, group_id) VALUES (${orgId}, ${contactId}, ${groupId})
      ON CONFLICT (org_id, contact_id, group_id) DO NOTHING`);
    return created;
  }
}
