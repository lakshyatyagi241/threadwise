import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { ShippingConfig } from '../rules/shipping';

/** `wa_storefronts` as the domain reads it. `deviceUuid` is the bound device's public id (the response never shows the bigint). */
export interface ShopRow {
  id: number;
  uuid: string;
  orgId: number;
  deviceId: number | null;
  deviceUuid: string | null;
  shopName: string | null;
  slug: string;
  customDomain: string | null;
  customDomainVerified: boolean;
  themeKey: string;
  enabled: boolean;
  settings: Record<string, unknown>;
  shipping: ShippingConfig | null;
  paymentProvider: string | null;
  paymentConfig: Record<string, unknown> | null;
  currencyCode: string;
  rowVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

interface RawShop {
  id: number | string;
  uuid: string;
  org_id: number | string;
  device_id: number | string | null;
  device_uuid: string | null;
  shop_name: string | null;
  slug: string;
  custom_domain: string | null;
  custom_domain_verified: boolean;
  theme_key: string;
  enabled: boolean;
  settings_json: Record<string, unknown> | null;
  shipping_json: ShippingConfig | null;
  payment_provider: string | null;
  payment_config_json: Record<string, unknown> | null;
  currency_code: string;
  row_version: number;
  created_at: Date | string;
  updated_at: Date | string;
}

const toRow = (r: RawShop): ShopRow => ({
  id: Number(r.id),
  uuid: r.uuid,
  orgId: Number(r.org_id),
  deviceId: r.device_id === null ? null : Number(r.device_id),
  deviceUuid: r.device_uuid,
  shopName: r.shop_name,
  slug: r.slug,
  customDomain: r.custom_domain,
  customDomainVerified: r.custom_domain_verified,
  themeKey: r.theme_key,
  enabled: r.enabled,
  settings: r.settings_json ?? {},
  shipping: r.shipping_json && Object.keys(r.shipping_json).length > 0 ? r.shipping_json : null,
  paymentProvider: r.payment_provider,
  paymentConfig: r.payment_config_json,
  currencyCode: r.currency_code,
  rowVersion: Number(r.row_version),
  createdAt: new Date(r.created_at),
  updatedAt: new Date(r.updated_at),
});

const SELECT = sql`
  SELECT s.id, s.uuid, s.org_id, s.device_id, d.uuid AS device_uuid, s.shop_name, s.slug, s.custom_domain,
         s.custom_domain_verified, s.theme_key, s.enabled, s.settings_json, s.shipping_json, s.payment_provider,
         s.payment_config_json, s.currency_code, s.row_version, s.created_at, s.updated_at
  FROM wa_storefronts s
  LEFT JOIN devices d ON d.org_id = s.org_id AND d.id = s.device_id`;

export interface ShopWrite {
  shopName?: string | null;
  slug?: string;
  deviceId?: number | null;
  customDomain?: string | null;
  customDomainVerified?: boolean;
  themeKey?: string;
  enabled?: boolean;
  settings?: Record<string, unknown>;
  shipping?: ShippingConfig | null;
  paymentProvider?: string | null;
  paymentConfig?: Record<string, unknown> | null;
  currencyCode?: string;
}

/** Data access for shops and their daily view counter. Hard deletes everywhere. */
@Injectable()
export class ShopsRepository {
  /** Newest-updated first: the dashboard's default shop and its switcher. */
  async listByUpdated(tx: Tx, orgId: number): Promise<ShopRow[]> {
    const res = await tx.execute(
      sql`${SELECT} WHERE s.org_id = ${orgId} ORDER BY s.updated_at DESC, s.id DESC`,
    );
    return (res.rows as unknown as RawShop[]).map(toRow);
  }

  /** Newest created first: the wizard's cards. */
  async listByNewest(tx: Tx, orgId: number): Promise<ShopRow[]> {
    const res = await tx.execute(sql`${SELECT} WHERE s.org_id = ${orgId} ORDER BY s.id DESC`);
    return (res.rows as unknown as RawShop[]).map(toRow);
  }

  async countByOrg(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(
      sql`SELECT count(*)::int AS n FROM wa_storefronts WHERE org_id = ${orgId}`,
    );
    return Number((res.rows[0] as { n: number | string }).n);
  }

  async findByUuid(tx: Tx, orgId: number, uuid: string): Promise<ShopRow | undefined> {
    const res = await tx.execute(
      sql`${SELECT} WHERE s.org_id = ${orgId} AND s.uuid = ${uuid}::uuid`,
    );
    const r = (res.rows as unknown as RawShop[])[0];
    return r ? toRow(r) : undefined;
  }

  async findById(tx: Tx, orgId: number, id: number): Promise<ShopRow | undefined> {
    const res = await tx.execute(sql`${SELECT} WHERE s.org_id = ${orgId} AND s.id = ${id}`);
    const r = (res.rows as unknown as RawShop[])[0];
    return r ? toRow(r) : undefined;
  }

  /**
   * Inserts a shop. A taken slug or custom domain surfaces as a Postgres 23505 for the caller to translate (the unique
   * indexes are global, across organizations, so no read of another tenant's rows is needed to decide).
   */
  async insert(
    tx: Tx,
    orgId: number,
    v: Required<Pick<ShopWrite, 'slug' | 'themeKey' | 'enabled'>> & ShopWrite,
  ): Promise<number> {
    const res = await tx.execute(sql`
      INSERT INTO wa_storefronts (org_id, device_id, shop_name, slug, custom_domain, custom_domain_verified, theme_key, enabled)
      VALUES (${orgId}, ${v.deviceId ?? null}, ${v.shopName ?? null}, ${v.slug}, ${v.customDomain ?? null},
              ${v.customDomainVerified ?? false}, ${v.themeKey}, ${v.enabled})
      RETURNING id`);
    return Number((res.rows[0] as { id: number | string }).id);
  }

  /**
   * Updates the given fields (an undefined key is left alone, null clears). With `expectedVersion` the update only lands when
   * nobody committed first; returns false when it did not.
   */
  async update(
    tx: Tx,
    orgId: number,
    id: number,
    v: ShopWrite,
    expectedVersion?: number,
  ): Promise<boolean> {
    const set: ReturnType<typeof sql>[] = [];
    const add = (col: string, val: unknown, json = false) =>
      set.push(
        json
          ? sql`${sql.raw(col)} = ${val === null ? null : JSON.stringify(val)}::jsonb`
          : sql`${sql.raw(col)} = ${val}`,
      );
    if (v.shopName !== undefined) add('shop_name', v.shopName);
    if (v.slug !== undefined) add('slug', v.slug);
    if (v.deviceId !== undefined) add('device_id', v.deviceId);
    if (v.customDomain !== undefined) add('custom_domain', v.customDomain);
    if (v.customDomainVerified !== undefined) add('custom_domain_verified', v.customDomainVerified);
    if (v.themeKey !== undefined) add('theme_key', v.themeKey);
    if (v.enabled !== undefined) add('enabled', v.enabled);
    if (v.settings !== undefined) add('settings_json', v.settings, true);
    if (v.shipping !== undefined) add('shipping_json', v.shipping, true);
    if (v.paymentProvider !== undefined) add('payment_provider', v.paymentProvider);
    if (v.paymentConfig !== undefined) add('payment_config_json', v.paymentConfig, true);
    if (v.currencyCode !== undefined) add('currency_code', v.currencyCode);
    // An empty patch still has to be a valid UPDATE: it just touches the row.
    if (set.length === 0) set.push(sql`updated_at = now()`);

    const res = await tx.execute(sql`
      UPDATE wa_storefronts SET ${sql.join(set, sql`, `)}
      WHERE org_id = ${orgId} AND id = ${id}
        ${expectedVersion === undefined ? sql`` : sql`AND row_version = ${expectedVersion}`}
      RETURNING id`);
    return res.rows.length > 0;
  }

  async deleteById(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM wa_storefronts WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async deleteAll(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(
      sql`DELETE FROM wa_storefronts WHERE org_id = ${orgId} RETURNING id`,
    );
    return res.rows.length;
  }

  /** The default-shop creation of two channels connecting together must not make two shops: serialise per organization. */
  async lockDefaultShop(tx: Tx, orgId: number): Promise<void> {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`store-default-shop:${orgId}`}, 0))`,
    );
  }

  async orgName(tx: Tx, orgId: number): Promise<string | null> {
    const res = await tx.execute(sql`SELECT name FROM organizations WHERE id = ${orgId}`);
    return (res.rows[0] as { name: string } | undefined)?.name ?? null;
  }

  // --- the daily view counter (WD-STORE-020) ---------------------------------------------------------------------

  /** One row per shop per day, `views + 1`. The day is the UTC date. */
  async bumpView(tx: Tx, orgId: number, storefrontId: number): Promise<void> {
    await tx.execute(sql`
      INSERT INTO wa_storefront_views (org_id, storefront_id, day, views)
      VALUES (${orgId}, ${storefrontId}, (now() AT TIME ZONE 'UTC')::date, 1)
      ON CONFLICT (org_id, storefront_id, day) DO UPDATE SET views = wa_storefront_views.views + 1`);
  }

  /** Visits of every shop of the organization since the calendar day `days` ago (inclusive). */
  async viewsSince(tx: Tx, orgId: number, days: number): Promise<number> {
    const res = await tx.execute(sql`
      SELECT coalesce(sum(views), 0)::bigint AS n FROM wa_storefront_views
      WHERE org_id = ${orgId} AND day >= (now() AT TIME ZONE 'UTC')::date - ${days}::int`);
    return Number((res.rows[0] as { n: number | string }).n);
  }
}
