import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

/** `wa_merchant_gateways` with the shop it belongs to (`storefrontId` 0 is the whole workspace). */
export interface GatewayRow {
  id: number;
  uuid: string;
  orgId: number;
  storefrontId: number;
  storefrontUuid: string | null;
  storefrontName: string | null;
  slug: string;
  /** One AES-GCM envelope over the JSON credential map; null for a row copied from a shop's own keys (see `meta.legacy`). */
  credentials: string | null;
  mode: string;
  active: boolean;
  isDefault: boolean;
  sortOrder: number;
  meta: Record<string, unknown> | null;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

interface Raw {
  id: number | string;
  uuid: string;
  org_id: number | string;
  storefront_id: number | string;
  storefront_uuid: string | null;
  storefront_name: string | null;
  slug: string;
  credentials: string | null;
  mode: string;
  active: boolean;
  is_default: boolean;
  sort_order: number;
  meta: Record<string, unknown> | null;
  row_version: number;
  created_at: Date | string;
  updated_at: Date | string;
}

const COLUMNS = sql`g.id, g.uuid, g.org_id, g.storefront_id, s.uuid AS storefront_uuid, s.shop_name AS storefront_name, g.slug,
  g.credentials, g.mode, g.active, g.is_default, g.sort_order, g.meta, g.row_version, g.created_at, g.updated_at`;
const FROM = sql`wa_merchant_gateways g
  LEFT JOIN wa_storefronts s ON s.org_id = g.org_id AND s.id = g.storefront_id`;

const toRow = (r: Raw): GatewayRow => ({
  id: Number(r.id),
  uuid: r.uuid,
  orgId: Number(r.org_id),
  storefrontId: Number(r.storefront_id),
  storefrontUuid: r.storefront_uuid,
  storefrontName: r.storefront_name,
  slug: r.slug,
  credentials: r.credentials,
  mode: r.mode,
  active: r.active,
  isDefault: r.is_default,
  sortOrder: Number(r.sort_order),
  meta: r.meta,
  rowVersion: Number(r.row_version),
  createdAt: new Date(r.created_at),
  updatedAt: new Date(r.updated_at),
});

export interface ShopRef {
  id: number;
  uuid: string;
  name: string | null;
}

/** The legacy home of a shop's Razorpay keys, read only to resolve and to copy. */
export interface LegacyShopPayment {
  paymentProvider: string | null;
  paymentConfig: Record<string, unknown> | null;
}

@Injectable()
export class MerchantGatewaysRepository {
  /** Rows of the workspace scope and, when given, of that shop. Every row of the organization when `scope` is `undefined`. */
  async list(tx: Tx, orgId: number, scope?: number): Promise<GatewayRow[]> {
    const where = scope === undefined ? sql`` : sql`AND g.storefront_id IN (0, ${scope})`;
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM ${FROM}
      WHERE g.org_id = ${orgId} ${where}
      ORDER BY g.storefront_id, g.sort_order, g.id`);
    return (res.rows as unknown as Raw[]).map(toRow);
  }

  async find(
    tx: Tx,
    orgId: number,
    storefrontId: number,
    slug: string,
    opts: { lock?: boolean } = {},
  ): Promise<GatewayRow | undefined> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM ${FROM}
      WHERE g.org_id = ${orgId} AND g.storefront_id = ${storefrontId} AND g.slug = ${slug}
      ${opts.lock ? sql`FOR UPDATE OF g` : sql``}`);
    const r = res.rows[0] as unknown as Raw | undefined;
    return r ? toRow(r) : undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<GatewayRow | undefined> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM ${FROM} WHERE g.org_id = ${orgId} AND g.id = ${id}`,
    );
    const r = res.rows[0] as unknown as Raw | undefined;
    return r ? toRow(r) : undefined;
  }

  async insert(
    tx: Tx,
    orgId: number,
    v: {
      storefrontId: number;
      slug: string;
      credentials: string | null;
      mode: string;
      active: boolean;
      sortOrder: number;
    },
  ): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO wa_merchant_gateways (org_id, storefront_id, slug, credentials, mode, active, sort_order)
      VALUES (${orgId}, ${v.storefrontId}, ${v.slug}, ${v.credentials}, ${v.mode}, ${v.active}, ${v.sortOrder})
      RETURNING id`);
    return Number((res.rows[0] as { id: number | string }).id);
  }

  /** Writes the editable columns of a row, guarded by the version the caller read; false when the row moved. */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    v: {
      credentials: string | null;
      mode: string;
      active: boolean;
      sortOrder: number;
      /** `null` drops the migration marker and the copied keys. */
      meta: Record<string, unknown> | null;
    },
    expectedVersion: number,
  ): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE wa_merchant_gateways
      SET credentials = ${v.credentials}, mode = ${v.mode}, active = ${v.active}, sort_order = ${v.sortOrder},
          meta = ${v.meta === null ? null : JSON.stringify(v.meta)}::jsonb
      WHERE org_id = ${orgId} AND id = ${id} AND row_version = ${expectedVersion}
      RETURNING id`);
    return res.rows.length === 1;
  }

  async setActive(tx: Tx, orgId: number, id: number, active: boolean): Promise<void> {
    await tx.execute(
      sql`UPDATE wa_merchant_gateways SET active = ${active} WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  /** Makes this row the default of its scope; the unique index allows one, so the others are cleared first. */
  async setDefault(tx: Tx, orgId: number, storefrontId: number, id: number): Promise<void> {
    await tx.execute(sql`
      UPDATE wa_merchant_gateways SET is_default = false
      WHERE org_id = ${orgId} AND storefront_id = ${storefrontId} AND is_default AND id <> ${id}`);
    await tx.execute(
      sql`UPDATE wa_merchant_gateways SET is_default = true WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  async clearDefault(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(
      sql`UPDATE wa_merchant_gateways SET is_default = false WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  async delete(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM wa_merchant_gateways WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async shopByUuid(tx: Tx, orgId: number, uuid: string): Promise<ShopRef | undefined> {
    const res = await tx.execute(
      sql`SELECT id, uuid, shop_name FROM wa_storefronts WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid`,
    );
    const r = res.rows[0] as
      { id: number | string; uuid: string; shop_name: string | null } | undefined;
    return r ? { id: Number(r.id), uuid: r.uuid, name: r.shop_name } : undefined;
  }

  async shopById(tx: Tx, orgId: number, id: number): Promise<ShopRef | undefined> {
    const res = await tx.execute(
      sql`SELECT id, uuid, shop_name FROM wa_storefronts WHERE org_id = ${orgId} AND id = ${id}`,
    );
    const r = res.rows[0] as
      { id: number | string; uuid: string; shop_name: string | null } | undefined;
    return r ? { id: Number(r.id), uuid: r.uuid, name: r.shop_name } : undefined;
  }

  async legacyShopPayment(
    tx: Tx,
    orgId: number,
    storefrontId: number,
  ): Promise<LegacyShopPayment | undefined> {
    const res = await tx.execute(sql`
      SELECT payment_provider, payment_config_json FROM wa_storefronts
      WHERE org_id = ${orgId} AND id = ${storefrontId}`);
    const r = res.rows[0] as
      | { payment_provider: string | null; payment_config_json: Record<string, unknown> | null }
      | undefined;
    return r
      ? { paymentProvider: r.payment_provider, paymentConfig: r.payment_config_json }
      : undefined;
  }
}
