import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { ListStoreOrdersQuery, StoreOrderCounts, StorePaymentStatus } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { decodeCursor } from '../../../common/pagination/cursor';
import { likePattern, phoneDigits } from '../rules/coupon-admin';
import { ISO_MICROS, PAYMENT_STATUS_SQL } from './payment-sql';

/** One `wa_orders` row with the joins both screens need. Ids are internal here; the mapper turns them into uuids. */
export interface OrderRow {
  id: number;
  uuid: string;
  source: string;
  status: string;
  paymentStatus: StorePaymentStatus;
  paymentMethod: string;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  customerAddress: string | null;
  items: unknown;
  itemsCount: number;
  totalMinor: number;
  shippingMinor: number;
  taxMinor: number;
  taxInclusive: boolean;
  discountMinor: number;
  couponCode: string | null;
  currencyCode: string;
  paymentLink: string | null;
  notes: string | null;
  rtoScore: number | null;
  rtoBand: string | null;
  waPaymentStatus: string | null;
  waPaymentTxnId: string | null;
  metaJson: Record<string, unknown> | null;
  recoveryToken: string | null;
  storefrontId: number | null;
  storefrontUuid: string | null;
  storefrontName: string | null;
  contactUuid: string | null;
  invoiceUuid: string | null;
  salesOrderUuid: string | null;
  rowVersion: number;
  createdAt: Date;
  createdAtIso: string;
  updatedAt: Date;
}

interface Raw {
  id: number | string;
  uuid: string;
  source: string;
  status: string;
  payment_status: StorePaymentStatus;
  payment_method: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  customer_address: string | null;
  items_json: unknown;
  items_count: number | string;
  total_minor: number | string;
  shipping_minor: number | string;
  tax_minor: number | string;
  tax_inclusive: boolean;
  discount_minor: number | string;
  coupon_code: string | null;
  currency_code: string;
  payment_link: string | null;
  notes: string | null;
  rto_score: number | null;
  rto_band: string | null;
  wa_payment_status: string | null;
  wa_payment_txn_id: string | null;
  meta_json: Record<string, unknown> | null;
  recovery_token: string | null;
  storefront_id: number | string | null;
  storefront_uuid: string | null;
  shop_name: string | null;
  contact_uuid: string | null;
  invoice_uuid: string | null;
  sales_order_uuid: string | null;
  row_version: number;
  created_at: Date | string;
  created_at_iso: string;
  updated_at: Date | string;
}

export const ORDER_COLUMNS = sql`o.id, o.uuid, o.source, o.status, ${PAYMENT_STATUS_SQL} AS payment_status, o.payment_method,
  o.customer_name, o.customer_phone, o.customer_email, o.customer_address, o.items_json,
  CASE WHEN jsonb_typeof(o.items_json) = 'array' THEN jsonb_array_length(o.items_json) ELSE 0 END AS items_count,
  o.total_minor, o.shipping_minor, o.tax_minor, o.tax_inclusive, o.discount_minor, o.coupon_code, o.currency_code,
  o.payment_link, o.notes, o.rto_score, o.rto_band, o.wa_payment_status, o.wa_payment_txn_id, o.meta_json, o.recovery_token,
  o.storefront_id, s.uuid AS storefront_uuid, s.shop_name,
  c.uuid AS contact_uuid, i.uuid AS invoice_uuid, so.uuid AS sales_order_uuid,
  o.row_version, o.created_at, to_char(o.created_at AT TIME ZONE 'UTC', ${sql.raw(`'${ISO_MICROS}'`)}) AS created_at_iso, o.updated_at`;

export const ORDER_FROM = sql`wa_orders o
  LEFT JOIN wa_storefronts s ON s.org_id = o.org_id AND s.id = o.storefront_id
  LEFT JOIN contacts c ON c.org_id = o.org_id AND c.id = o.contact_id
  LEFT JOIN invoices i ON i.org_id = o.org_id AND i.id = o.invoice_id
  LEFT JOIN sales_orders so ON so.org_id = o.org_id AND so.id = o.sales_order_id`;

export const toOrderRow = (r: Raw): OrderRow => ({
  id: Number(r.id),
  uuid: r.uuid,
  source: r.source,
  status: r.status,
  paymentStatus: r.payment_status,
  paymentMethod: r.payment_method,
  customerName: r.customer_name,
  customerPhone: r.customer_phone,
  customerEmail: r.customer_email,
  customerAddress: r.customer_address,
  items: r.items_json,
  itemsCount: Number(r.items_count),
  totalMinor: Number(r.total_minor),
  shippingMinor: Number(r.shipping_minor),
  taxMinor: Number(r.tax_minor),
  taxInclusive: r.tax_inclusive,
  discountMinor: Number(r.discount_minor),
  couponCode: r.coupon_code,
  currencyCode: r.currency_code,
  paymentLink: r.payment_link,
  notes: r.notes,
  rtoScore: r.rto_score,
  rtoBand: r.rto_band,
  waPaymentStatus: r.wa_payment_status,
  waPaymentTxnId: r.wa_payment_txn_id,
  metaJson: r.meta_json,
  recoveryToken: r.recovery_token,
  storefrontId: r.storefront_id === null ? null : Number(r.storefront_id),
  storefrontUuid: r.storefront_uuid,
  storefrontName: r.shop_name,
  contactUuid: r.contact_uuid,
  invoiceUuid: r.invoice_uuid,
  salesOrderUuid: r.sales_order_uuid,
  rowVersion: r.row_version,
  createdAt: new Date(r.created_at),
  createdAtIso: r.created_at_iso,
  updatedAt: new Date(r.updated_at),
});

export interface OrderFilter extends Omit<ListStoreOrdersQuery, 'storefrontId' | 'cursor'> {
  /** Internal id of the shop (resolved from the uuid by the service). */
  storefrontId?: number;
  cursor?: string;
  /** `prepaid`, `cod` or a gateway slug (the payments overview). */
  method?: string;
}

/** The WHERE of the order list and of the payments overview (`o` is `wa_orders`); the org is always the first condition. */
export function orderConditions(orgId: number, f: Partial<OrderFilter>): SQL[] {
  const where: SQL[] = [sql`o.org_id = ${orgId}`];
  if (f.status && f.status !== 'all') where.push(sql`o.status = ${f.status}`);
  if (f.source && f.source !== 'all') where.push(sql`o.source = ${f.source}`);
  if (f.storefrontId) where.push(sql`o.storefront_id = ${f.storefrontId}`);
  if (f.paymentStatus) where.push(sql`${PAYMENT_STATUS_SQL} = ${f.paymentStatus}`);
  if (f.method) where.push(sql`o.payment_method = ${f.method}`);
  if (f.from) where.push(sql`o.created_at >= (${f.from}::date)::timestamp AT TIME ZONE 'UTC'`);
  if (f.to) where.push(sql`o.created_at < ((${f.to}::date + 1)::timestamp AT TIME ZONE 'UTC')`);
  const q = (f.q ?? '').trim();
  if (q !== '') {
    const alts: SQL[] = [
      sql`o.customer_name ILIKE ${likePattern(q)}`,
      sql`o.customer_phone ILIKE ${likePattern(q)}`,
    ];
    const digits = phoneDigits(q);
    if (digits && digits.length >= 3) {
      alts.push(
        sql`regexp_replace(coalesce(o.customer_phone, ''), '[^0-9]', '', 'g') LIKE ${`%${digits}%`}`,
      );
    }
    // An order number: "#42" or "42", bounded so the cast cannot overflow.
    const no = /^#?(\d{1,15})$/.exec(q)?.[1];
    if (no) alts.push(sql`o.id = ${Number(no)}`);
    where.push(sql`(${sql.join(alts, sql` OR `)})`);
  }
  if (f.cursor) {
    const c = decodeCursor(f.cursor);
    where.push(
      sql`(o.created_at, o.id) < (${c.createdAtIso ?? c.createdAt.toISOString()}::timestamptz, ${c.id}::bigint)`,
    );
  }
  return where;
}

@Injectable()
export class StoreOrdersRepository {
  /** `limit + 1` rows, newest first; the service turns them into a page. */
  async list(tx: Tx, orgId: number, f: OrderFilter): Promise<OrderRow[]> {
    const res = await tx.execute(sql`
      SELECT ${ORDER_COLUMNS} FROM ${ORDER_FROM}
      WHERE ${sql.join(orderConditions(orgId, f), sql` AND `)}
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT ${f.limit + 1}`);
    return (res.rows as unknown as Raw[]).map(toOrderRow);
  }

  async counts(tx: Tx, orgId: number): Promise<StoreOrderCounts> {
    const res = await tx.execute(
      sql`SELECT status, count(*)::int AS n FROM wa_orders WHERE org_id = ${orgId} GROUP BY status`,
    );
    const by = new Map(
      (res.rows as Array<{ status: string; n: number }>).map((r) => [r.status, r.n]),
    );
    const get = (s: string): number => by.get(s) ?? 0;
    return {
      all: [...by.values()].reduce((a, b) => a + b, 0),
      new: get('new'),
      pending: get('pending'),
      confirmed: get('confirmed'),
      paid: get('paid'),
      processing: get('processing'),
      completed: get('completed'),
      shipped: get('shipped'),
      cancelled: get('cancelled'),
    };
  }

  async findByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
    opts: { lock?: boolean } = {},
  ): Promise<OrderRow | undefined> {
    const res = await tx.execute(sql`
      SELECT ${ORDER_COLUMNS} FROM ${ORDER_FROM}
      WHERE o.org_id = ${orgId} AND o.uuid = ${uuid}::uuid
      ${opts.lock ? sql`FOR UPDATE OF o` : sql``}`);
    const r = res.rows[0] as unknown as Raw | undefined;
    return r ? toOrderRow(r) : undefined;
  }

  /** The normalised lines of an order that has no `items_json` lines (orders from channels that write `wa_order_items`). */
  async itemRows(tx: Tx, orgId: number, orderId: number) {
    const res = await tx.execute(sql`
      SELECT product_id, name, quantity, price_minor, image_url, retailer_id
      FROM wa_order_items WHERE org_id = ${orgId} AND order_id = ${orderId} ORDER BY id`);
    return res.rows as unknown as Array<{
      product_id: number | string | null;
      name: string;
      quantity: number;
      price_minor: number | string;
      image_url: string | null;
      retailer_id: string | null;
    }>;
  }

  /**
   * The status form. `notes` and `paymentLink` are written only when the caller says so (`undefined` keeps the column, `null`
   * clears it: WaDesk `fill` of the keys that were submitted). Guarded by the version the caller read when one is given.
   */
  async updateStatus(
    tx: Tx,
    orgId: number,
    id: number,
    v: { status: string; notes?: string | null; paymentLink?: string | null },
    expectedVersion?: number,
  ): Promise<boolean> {
    const sets: SQL[] = [sql`status = ${v.status}`];
    if (v.notes !== undefined) sets.push(sql`notes = ${v.notes}`);
    if (v.paymentLink !== undefined) sets.push(sql`payment_link = ${v.paymentLink}`);
    const res = await tx.execute(sql`
      UPDATE wa_orders SET ${sql.join(sets, sql`, `)}
      WHERE org_id = ${orgId} AND id = ${id}
        ${expectedVersion === undefined ? sql`` : sql`AND row_version = ${expectedVersion}`}
      RETURNING id`);
    return res.rows.length === 1;
  }

  async setPaymentLink(
    tx: Tx,
    orgId: number,
    id: number,
    link: string,
    meta?: Record<string, unknown>,
    paymentMethod?: string,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE wa_orders
      SET payment_link = ${link},
          meta_json = coalesce(meta_json, '{}'::jsonb) || ${JSON.stringify(meta ?? {})}::jsonb
          ${paymentMethod ? sql`, payment_method = ${paymentMethod}` : sql``}
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async delete(tx: Tx, orgId: number, uuid: string): Promise<{ id: number } | undefined> {
    const res = await tx.execute(
      sql`DELETE FROM wa_orders WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid RETURNING id`,
    );
    const r = res.rows[0] as { id: number | string } | undefined;
    return r ? { id: Number(r.id) } : undefined;
  }

  async shopIdByUuid(tx: Tx, orgId: number, uuid: string): Promise<number | undefined> {
    const res = await tx.execute(
      sql`SELECT id FROM wa_storefronts WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as { id: number | string } | undefined;
    return r ? Number(r.id) : undefined;
  }
}
