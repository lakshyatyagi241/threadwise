import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  type ShopifyEmbeddedConfig,
  type ShopifyEmbeddedSessionInput,
  type ShopifyEmbeddedStatus,
} from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { verifyShopifySessionToken } from './embedded-session';
import { EcomSettingsService } from './platform-settings.service';
import { StoresRepository, type ShopifyRow } from './stores.repository';

const NOT_CONNECTED = 'This store is not connected yet. Open the app to connect it.';

/**
 * The Shopify embedded app (TW-ECOM-038). Read-only: a valid App Bridge session token proves which shop is asking, and the answer is
 * that shop's connection status. It never signs anyone in, never returns the store's webhook address or any secret, and never
 * reveals which workspace holds the store (the store's own name and plan are what the merchant already sees in Shopify).
 */
@Injectable()
export class EmbeddedShopifyService {
  private readonly logger = new Logger(EmbeddedShopifyService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: StoresRepository,
    private readonly settings: EcomSettingsService,
  ) {}

  /** The app's public client id, so the page can load App Bridge. Null while the platform app is off. */
  async config(): Promise<ShopifyEmbeddedConfig> {
    const s = await this.settings.shopify();
    const on = s.enabled && s.clientId !== '';
    return { appEnabled: on, clientId: on ? s.clientId : null };
  }

  async session(input: ShopifyEmbeddedSessionInput): Promise<ShopifyEmbeddedStatus> {
    const s = await this.settings.shopify();
    if (!s.enabled || s.clientId === '') {
      throw new AppError(
        ERROR_CODES.ECOM_NOT_CONFIGURED,
        'Shopify integration is not configured. Ask your admin to enable it.',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    const verdict = verifyShopifySessionToken(input.sessionToken, {
      clientId: s.clientId,
      clientSecret: s.clientSecret,
      now: Date.now(),
      expectedShop: input.shop,
    });
    if (!verdict.ok) {
      // The reason is for the operator's log; the caller learns only that the token is not valid.
      this.logger.warn({ reason: verdict.reason }, 'shopify embedded: session token refused');
      throw new AppError(
        ERROR_CODES.ECOM_SESSION_TOKEN_INVALID,
        'The Shopify session is not valid. Reload the app from your Shopify admin.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    const shop = verdict.claims.shop;
    const row = await this.find(shop);
    if (!row) return { shop, connected: false, store: null, message: NOT_CONNECTED };
    const connected = row.accessToken !== '';
    return {
      shop,
      connected,
      store: {
        id: row.uuid,
        storeName: row.storeName,
        status: row.status,
        shopPlan: row.shopPlan,
        connectedAt: row.connectedAt?.toISOString() ?? null,
        lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
      },
      message: connected
        ? `${row.storeName ?? shop} is connected.`
        : 'The app was removed from this store. Open the app to connect it again.',
    };
  }

  /**
   * The row for a shop, across workspaces (a SECURITY DEFINER lookup names the candidates: no tenant exists yet). When more than
   * one workspace has the shop, the one connected most recently wins and a connected store beats a removed one.
   */
  private async find(shop: string): Promise<ShopifyRow | null> {
    const found = await this.db.primary.execute(sql`SELECT * FROM ecom_shop_lookup(${shop})`);
    const hits = found.rows as Array<{
      store_org_id: number | string;
      store_row_id: number | string;
    }>;
    const rows: ShopifyRow[] = [];
    for (const hit of hits) {
      const orgId = Number(hit.store_org_id);
      const row = await this.db.txAs({ orgId }, (tx) =>
        this.repo.shopifyById(tx, orgId, Number(hit.store_row_id)),
      );
      if (row) rows.push(row);
    }
    rows.sort(
      (a, b) =>
        Number(b.accessToken !== '') - Number(a.accessToken !== '') ||
        (b.connectedAt?.getTime() ?? 0) - (a.connectedAt?.getTime() ?? 0),
    );
    return rows[0] ?? null;
  }
}
