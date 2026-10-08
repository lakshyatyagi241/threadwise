import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { StoreKind } from './mirror-rules';

const ORDER_ID = { shopify: 'shopify_order_id', woocommerce: 'woo_order_id' } as const;

export interface BillableOrder {
  id: number;
  contactId: number | null;
  salesOrderId: number | null;
  invoiceId: number | null;
}

/** The mirrored order's billing links and the claims on deliveries (`ecom_invoice_handoffs`), inside the caller's tenant transaction. */
@Injectable()
export class InvoiceHandoffRepository {
  /** The mirrored order of a store order id, locked for the billing so two deliveries of one order take turns. */
  async lockOrder(
    tx: Tx,
    orgId: number,
    kind: StoreKind,
    storeOrderId: string,
  ): Promise<BillableOrder | undefined> {
    const res = await tx.execute(sql`
      SELECT id, contact_id, sales_order_id, invoice_id FROM wa_orders
      WHERE org_id = ${orgId} AND ${sql.raw(ORDER_ID[kind])} = ${storeOrderId}
      ORDER BY id LIMIT 1 FOR UPDATE`);
    const r = res.rows[0] as
      | {
          id: number | string;
          contact_id: number | string | null;
          sales_order_id: number | string | null;
          invoice_id: number | string | null;
        }
      | undefined;
    if (!r) return undefined;
    const n = (v: number | string | null) => (v === null ? null : Number(v));
    return {
      id: Number(r.id),
      contactId: n(r.contact_id),
      salesOrderId: n(r.sales_order_id),
      invoiceId: n(r.invoice_id),
    };
  }

  async setSalesOrder(tx: Tx, orgId: number, orderId: number, salesOrderId: number): Promise<void> {
    await tx.execute(
      sql`UPDATE wa_orders SET sales_order_id = ${salesOrderId} WHERE org_id = ${orgId} AND id = ${orderId}`,
    );
  }

  async setInvoice(tx: Tx, orgId: number, orderId: number, invoiceId: number): Promise<void> {
    await tx.execute(
      sql`UPDATE wa_orders SET invoice_id = ${invoiceId} WHERE org_id = ${orgId} AND id = ${orderId}`,
    );
  }

  /**
   * Claims a delivery for this source. False when it was claimed before (a replay): the unique key decides, so two workers racing on
   * one delivery cannot both win.
   */
  async claim(
    tx: Tx,
    orgId: number,
    v: { source: StoreKind; deliveryId: string; topic: string; orderId: number },
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      INSERT INTO ecom_invoice_handoffs (org_id, source, delivery_id, topic, wa_order_id)
      VALUES (${orgId}, ${v.source}, ${v.deliveryId}, ${v.topic}, ${v.orderId})
      ON CONFLICT (org_id, source, delivery_id) DO NOTHING RETURNING id`);
    return res.rows.length > 0;
  }

  async settle(
    tx: Tx,
    orgId: number,
    source: StoreKind,
    deliveryId: string,
    v: {
      outcome: 'invoiced' | 'existing' | 'skipped';
      invoiceId: number | null;
      reason: string | null;
    },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE ecom_invoice_handoffs SET outcome = ${v.outcome}, invoice_id = ${v.invoiceId}, reason = ${v.reason}
      WHERE org_id = ${orgId} AND source = ${source} AND delivery_id = ${deliveryId}`);
  }
}
