import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { StoreKind } from './mirror-rules';

export interface MirroredOrder {
  id: number;
  phone: string | null;
  name: string | null;
  /** The store's own display name for the order (`#1001`), when the mirror kept it. */
  orderName: string | null;
  status: string;
}

const ORDER_ID = { shopify: 'shopify_order_id', woocommerce: 'woo_order_id' } as const;

/** Reads of the CRM's copy of the store (TW-ECOM-011) that the automations need, inside the caller's tenant transaction. */
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
}
