import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import {
  ERROR_CODES,
  type ConnectShopifyInput,
  type ShopifyConnectStart,
  type ShopifyOverview,
  type ShopifyStore,
} from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import { SHOP_DOMAIN, SHOPIFY, type ShopifyFactory } from '../../infra/providers/ecom/ecom.port';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { ECOM_PLAN_GATE, type EcomPlanGate } from './_shims/tokens';
import {
  SHOPIFY_WEBHOOK_TOPICS,
  authorizeUrl,
  newWebhookSecret,
  normalizeShop,
  readState,
  verifyOAuthHmac,
  webhookIdsOf,
  webhookUrl,
} from './ecom-rules';
import { EcomSettingsService } from './platform-settings.service';
import { StoresRepository, type ShopifyRow } from './stores.repository';

export const SHOPIFY_MODULE_KEY = 'shopify_integrations';

/** What the OAuth round trip leaves behind for the browser to show. */
export interface ConnectOutcome {
  ok: boolean;
  message: string;
}

const refuse = (code: keyof typeof ERROR_CODES, message: string) =>
  new AppError(ERROR_CODES[code], message, HttpStatus.UNPROCESSABLE_ENTITY);

const iso = (d: Date | null) => d?.toISOString() ?? null;

/**
 * Connecting a Shopify store (TW-ECOM-004 to 007, 013). The merchant approves the platform's app on their store; Shopify sends the
 * browser back with a signed code, which is exchanged for a permanent token (stored encrypted, never returned). Webhooks are then
 * registered at an address that carries a fresh secret.
 *
 * Differences from Reference that the port needs: there is no PHP session, so the OAuth `state` is a sealed, short-lived value that
 * names the organization, the user and the store (the same login-CSRF guard), and the callback is a public route that carries the
 * user in that state.
 */
@Injectable()
export class ShopifyService {
  private readonly logger = new Logger(ShopifyService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: StoresRepository,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly settings: EcomSettingsService,
    private readonly config: ConfigService<Env, true>,
    @Inject(SHOPIFY) private readonly shopify: ShopifyFactory,
    @Inject(ECOM_PLAN_GATE) private readonly plan: EcomPlanGate,
  ) {}

  private appUrl(): string {
    return this.config.get('APP_URL', { infer: true });
  }

  /** What the API shows of a store: never a token. */
  toStore(row: ShopifyRow): ShopifyStore {
    return {
      id: row.uuid,
      storeUrl: row.storeUrl,
      storeName: row.storeName,
      status: row.status,
      connected: row.accessToken !== '',
      connectedAt: iso(row.connectedAt),
      lastVerifiedAt: iso(row.lastVerifiedAt),
      productsSyncedAt: iso(row.productsSyncedAt),
      ordersSyncedAt: iso(row.ordersSyncedAt),
      customersSyncedAt: iso(row.customersSyncedAt),
      syncStats: row.syncStats,
      webhookUrl: webhookUrl(this.appUrl(), 'shopify', row.webhookSecret),
      webhookIds: webhookIdsOf(row.metadata),
      createdAt: row.createdAt.toISOString(),
      rowVersion: row.rowVersion,
      shopId: row.shopId,
      shopEmail: row.shopEmail,
      shopOwner: row.shopOwner,
      shopPlan: row.shopPlan,
      shopCurrency: row.shopCurrency,
      shopCountry: row.shopCountry,
      scopes: row.scopes,
    };
  }

  async overview(): Promise<ShopifyOverview> {
    const { orgId } = RequestContextStore.require();
    await this.plan.assertIntegration(orgId, 'shopify');
    const [s, row] = await Promise.all([
      this.settings.shopify(),
      this.db.tx((tx) => this.repo.latestShopify(tx, orgId)),
    ]);
    return {
      appEnabled: s.enabled && s.clientId !== '',
      scopes: s.scopes,
      eventTopics: [...SHOPIFY_WEBHOOK_TOPICS],
      store: row ? this.toStore(row) : null,
    };
  }

  /** The address the browser is sent to so the merchant can approve the app. */
  async start(input: ConnectShopifyInput): Promise<ShopifyConnectStart> {
    const ctx = RequestContextStore.require();
    await this.plan.assertIntegration(ctx.orgId, 'shopify');
    const shop = normalizeShop(input.shop);
    if (!SHOP_DOMAIN.test(shop)) {
      throw refuse(
        'ECOM_SHOP_INVALID',
        'Enter a valid Shopify domain like my-store.myshopify.com.',
      );
    }
    const s = await this.settings.shopify();
    if (!s.enabled || s.clientId === '') {
      throw refuse(
        'ECOM_NOT_CONFIGURED',
        'Shopify integration is not configured. Ask your admin to enable it.',
      );
    }
    const state = this.crypto.encrypt(
      JSON.stringify({
        orgId: ctx.orgId,
        userId: ctx.userId,
        shop,
        at: Date.now(),
        nonce: randomBytes(12).toString('hex'),
      }),
    );
    return {
      url: authorizeUrl({
        shop,
        clientId: s.clientId,
        scopes: s.scopes,
        redirectUri: s.redirectUri,
        state,
      }),
    };
  }

  private openState(sealed: string | undefined) {
    if (!sealed) return null;
    try {
      return readState(this.crypto.decrypt(sealed), Date.now());
    } catch {
      return null;
    }
  }

  /**
   * Where Shopify sends the browser back (TW-ECOM-006). Checked in Reference's order: the signature, the state, the store. Then the
   * code is exchanged, the store is saved (reconnecting the same store removes the subscriptions made with its old secret first),
   * its webhooks are registered, and the import is queued. A registration failure never blocks the connection.
   */
  async complete(query: Readonly<Record<string, string>>): Promise<ConnectOutcome> {
    const fail = (message: string): ConnectOutcome => ({ ok: false, message });
    const s = await this.settings.shopify();
    if (!verifyOAuthHmac(query, s.clientSecret))
      return fail('Invalid Shopify signature. Try again.');
    const state = this.openState(query.state);
    if (!state) return fail('Session expired. Please reconnect.');
    const shop = query.shop ?? '';
    if (shop === '' || shop !== state.shop) return fail('Shop mismatch during callback.');

    return RequestContextStore.run(
      {
        requestId: `shopify-connect-${state.nonce}`,
        orgId: state.orgId,
        actorType: 'user',
        actorId: state.userId,
        userId: state.userId,
      },
      async () => {
        try {
          await this.plan.assertIntegration(state.orgId, 'shopify');
          const ex = await this.shopify.app(s).exchangeCode(shop, (query.code ?? '').trim());
          if (!ex.ok) return fail(`OAuth failed: ${ex.error}`);

          const api = this.shopify.store(shop, ex.data.accessToken);
          const info = await api.shop();
          const d = info.ok ? info.data : null;

          const existing = await this.db.tx((tx) =>
            this.repo.shopifyByStoreUrl(tx, state.orgId, shop),
          );
          if (existing && existing.accessToken !== '') {
            // The new secret changes the delivery address, so the old subscriptions would deliver to a 404.
            await this.shopify
              .store(shop, this.crypto.decrypt(existing.accessToken))
              .deleteWebhooks(Object.values(webhookIdsOf(existing.metadata)))
              .catch(() => undefined);
          }

          const secret = newWebhookSecret();
          const saved = await this.db.tx(async (tx) => {
            const r = await this.repo.upsertShopify(tx, state.orgId, {
              userId: state.userId,
              storeUrl: shop,
              storeName: d?.name ?? shop,
              shopId: d?.id ?? null,
              shopEmail: d?.email ?? null,
              shopOwner: d?.owner ?? null,
              shopPlan: d?.plan ?? null,
              shopCurrency: d?.currency ?? null,
              shopCountry: d?.country ?? null,
              accessToken: this.crypto.encrypt(ex.data.accessToken),
              scopes: ex.data.scope,
              webhookSecret: secret,
            });
            await this.audit.record(tx, {
              module: SHOPIFY_MODULE_KEY,
              recordId: r.row.id,
              action: r.created ? 'insert' : 'update',
            });
            await this.outbox.emit(tx, {
              aggregateModule: SHOPIFY_MODULE_KEY,
              aggregateId: r.row.id,
              eventType: 'shopify.store.connected',
              payload: { uuid: r.row.uuid, storeUrl: shop, reconnected: !r.created },
            });
            return r;
          });

          const ids = await api.registerWebhooks(
            webhookUrl(this.appUrl(), 'shopify', secret),
            SHOPIFY_WEBHOOK_TOPICS,
          );
          await this.db.tx((tx) => this.repo.setShopifyHooks(tx, state.orgId, saved.row.id, ids));
          if (Object.keys(ids).length < SHOPIFY_WEBHOOK_TOPICS.length) {
            this.logger.warn(
              { orgId: state.orgId, registered: Object.keys(ids).length },
              'shopify: not every webhook was registered',
            );
          }
          return { ok: true, message: 'Shopify store connected.' };
        } catch (err) {
          if (err instanceof AppError) return fail(err.message);
          this.logger.error({ err }, 'shopify connect failed');
          return fail('Shopify connect failed. Please try again.');
        }
      },
    );
  }

  /** Disconnect: the store's webhooks are removed (errors ignored), then the row goes with its mapping and logs. */
  async disconnect(uuid: string): Promise<void> {
    const { orgId } = RequestContextStore.require();
    await this.plan.assertIntegration(orgId, 'shopify');
    const row = await this.db.tx((tx) => this.repo.shopifyByUuid(tx, orgId, uuid));
    if (!row) throw AppError.notFound('Shopify store', uuid);
    if (row.accessToken !== '') {
      await this.shopify
        .store(row.storeUrl, this.crypto.decrypt(row.accessToken))
        .deleteWebhooks(Object.values(webhookIdsOf(row.metadata)))
        .catch(() => undefined);
    }
    await this.db.tx(async (tx) => {
      await this.repo.removeShopify(tx, orgId, row.id);
      await this.audit.record(tx, {
        module: SHOPIFY_MODULE_KEY,
        recordId: row.id,
        action: 'delete',
      });
      await this.outbox.emit(tx, {
        aggregateModule: SHOPIFY_MODULE_KEY,
        aggregateId: row.id,
        eventType: 'shopify.store.disconnected',
        payload: { uuid: row.uuid, storeUrl: row.storeUrl },
      });
    });
  }
}
