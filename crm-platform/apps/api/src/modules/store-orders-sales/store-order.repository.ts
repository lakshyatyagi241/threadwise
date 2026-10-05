import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { StoreOrderItemRow, StoreOrderRow } from './store-order.rules';

interface Raw {
  id: number | string;
  uuid: string;
  source: string;
  status: string;
  customer_phone: string | null;
  customer_name: string | null;
  customer_email: string | null;
  customer_address: string | null;
  items_json: unknown;
  total_minor: number | string;
  shipping_minor: number | string;
  tax_minor: number | string;
  tax_inclusive: boolean;
  tax_lines_json: unknown;
  discount_minor: number | string;
  coupon_code: string | null;
  payment_method: string;
  currency_code: string;
  notes: string | null;
  meta_json: Record<string, unknown> | null;
  wa_payment_txn_id: string | null;
  contact_id: number | string | null;
  sales_order_id: number | string | null;
  invoice_id: number | string | null;
  created_at: Date | string;
}

const COLUMNS = sql`id, uuid, source, status, customer_phone, customer_name, customer_email, customer_address, items_json,
  total_minor, shipping_minor, tax_minor, tax_inclusive, tax_lines_json, discount_minor, coupon_code, payment_method, currency_code,
  notes, meta_json, wa_payment_txn_id, contact_id, sales_order_id, invoice_id, created_at`;

const opt = (v: number | string | null): number | null => (v === null ? null : Number(v));

const toRow = (r: Raw): StoreOrderRow => ({
  id: Number(r.id),
  uuid: r.uuid,
  source: r.source,
  status: r.status,
  customerPhone: r.customer_phone,
  customerName: r.customer_name,
  customerEmail: r.customer_email,
  customerAddress: r.customer_address,
  itemsJson: r.items_json,
  totalMinor: Number(r.total_minor),
  shippingMinor: Number(r.shipping_minor),
  taxMinor: Number(r.tax_minor),
  taxInclusive: r.tax_inclusive,
  taxLinesJson: r.tax_lines_json,
  discountMinor: Number(r.discount_minor),
  couponCode: r.coupon_code,
  paymentMethod: r.payment_method,
  currencyCode: r.currency_code,
  notes: r.notes,
  metaJson: r.meta_json,
  waPaymentTxnId: r.wa_payment_txn_id,
  contactId: opt(r.contact_id),
  salesOrderId: opt(r.sales_order_id),
  invoiceId: opt(r.invoice_id),
  createdAt: new Date(r.created_at),
});

/** What a contact's detail page shows of one of its store orders (read side of the contact link). */
export interface ContactOrderRow {
  uuid: string;
  id: number;
  source: string;
  status: string;
  paymentMethod: string;
  currencyCode: string;
  totalMinor: number;
  itemCount: number;
  createdAt: Date;
  salesOrderUuid: string | null;
  salesOrderNumber: string | null;
  invoiceUuid: string | null;
  invoiceNumber: string | null;
  invoiceDocType: string | null;
}

/**
 * Reads and writes the link columns of `wa_orders` (`contact_id`, `sales_order_id`, `invoice_id`) and the bridge's own bookkeeping in
 * `meta_json.crm`. The order's other columns belong to the checkout domain; this reads them until it exports an orders service
 * (the same stand-in the storefront's `SqlOrdersGateway` is).
 */
@Injectable()
export class StoreOrderRepository {
  /** The order row locked for the transaction: two events for the same order cannot both create its sales order. */
  async lock(
    tx: Tx,
    orgId: number,
    ref: { id?: number; uuid?: string },
  ): Promise<StoreOrderRow | undefined> {
    const where = ref.id !== undefined ? sql`id = ${ref.id}` : sql`uuid = ${ref.uuid ?? ''}::uuid`;
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM wa_orders WHERE org_id = ${orgId} AND ${where} FOR UPDATE`,
    );
    const r = res.rows[0] as unknown as Raw | undefined;
    return r ? toRow(r) : undefined;
  }

  async items(tx: Tx, orgId: number, orderId: number): Promise<StoreOrderItemRow[]> {
    const res = await tx.execute(
      sql`SELECT name, retailer_id, quantity, price_minor FROM wa_order_items WHERE org_id = ${orgId} AND order_id = ${orderId} ORDER BY id`,
    );
    return (
      res.rows as Array<{
        name: string;
        retailer_id: string | null;
        quantity: number | string;
        price_minor: number | string;
      }>
    ).map((r) => ({
      name: r.name,
      retailerId: r.retailer_id,
      quantity: Number(r.quantity),
      priceMinor: Number(r.price_minor),
    }));
  }

  async setContact(tx: Tx, orgId: number, id: number, contactId: number): Promise<void> {
    await tx.execute(
      sql`UPDATE wa_orders SET contact_id = ${contactId} WHERE org_id = ${orgId} AND id = ${id} AND contact_id IS NULL`,
    );
  }

  async setSalesOrder(tx: Tx, orgId: number, id: number, salesOrderId: number): Promise<void> {
    await tx.execute(
      sql`UPDATE wa_orders SET sales_order_id = ${salesOrderId} WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  async setInvoice(tx: Tx, orgId: number, id: number, invoiceId: number): Promise<void> {
    await tx.execute(
      sql`UPDATE wa_orders SET invoice_id = ${invoiceId} WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  /** Marks a bookkeeping step done in `meta_json.crm` (`placedLogged`, `paidLogged`, `cancelled`), keeping every other key. */
  async mark(tx: Tx, orgId: number, id: number, key: string): Promise<void> {
    await tx.execute(sql`
      UPDATE wa_orders
      SET meta_json = jsonb_set(
        coalesce(meta_json, '{}'::jsonb), '{crm}',
        coalesce(meta_json -> 'crm', '{}'::jsonb) || jsonb_build_object(${key}::text, true))
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** A contact's store orders, newest first, one more than `limit` so the caller can say there are more. */
  async forContact(
    tx: Tx,
    orgId: number,
    contactId: number,
    limit: number,
  ): Promise<ContactOrderRow[]> {
    const res = await tx.execute(sql`
      SELECT o.id, o.uuid, o.source, o.status, o.payment_method, o.currency_code, o.total_minor, o.created_at,
             CASE WHEN jsonb_typeof(o.items_json) = 'array' THEN jsonb_array_length(o.items_json) ELSE 0 END AS item_count,
             so.uuid AS so_uuid, so.number AS so_number, i.uuid AS inv_uuid, i.invoice_number AS inv_number, i.doc_type AS inv_doc_type
      FROM wa_orders o
      LEFT JOIN sales_orders so ON so.org_id = o.org_id AND so.id = o.sales_order_id
      LEFT JOIN invoices i ON i.org_id = o.org_id AND i.id = o.invoice_id
      WHERE o.org_id = ${orgId} AND o.contact_id = ${contactId}
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT ${limit + 1}`);
    return (
      res.rows as Array<{
        id: number | string;
        uuid: string;
        source: string;
        status: string;
        payment_method: string;
        currency_code: string;
        total_minor: number | string;
        created_at: Date | string;
        item_count: number | string;
        so_uuid: string | null;
        so_number: string | null;
        inv_uuid: string | null;
        inv_number: string | null;
        inv_doc_type: string | null;
      }>
    ).map((r) => ({
      id: Number(r.id),
      uuid: r.uuid,
      source: r.source,
      status: r.status,
      paymentMethod: r.payment_method,
      currencyCode: r.currency_code,
      totalMinor: Number(r.total_minor),
      itemCount: Number(r.item_count),
      createdAt: new Date(r.created_at),
      salesOrderUuid: r.so_uuid,
      salesOrderNumber: r.so_number,
      invoiceUuid: r.inv_uuid,
      invoiceNumber: r.inv_number,
      invoiceDocType: r.inv_doc_type,
    }));
  }

  /** The sales order made from an order (uuid and number), if any. */
  async salesOrderOf(
    tx: Tx,
    orgId: number,
    orderId: number,
  ): Promise<{ uuid: string; number: string } | undefined> {
    const res = await tx.execute(sql`
      SELECT so.uuid, so.number FROM wa_orders o
      JOIN sales_orders so ON so.org_id = o.org_id AND so.id = o.sales_order_id
      WHERE o.org_id = ${orgId} AND o.id = ${orderId}`);
    return res.rows[0] as { uuid: string; number: string } | undefined;
  }
}
