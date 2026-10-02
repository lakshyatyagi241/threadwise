import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { StoreKind } from './mirror-rules';

export interface Waiter {
  id: number;
  phone: string;
}

// Table and column names are fixed by the store kind, never taken from input.
const T = (kind: StoreKind): { table: SQL; productCol: SQL } =>
  kind === 'shopify'
    ? { table: sql.raw('shopify_stock_waitlist'), productCol: sql.raw('shopify_product_id') }
    : { table: sql.raw('woocommerce_stock_waitlist'), productCol: sql.raw('woo_product_id') };

/** The back-in-stock waitlist of a store (WD-ECOM-020), inside the caller's tenant transaction. */
@Injectable()
export class StockRepository {
  /** Puts a customer on the waitlist for a product unless they are already waiting for it. */
  async join(
    tx: Tx,
    orgId: number,
    kind: StoreKind,
    storeId: number,
    v: { storeProductId: string; productName: string; phone: string },
  ): Promise<void> {
    const t = T(kind);
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`ecom-waitlist:${orgId}:${kind}:${v.storeProductId}:${v.phone}`}))`,
    );
    await tx.execute(sql`
      INSERT INTO ${t.table} (org_id, integration_id, ${t.productCol}, product_name, customer_phone, status)
      SELECT ${orgId}, ${storeId}, ${v.storeProductId}, ${v.productName}, ${v.phone}, 'waiting'
      WHERE NOT EXISTS (
        SELECT 1 FROM ${t.table}
        WHERE org_id = ${orgId} AND ${t.productCol} = ${v.storeProductId} AND customer_phone = ${v.phone} AND status = 'waiting')`);
  }

  async waiting(tx: Tx, orgId: number, kind: StoreKind, storeProductId: string): Promise<Waiter[]> {
    const t = T(kind);
    const res = await tx.execute(sql`
      SELECT id, customer_phone FROM ${t.table}
      WHERE org_id = ${orgId} AND ${t.productCol} = ${storeProductId} AND status = 'waiting' ORDER BY id`);
    return (res.rows as Array<{ id: number | string; customer_phone: string }>).map((r) => ({
      id: Number(r.id),
      phone: r.customer_phone,
    }));
  }

  async markNotified(tx: Tx, orgId: number, kind: StoreKind, id: number): Promise<void> {
    const t = T(kind);
    await tx.execute(sql`
      UPDATE ${t.table} SET status = 'notified', notified_at = now(), updated_at = now(), row_version = row_version + 1
      WHERE org_id = ${orgId} AND id = ${id}`);
  }
}
