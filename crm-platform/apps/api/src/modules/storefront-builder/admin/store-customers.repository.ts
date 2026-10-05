import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { AppError } from '../../../common/errors/app-error';
import { phoneKeySql } from '../../../common/sql/phone-key';
import { likePattern, phoneDigits } from '../rules/coupon-admin';

/** A saved profile (`wa_customer_profiles`), the row the edit and delete endpoints work on. */
export interface CustomerRow {
  id: number;
  uuid: string;
  phone: string;
  name: string | null;
  company: string | null;
  address: string | null;
  contactUuid: string | null;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

interface Raw {
  id: number | string;
  uuid: string;
  phone: string;
  name: string | null;
  company: string | null;
  address: string | null;
  contact_uuid: string | null;
  row_version: number;
  created_at: Date | string;
  updated_at: Date | string;
}

const COLUMNS = sql`p.id, p.uuid, p.phone, p.name, p.company, p.address, c.uuid AS contact_uuid, p.row_version, p.created_at, p.updated_at`;
const FROM = sql`wa_customer_profiles p LEFT JOIN contacts c ON c.org_id = p.org_id AND c.id = p.contact_id`;

const toRow = (r: Raw): CustomerRow => ({
  id: Number(r.id),
  uuid: r.uuid,
  phone: r.phone,
  name: r.name,
  company: r.company,
  address: r.address,
  contactUuid: r.contact_uuid,
  rowVersion: r.row_version,
  createdAt: new Date(r.created_at),
  updatedAt: new Date(r.updated_at),
});

/** What the orders of one buyer (one normalised phone) add up to: every order counts, cancelled ones are left out of the money. */
export interface PhoneStats {
  orderCount: number;
  totals: Array<{ currencyCode: string; totalMinor: number; orders: number }>;
  lastOrderAt: Date | null;
}

/**
 * One row of the customers list: a saved profile, a buyer known from orders only, or both. `key` is the buyer's normalised phone
 * (`phoneKeySql`); `profileId` is null for an order-only buyer.
 */
export interface BuyerRow {
  key: string;
  profileId: number | null;
  profileUuid: string | null;
  /** The profile's stored phone, null for an order-only buyer. */
  profilePhone: string | null;
  /** The profile's name, else the name on the latest order that has one. */
  name: string | null;
  company: string | null;
  address: string | null;
  contactUuid: string | null;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
  /** Last activity in microseconds since the epoch: the list's sort key, carried exactly into the cursor. */
  activityUs: string;
  stats: PhoneStats;
}

/** Position in the list: last activity (newest first, in microseconds so no row is skipped or repeated), then phone key, then profile. */
export interface CustomerCursor {
  activityUs: string;
  key: string;
  profileId: number;
}

export const encodeCustomerCursor = (c: CustomerCursor): string =>
  Buffer.from(JSON.stringify([c.activityUs, c.key, c.profileId]), 'utf8').toString('base64url');

export function decodeCustomerCursor(raw: string): CustomerCursor {
  try {
    const [activityUs, key, profileId] = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as [string, string, number];
    if (
      typeof activityUs !== 'string' ||
      !/^-?\d{1,20}$/.test(activityUs) ||
      typeof key !== 'string' ||
      !Number.isSafeInteger(profileId)
    ) {
      throw new Error('malformed');
    }
    return { activityUs, key, profileId };
  } catch {
    throw AppError.validation('Invalid pagination cursor');
  }
}

interface BuyerRaw {
  key: string;
  profile_id: number | string | null;
  profile_uuid: string | null;
  profile_phone: string | null;
  name: string | null;
  company: string | null;
  address: string | null;
  contact_uuid: string | null;
  row_version: number | null;
  created_at: Date | string;
  updated_at: Date | string;
  order_count: number | null;
  last_at: Date | string | null;
  totals: Array<{ currencyCode: string; totalMinor: number | string; orders: number }> | null;
  activity_us: string;
}

const toBuyer = (r: BuyerRaw): BuyerRow => ({
  key: r.key,
  profileId: r.profile_id === null ? null : Number(r.profile_id),
  profileUuid: r.profile_uuid,
  profilePhone: r.profile_phone,
  name: r.name,
  company: r.company,
  address: r.address,
  contactUuid: r.contact_uuid,
  rowVersion: r.row_version ?? 0,
  createdAt: new Date(r.created_at),
  updatedAt: new Date(r.updated_at),
  activityUs: r.activity_us,
  stats: {
    orderCount: r.order_count ?? 0,
    totals: (r.totals ?? []).map((t) => ({
      currencyCode: t.currencyCode,
      totalMinor: Number(t.totalMinor),
      orders: t.orders,
    })),
    lastOrderAt: r.last_at ? new Date(r.last_at) : null,
  },
});

/** What narrows the union: a search text, one shop's buyers, one buyer (by normalised phone), and the page position. */
export interface BuyerFilter {
  q?: string;
  /** Internal id of a shop: only buyers who ordered from it. */
  storefrontId?: number;
  /** One buyer. */
  key?: string;
  cursor?: string;
  /** When set, at most `limit + 1` rows come back (the extra one says there is a next page). */
  limit?: number;
}

@Injectable()
export class StoreCustomersRepository {
  /**
   * The customers of a workspace: saved profiles FULL JOINed with the distinct buyers of `wa_orders`, both keyed by the normalised
   * phone (`ccDigits` is the default country code, "91", or ""). A profile of a number nobody ordered with, a buyer without a
   * profile, and a buyer with both are each one row. Sorted by last activity, newest first: the latest order, else (a saved
   * customer nobody ordered with) the profile's last change.
   */
  async buyers(tx: Tx, orgId: number, ccDigits: string, f: BuyerFilter = {}): Promise<BuyerRow[]> {
    const orderKey = phoneKeySql(sql`o.customer_phone`, ccDigits);
    const profileKey = phoneKeySql(sql`p.phone`, ccDigits);
    const ordWhere: SQL[] = [sql`o.org_id = ${orgId}`];
    if (f.storefrontId !== undefined) ordWhere.push(sql`o.storefront_id = ${f.storefrontId}`);
    if (f.key !== undefined) ordWhere.push(sql`${orderKey} = ${f.key}`);
    const profWhere: SQL[] = [sql`p.org_id = ${orgId}`];
    if (f.key !== undefined) profWhere.push(sql`${profileKey} = ${f.key}`);

    const outer: SQL[] = [];
    // A shop filter keeps only buyers who ordered from that shop.
    if (f.storefrontId !== undefined) outer.push(sql`j.last_at IS NOT NULL`);
    if (f.q) {
      const like = likePattern(f.q);
      const alts: SQL[] = [
        sql`j.name ILIKE ${like}`,
        sql`j.company ILIKE ${like}`,
        sql`j.profile_phone ILIKE ${like}`,
        sql`j.key ILIKE ${like}`,
      ];
      const digits = phoneDigits(f.q);
      if (digits && digits.length >= 3) alts.push(sql`j.key LIKE ${`%${digits}%`}`);
      outer.push(sql`(${sql.join(alts, sql` OR `)})`);
    }
    if (f.cursor) {
      const c = decodeCustomerCursor(f.cursor);
      outer.push(
        sql`(j.activity_us < ${c.activityUs}::bigint
          OR (j.activity_us = ${c.activityUs}::bigint
              AND (j.key, coalesce(j.profile_id, 0)) > (${c.key}::text, ${c.profileId}::bigint)))`,
      );
    }
    const res = await tx.execute(sql`
      WITH ord AS (
        SELECT o.id, o.created_at, o.customer_name, o.contact_id, o.currency_code, o.status, o.total_minor, ${orderKey} AS key
        FROM wa_orders o
        WHERE ${sql.join(ordWhere, sql` AND `)}
      ),
      per_currency AS (
        SELECT key, currency_code,
               count(*) FILTER (WHERE status <> 'cancelled')::int AS counted,
               coalesce(sum(total_minor) FILTER (WHERE status <> 'cancelled'), 0)::bigint AS total
        FROM ord WHERE key <> '' GROUP BY key, currency_code
      ),
      totals AS (
        SELECT key, jsonb_agg(jsonb_build_object('currencyCode', currency_code, 'totalMinor', total, 'orders', counted)
                              ORDER BY currency_code) AS totals
        FROM per_currency WHERE counted > 0 GROUP BY key
      ),
      buyers AS (
        SELECT key, count(*)::int AS order_count, min(created_at) AS first_at, max(created_at) AS last_at,
               (array_agg(nullif(btrim(customer_name), '') ORDER BY created_at DESC, id DESC)
                  FILTER (WHERE nullif(btrim(customer_name), '') IS NOT NULL))[1] AS last_name,
               (array_agg(contact_id ORDER BY created_at DESC, id DESC) FILTER (WHERE contact_id IS NOT NULL))[1] AS last_contact_id
        FROM ord WHERE key <> '' GROUP BY key
      ),
      profs AS (
        SELECT p.*, ${profileKey} AS key FROM wa_customer_profiles p WHERE ${sql.join(profWhere, sql` AND `)}
      ),
      j AS (
        SELECT coalesce(p.key, b.key) AS key,
               p.id AS profile_id, p.uuid AS profile_uuid, p.phone AS profile_phone,
               coalesce(nullif(btrim(p.name), ''), b.last_name) AS name,
               p.company, p.address, p.row_version,
               coalesce(p.contact_id, b.last_contact_id) AS contact_id,
               coalesce(p.created_at, b.first_at) AS created_at,
               greatest(p.updated_at, b.last_at) AS updated_at,
               b.order_count, b.last_at,
               (extract(epoch FROM coalesce(b.last_at, p.updated_at)) * 1000000)::bigint AS activity_us
        FROM profs p FULL JOIN buyers b ON b.key = p.key
        WHERE coalesce(p.key, b.key) <> ''
      )
      SELECT j.key, j.profile_id, j.profile_uuid, j.profile_phone, j.name, j.company, j.address, j.row_version,
             j.created_at, j.updated_at, j.order_count, j.last_at, j.activity_us::text AS activity_us,
             c.uuid AS contact_uuid, t.totals
      FROM j
      LEFT JOIN contacts c ON c.org_id = ${orgId} AND c.id = j.contact_id
      LEFT JOIN totals t ON t.key = j.key
      ${outer.length ? sql`WHERE ${sql.join(outer, sql` AND `)}` : sql``}
      ORDER BY j.activity_us DESC, j.key, coalesce(j.profile_id, 0)
      ${f.limit !== undefined ? sql`LIMIT ${f.limit + 1}` : sql``}`);
    return (res.rows as unknown as BuyerRaw[]).map(toBuyer);
  }

  /** The normalised phone of a saved profile (its key in the list), or undefined when the uuid is not one of this workspace's. */
  async keyOfProfile(
    tx: Tx,
    orgId: number,
    uuid: string,
    ccDigits: string,
  ): Promise<string | undefined> {
    const res = await tx.execute(sql`
      SELECT ${phoneKeySql(sql`p.phone`, ccDigits)} AS key FROM wa_customer_profiles p
      WHERE p.org_id = ${orgId} AND p.uuid = ${uuid}::uuid`);
    return (res.rows[0] as { key: string } | undefined)?.key;
  }

  /** The saved profile of a normalised phone (the one saved as exactly that number first), locked when asked. */
  async findProfileByKey(
    tx: Tx,
    orgId: number,
    key: string,
    ccDigits: string,
    opts: { lock?: boolean } = {},
  ): Promise<CustomerRow | undefined> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM ${FROM}
      WHERE p.org_id = ${orgId} AND ${phoneKeySql(sql`p.phone`, ccDigits)} = ${key}
      ORDER BY (p.phone = ${key}) DESC, p.id
      LIMIT 1
      ${opts.lock ? sql`FOR UPDATE OF p` : sql``}`);
    const r = res.rows[0] as unknown as Raw | undefined;
    return r ? toRow(r) : undefined;
  }

  async findByUuid(
    tx: Tx,
    orgId: number,
    uuid: string,
    opts: { lock?: boolean } = {},
  ): Promise<CustomerRow | undefined> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM ${FROM}
      WHERE p.org_id = ${orgId} AND p.uuid = ${uuid}::uuid
      ${opts.lock ? sql`FOR UPDATE OF p` : sql``}`);
    const r = res.rows[0] as unknown as Raw | undefined;
    return r ? toRow(r) : undefined;
  }

  /** Reference `updateOrCreate` keyed by phone; every submitted field replaces the stored one (blank becomes null). */
  async upsert(
    tx: Tx,
    orgId: number,
    v: { phone: string; name: string | null; company: string | null; address: string | null },
  ): Promise<{ id: number; uuid: string; created: boolean }> {
    const res = await tx.execute(sql`
      INSERT INTO wa_customer_profiles (org_id, phone, name, company, address)
      VALUES (${orgId}, ${v.phone}, ${v.name}, ${v.company}, ${v.address})
      ON CONFLICT (org_id, phone) DO UPDATE
        SET name = EXCLUDED.name, company = EXCLUDED.company, address = EXCLUDED.address
      RETURNING id, uuid, (xmax = 0) AS created`);
    const r = res.rows[0] as { id: number | string; uuid: string; created: boolean };
    return { id: Number(r.id), uuid: r.uuid, created: r.created };
  }

  async update(
    tx: Tx,
    orgId: number,
    id: number,
    v: { name: string | null; company: string | null; address: string | null },
    expectedVersion: number,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE wa_customer_profiles SET name = ${v.name}, company = ${v.company}, address = ${v.address}
      WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${expectedVersion}
      RETURNING id`);
    return res.rows.length === 1;
  }

  async delete(tx: Tx, orgId: number, uuid: string): Promise<{ id: number } | undefined> {
    const res = await tx.execute(
      sql`DELETE FROM wa_customer_profiles WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid RETURNING id`,
    );
    const r = res.rows[0] as { id: number | string } | undefined;
    return r ? { id: Number(r.id) } : undefined;
  }

  /** The latest orders of one buyer (normalised phone), newest first. */
  async recentOrders(tx: Tx, orgId: number, key: string, ccDigits: string, limit: number) {
    const res = await tx.execute(sql`
      SELECT o.id, o.uuid, o.status, o.total_minor, o.currency_code, o.created_at
      FROM wa_orders o
      WHERE o.org_id = ${orgId} AND ${phoneKeySql(sql`o.customer_phone`, ccDigits)} = ${key}
      ORDER BY o.created_at DESC, o.id DESC
      LIMIT ${limit}`);
    return (
      res.rows as unknown as Array<{
        id: number | string;
        uuid: string;
        status: string;
        total_minor: number | string;
        currency_code: string;
        created_at: Date | string;
      }>
    ).map((r) => ({
      id: r.uuid,
      orderNo: Number(r.id),
      status: r.status,
      totalMinor: Number(r.total_minor),
      currencyCode: r.currency_code,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }
}
