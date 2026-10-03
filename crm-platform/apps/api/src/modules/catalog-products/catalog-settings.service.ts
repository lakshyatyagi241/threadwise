import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  CATALOG_DEFAULT_CURRENCY,
  CATALOG_GRAPH_VERSION_RE,
  type CatalogSettingsResponse,
  type UpdateCatalogSettingsInput,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { readCatalogEnv } from '../../config/domains/catalog-products.env';
import { DatabaseService } from '../../infra/db/database.service';
import type { CatalogRuntimeSettings } from '../../infra/providers/catalog-products/catalog-provider.port';
import { AuthAuditService, PlatformSettingsService } from '../auth';
import { NodeBridgeSettingsService } from '../node-bridge-runtime';

/** The catalog document in the platform store (WaDesk's `catalog_*` system settings, one versioned document). */
export const CATALOG_SETTINGS_KEY = 'cat.settings';
export const CATALOG_APP_SECRET_KEY = 'cat.settings.metaAppSecret';

interface Doc {
  catalogEnabled?: boolean;
  commerceEnabled?: boolean;
  graphApiVersion?: string;
  metaAppId?: string;
  defaultCurrency?: string;
  _rv?: number;
  _at?: string;
}

/**
 * The operator's catalog settings (WD-CAT-030) and what the adapters read at call time (WD-CAT-034).
 *
 * The Graph version is the only setting with a reader: the saved value wins, then `CAT_GRAPH_API_VERSION`, then `v23.0`. The
 * Node bridge address is not a catalog setting at all: WaDesk's `baileys_server_url` is the bridge page's own address, so it is
 * read from the Node bridge domain (saved address and token first, then `BAILEYS_SERVER_URL` / `BAILEYS_SERVER_TOKEN`).
 */
@Injectable()
export class CatalogSettingsService implements CatalogRuntimeSettings {
  constructor(
    private readonly store: PlatformSettingsService,
    private readonly audit: AuthAuditService,
    private readonly db: DatabaseService,
    private readonly bridge: NodeBridgeSettingsService,
  ) {}

  // --- what the adapters read -----------------------------------------------------------------

  async graphVersion(): Promise<string> {
    try {
      const saved = (await this.store.get<Doc>(CATALOG_SETTINGS_KEY))?.graphApiVersion?.trim();
      if (saved && CATALOG_GRAPH_VERSION_RE.test(saved)) return saved;
    } catch {
      // A settings outage must not stop a catalog call: fall through to the environment.
    }
    return readCatalogEnv().CAT_GRAPH_API_VERSION;
  }

  async bridgeTarget(): Promise<{ baseUrl: string; token: string | null }> {
    const env = readCatalogEnv();
    try {
      const saved = await this.bridge.target();
      return {
        baseUrl: saved.serverUrl || env.BAILEYS_SERVER_URL,
        token: saved.token ?? env.BAILEYS_SERVER_TOKEN ?? null,
      };
    } catch {
      return { baseUrl: env.BAILEYS_SERVER_URL, token: env.BAILEYS_SERVER_TOKEN ?? null };
    }
  }

  // --- the operator page ----------------------------------------------------------------------

  async read(): Promise<CatalogSettingsResponse> {
    // The page must see what a save elsewhere just wrote, or its next save carries a stale version.
    this.store.invalidate();
    const doc = await this.store.get<Doc>(CATALOG_SETTINGS_KEY);
    return {
      catalogEnabled: doc?.catalogEnabled ?? true,
      commerceEnabled: doc?.commerceEnabled ?? false,
      graphApiVersion: await this.graphVersion(),
      metaAppId: doc?.metaAppId ?? '',
      metaAppSecretSet: await this.store.hasSecret(CATALOG_APP_SECRET_KEY),
      defaultCurrency: doc?.defaultCurrency?.trim() || CATALOG_DEFAULT_CURRENCY,
      usage: await this.usage(),
      rowVersion: doc?._rv ?? 0,
    };
  }

  /** The three tiles. WaDesk queried tables that do not exist and always showed 0 for two of them; these are real counts. */
  private usage(): Promise<CatalogSettingsResponse['usage']> {
    return this.db.privileged(async (tx) => {
      const one = async (q: ReturnType<typeof sql>) =>
        Number(((await tx.execute(q)).rows[0] as { n: number | string }).n);
      return {
        workspacesConnected: await one(
          sql`SELECT count(DISTINCT org_id) AS n FROM wa_catalogs WHERE coalesce(catalog_id, '') <> ''`,
        ),
        productsSynced: await one(
          sql`SELECT count(*) AS n FROM wa_products WHERE meta_sync_status = 'synced'`,
        ),
        messagesSent: await one(
          sql`SELECT count(*) AS n FROM cat_catalog_sends WHERE status = 'sent'`,
        ),
      };
    });
  }

  async update(
    input: UpdateCatalogSettingsInput,
    operatorId: number,
  ): Promise<CatalogSettingsResponse> {
    await this.store.inTx(async (tx) => {
      // Lock the row for the whole transaction so two operators cannot both pass the version check.
      const found = await tx.execute(
        sql`SELECT value FROM platform_settings WHERE key = ${CATALOG_SETTINGS_KEY} FOR UPDATE`,
      );
      const current = (found.rows[0] as { value: Doc } | undefined)?.value;
      const version = current?._rv ?? 0;
      if (version !== input.rowVersion) throw AppError.rowVersionConflict('Catalog settings');

      // An unchecked toggle is saved false (WaDesk); here a field that is not sent keeps its value.
      const doc: Doc = {
        catalogEnabled: input.catalogEnabled ?? current?.catalogEnabled ?? true,
        commerceEnabled: input.commerceEnabled ?? current?.commerceEnabled ?? false,
        graphApiVersion:
          input.graphApiVersion !== undefined
            ? input.graphApiVersion
            : (current?.graphApiVersion ?? ''),
        metaAppId: input.metaAppId ?? current?.metaAppId ?? '',
        defaultCurrency: input.defaultCurrency ?? current?.defaultCurrency ?? '',
        _rv: version + 1,
        _at: new Date().toISOString(),
      };
      const json = JSON.stringify(doc);
      if (current) {
        await tx.execute(sql`
          UPDATE platform_settings
             SET value = ${json}::jsonb, updated_by = ${operatorId}, updated_at = now()
           WHERE key = ${CATALOG_SETTINGS_KEY}`);
      } else {
        const ins = await tx.execute(sql`
          INSERT INTO platform_settings (key, value, is_secret, updated_by, updated_at)
          VALUES (${CATALOG_SETTINGS_KEY}, ${json}::jsonb, false, ${operatorId}, now())
          ON CONFLICT (key) DO NOTHING
          RETURNING key`);
        // Another first save won the race between our read and this insert.
        if (ins.rows.length === 0) throw AppError.rowVersionConflict('Catalog settings');
      }

      // A blank secret keeps the stored one (WaDesk never lets the form clear it).
      const secret = input.metaAppSecret?.trim() ?? '';
      if (secret) {
        const sealed = JSON.stringify(this.store.seal(secret));
        await tx.execute(sql`
          INSERT INTO platform_settings (key, value, is_secret, updated_by, updated_at)
          VALUES (${CATALOG_APP_SECRET_KEY}, ${sealed}::jsonb, true, ${operatorId}, now())
          ON CONFLICT (key) DO UPDATE
            SET value = EXCLUDED.value, is_secret = true,
                updated_by = EXCLUDED.updated_by, updated_at = now()`);
      }

      await this.audit.record(tx, {
        event: 'platform.catalog_settings_updated',
        status: 'info',
        actorType: 'platform_operator',
        actorId: operatorId,
        // Field names only, never a value (WaDesk's `settings.catalog_update` carried the submitted field names).
        payload: {
          fields: [
            ...(input.catalogEnabled !== undefined ? ['catalogEnabled'] : []),
            ...(input.commerceEnabled !== undefined ? ['commerceEnabled'] : []),
            ...(input.graphApiVersion !== undefined ? ['graphApiVersion'] : []),
            ...(input.metaAppId !== undefined ? ['metaAppId'] : []),
            ...(secret ? ['metaAppSecret'] : []),
            ...(input.defaultCurrency !== undefined ? ['defaultCurrency'] : []),
          ],
          rowVersion: version + 1,
        },
      });
    });
    return this.read();
  }
}
