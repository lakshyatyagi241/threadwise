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
}
