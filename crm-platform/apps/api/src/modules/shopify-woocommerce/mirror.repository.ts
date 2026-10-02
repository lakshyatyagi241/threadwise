import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { StoreKind } from './mirror-rules';

export interface MirroredProduct {
  id: number;
  storeProductId: string;
  name: string;
  sku: string | null;
  inStock: boolean;
  productUrl: string | null;
}

export interface WooOrderFacts {
  id: number;
  wooOrderId: string;
  name: string | null;
  status: string;
  items: Array<{ sku: string | null; qty: number }>;
}

export interface MirroredOrder {
  id: number;
  phone: string | null;
  name: string | null;
  /** The store's own display name for the order (`#1001`), when the mirror kept it. */
  orderName: string | null;
  status: string;
}

const PRODUCT_ID = { shopify: 'shopify_product_id', woocommerce: 'woo_product_id' } as const;
const ORDER_ID = { shopify: 'shopify_order_id', woocommerce: 'woo_order_id' } as const;

/** Reads of the CRM's copy of the store (WD-ECOM-011) that the automations need, inside the caller's tenant transaction. */
@Injectable()
export class MirrorRepository {
  async orderByStoreId(
    tx: Tx,
    orgId: number,
    kind: StoreKind,
    storeOrderId: string,
  ): Promise<MirroredOrder | undefined> {
    const res = await tx.execute(sql`
      SELECT id, customer_phone, customer_name, status, meta_json->>'name' AS order_name
      FROM wa_orders
      WHERE org_id = ${orgId} AND ${sql.raw(ORDER_ID[kind])} = ${storeOrderId}
      ORDER BY id LIMIT 1`);
    const r = res.rows[0] as
      | {
          id: number | string;
          customer_phone: string | null;
          customer_name: string | null;
          status: string;
          order_name: string | null;
        }
      | undefined;
    return r
      ? {
          id: Number(r.id),
          phone: r.customer_phone,
          name: r.customer_name,
          orderName: r.order_name,
          status: r.status,
        }
      : undefined;
  }

  /** A reply of the customer changes the mirrored order's status (`confirmed` or `cancelled`). */
  async setOrderStatus(
    tx: Tx,
    orgId: number,
    kind: StoreKind,
    storeOrderId: string,
    status: string,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE wa_orders SET status = ${status}
      WHERE org_id = ${orgId} AND ${sql.raw(ORDER_ID[kind])} = ${storeOrderId}`);
  }

  /** What the workspace's mirrored WooCommerce orders say about a customer, and the store's average order value (major units). */
  async wooHistory(
    tx: Tx,
    orgId: number,
    phone: string,
    /** The order being scored: the mirror already holds it by now, and it is not part of its own history. */
    exceptOrderId: string,
  ): Promise<{ count: number; cancelled: number; fulfilled: number; average: number }> {
    const res = await tx.execute(sql`
      SELECT count(*) FILTER (WHERE ${phone} <> '' AND customer_phone = ${phone} AND woo_order_id IS DISTINCT FROM ${exceptOrderId})::int AS n,
             count(*) FILTER (WHERE ${phone} <> '' AND customer_phone = ${phone} AND woo_order_id IS DISTINCT FROM ${exceptOrderId} AND status = 'cancelled')::int AS cancelled,
             count(*) FILTER (WHERE ${phone} <> '' AND customer_phone = ${phone} AND woo_order_id IS DISTINCT FROM ${exceptOrderId} AND status IN ('shipped', 'paid'))::int AS fulfilled,
             count(*)::int AS all_orders,
             coalesce(sum(total_minor), 0)::bigint AS all_minor
      FROM wa_orders WHERE org_id = ${orgId} AND source = 'woocommerce'`);
    const r = res.rows[0] as {
      n: number;
      cancelled: number;
      fulfilled: number;
      all_orders: number;
      all_minor: string | number;
    };
    const all = Number(r.all_orders);
    return {
      count: Number(r.n),
      cancelled: Number(r.cancelled),
      fulfilled: Number(r.fulfilled),
      average: all === 0 ? 0 : Number(r.all_minor) / 100 / all,
    };
  }

  /** A mirrored product by the store's own id. */
  async productByStoreId(
    tx: Tx,
    orgId: number,
    kind: StoreKind,
    storeProductId: string,
  ): Promise<MirroredProduct | undefined> {
    const col = sql.raw(PRODUCT_ID[kind]);
    const res = await tx.execute(sql`
      SELECT id, ${col} AS store_product_id, name, sku, in_stock, product_url FROM wa_products
      WHERE org_id = ${orgId} AND ${col} = ${storeProductId} ORDER BY id LIMIT 1`);
    const r = res.rows[0] as Record<string, unknown> | undefined;
    return r ? toProduct(r) : undefined;
  }

  /** The store's mirrored products that are out of stock, oldest first, up to `limit`. */
  async outOfStock(
    tx: Tx,
    orgId: number,
    kind: StoreKind,
    limit = 2000,
  ): Promise<MirroredProduct[]> {
    const col = sql.raw(PRODUCT_ID[kind]);
    const res = await tx.execute(sql`
      SELECT id, ${col} AS store_product_id, name, sku, in_stock, product_url FROM wa_products
      WHERE org_id = ${orgId} AND in_stock = false AND ${col} IS NOT NULL
      ORDER BY id LIMIT ${limit}`);
    return (res.rows as Array<Record<string, unknown>>).map(toProduct);
  }

  /** The customer's newest mirrored WooCommerce order, optionally only those in these mirror statuses. */
  async latestWooOrder(
    tx: Tx,
    orgId: number,
    phone: string,
    statuses?: readonly string[],
  ): Promise<WooOrderFacts | undefined> {
    const res = await tx.execute(sql`
      SELECT id, woo_order_id, status, items_json, meta_json->>'name' AS order_name FROM wa_orders
      WHERE org_id = ${orgId} AND source = 'woocommerce' AND customer_phone = ${phone}
        ${
          statuses
            ? sql`AND status IN (${sql.join(
                statuses.map((x) => sql`${x}`),
                sql`, `,
              )})`
            : sql``
        }
      ORDER BY id DESC LIMIT 1`);
    const r = res.rows[0] as
      | {
          id: number | string;
          woo_order_id: string | null;
          status: string;
          items_json: unknown;
          order_name: string | null;
        }
      | undefined;
    if (!r) return undefined;
    const items = (Array.isArray(r.items_json) ? r.items_json : []).map(
      (i: Record<string, unknown>) => ({
        sku: typeof i.sku === 'string' && i.sku !== '' ? i.sku : null,
        qty: Number(i.qty) || 1,
      }),
    );
    return {
      id: Number(r.id),
      wooOrderId: r.woo_order_id ?? '',
      name: r.order_name,
      status: r.status,
      items,
    };
  }

  /** How many mirrored WooCommerce orders the customer has, and what they spent (minor units). */
  async wooTotals(
    tx: Tx,
    orgId: number,
    phone: string,
  ): Promise<{ orders: number; spentMinor: number }> {
    const res = await tx.execute(sql`
      SELECT count(*)::int AS n, coalesce(sum(total_minor), 0)::bigint AS spent FROM wa_orders
      WHERE org_id = ${orgId} AND source = 'woocommerce' AND customer_phone = ${phone}`);
    const r = res.rows[0] as { n: number; spent: number | string };
    return { orders: Number(r.n), spentMinor: Number(r.spent) };
  }

  /** Did the customer receive a WooCommerce order within the last `days` days (mirror status shipped)? */
  async hasRecentShipped(tx: Tx, orgId: number, phone: string, days: number): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT 1 FROM wa_orders
      WHERE org_id = ${orgId} AND source = 'woocommerce' AND customer_phone = ${phone} AND status = 'shipped'
        AND created_at >= now() - make_interval(days => ${days}) LIMIT 1`);
    return res.rows.length > 0;
  }

  /** The points balance a points plugin stored on the contact (`data.points_balance`), as text. */
  async pointsBalance(tx: Tx, orgId: number, phone: string): Promise<string | null> {
    const res = await tx.execute(sql`
      SELECT data->>'points_balance' AS points FROM contacts
      WHERE org_id = ${orgId} AND normalized_phone IN (${phone}, ${`+${phone}`}) ORDER BY id LIMIT 1`);
    const r = res.rows[0] as { points: string | null } | undefined;
    return r?.points ?? null;
  }
}

const toProduct = (r: Record<string, unknown>): MirroredProduct => ({
  id: Number(r.id),
  storeProductId: String(r.store_product_id ?? ''),
  name: String(r.name ?? ''),
  sku: typeof r.sku === 'string' ? r.sku : null,
  inStock: r.in_stock === true,
  productUrl: typeof r.product_url === 'string' ? r.product_url : null,
});
