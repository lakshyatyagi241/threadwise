import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { ListStoreCouponsQuery, ListStoreCouponUsagesQuery } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { decodeCursor } from '../../../common/pagination/cursor';
import { likePattern } from '../rules/coupon-admin';
import { ISO_MICROS } from './payment-sql';

export interface CouponRow {
  id: number;
  uuid: string;
  code: string;
  type: string;
  amount: number;
  minSubtotalMinor: number | null;
  maxDiscountMinor: number | null;
  freeShipping: boolean;
  active: boolean;
  startsAt: Date | null;
  expiresAt: Date | null;
  usageLimit: number | null;
  usedCount: number;
  storefrontId: number | null;
  storefrontUuid: string | null;
  storefrontName: string | null;
  rowVersion: number;
  createdAt: Date;
  createdAtIso: string;
  updatedAt: Date;
}

interface Raw {
  id: number | string;
  uuid: string;
  code: string;
  type: string;
  amount: number | string;
  min_subtotal_minor: number | string | null;
  max_discount_minor: number | string | null;
  free_shipping: boolean;
  active: boolean;
  starts_at: Date | string | null;
  expires_at: Date | string | null;
  usage_limit: number | null;
  used_count: number;
  storefront_id: number | string | null;
  storefront_uuid: string | null;
  shop_name: string | null;
  row_version: number;
  created_at: Date | string;
  created_at_iso: string;
  updated_at: Date | string;
}

const num = (v: number | string | null): number | null => (v === null ? null : Number(v));
const date = (v: Date | string | null): Date | null => (v === null ? null : new Date(v));

const COLUMNS = sql`k.id, k.uuid, k.code, k.type, k.amount, k.min_subtotal_minor, k.max_discount_minor, k.free_shipping,
  k.active, k.starts_at, k.expires_at, k.usage_limit, k.used_count, k.storefront_id, s.uuid AS storefront_uuid, s.shop_name,
  k.row_version, k.created_at, to_char(k.created_at AT TIME ZONE 'UTC', ${sql.raw(`'${ISO_MICROS}'`)}) AS created_at_iso, k.updated_at`;
const FROM = sql`wa_coupons k LEFT JOIN wa_storefronts s ON s.org_id = k.org_id AND s.id = k.storefront_id`;

const toRow = (r: Raw): CouponRow => ({
  id: Number(r.id),
  uuid: r.uuid,
  code: r.code,
  type: r.type,
  amount: Number(r.amount),
  minSubtotalMinor: num(r.min_subtotal_minor),
  maxDiscountMinor: num(r.max_discount_minor),
  freeShipping: r.free_shipping,
  active: r.active,
  startsAt: date(r.starts_at),
  expiresAt: date(r.expires_at),
  usageLimit: r.usage_limit,
  usedCount: Number(r.used_count),
  storefrontId: r.storefront_id === null ? null : Number(r.storefront_id),
  storefrontUuid: r.storefront_uuid,
  storefrontName: r.shop_name,
  rowVersion: r.row_version,
  createdAt: new Date(r.created_at),
  createdAtIso: r.created_at_iso,
  updatedAt: new Date(r.updated_at),
});

/** The same order of checks as `couponState` (rules/coupon-admin.ts), for the list filter. */
const STATE_SQL = sql`(CASE
  WHEN NOT k.active THEN 'inactive'
  WHEN k.starts_at IS NOT NULL AND k.starts_at > now() THEN 'scheduled'
  WHEN k.expires_at IS NOT NULL AND k.expires_at < now() THEN 'expired'
  WHEN k.usage_limit IS NOT NULL AND k.used_count >= k.usage_limit THEN 'exhausted'
  ELSE 'active' END)`;

export interface CouponValues {
  code: string;
  type: string;
  amount: number;
  minSubtotalMinor: number | null;
  maxDiscountMinor: number | null;
  freeShipping: boolean;
  active: boolean;
  startsAt: string | null;
  expiresAt: string | null;
  usageLimit: number | null;
  storefrontId: number | null;
}

@Injectable()
export class StoreCouponsRepository {
  async list(tx: Tx, orgId: number, q: ListStoreCouponsQuery): Promise<CouponRow[]> {
    const where: SQL[] = [sql`k.org_id = ${orgId}`];
    if (q.q) where.push(sql`k.code ILIKE ${likePattern(q.q)}`);
    if (q.state) where.push(sql`${STATE_SQL} = ${q.state}`);
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      where.push(
        sql`(k.created_at, k.id) < (${c.createdAtIso ?? c.createdAt.toISOString()}::timestamptz, ${c.id}::bigint)`,
      );
    }
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM ${FROM}
      WHERE ${sql.join(where, sql` AND `)}
      ORDER BY k.created_at DESC, k.id DESC
      LIMIT ${q.limit + 1}`);
    return (res.rows as unknown as Raw[]).map(toRow);
  }

  async findByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
    opts: { lock?: boolean } = {},
  ): Promise<CouponRow | undefined> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM ${FROM}
      WHERE k.org_id = ${orgId} AND k.uuid = ${uuid}::uuid
      ${opts.lock ? sql`FOR UPDATE OF k` : sql``}`);
    const r = res.rows[0] as unknown as Raw | undefined;
    return r ? toRow(r) : undefined;
  }

  /** A coupon whose code equals this one ignoring case (WaDesk `LOWER(code) = ?`), other than `exceptId`. */
  async codeTaken(tx: Tx, orgId: number, code: string, exceptId?: number): Promise<boolean> {
    const res = await tx.execute(sql`
      SELECT 1 FROM wa_coupons
      WHERE org_id = ${orgId} AND lower(code) = lower(${code})
        ${exceptId === undefined ? sql`` : sql`AND id <> ${exceptId}`}
      LIMIT 1`);
    return res.rows.length > 0;
  }

  async insert(tx: Tx, orgId: number, v: CouponValues): Promise<{ id: number; uuid: string }> {
    const res = await tx.execute(sql`
      INSERT INTO wa_coupons (org_id, storefront_id, code, type, amount, min_subtotal_minor, max_discount_minor, free_shipping,
                              active, starts_at, expires_at, usage_limit)
      VALUES (${orgId}, ${v.storefrontId}, ${v.code}, ${v.type}, ${v.amount}, ${v.minSubtotalMinor}, ${v.maxDiscountMinor},
              ${v.freeShipping}, ${v.active}, ${v.startsAt}::timestamptz, ${v.expiresAt}::timestamptz, ${v.usageLimit})
      RETURNING id, uuid`);
    const r = res.rows[0] as { id: number | string; uuid: string };
    return { id: Number(r.id), uuid: r.uuid };
  }

  async update(
    tx: Tx,
    orgId: number,
    id: number,
    v: CouponValues,
    expectedVersion: number,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE wa_coupons
      SET storefront_id = ${v.storefrontId}, code = ${v.code}, type = ${v.type}, amount = ${v.amount},
          min_subtotal_minor = ${v.minSubtotalMinor}, max_discount_minor = ${v.maxDiscountMinor},
          free_shipping = ${v.freeShipping}, active = ${v.active}, starts_at = ${v.startsAt}::timestamptz,
          expires_at = ${v.expiresAt}::timestamptz, usage_limit = ${v.usageLimit}
      WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${expectedVersion}
      RETURNING id`);
    return res.rows.length === 1;
  }

  async setActive(tx: Tx, orgId: number, id: number, active: boolean): Promise<void> {
    await tx.execute(
      sql`UPDATE wa_coupons SET active = ${active} WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  async delete(
    tx: Tx,
    orgId: number,
    uuid: string,
  ): Promise<{ id: number; code: string } | undefined> {
    const res = await tx.execute(
      sql`DELETE FROM wa_coupons WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid RETURNING id, code`,
    );
    const r = res.rows[0] as { id: number | string; code: string } | undefined;
    return r ? { id: Number(r.id), code: r.code } : undefined;
  }

  async shopIdByUuid(tx: Tx, orgId: number, uuid: string): Promise<number | undefined> {
    const res = await tx.execute(
      sql`SELECT id FROM wa_storefronts WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as { id: number | string } | undefined;
    return r ? Number(r.id) : undefined;
  }

  /** Orders that carry this coupon code (compared ignoring case), newest first, `limit + 1` rows. */
  async usages(tx: Tx, orgId: number, code: string, q: ListStoreCouponUsagesQuery) {
    const where: SQL[] = [sql`o.org_id = ${orgId}`, sql`lower(o.coupon_code) = lower(${code})`];
    if (q.cursor) {
      const c = decodeCursor(q.cursor);
      where.push(
        sql`(o.created_at, o.id) < (${c.createdAtIso ?? c.createdAt.toISOString()}::timestamptz, ${c.id}::bigint)`,
      );
    }
    const res = await tx.execute(sql`
      SELECT o.id, o.uuid, o.customer_name, o.customer_phone, o.discount_minor, o.total_minor, o.currency_code, o.status,
             o.created_at, to_char(o.created_at AT TIME ZONE 'UTC', ${sql.raw(`'${ISO_MICROS}'`)}) AS created_at_iso
      FROM wa_orders o
      WHERE ${sql.join(where, sql` AND `)}
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT ${q.limit + 1}`);
    return (
      res.rows as unknown as Array<{
        id: number | string;
        uuid: string;
        customer_name: string | null;
        customer_phone: string | null;
        discount_minor: number | string;
        total_minor: number | string;
        currency_code: string;
        status: string;
        created_at: Date | string;
        created_at_iso: string;
      }>
    ).map((r) => ({
      id: Number(r.id),
      uuid: r.uuid,
      customerName: r.customer_name,
      customerPhone: r.customer_phone,
      discountMinor: Number(r.discount_minor),
      totalMinor: Number(r.total_minor),
      currencyCode: r.currency_code,
      status: r.status,
      createdAt: new Date(r.created_at),
      createdAtIso: r.created_at_iso,
    }));
  }
}
