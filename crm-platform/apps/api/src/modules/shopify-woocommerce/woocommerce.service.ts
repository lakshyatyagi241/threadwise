import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ERROR_CODES,
  type ConnectWoocommerceInput,
  type WoocommerceOverview,
  type SyncResult,
  type WoocommerceStore,
  type WoocommerceTestResult,
} from '@crm/contracts';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import { WOOCOMMERCE, type WooFactory } from '../../infra/providers/ecom/ecom.port';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { ECOM_PLAN_GATE, type EcomPlanGate } from './_shims/tokens';
import {
  WOO_WEBHOOK_TOPICS,
  newWebhookSecret,
  normalizeWooUrl,
  webhookIdsOf,
  webhookUrl,
} from './ecom-rules';
import { ImportService } from './import.service';
import { EcomSettingsService } from './platform-settings.service';
import { StoresRepository, type WooRow } from './stores.repository';

export const WOO_MODULE_KEY = 'woocommerce_integrations';

const refuse = (code: keyof typeof ERROR_CODES, message: string) =>
  new AppError(ERROR_CODES[code], message, HttpStatus.UNPROCESSABLE_ENTITY);

const iso = (d: Date | null) => d?.toISOString() ?? null;

/**
 * Connecting a WooCommerce store (WD-ECOM-025, 026). The merchant pastes a REST consumer key and secret; they are checked against
 * the live store, saved encrypted (never returned), and webhooks are registered at an address that carries a fresh secret.
 * Differences from WaDesk: the store address is checked against private and loopback ranges before any call.
 */
@Injectable()
export class WoocommerceService {
  private readonly logger = new Logger(WoocommerceService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: StoresRepository,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly settings: EcomSettingsService,
    private readonly imports: ImportService,
    private readonly config: ConfigService<Env, true>,
    @Inject(WOOCOMMERCE) private readonly woo: WooFactory,
    @Inject(ECOM_PLAN_GATE) private readonly plan: EcomPlanGate,
  ) {}

  private appUrl(): string {
    return this.config.get('APP_URL', { infer: true });
  }

  /** What the API shows of a store: never a key or a secret. */
  toStore(row: WooRow): WoocommerceStore {
    return {
      id: row.uuid,
      storeUrl: row.storeUrl,
      storeName: row.storeName,
      status: row.status,
      connected: row.consumerKey !== '' && row.consumerSecret !== '',
      connectedAt: iso(row.connectedAt),
      lastVerifiedAt: iso(row.lastVerifiedAt),
      productsSyncedAt: iso(row.productsSyncedAt),
      ordersSyncedAt: iso(row.ordersSyncedAt),
      customersSyncedAt: iso(row.customersSyncedAt),
      syncStats: row.syncStats,
      webhookUrl: webhookUrl(this.appUrl(), 'woocommerce', row.webhookSecret),
      webhookIds: webhookIdsOf(row.metadata),
      createdAt: row.createdAt.toISOString(),
      rowVersion: row.rowVersion,
      storeCurrency: row.storeCurrency,
      storeCountry: row.storeCountry,
      storeVersion: row.storeVersion,
    };
  }

  async overview(): Promise<WoocommerceOverview> {
    const { orgId } = RequestContextStore.require();
    await this.plan.assertIntegration(orgId, 'woocommerce');
    const [enabled, row] = await Promise.all([
      this.settings.woocommerceEnabled(),
      this.db.tx((tx) => this.repo.latestWoo(tx, orgId)),
    ]);
    return {
      appEnabled: enabled,
      eventTopics: [...WOO_WEBHOOK_TOPICS],
      store: row ? this.toStore(row) : null,
    };
  }

  /** A credential check that saves nothing: the form shows the answer inline, so a failure is a result, not an error. */
  async test(input: ConnectWoocommerceInput): Promise<WoocommerceTestResult> {
    const url = normalizeWooUrl(input.storeUrl);
    if (url === '') return { ok: false, message: 'Invalid URL.' };
    const r = await this.woo.store(url, input.consumerKey, input.consumerSecret).test();
    return r.ok
      ? { ok: true, message: `Connection verified. Store: ${r.data.name ?? url}` }
      : { ok: false, message: r.error || 'Connection failed.' };
  }

  /**
   * Verify against the live store, save, register webhooks. Reconnecting the same store keeps its mapping and logs but gets a new
   * webhook secret, so the old subscriptions are removed first (with the old key, which is still the store's way in). A webhook
   * failure never undoes the connection: the merchant can sync again.
   */
  async connect(input: ConnectWoocommerceInput): Promise<WoocommerceStore> {
    const ctx = RequestContextStore.require();
    await this.plan.assertIntegration(ctx.orgId, 'woocommerce');
    if (!(await this.settings.woocommerceEnabled())) {
      throw refuse('ECOM_DISABLED', 'WooCommerce is disabled. Ask an admin to enable it.');
    }
    const url = normalizeWooUrl(input.storeUrl);
    if (url === '') {
      throw refuse('ECOM_STORE_INVALID', 'Enter a valid store URL (e.g. https://your-store.com).');
    }

    const probe = await this.woo.store(url, input.consumerKey, input.consumerSecret).test();
    if (!probe.ok) {
      throw refuse(
        'ECOM_STORE_UNREACHABLE',
        `Could not reach WooCommerce: ${probe.error || 'unknown error'}`,
      );
    }

    const existing = await this.db.tx((tx) => this.repo.wooByStoreUrl(tx, ctx.orgId, url));
    if (existing && existing.consumerKey !== '') {
      await this.woo
        .store(
          url,
          this.crypto.decrypt(existing.consumerKey),
          this.crypto.decrypt(existing.consumerSecret),
        )
        .deleteWebhooks(Object.values(webhookIdsOf(existing.metadata)))
        .catch(() => undefined);
    }

    const secret = newWebhookSecret();
    const saved = await this.db.tx(async (tx) => {
      const r = await this.repo.upsertWoo(tx, ctx.orgId, {
        userId: ctx.userId,
        storeUrl: url,
        storeName: probe.data.name ?? new URL(url).hostname,
        storeCurrency: probe.data.currency,
        storeCountry: probe.data.country,
        storeVersion: probe.data.version,
        consumerKey: this.crypto.encrypt(input.consumerKey),
        consumerSecret: this.crypto.encrypt(input.consumerSecret),
        webhookSecret: secret,
      });
      await this.audit.record(tx, {
        module: WOO_MODULE_KEY,
        recordId: r.row.id,
        action: r.created ? 'insert' : 'update',
      });
      await this.outbox.emit(tx, {
        aggregateModule: WOO_MODULE_KEY,
        aggregateId: r.row.id,
        eventType: 'woocommerce.store.connected',
        payload: { uuid: r.row.uuid, storeUrl: url, reconnected: !r.created },
      });
      return r;
    });

    const appName = this.config.get('APP_NAME', { infer: true });
    const ids = await this.woo
      .store(url, input.consumerKey, input.consumerSecret)
      .registerWebhooks({
        deliveryUrl: webhookUrl(this.appUrl(), 'woocommerce', secret),
        secret,
        topics: WOO_WEBHOOK_TOPICS,
        nameOf: (topic) => `${appName} ${topic}`,
      });
    const row = await this.db.tx(async (tx) => {
      await this.repo.setWooHooks(tx, ctx.orgId, saved.row.id, ids);
      return (await this.repo.wooByStoreUrl(tx, ctx.orgId, url)) ?? saved.row;
    });
    // The first import runs in the background: the merchant lands on the store screen at once and it fills in.
    await this.imports
      .enqueue({ orgId: ctx.orgId, kind: 'woocommerce', id: saved.row.id })
      .catch((err: unknown) => this.logger.warn({ err }, 'woocommerce: import not queued'));
    if (Object.keys(ids).length < WOO_WEBHOOK_TOPICS.length) {
      this.logger.warn(
        { orgId: ctx.orgId, registered: Object.keys(ids).length },
        'woocommerce: not every webhook was registered',
      );
    }
    return this.toStore(row);
  }

  /** Disconnect: the store's webhooks are removed (errors ignored), then the row goes with its mapping and logs. */
  async disconnect(uuid: string): Promise<void> {
    const { orgId } = RequestContextStore.require();
    await this.plan.assertIntegration(orgId, 'woocommerce');
    const row = await this.db.tx((tx) => this.repo.wooByUuid(tx, orgId, uuid));
    if (!row) throw AppError.notFound('WooCommerce store', uuid);
    if (row.consumerKey !== '') {
      await this.woo
        .store(
          row.storeUrl,
          this.crypto.decrypt(row.consumerKey),
          this.crypto.decrypt(row.consumerSecret),
        )
        .deleteWebhooks(Object.values(webhookIdsOf(row.metadata)))
        .catch(() => undefined);
    }
    await this.db.tx(async (tx) => {
      await this.repo.removeWoo(tx, orgId, row.id);
      await this.audit.record(tx, { module: WOO_MODULE_KEY, recordId: row.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: WOO_MODULE_KEY,
        aggregateId: row.id,
        eventType: 'woocommerce.store.disconnected',
        payload: { uuid: row.uuid, storeUrl: row.storeUrl },
      });
    });
  }

  /** Sync now (WD-ECOM-013): the same as Shopify's. The store is verified with its keys, its facts refreshed and the import queued. */
  async sync(uuid: string): Promise<SyncResult> {
    const { orgId } = RequestContextStore.require();
    await this.plan.assertIntegration(orgId, 'woocommerce');
    const row = await this.db.tx((tx) => this.repo.wooByUuid(tx, orgId, uuid));
    if (!row) throw AppError.notFound('WooCommerce store', uuid);
    if (row.consumerKey === '') {
      return { ok: false, message: 'This store is no longer connected. Connect it again.' };
    }
    const api = this.woo.store(
      row.storeUrl,
      this.crypto.decrypt(row.consumerKey),
      this.crypto.decrypt(row.consumerSecret),
    );
    const probe = await api.test();
    if (!probe.ok) {
      await this.db.tx((tx) => this.repo.setStatus(tx, orgId, 'woocommerce', row.id, 'error'));
      return { ok: false, message: probe.error || 'Verify failed.' };
    }
    await this.db.tx((tx) => this.repo.refreshWoo(tx, orgId, row.id, probe.data));
    await this.imports.enqueue({ orgId, kind: 'woocommerce', id: row.id });
    return { ok: true, counts: await api.counts(), importQueued: true };
  }
}
