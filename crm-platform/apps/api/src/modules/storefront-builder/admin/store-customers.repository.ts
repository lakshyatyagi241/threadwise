import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import { AppError } from '../../../common/errors/app-error';
import { likePattern } from '../rules/coupon-admin';

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

/** What the orders of one phone add up to: every order counts, cancelled ones are left out of the money. */
export interface PhoneStats {
  orderCount: number;
  totals: Array<{ currencyCode: string; totalMinor: number; orders: number }>;
  lastOrderAt: Date | null;
}

/** Position in the list, which Reference orders by name (names first, unnamed last), then phone. */
export interface CustomerCursor {
  unnamed: boolean;
  name: string;
  phone: string;
  id: number;
}

export const encodeCustomerCursor = (c: CustomerCursor): string =>
  Buffer.from(JSON.stringify([c.unnamed, c.name, c.phone, c.id]), 'utf8').toString('base64url');

export function decodeCustomerCursor(raw: string): CustomerCursor {
  try {
    const [unnamed, name, phone, id] = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as [boolean, string, string, number];
    if (
      typeof unnamed !== 'boolean' ||
      typeof name !== 'string' ||
      typeof phone !== 'string' ||
      !Number.isSafeInteger(id)
    ) {
      throw new Error('malformed');
    }
    return { unnamed, name, phone, id };
  } catch {
    throw AppError.validation('Invalid pagination cursor');
  }
}

const DIGITS = sql`regexp_replace(coalesce(o.customer_phone, ''), '[^0-9]', '', 'g')`;

@Injectable()
export class StoreCustomersRepository {
  /** `limit + 1` rows ordered by name (unnamed last), phone, id. */
  async list(
    tx: Tx,
    orgId: number,
    q: { q?: string; limit: number; cursor?: string },
  ): Promise<CustomerRow[]> {
    const where: SQL[] = [sql`p.org_id = ${orgId}`];
    if (q.q) {
      const like = likePattern(q.q);
      where.push(sql`(p.name ILIKE ${like} OR p.phone ILIKE ${like} OR p.company ILIKE ${like})`);
    }
    if (q.cursor) {
      const c = decodeCustomerCursor(q.cursor);
      where.push(
        sql`((p.name IS NULL), coalesce(p.name, ''), p.phone, p.id) > (${c.unnamed}::boolean, ${c.name}::text, ${c.phone}::text, ${c.id}::bigint)`,
      );
    }
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM ${FROM}
      WHERE ${sql.join(where, sql` AND `)}
      ORDER BY (p.name IS NULL), coalesce(p.name, ''), p.phone, p.id
      LIMIT ${q.limit + 1}`);
    return (res.rows as unknown as Raw[]).map(toRow);
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

  async findByPhone(tx: Tx, orgId: number, digits: string): Promise<CustomerRow | undefined> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM ${FROM} WHERE p.org_id = ${orgId} AND p.phone = ${digits}`,
    );
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

  /** Order counts and totals per phone, for these phones (digits) only. Orders are matched on the digits of their phone. */
  async statsFor(
    tx: Tx,
    orgId: number,
    phones: readonly string[],
  ): Promise<Map<string, PhoneStats>> {
    const out = new Map<string, PhoneStats>();
    if (phones.length === 0) return out;
    const list = sql.join(
      phones.map((p) => sql`${p}`),
      sql`, `,
    );
    const res = await tx.execute(sql`
      SELECT ${DIGITS} AS digits, o.currency_code, count(*)::int AS orders,
             count(*) FILTER (WHERE o.status <> 'cancelled')::int AS counted,
             coalesce(sum(o.total_minor) FILTER (WHERE o.status <> 'cancelled'), 0)::bigint AS total,
             max(o.created_at) AS last_at
      FROM wa_orders o
      WHERE o.org_id = ${orgId} AND ${DIGITS} IN (${list})
      GROUP BY 1, 2
      ORDER BY 1, 2`);
    for (const r of res.rows as Array<{
      digits: string;
      currency_code: string;
      orders: number;
      counted: number;
      total: number | string;
      last_at: Date | string | null;
    }>) {
      const s = out.get(r.digits) ?? { orderCount: 0, totals: [], lastOrderAt: null };
      s.orderCount += r.orders;
      if (r.counted > 0) {
        s.totals.push({
          currencyCode: r.currency_code,
          totalMinor: Number(r.total),
          orders: r.counted,
        });
      }
      const last = r.last_at ? new Date(r.last_at) : null;
      if (last && (!s.lastOrderAt || last > s.lastOrderAt)) s.lastOrderAt = last;
      out.set(r.digits, s);
    }
    return out;
  }

  async recentOrders(tx: Tx, orgId: number, digits: string, limit: number) {
    const res = await tx.execute(sql`
      SELECT o.id, o.uuid, o.status, o.total_minor, o.currency_code, o.created_at
      FROM wa_orders o
      WHERE o.org_id = ${orgId} AND ${DIGITS} = ${digits}
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
