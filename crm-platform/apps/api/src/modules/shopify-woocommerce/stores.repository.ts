import type { TokenColumns } from '../../common/crypto/secret-columns';
import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { StoreKind } from './mirror-rules';

/** The two store tables, always inside the caller's tenant transaction (RLS scopes every statement). */

interface Sync {
  productsSyncedAt: Date | null;
  ordersSyncedAt: Date | null;
  customersSyncedAt: Date | null;
  syncStats: Record<string, number> | null;
}

export interface ShopifyRow extends Sync {
  id: number;
  uuid: string;
  userId: number | null;
  storeUrl: string;
  storeName: string | null;
  shopId: string | null;
  shopEmail: string | null;
  shopOwner: string | null;
  shopPlan: string | null;
  shopCurrency: string | null;
  shopCountry: string | null;
  /** Encrypted; an empty string once the app is uninstalled. */
  accessToken: string;
  scopes: string | null;
  status: string;
  /** Legacy plaintext; NULL once the audit backfill has run. Read `webhookSecretEnc` first (encryption audit E2). */
  webhookSecret: string | null;
  webhookSecretEnc: string | null;
  metadata: unknown;
  lastVerifiedAt: Date | null;
  connectedAt: Date | null;
  createdAt: Date;
  rowVersion: number;
}

export interface WooRow extends Sync {
  id: number;
  uuid: string;
  userId: number | null;
  storeUrl: string;
  storeName: string | null;
  storeCurrency: string | null;
  storeCountry: string | null;
  storeVersion: string | null;
  /** Encrypted. */
  consumerKey: string;
  /** Encrypted. */
  consumerSecret: string;
  status: string;
  /** Legacy plaintext; NULL once the audit backfill has run. Read `webhookSecretEnc` first (encryption audit E2). */
  webhookSecret: string | null;
  webhookSecretEnc: string | null;
  metadata: unknown;
  lastVerifiedAt: Date | null;
  connectedAt: Date | null;
  createdAt: Date;
  rowVersion: number;
}

type Raw = Record<string, unknown>;
const d = (v: unknown): Date | null =>
  v === null || v === undefined ? null : new Date(v as string);
const s = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const stats = (v: unknown): Record<string, number> | null => {
  if (typeof v !== 'object' || v === null) return null;
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(v)) if (typeof n === 'number') out[k] = n;
  return out;
};

const syncOf = (r: Raw): Sync => ({
  productsSyncedAt: d(r.products_synced_at),
  ordersSyncedAt: d(r.orders_synced_at),
  customersSyncedAt: d(r.customers_synced_at),
  syncStats: stats(r.sync_stats),
});

const toShopify = (r: Raw): ShopifyRow => ({
  ...syncOf(r),
  id: Number(r.id),
  uuid: r.uuid as string,
  userId: r.user_id === null ? null : Number(r.user_id),
  storeUrl: r.store_url as string,
  storeName: s(r.store_name),
  shopId: s(r.shop_id),
  shopEmail: s(r.shop_email),
  shopOwner: s(r.shop_owner),
  shopPlan: s(r.shop_plan),
  shopCurrency: s(r.shop_currency),
  shopCountry: s(r.shop_country),
  accessToken: (r.access_token as string | null) ?? '',
  scopes: s(r.scopes),
  status: r.status as string,
  webhookSecret: (r.webhook_secret as string | null) ?? null,
  webhookSecretEnc: (r.webhook_secret_enc as string | null) ?? null,
  metadata: r.metadata,
  lastVerifiedAt: d(r.last_verified_at),
  connectedAt: d(r.connected_at),
  createdAt: new Date(r.created_at as string),
  rowVersion: Number(r.row_version),
});

const toWoo = (r: Raw): WooRow => ({
  ...syncOf(r),
  id: Number(r.id),
  uuid: r.uuid as string,
  userId: r.user_id === null ? null : Number(r.user_id),
  storeUrl: r.store_url as string,
  storeName: s(r.store_name),
  storeCurrency: s(r.store_currency),
  storeCountry: s(r.store_country),
  storeVersion: s(r.store_version),
  consumerKey: r.consumer_key as string,
  consumerSecret: r.consumer_secret as string,
  status: r.status as string,
  webhookSecret: (r.webhook_secret as string | null) ?? null,
  webhookSecretEnc: (r.webhook_secret_enc as string | null) ?? null,
  metadata: r.metadata,
  lastVerifiedAt: d(r.last_verified_at),
  connectedAt: d(r.connected_at),
  createdAt: new Date(r.created_at as string),
  rowVersion: Number(r.row_version),
});

export interface ShopifyValues {
  userId: number | null;
  storeUrl: string;
  storeName: string | null;
  shopId: string | null;
  shopEmail: string | null;
  shopOwner: string | null;
  shopPlan: string | null;
  shopCurrency: string | null;
  shopCountry: string | null;
  /** Already encrypted. */
  accessToken: string;
  scopes: string;
  webhookSecret: TokenColumns;
}

export interface WooValues {
  userId: number | null;
  storeUrl: string;
  storeName: string | null;
  storeCurrency: string | null;
  storeCountry: string | null;
  storeVersion: string | null;
  /** Already encrypted. */
  consumerKey: string;
  /** Already encrypted. */
  consumerSecret: string;
  webhookSecret: TokenColumns;
}

@Injectable()
export class StoresRepository {
  // ── Shopify ─────────────────────────────────────────────────────────────

  async latestShopify(tx: Tx, orgId: number): Promise<ShopifyRow | undefined> {
    const res = await tx.execute(
      sql`SELECT * FROM shopify_integrations WHERE org_id = ${orgId} ORDER BY id DESC LIMIT 1`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r ? toShopify(r) : undefined;
  }

  async shopifyByUuid(tx: Tx, orgId: number, uuid: string): Promise<ShopifyRow | undefined> {
    const res = await tx.execute(
      sql`SELECT * FROM shopify_integrations WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid FOR UPDATE`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r ? toShopify(r) : undefined;
  }

  async shopifyByStoreUrl(
    tx: Tx,
    orgId: number,
    storeUrl: string,
  ): Promise<ShopifyRow | undefined> {
    const res = await tx.execute(
      sql`SELECT * FROM shopify_integrations WHERE org_id = ${orgId} AND store_url = ${storeUrl}`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r ? toShopify(r) : undefined;
  }

  /**
   * One row per (organization, store): connecting the same store again updates it and keeps its uuid, event mapping and logs, but
   * issues a NEW webhook secret (so the subscriptions made with the old one are torn down first) and a fresh token.
   */
  async upsertShopify(
    tx: Tx,
    orgId: number,
    v: ShopifyValues,
  ): Promise<{ row: ShopifyRow; created: boolean }> {
    const res = await tx.execute(sql`
      INSERT INTO shopify_integrations (org_id, user_id, store_url, store_name, shop_id, shop_email, shop_owner, shop_plan,
                                        shop_currency, shop_country, access_token, scopes, status, webhook_secret,
                                        webhook_secret_hash, webhook_secret_enc,
                                        last_verified_at, connected_at)
      VALUES (${orgId}, ${v.userId}, ${v.storeUrl}, ${v.storeName}, ${v.shopId}, ${v.shopEmail}, ${v.shopOwner}, ${v.shopPlan},
              ${v.shopCurrency}, ${v.shopCountry}, ${v.accessToken}, ${v.scopes}, 'active', ${v.webhookSecret.plain},
              ${v.webhookSecret.hash}, ${v.webhookSecret.enc}, now(), now())
      ON CONFLICT (org_id, store_url) DO UPDATE SET
        user_id = EXCLUDED.user_id, store_name = EXCLUDED.store_name, shop_id = EXCLUDED.shop_id,
        shop_email = EXCLUDED.shop_email, shop_owner = EXCLUDED.shop_owner, shop_plan = EXCLUDED.shop_plan,
        shop_currency = EXCLUDED.shop_currency, shop_country = EXCLUDED.shop_country, access_token = EXCLUDED.access_token,
        scopes = EXCLUDED.scopes, status = 'active', webhook_secret = EXCLUDED.webhook_secret,
        webhook_secret_hash = EXCLUDED.webhook_secret_hash, webhook_secret_enc = EXCLUDED.webhook_secret_enc, last_verified_at = now(),
        connected_at = now()
      RETURNING *, (xmax = 0) AS inserted`);
    const raw = res.rows[0] as Raw & { inserted: boolean };
    return { row: toShopify(raw), created: raw.inserted };
  }

  async setShopifyHooks(
    tx: Tx,
    orgId: number,
    id: number,
    ids: Record<string, string>,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE shopify_integrations
      SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('webhook_ids', ${JSON.stringify(ids)}::jsonb)
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** The merchant removed the app: the revoked token and the connected time are cleared; the row, mapping and logs stay visible. */
  async markShopifyUninstalled(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(
      sql`UPDATE shopify_integrations SET access_token = '', connected_at = NULL WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  async removeShopify(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(sql`DELETE FROM shopify_integrations WHERE org_id = ${orgId} AND id = ${id}`);
  }

  // ── WooCommerce ─────────────────────────────────────────────────────────

  async latestWoo(tx: Tx, orgId: number): Promise<WooRow | undefined> {
    const res = await tx.execute(
      sql`SELECT * FROM woocommerce_integrations WHERE org_id = ${orgId} ORDER BY id DESC LIMIT 1`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r ? toWoo(r) : undefined;
  }

  async wooByUuid(tx: Tx, orgId: number, uuid: string): Promise<WooRow | undefined> {
    const res = await tx.execute(
      sql`SELECT * FROM woocommerce_integrations WHERE org_id = ${orgId} AND uuid = ${uuid}::uuid FOR UPDATE`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r ? toWoo(r) : undefined;
  }

  async wooByStoreUrl(tx: Tx, orgId: number, storeUrl: string): Promise<WooRow | undefined> {
    const res = await tx.execute(
      sql`SELECT * FROM woocommerce_integrations WHERE org_id = ${orgId} AND store_url = ${storeUrl}`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r ? toWoo(r) : undefined;
  }

  async upsertWoo(tx: Tx, orgId: number, v: WooValues): Promise<{ row: WooRow; created: boolean }> {
    const res = await tx.execute(sql`
      INSERT INTO woocommerce_integrations (org_id, user_id, store_url, store_name, store_currency, store_country, store_version,
                                            consumer_key, consumer_secret, status, webhook_secret, webhook_secret_hash,
                                            webhook_secret_enc, last_verified_at, connected_at)
      VALUES (${orgId}, ${v.userId}, ${v.storeUrl}, ${v.storeName}, ${v.storeCurrency}, ${v.storeCountry}, ${v.storeVersion},
              ${v.consumerKey}, ${v.consumerSecret}, 'active', ${v.webhookSecret.plain},
              ${v.webhookSecret.hash}, ${v.webhookSecret.enc}, now(), now())
      ON CONFLICT (org_id, store_url) DO UPDATE SET
        user_id = EXCLUDED.user_id, store_name = EXCLUDED.store_name, store_currency = EXCLUDED.store_currency,
        store_country = EXCLUDED.store_country, store_version = EXCLUDED.store_version, consumer_key = EXCLUDED.consumer_key,
        consumer_secret = EXCLUDED.consumer_secret, status = 'active', webhook_secret = EXCLUDED.webhook_secret,
        webhook_secret_hash = EXCLUDED.webhook_secret_hash, webhook_secret_enc = EXCLUDED.webhook_secret_enc,
        last_verified_at = now(), connected_at = now()
      RETURNING *, (xmax = 0) AS inserted`);
    const raw = res.rows[0] as Raw & { inserted: boolean };
    return { row: toWoo(raw), created: raw.inserted };
  }

  async setWooHooks(tx: Tx, orgId: number, id: number, ids: Record<string, string>): Promise<void> {
    await tx.execute(sql`
      UPDATE woocommerce_integrations
      SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('webhook_ids', ${JSON.stringify(ids)}::jsonb)
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async removeWoo(tx: Tx, orgId: number, id: number): Promise<void> {
    await tx.execute(
      sql`DELETE FROM woocommerce_integrations WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  // ── Platform counts (across every organization: the operator's settings page) ─

  async counts(tx: Tx): Promise<{
    shopify: { integrations: number; events: number; logs: number };
    woocommerce: { integrations: number; events: number; logs: number };
  }> {
    const res = await tx.execute(sql`
      SELECT (SELECT count(*) FROM shopify_integrations)::int AS si,
             (SELECT count(*) FROM shopify_integration_events)::int AS se,
             (SELECT count(*) FROM shopify_integration_logs)::int AS sl,
             (SELECT count(*) FROM woocommerce_integrations)::int AS wi,
             (SELECT count(*) FROM woocommerce_integration_events)::int AS we,
             (SELECT count(*) FROM woocommerce_integration_logs)::int AS wl`);
    const r = res.rows[0] as Record<string, number>;
    return {
      shopify: { integrations: r.si!, events: r.se!, logs: r.sl! },
      woocommerce: { integrations: r.wi!, events: r.we!, logs: r.wl! },
    };
  }

  // ── Both stores ─────────────────────────────────────────────────────────

  /** Either kind's store by id. */
  async storeById(
    tx: Tx,
    orgId: number,
    kind: StoreKind,
    id: number,
  ): Promise<ShopifyRow | WooRow | undefined> {
    return kind === 'shopify' ? this.shopifyById(tx, orgId, id) : this.wooById(tx, orgId, id);
  }

  async shopifyById(tx: Tx, orgId: number, id: number): Promise<ShopifyRow | undefined> {
    const res = await tx.execute(
      sql`SELECT * FROM shopify_integrations WHERE org_id = ${orgId} AND id = ${id}`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r ? toShopify(r) : undefined;
  }

  async wooById(tx: Tx, orgId: number, id: number): Promise<WooRow | undefined> {
    const res = await tx.execute(
      sql`SELECT * FROM woocommerce_integrations WHERE org_id = ${orgId} AND id = ${id}`,
    );
    const r = res.rows[0] as Raw | undefined;
    return r ? toWoo(r) : undefined;
  }

  /** What an import brought in, per resource, and when. */
  async setSynced(
    tx: Tx,
    orgId: number,
    kind: 'shopify' | 'woocommerce',
    id: number,
    stats: Record<string, number>,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE ${sql.raw(TABLE[kind])}
      SET products_synced_at = now(), orders_synced_at = now(), customers_synced_at = now(),
          sync_stats = ${JSON.stringify(stats)}::jsonb
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async mergeMetadata(
    tx: Tx,
    orgId: number,
    kind: 'shopify' | 'woocommerce',
    id: number,
    patch: Record<string, unknown>,
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE ${sql.raw(TABLE[kind])}
      SET metadata = coalesce(metadata, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async setStatus(
    tx: Tx,
    orgId: number,
    kind: 'shopify' | 'woocommerce',
    id: number,
    status: string,
  ): Promise<void> {
    await tx.execute(
      sql`UPDATE ${sql.raw(TABLE[kind])} SET status = ${status} WHERE org_id = ${orgId} AND id = ${id}`,
    );
  }

  /** A fresh read of the store's facts: a field the store did not give keeps what is saved. The store is active and verified now. */
  async refreshShopify(
    tx: Tx,
    orgId: number,
    id: number,
    f: {
      name: string | null;
      email: string | null;
      owner: string | null;
      plan: string | null;
      currency: string | null;
      country: string | null;
    },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE shopify_integrations
      SET store_name = coalesce(${f.name}, store_name), shop_email = coalesce(${f.email}, shop_email),
          shop_owner = coalesce(${f.owner}, shop_owner), shop_plan = coalesce(${f.plan}, shop_plan),
          shop_currency = coalesce(${f.currency}, shop_currency), shop_country = coalesce(${f.country}, shop_country),
          status = 'active', last_verified_at = now()
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async refreshWoo(
    tx: Tx,
    orgId: number,
    id: number,
    f: {
      name: string | null;
      currency: string | null;
      country: string | null;
      version: string | null;
    },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE woocommerce_integrations
      SET store_name = coalesce(${f.name}, store_name), store_currency = coalesce(${f.currency}, store_currency),
          store_country = coalesce(${f.country}, store_country), store_version = coalesce(${f.version}, store_version),
          status = 'active', last_verified_at = now()
      WHERE org_id = ${orgId} AND id = ${id}`);
  }
}

const TABLE = { shopify: 'shopify_integrations', woocommerce: 'woocommerce_integrations' } as const;
