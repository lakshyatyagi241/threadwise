import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { CONTACT_RESOLVER, type ContactResolverPort } from '../../crm/contact-resolver.port';
import type { PhoneHistory } from '../rules/rto';
import type {
  DashboardOrders,
  NewStorefrontOrder,
  OrderRecord,
  OrdersGateway,
  PlacedOrder,
  RecentOrder,
} from './tokens';

interface RawOrder {
  id: number | string;
  uuid: string;
  storefront_id: number | string | null;
  status: string;
  payment_method: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  customer_address: string | null;
  items_json: unknown;
  total_minor: number | string;
  shipping_minor: number | string;
  discount_minor: number | string;
  currency_code: string;
  payment_link: string | null;
  meta_json: Record<string, unknown> | null;
  recovery_token: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const ORDER_COLUMNS = sql`id, uuid, storefront_id, status, payment_method, customer_name, customer_phone, customer_email,
  customer_address, items_json, total_minor, shipping_minor, discount_minor, currency_code, payment_link, meta_json,
  recovery_token, created_at, updated_at`;

const toRecord = (r: RawOrder): OrderRecord => ({
  id: Number(r.id),
  uuid: r.uuid,
  storefrontId: r.storefront_id === null ? null : Number(r.storefront_id),
  status: r.status,
  paymentMethod: r.payment_method,
  customerName: r.customer_name,
  customerPhone: r.customer_phone,
  customerEmail: r.customer_email,
  customerAddress: r.customer_address,
  items: Array.isArray(r.items_json) ? (r.items_json as Array<Record<string, unknown>>) : [],
  totalMinor: Number(r.total_minor),
  shippingMinor: Number(r.shipping_minor),
  discountMinor: Number(r.discount_minor),
  currencyCode: r.currency_code,
  paymentLink: r.payment_link,
  metaJson: r.meta_json,
  recoveryToken: r.recovery_token,
  createdAt: new Date(r.created_at),
  updatedAt: new Date(r.updated_at),
});

/** Reads and writes `wa_orders` directly until checkout-orders-merchant-payments (CHK) exports its own order service. */
@Injectable()
export class SqlOrdersGateway implements OrdersGateway {
  constructor(@Inject(CONTACT_RESOLVER) private readonly contacts: ContactResolverPort) {}

  async create(tx: Tx, orgId: number, o: NewStorefrontOrder): Promise<PlacedOrder> {
    // The buyer is a contact of the workspace (found or created by phone), in this same transaction. A cap on contacts or an unusable
    // number leaves the link empty: the order is placed either way.
    const link = await this.contacts.findOrCreateByPhone(tx, orgId, {
      phone: o.customerPhone,
      name: o.customerName,
      email: o.customerEmail,
      address: o.customerAddress,
      source: 'store',
      tag: 'Store customer',
    });
    const contactId = link.outcome === 'skipped' ? null : link.contactId;
    const res = await tx.execute(sql`
      INSERT INTO wa_orders (
        org_id, source, customer_phone, customer_name, customer_email, customer_address, items_json,
        total_minor, shipping_minor, discount_minor, coupon_code, currency_code, payment_method,
        rto_score, rto_band, status, storefront_id, recovery_token, notes, meta_json, contact_id
      ) VALUES (
        ${orgId}, 'storefront', ${o.customerPhone}, ${o.customerName}, ${o.customerEmail}, ${o.customerAddress},
        ${JSON.stringify(o.items)}::jsonb,
        ${o.totalMinor}, ${o.shippingMinor}, ${o.discountMinor}, ${o.couponCode}, ${o.currencyCode}, ${o.paymentMethod},
        ${o.rtoScore}, ${o.rtoBand}, 'new', ${o.storefrontId}, ${o.recoveryToken}, ${o.notes},
        ${JSON.stringify({ placed_via: 'storefront_checkout' })}::jsonb, ${contactId}
      )
      RETURNING id, uuid`);
    const row = res.rows[0] as { id: number | string; uuid: string };
    return { id: Number(row.id), uuid: row.uuid };
  }

  async window(tx: Tx, orgId: number, days: number): Promise<DashboardOrders> {
    const res = await tx.execute(sql`
      SELECT coalesce(sum(total_minor), 0)::bigint AS revenue, count(*)::int AS orders
      FROM wa_orders
      WHERE org_id = ${orgId} AND created_at >= now() - make_interval(days => ${days})`);
    const r = res.rows[0] as { revenue: number | string; orders: number | string };
    return { revenueMinor: Number(r.revenue), orders: Number(r.orders) };
  }

  async salesByDay(
    tx: Tx,
    orgId: number,
    days: number,
  ): Promise<Array<{ day: string; revenueMinor: number; orders: number }>> {
    const res = await tx.execute(sql`
      WITH buckets AS (
        SELECT d::date AS day
        FROM generate_series(
          (now() AT TIME ZONE 'UTC')::date - ${days - 1}::int,
          (now() AT TIME ZONE 'UTC')::date,
          interval '1 day') AS d
      ), sold AS (
        SELECT (created_at AT TIME ZONE 'UTC')::date AS day, sum(total_minor)::bigint AS revenue, count(*)::int AS orders
        FROM wa_orders
        WHERE org_id = ${orgId} AND created_at >= now() - make_interval(days => ${days})
        GROUP BY 1
      )
      SELECT to_char(b.day, 'YYYY-MM-DD') AS day, coalesce(s.revenue, 0) AS revenue, coalesce(s.orders, 0) AS orders
      FROM buckets b LEFT JOIN sold s ON s.day = b.day
      ORDER BY b.day`);
    return (
      res.rows as Array<{ day: string; revenue: number | string; orders: number | string }>
    ).map((r) => ({ day: r.day, revenueMinor: Number(r.revenue), orders: Number(r.orders) }));
  }

  async topProducts(
    tx: Tx,
    orgId: number,
    days: number,
    limit: number,
  ): Promise<Array<{ name: string; qty: number }>> {
    const res = await tx.execute(sql`
      SELECT coalesce(i.item ->> 'name', 'Unknown') AS name,
             sum(coalesce(nullif(i.item ->> 'qty', '')::numeric, 1))::bigint AS qty
      FROM wa_orders o
      CROSS JOIN LATERAL jsonb_array_elements(
        CASE WHEN jsonb_typeof(o.items_json) = 'array' THEN o.items_json ELSE '[]'::jsonb END
      ) WITH ORDINALITY AS i(item, pos)
      WHERE o.org_id = ${orgId} AND o.created_at >= now() - make_interval(days => ${days})
      GROUP BY 1
      ORDER BY qty DESC, min(o.id), min(i.pos)
      LIMIT ${limit}`);
    return (res.rows as Array<{ name: string; qty: number | string }>).map((r) => ({
      name: r.name,
      qty: Number(r.qty),
    }));
  }

  async recent(tx: Tx, orgId: number, limit: number): Promise<RecentOrder[]> {
    const res = await tx.execute(sql`
      SELECT id, uuid, customer_name, customer_phone, total_minor, currency_code, status, source, created_at,
             CASE WHEN jsonb_typeof(items_json) = 'array' THEN jsonb_array_length(items_json) ELSE 0 END AS items_count
      FROM wa_orders WHERE org_id = ${orgId}
      ORDER BY created_at DESC, id DESC LIMIT ${limit}`);
    return (
      res.rows as Array<{
        id: number | string;
        uuid: string;
        customer_name: string | null;
        customer_phone: string | null;
        total_minor: number | string;
        currency_code: string;
        status: string;
        source: string;
        created_at: Date | string;
        items_count: number | string;
      }>
    ).map((r) => ({
      itemsCount: Number(r.items_count),
      id: Number(r.id),
      uuid: r.uuid,
      customerName: r.customer_name,
      customerPhone: r.customer_phone,
      totalMinor: Number(r.total_minor),
      currencyCode: r.currency_code,
      status: r.status,
      source: r.source,
      createdAt: new Date(r.created_at),
    }));
  }

  async sidebarCounts(tx: Tx, orgId: number) {
    const res = await tx.execute(sql`
      SELECT
        (SELECT count(*) FROM wa_orders WHERE org_id = ${orgId})::int AS orders,
        (SELECT count(*) FROM wa_groups WHERE org_id = ${orgId})::int AS groups,
        (SELECT count(*) FROM wa_coupons WHERE org_id = ${orgId})::int AS coupons,
        (SELECT count(*) FROM wa_product_reviews WHERE org_id = ${orgId} AND status = 'pending')::int AS reviews_pending,
        (SELECT count(*) FROM workspace_payment_configs WHERE org_id = ${orgId})::int AS payments,
        (SELECT count(*) FROM wa_merchant_gateways WHERE org_id = ${orgId} AND coalesce(storefront_id, 0) = 0 AND active)::int AS gateways,
        (SELECT count(*) FROM wa_customer_profiles WHERE org_id = ${orgId})::int AS customers`);
    const r = res.rows[0] as Record<string, number | string>;
    return {
      orders: Number(r.orders),
      groups: Number(r.groups),
      coupons: Number(r.coupons),
      reviewsPending: Number(r.reviews_pending),
      payments: Number(r.payments),
      gateways: Number(r.gateways),
      customers: Number(r.customers),
    };
  }

  async phoneHistory(tx: Tx, orgId: number, phoneDigits: string): Promise<PhoneHistory> {
    if (!phoneDigits) return { priorCount: 0, priorCancelled: 0, priorDelivered: 0 };
    // Digits on both sides: WaDesk compared the digits-only phone with a column that kept the "+", so a returning buyer who
    // typed one was scored as new.
    const res = await tx.execute(sql`
      SELECT count(*)::int AS n,
             count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
             count(*) FILTER (WHERE status IN ('shipped', 'paid'))::int AS delivered
      FROM wa_orders
      WHERE org_id = ${orgId} AND regexp_replace(coalesce(customer_phone, ''), '\\D', '', 'g') = ${phoneDigits}`);
    const r = res.rows[0] as {
      n: number | string;
      cancelled: number | string;
      delivered: number | string;
    };
    return {
      priorCount: Number(r.n),
      priorCancelled: Number(r.cancelled),
      priorDelivered: Number(r.delivered),
    };
  }

  async averageTotalMinor(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(
      sql`SELECT avg(total_minor) AS avg FROM wa_orders WHERE org_id = ${orgId} AND total_minor > 0`,
    );
    const avg = (res.rows[0] as { avg: string | number | null } | undefined)?.avg;
    return avg === null || avg === undefined ? 0 : Math.round(Number(avg));
  }

  async findByToken(
    tx: Tx,
    orgId: number,
    storefrontId: number,
    token: string,
  ): Promise<OrderRecord | undefined> {
    const res = await tx.execute(sql`
      SELECT ${ORDER_COLUMNS} FROM wa_orders
      WHERE org_id = ${orgId} AND storefront_id = ${storefrontId} AND recovery_token = ${token}`);
    const row = res.rows[0] as unknown as RawOrder | undefined;
    return row ? toRecord(row) : undefined;
  }

  async findForPayment(tx: Tx, orgId: number, orderId: number): Promise<OrderRecord | undefined> {
    const res = await tx.execute(sql`
      SELECT ${ORDER_COLUMNS} FROM wa_orders
      WHERE org_id = ${orgId} AND id = ${orderId} FOR UPDATE`);
    const row = res.rows[0] as unknown as RawOrder | undefined;
    return row ? toRecord(row) : undefined;
  }

  async markPaid(
    tx: Tx,
    orgId: number,
    orderId: number,
    patch: { paymentLink: string | null; meta: Record<string, unknown> },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE wa_orders
      SET status = 'paid',
          payment_link = coalesce(${patch.paymentLink}, payment_link),
          meta_json = coalesce(meta_json, '{}'::jsonb) || ${JSON.stringify(patch.meta)}::jsonb
      WHERE org_id = ${orgId} AND id = ${orderId}`);
  }

  async deleteByStorefront(tx: Tx, orgId: number, storefrontId: number): Promise<number> {
    const res = await tx.execute(
      sql`DELETE FROM wa_orders WHERE org_id = ${orgId} AND storefront_id = ${storefrontId} RETURNING id`,
    );
    return res.rows.length;
  }

  async deleteAll(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(sql`DELETE FROM wa_orders WHERE org_id = ${orgId} RETURNING id`);
    return res.rows.length;
  }
}
