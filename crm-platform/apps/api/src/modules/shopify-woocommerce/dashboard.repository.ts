import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type {
  DashboardCustomer,
  DashboardLog,
  DashboardOrder,
  DashboardProduct,
  DashboardSender,
  DashboardTemplate,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { discountPct, paramCount } from './dashboard-rules';
import type { StoreKind } from './mirror-rules';

type Row = Record<string, unknown>;
const n = (x: unknown): number => Number(x ?? 0) || 0;
const s = (x: unknown): string | null => (typeof x === 'string' && x !== '' ? x : null);
const iso = (x: unknown): string | null => (x ? new Date(x as string).toISOString() : null);

// Table and column names are fixed by the store kind, never taken from input.
const T = (kind: StoreKind) =>
  kind === 'shopify'
    ? {
        logs: sql.raw('shopify_integration_logs'),
        events: sql.raw('shopify_integration_events'),
        cod: sql.raw('shopify_cod_confirmations'),
        product: sql.raw('shopify_product_id'),
      }
    : {
        logs: sql.raw('woocommerce_integration_logs'),
        events: sql.raw('woocommerce_integration_events'),
        cod: sql.raw('woocommerce_cod_confirmations'),
        product: sql.raw('woo_product_id'),
      };

/** The reads behind the store dashboard (WD-ECOM-023), inside the caller's tenant transaction. */
@Injectable()
export class DashboardRepository {
  /** Mirrored products of the store, newest first. */
  async products(
    tx: Tx,
    orgId: number,
    kind: StoreKind,
    limit: number,
  ): Promise<DashboardProduct[]> {
    const t = T(kind);
    const res = await tx.execute(sql`
      SELECT id, uuid, name, brand, image_url, product_url, price_minor, compare_price_minor, in_stock FROM wa_products
      WHERE org_id = ${orgId} AND ${t.product} IS NOT NULL ORDER BY id DESC LIMIT ${limit}`);
    return (res.rows as Row[]).map((r) => {
      const price = n(r.price_minor) / 100;
      const compare = r.compare_price_minor ? n(r.compare_price_minor) / 100 : null;
      return {
        id: String(r.uuid),
        title: String(r.name),
        vendor: s(r.brand),
        imageUrl: s(r.image_url),
        productUrl: s(r.product_url),
        price,
        comparePrice: compare,
        discountPct: discountPct(price, compare),
        inStock: r.in_stock === true,
      };
    });
  }

  async orders(tx: Tx, orgId: number, kind: StoreKind, limit: number): Promise<DashboardOrder[]> {
    const res = await tx.execute(sql`
      SELECT id, customer_name, customer_email, customer_phone, total_minor, currency_code, status, created_at, meta_json
      FROM wa_orders WHERE org_id = ${orgId} AND source = ${kind} ORDER BY id DESC LIMIT ${limit}`);
    return (res.rows as Row[]).map((r) => {
      const meta = (
        typeof r.meta_json === 'object' && r.meta_json !== null ? r.meta_json : {}
      ) as Row;
      return {
        name: s(meta.name) ?? `#${n(r.id)}`,
        customer: s(r.customer_name) ?? s(r.customer_email) ?? '—',
        email: s(r.customer_email),
        phone: s(r.customer_phone),
        status: s(meta.financial_status) ?? s(r.status),
        fulfillment: s(meta.fulfillment_status),
        total: n(r.total_minor) / 100,
        currency: String(r.currency_code ?? 'USD'),
        createdAt: iso(r.created_at),
      };
    });
  }

  /** Customers of the store: the members of its customer group, newest first. */
  async customers(
    tx: Tx,
    orgId: number,
    groupId: number | null,
    limit: number,
  ): Promise<{ rows: DashboardCustomer[]; total: number }> {
    if (groupId === null) return { rows: [], total: 0 };
    const res = await tx.execute(sql`
      SELECT c.name, c.email, c.phone, c.data FROM contact_group_members m
      JOIN contacts c ON c.org_id = m.org_id AND c.id = m.contact_id
      WHERE m.org_id = ${orgId} AND m.group_id = ${groupId} ORDER BY c.id DESC LIMIT ${limit}`);
    const total = await tx.execute(
      sql`SELECT count(*)::int AS n FROM contact_group_members WHERE org_id = ${orgId} AND group_id = ${groupId}`,
    );
    return {
      rows: (res.rows as Row[]).map((r) => {
        const data = (typeof r.data === 'object' && r.data !== null ? r.data : {}) as Row;
        return {
          name: s(r.name) ?? s(r.email) ?? '—',
          email: s(r.email),
          phone: s(r.phone),
          ordersCount: Math.max(0, Math.round(n(data.orders_count))),
          totalSpent: Math.max(0, Number.parseFloat(String(data.total_spent ?? 0)) || 0),
        };
      }),
      total: n((total.rows[0] as Row).n),
    };
  }

  async counts(
    tx: Tx,
    orgId: number,
    kind: StoreKind,
  ): Promise<{ products: number; orders: number }> {
    const t = T(kind);
    const res = await tx.execute(sql`
      SELECT (SELECT count(*) FROM wa_products WHERE org_id = ${orgId} AND ${t.product} IS NOT NULL)::int AS products,
             (SELECT count(*) FROM wa_orders WHERE org_id = ${orgId} AND source = ${kind})::int AS orders`);
    const r = res.rows[0] as Row;
    return { products: n(r.products), orders: n(r.orders) };
  }

  async logSummary(
    tx: Tx,
    orgId: number,
    kind: StoreKind,
    storeId: number,
  ): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byEvent: Record<string, number>;
    recent: DashboardLog[];
  }> {
    const t = T(kind);
    const [status, event, recent] = await Promise.all([
      tx.execute(
        sql`SELECT status AS k, count(*)::int AS n FROM ${t.logs} WHERE org_id = ${orgId} AND integration_id = ${storeId} GROUP BY status`,
      ),
      tx.execute(
        sql`SELECT event_type AS k, count(*)::int AS n FROM ${t.logs} WHERE org_id = ${orgId} AND integration_id = ${storeId} GROUP BY event_type`,
      ),
      tx.execute(
        sql`SELECT id, event_type, status, recipient, error, created_at FROM ${t.logs} WHERE org_id = ${orgId} AND integration_id = ${storeId} ORDER BY created_at DESC, id DESC LIMIT 15`,
      ),
    ]);
    const group = (rows: Row[]) => Object.fromEntries(rows.map((r) => [String(r.k), n(r.n)]));
    const byStatus = group(status.rows as Row[]);
    return {
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      byStatus,
      byEvent: group(event.rows as Row[]),
      recent: (recent.rows as Row[]).map((r) => ({
        id: n(r.id),
        eventType: String(r.event_type),
        status: String(r.status),
        recipient: s(r.recipient),
        error: s(r.error),
        createdAt: new Date(r.created_at as string).toISOString(),
      })),
    };
  }

  async activeEvents(tx: Tx, orgId: number, kind: StoreKind, storeId: number): Promise<number> {
    const t = T(kind);
    const res = await tx.execute(
      sql`SELECT count(*)::int AS n FROM ${t.events} WHERE org_id = ${orgId} AND integration_id = ${storeId} AND is_active`,
    );
    return n((res.rows[0] as Row).n);
  }

  /** The analytics numbers: revenue, orders, messages, offers, COD results, recovery sends and the revenue by day. */
  async analytics(
    tx: Tx,
    orgId: number,
    kind: StoreKind,
    storeId: number,
  ): Promise<{
    revenueMinor: number;
    orders: number;
    messagesSent: number;
    offersSent: number;
    codConfirmed: number;
    codCancelled: number;
    recoverySends: number;
    byDay: Map<string, number>;
  }> {
    const t = T(kind);
    const checkout = kind === 'shopify' ? 'checkouts/create' : 'checkout.created';
    const [orders, logs, cod, days] = await Promise.all([
      tx.execute(
        sql`SELECT count(*)::int AS n, coalesce(sum(total_minor), 0)::bigint AS minor FROM wa_orders WHERE org_id = ${orgId} AND source = ${kind}`,
      ),
      tx.execute(sql`
        SELECT count(*) FILTER (WHERE status = 'sent')::int AS sent,
               count(*) FILTER (WHERE event_type = 'offer/broadcast')::int AS offers,
               count(*) FILTER (WHERE status = 'sent' AND event_type IN ('offer/broadcast', 'winback/broadcast', ${checkout}, 'cod/confirm', 'cod/prepaid', 'stock/back'))::int AS recovery
        FROM ${t.logs} WHERE org_id = ${orgId} AND integration_id = ${storeId}`),
      tx.execute(sql`
        SELECT count(*) FILTER (WHERE status = 'confirmed')::int AS confirmed, count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
        FROM ${t.cod} WHERE org_id = ${orgId}`),
      tx.execute(sql`
        SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, sum(total_minor)::bigint AS minor FROM wa_orders
        WHERE org_id = ${orgId} AND source = ${kind} AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') - interval '13 days'
        GROUP BY 1`),
    ]);
    const o = orders.rows[0] as Row;
    const l = logs.rows[0] as Row;
    const c = cod.rows[0] as Row;
    return {
      revenueMinor: n(o.minor),
      orders: n(o.n),
      messagesSent: n(l.sent),
      offersSent: n(l.offers),
      codConfirmed: n(c.confirmed),
      codCancelled: n(c.cancelled),
      recoverySends: n(l.recovery),
      byDay: new Map((days.rows as Row[]).map((r) => [String(r.day), n(r.minor) / 100])),
    };
  }

  /** Templates that can be sent now: not submitted to Meta, or approved by it. */
  async templates(tx: Tx, orgId: number): Promise<DashboardTemplate[]> {
    const res = await tx.execute(sql`
      SELECT uuid, template_name, category, language, channel, template_body FROM wa_templates
      WHERE org_id = ${orgId} AND (meta_template_id IS NULL OR upper(coalesce(meta_status, '')) = 'APPROVED')
      ORDER BY template_name`);
    return (res.rows as Row[]).map((r) => ({
      uuid: String(r.uuid),
      name: String(r.template_name),
      category: s(r.category),
      language: String(r.language ?? 'en_US'),
      channel: s(r.channel),
      paramCount: paramCount(String(r.template_body ?? '')),
    }));
  }

  async contactGroups(
    tx: Tx,
    orgId: number,
  ): Promise<Array<{ uuid: string; name: string; color: string | null }>> {
    const res = await tx.execute(
      sql`SELECT uuid, name, color FROM contact_groups WHERE org_id = ${orgId} ORDER BY name`,
    );
    return (res.rows as Row[]).map((r) => ({
      uuid: String(r.uuid),
      name: String(r.name),
      color: s(r.color),
    }));
  }

  async coupons(
    tx: Tx,
    orgId: number,
  ): Promise<Array<{ code: string; type: string; amount: number }>> {
    const res = await tx.execute(
      sql`SELECT code, type, amount FROM wa_coupons WHERE org_id = ${orgId} AND active ORDER BY code LIMIT 100`,
    );
    return (res.rows as Row[]).map((r) => ({
      code: String(r.code),
      type: String(r.type),
      amount: n(r.amount),
    }));
  }

  async offerProducts(
    tx: Tx,
    orgId: number,
    kind: StoreKind,
  ): Promise<Array<{ uuid: string; name: string; priceMinor: number }>> {
    const t = T(kind);
    const res = await tx.execute(sql`
      SELECT uuid, name, price_minor FROM wa_products WHERE org_id = ${orgId} AND ${t.product} IS NOT NULL ORDER BY name LIMIT 200`);
    return (res.rows as Row[]).map((r) => ({
      uuid: String(r.uuid),
      name: String(r.name),
      priceMinor: n(r.price_minor),
    }));
  }

  /** The numbers a message can go out from: connected devices and connected provider accounts. */
  async senders(tx: Tx, orgId: number): Promise<DashboardSender[]> {
    const [devices, configs] = await Promise.all([
      tx.execute(
        sql`SELECT uuid, coalesce(nullif(device_name, ''), nullif(phone_number, ''), 'Device') AS label FROM devices WHERE org_id = ${orgId} AND status = 'connected' AND active ORDER BY id DESC`,
      ),
      tx.execute(
        sql`SELECT uuid, provider, coalesce(nullif(display_label, ''), nullif(phone_number, ''), provider) AS label FROM wa_provider_configs WHERE org_id = ${orgId} AND status = 'connected' ORDER BY is_primary DESC, id DESC`,
      ),
    ]);
    return [
      ...(devices.rows as Row[]).map((r) => ({
        key: `baileys:${String(r.uuid)}`,
        label: String(r.label),
        engine: 'baileys',
      })),
      ...(configs.rows as Row[]).map((r) => ({
        key: `${String(r.provider)}:${String(r.uuid)}`,
        label: String(r.label),
        engine: String(r.provider),
      })),
    ];
  }
}
