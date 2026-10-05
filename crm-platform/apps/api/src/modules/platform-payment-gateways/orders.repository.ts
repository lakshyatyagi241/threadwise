import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { decodeCursor } from '../../common/pagination/cursor';

/** One `orders` row as the module reads it. `id` and `orgId` are internal and never leave the API (the mapper uses `uuid`). */
export interface OrderRow {
  id: number;
  orgId: number;
  uuid: string;
  orderNumber: string;
  userId: number | null;
  kind: 'plan' | 'addon' | 'wallet_topup' | 'manual';
  planSlug: string | null;
  billingPeriod: 'monthly' | 'yearly';
  currency: string;
  amount: string;
  discountAmount: string;
  taxRate: string;
  taxAmount: string;
  totalAmount: string;
  couponCode: string | null;
  couponId: number | null;
  gatewayId: number | null;
  gatewaySlug: string | null;
  status: 'pending' | 'awaiting_approval' | 'paid' | 'failed' | 'cancelled' | 'refunded';
  gatewayOrderId: string | null;
  gatewayPaymentId: string | null;
  failureReason: string | null;
  walletTopupMinor: number | null;
  /** The wallet a top-up credits; null on an older order (the platform currency). */
  walletUnit: string | null;
  returnToken: string;
  autoRenew: boolean;
  customerName: string | null;
  customerEmail: string | null;
  description: string | null;
  createdAt: Date;
  createdAtIso: string;
  paidAt: Date | null;
  rowVersion: number;
}

const COLS = sql.raw(`
  o.id, o.org_id, o.uuid, o.order_number, o.user_id, o.kind, o.plan_slug, o.billing_period, o.currency,
  o.amount::text AS amount, o.discount_amount::text AS discount_amount, o.tax_rate::text AS tax_rate,
  o.tax_amount::text AS tax_amount, o.total_amount::text AS total_amount, o.coupon_code, o.coupon_id, o.gateway_id,
  o.gateway_slug, o.status, o.gateway_order_id, o.gateway_payment_id, o.failure_reason, o.wallet_topup_minor, o.wallet_unit,
  o.return_token, o.customer_name, o.customer_email, o.description, o.created_at, o.paid_at, o.row_version, o.auto_renew,
  to_char(o.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at_iso`);

type Raw = Record<string, unknown>;
const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function toRow(r: Raw): OrderRow {
  return {
    id: Number(r.id),
    orgId: Number(r.org_id),
    uuid: r.uuid as string,
    orderNumber: r.order_number as string,
    userId: num(r.user_id),
    kind: r.kind as OrderRow['kind'],
    planSlug: (r.plan_slug as string | null) ?? null,
    billingPeriod: r.billing_period as OrderRow['billingPeriod'],
    currency: r.currency as string,
    amount: r.amount as string,
    discountAmount: r.discount_amount as string,
    taxRate: r.tax_rate as string,
    taxAmount: r.tax_amount as string,
    totalAmount: r.total_amount as string,
    couponCode: (r.coupon_code as string | null) ?? null,
    couponId: num(r.coupon_id),
    gatewayId: num(r.gateway_id),
    gatewaySlug: (r.gateway_slug as string | null) ?? null,
    status: r.status as OrderRow['status'],
    gatewayOrderId: (r.gateway_order_id as string | null) ?? null,
    gatewayPaymentId: (r.gateway_payment_id as string | null) ?? null,
    failureReason: (r.failure_reason as string | null) ?? null,
    walletTopupMinor: num(r.wallet_topup_minor),
    walletUnit: (r.wallet_unit as string | null) ?? null,
    returnToken: r.return_token as string,
    autoRenew: r.auto_renew === true,
    customerName: (r.customer_name as string | null) ?? null,
    customerEmail: (r.customer_email as string | null) ?? null,
    description: (r.description as string | null) ?? null,
    createdAt: new Date(r.created_at as string),
    createdAtIso: r.created_at_iso as string,
    paidAt: r.paid_at ? new Date(r.paid_at as string) : null,
    rowVersion: Number(r.row_version),
  };
}

export interface NewOrder {
  orgId: number;
  userId: number | null;
  orderNumber: string;
  kind: OrderRow['kind'];
  planSlug: string | null;
  billingPeriod: 'monthly' | 'yearly';
  autoRenew: boolean;
  gatewayId: number;
  gatewaySlug: string;
  currency: string;
  amount: string;
  discountAmount: string;
  taxRate: string;
  taxAmount: string;
  totalAmount: string;
  customerName: string | null;
  customerEmail: string | null;
  billingCompany: string | null;
  billingAddress: string | null;
  billingCity: string | null;
  billingPostal: string | null;
  billingCountry: string | null;
  billingTaxId: string | null;
  walletTopupMinor: number | null;
  walletUnit: string | null;
  idempotencyKey: string | null;
  couponId: number | null;
  couponCode: string | null;
}

/** All SQL for `orders`. Every method runs inside the transaction its caller opened (tenant `tx()` or the store's). */
@Injectable()
export class OrdersRepository {
  async insert(tx: Tx, o: NewOrder): Promise<OrderRow> {
    const res = await tx.execute(sql`
      INSERT INTO orders AS o (org_id, user_id, order_number, kind, plan_slug, billing_period, auto_renew, gateway_id, gateway_slug,
        currency, amount, discount_amount, tax_rate, tax_amount, total_amount, customer_name, customer_email, billing_company,
        billing_address, billing_city, billing_postal, billing_country, billing_tax_id, wallet_topup_minor, wallet_unit, idempotency_key, coupon_id, coupon_code, status)
      VALUES (${o.orgId}, ${o.userId}, ${o.orderNumber}, ${o.kind}, ${o.planSlug}, ${o.billingPeriod}, ${o.autoRenew}, ${o.gatewayId},
        ${o.gatewaySlug}, ${o.currency}, ${o.totalAmount}, ${o.discountAmount}, ${o.taxRate}, ${o.taxAmount}, ${o.totalAmount},
        ${o.customerName}, ${o.customerEmail}, ${o.billingCompany}, ${o.billingAddress}, ${o.billingCity}, ${o.billingPostal},
        ${o.billingCountry}, ${o.billingTaxId}, ${o.walletTopupMinor}, ${o.walletUnit}, ${o.idempotencyKey}, ${o.couponId}, ${o.couponCode}, 'pending')
      RETURNING ${COLS}`);
    return toRow((res.rows as Raw[])[0]!);
  }

  async byIdempotencyKey(tx: Tx, orgId: number, key: string): Promise<OrderRow | null> {
    const res = await tx.execute(
      sql`SELECT ${COLS} FROM orders o WHERE o.org_id = ${orgId} AND o.idempotency_key = ${key}`,
    );
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : null;
  }

  /** The operator console's lookup: by the order's public uuid, across tenants (privileged transaction only). */
  async byUuid(tx: Tx, uuid: string): Promise<OrderRow | null> {
    const res = await tx.execute(sql`SELECT ${COLS} FROM orders o WHERE o.uuid = ${uuid}`);
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : null;
  }

  async byReturnToken(tx: Tx, token: string): Promise<OrderRow | null> {
    const res = await tx.execute(sql`SELECT ${COLS} FROM orders o WHERE o.return_token = ${token}`);
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : null;
  }

  /** Webhook matching: our own reference first (set in every provider's metadata), the provider's id second. */
  async byReference(
    tx: Tx,
    slug: string,
    ref: { orderNumber?: string; gatewayOrderId?: string },
  ): Promise<OrderRow | null> {
    if (ref.orderNumber) {
      const res = await tx.execute(
        sql`SELECT ${COLS} FROM orders o WHERE o.order_number = ${ref.orderNumber} AND o.gateway_slug = ${slug}`,
      );
      const r = (res.rows as Raw[])[0];
      if (r) return toRow(r);
    }
    if (ref.gatewayOrderId) {
      const res = await tx.execute(
        sql`SELECT ${COLS} FROM orders o WHERE o.gateway_order_id = ${ref.gatewayOrderId} AND o.gateway_slug = ${slug}`,
      );
      const r = (res.rows as Raw[])[0];
      if (r) return toRow(r);
    }
    return null;
  }

  /** The provider has accepted the order: remember its id. Only while the order is still open. */
  async setProviderInfo(
    tx: Tx,
    orgId: number,
    id: number,
    gatewayOrderId: string | undefined,
    payload: Record<string, unknown> | undefined,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE orders SET gateway_order_id = COALESCE(${gatewayOrderId ?? null}, gateway_order_id),
        gateway_payload = COALESCE(gateway_payload, '{}'::jsonb) || ${JSON.stringify(payload ?? {})}::jsonb
      WHERE org_id = ${orgId} AND id = ${id} AND status IN ('pending', 'awaiting_approval')`);
  }

  /**
   * Failed or cancelled, never over a paid order (WaDesk let a replayed `?cancelled=1` turn a paid order into a failed one) and
   * never over a refunded one. Returns whether this call changed the row.
   */
  async markUnpaid(
    tx: Tx,
    orgId: number,
    id: number,
    status: 'failed' | 'cancelled',
    reason: string | null,
    payload?: Record<string, unknown>,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE orders SET status = ${status}, failure_reason = ${reason},
        gateway_payload = COALESCE(gateway_payload, '{}'::jsonb) || ${JSON.stringify(payload ?? {})}::jsonb
      WHERE org_id = ${orgId} AND id = ${id} AND status IN ('pending', 'awaiting_approval', 'failed')
      RETURNING id`);
    return res.rows.length > 0;
  }

  /**
   * THE transition: pending (or failed, or cancelled) to paid in one conditional UPDATE. Only the call that gets a row back owns
   * the side effects, so a return and a webhook racing, or a replayed delivery, apply the plan and the wallet exactly once.
   */
  async markPaid(
    tx: Tx,
    orgId: number,
    id: number,
    paymentId: string | null,
    payload: Record<string, unknown> | undefined,
  ): Promise<OrderRow | null> {
    const res = await tx.execute(sql`
      UPDATE orders o SET status = 'paid', paid_at = now(), failure_reason = NULL,
        gateway_payment_id = COALESCE(${paymentId}, o.gateway_payment_id),
        gateway_payload = COALESCE(o.gateway_payload, '{}'::jsonb) || ${JSON.stringify(payload ?? {}, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))}::jsonb
      WHERE o.org_id = ${orgId} AND o.id = ${id} AND o.status NOT IN ('paid', 'refunded')
      RETURNING ${COLS}`);
    const r = (res.rows as Raw[])[0];
    return r ? toRow(r) : null;
  }

  // ---- buyer history -----------------------------------------------------------------------------------------------------

  async listForUser(
    tx: Tx,
    orgId: number,
    userId: number,
    limit: number,
    cursor?: string,
  ): Promise<Array<OrderRow & { planName: string | null }>> {
    const conds: SQL[] = [sql`o.org_id = ${orgId}`, sql`o.user_id = ${userId}`];
    if (cursor) {
      const c = decodeCursor(cursor);
      const at = c.createdAtIso ?? c.createdAt.toISOString();
      conds.push(sql`(o.created_at, o.id) < (${at}::timestamptz, ${c.id})`);
    }
    const res = await tx.execute(sql`
      SELECT ${COLS}, p.name AS plan_name
      FROM orders o
      LEFT JOIN plans p ON p.slug = o.plan_slug
      WHERE ${sql.join(conds, sql` AND `)}
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT ${limit + 1}`);
    return (res.rows as Raw[]).map((r) => ({
      ...toRow(r),
      planName: (r.plan_name as string | null) ?? null,
    }));
  }

  async lifetimeSpend(
    tx: Tx,
    orgId: number,
    userId: number,
  ): Promise<Array<{ currency: string; total: string; orders: number }>> {
    const res = await tx.execute(sql`
      SELECT currency, SUM(total_amount)::text AS total, COUNT(*)::int AS orders
      FROM orders WHERE org_id = ${orgId} AND user_id = ${userId} AND status = 'paid'
      GROUP BY currency ORDER BY currency`);
    return (res.rows as Raw[]).map((r) => ({
      currency: r.currency as string,
      total: r.total as string,
      orders: Number(r.orders),
    }));
  }
}
