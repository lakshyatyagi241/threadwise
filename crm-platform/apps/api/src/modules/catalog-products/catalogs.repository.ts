import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';

export interface CatalogRow {
  id: number;
  uuid: string;
  provider: 'meta_cloud' | 'dialog_360';
  catalogId: string;
  catalogName: string | null;
  wabaId: string | null;
  phoneNumberId: string | null;
  /** AES-GCM ciphertext; only the connection service decrypts it. */
  accessTokenEnc: string | null;
  isCartEnabled: boolean;
  isCatalogVisible: boolean;
  lastSyncedAt: Date | null;
  metaJson: unknown;
  createdAt: Date;
  rowVersion: number;
}

type Raw = Record<string, unknown>;
const s = (v: unknown): string | null => (v === null || v === undefined ? null : (v as string));

const toRow = (r: Raw): CatalogRow => ({
  id: Number(r.id),
  uuid: r.uuid as string,
  provider: r.provider as CatalogRow['provider'],
  catalogId: r.catalog_id as string,
  catalogName: s(r.catalog_name),
  wabaId: s(r.waba_id),
  phoneNumberId: s(r.phone_number_id),
  accessTokenEnc: s(r.access_token_enc),
  isCartEnabled: r.is_cart_enabled === true,
  isCatalogVisible: r.is_catalog_visible === true,
  lastSyncedAt: r.last_synced_at ? new Date(r.last_synced_at as string) : null,
  metaJson: r.meta_json ?? null,
  createdAt: new Date(r.created_at as string),
  rowVersion: Number(r.row_version),
});

const COLUMNS = sql`id, uuid, provider, catalog_id, catalog_name, waba_id, phone_number_id, access_token_enc,
  is_cart_enabled, is_catalog_visible, last_synced_at, meta_json, created_at, row_version`;

@Injectable()
export class CatalogsRepository {
  /** The workspace's catalog: WaDesk used `first()` everywhere, so with two providers the oldest row is the one in use. */
  async first(tx: Tx, orgId: number, forUpdate = false): Promise<CatalogRow | undefined> {
    const res = await tx.execute(sql`
      SELECT ${COLUMNS} FROM wa_catalogs WHERE org_id = ${orgId} ORDER BY id LIMIT 1
      ${forUpdate ? sql`FOR UPDATE` : sql``}`);
    const row = res.rows[0] as Raw | undefined;
    return row ? toRow(row) : undefined;
  }

  /**
   * Binds the workspace to a catalog: one row per provider, so re-connecting the same provider overwrites it. `meta_json` is
   * deliberately not in the update list: the automation switches survive a re-connect of the same provider.
   */
  async upsert(
    tx: Tx,
    orgId: number,
    v: {
      provider: string;
      catalogId: string;
      catalogName: string | null;
      wabaId: string | null;
      phoneNumberId: string | null;
      accessTokenEnc: string;
    },
  ): Promise<CatalogRow> {
    const res = await tx.execute(sql`
      INSERT INTO wa_catalogs (org_id, provider, catalog_id, catalog_name, waba_id, phone_number_id, access_token_enc,
                               is_cart_enabled, is_catalog_visible)
      VALUES (${orgId}, ${v.provider}, ${v.catalogId}, ${v.catalogName}, ${v.wabaId}, ${v.phoneNumberId},
              ${v.accessTokenEnc}, true, true)
      ON CONFLICT (org_id, provider) DO UPDATE SET
        catalog_id = EXCLUDED.catalog_id, catalog_name = EXCLUDED.catalog_name, waba_id = EXCLUDED.waba_id,
        phone_number_id = EXCLUDED.phone_number_id, access_token_enc = EXCLUDED.access_token_enc,
        is_cart_enabled = true, is_catalog_visible = true
      RETURNING ${COLUMNS}`);
    return toRow(res.rows[0] as Raw);
  }

  async deleteAll(tx: Tx, orgId: number): Promise<number> {
    const res = await tx.execute(sql`DELETE FROM wa_catalogs WHERE org_id = ${orgId} RETURNING id`);
    return res.rows.length;
  }

  async setCommerce(
    tx: Tx,
    orgId: number,
    id: number,
    v: { isCartEnabled: boolean; isCatalogVisible: boolean },
  ): Promise<void> {
    await tx.execute(sql`
      UPDATE wa_catalogs SET is_cart_enabled = ${v.isCartEnabled}, is_catalog_visible = ${v.isCatalogVisible}
      WHERE org_id = ${orgId} AND id = ${id}`);
  }

  async setMeta(tx: Tx, orgId: number, id: number, meta: Record<string, unknown>): Promise<void> {
    await tx.execute(sql`
      UPDATE wa_catalogs SET meta_json = ${JSON.stringify(meta)}::jsonb WHERE org_id = ${orgId} AND id = ${id}`);
  }

  /** The organizations that have a connected catalog, for the resync sweep. Privileged: it spans tenants. */
  async orgsWithCatalog(tx: Tx): Promise<number[]> {
    const res = await tx.execute(
      sql`SELECT DISTINCT org_id FROM wa_catalogs WHERE catalog_id <> '' ORDER BY org_id`,
    );
    return (res.rows as Raw[]).map((r) => Number(r.org_id));
  }
}
