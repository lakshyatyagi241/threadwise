import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { StoreKind } from './mirror-rules';

export interface Pending {
  id: number;
  storeId: number;
  storeOrderId: string | null;
  orderName: string | null;
}

// Table and column names are fixed by the store kind, never taken from input.
const T = (kind: StoreKind): { table: SQL; orderCol: SQL } =>
  kind === 'shopify'
    ? { table: sql.raw('shopify_cod_confirmations'), orderCol: sql.raw('shopify_order_id') }
    : { table: sql.raw('woocommerce_cod_confirmations'), orderCol: sql.raw('woo_order_id') };

/** The cash-on-delivery confirmations of a store (TW-ECOM-016), inside the caller's tenant transaction. */
@Injectable()
export class CodRepository {
  async open(
    tx: Tx,
    orgId: number,
    kind: StoreKind,
    storeId: number,
    v: { storeOrderId: string; orderName: string; phone: string },
  ): Promise<void> {
    const t = T(kind);
    await tx.execute(sql`
      INSERT INTO ${t.table} (org_id, integration_id, ${t.orderCol}, order_name, customer_phone, status)
      VALUES (${orgId}, ${storeId}, ${v.storeOrderId}, ${v.orderName}, ${v.phone}, 'pending')`);
  }

  /** The newest confirmation still waiting for this number, across the organization's stores of this kind. */
  async newestPending(
    tx: Tx,
    orgId: number,
    kind: StoreKind,
    phone: string,
  ): Promise<Pending | undefined> {
    const t = T(kind);
    const res = await tx.execute(sql`
      SELECT id, integration_id, ${t.orderCol} AS store_order_id, order_name FROM ${t.table}
      WHERE org_id = ${orgId} AND customer_phone = ${phone} AND status = 'pending'
      ORDER BY id DESC LIMIT 1`);
    const r = res.rows[0] as
      | {
          id: number | string;
          integration_id: number | string;
          store_order_id: string | null;
          order_name: string | null;
        }
      | undefined;
    return r
      ? {
          id: Number(r.id),
          storeId: Number(r.integration_id),
          storeOrderId: r.store_order_id,
          orderName: r.order_name,
        }
      : undefined;
  }

  /** Closes a pending confirmation. False when another reply got there first. */
  async settle(
    tx: Tx,
    orgId: number,
    kind: StoreKind,
    id: number,
    status: 'confirmed' | 'cancelled',
  ): Promise<boolean> {
    const t = T(kind);
    const res = await tx.execute(sql`
      UPDATE ${t.table} SET status = ${status}, updated_at = now(), row_version = row_version + 1
      WHERE org_id = ${orgId} AND id = ${id} AND status = 'pending' RETURNING id`);
    return res.rows.length > 0;
  }
}
