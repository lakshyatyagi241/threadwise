import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  ShopifyPlatformSettings,
  UpdateShopifySettingsInput,
  UpdateWoocommerceSettingsInput,
  WoocommercePlatformSettings,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import { DatabaseService } from '../../infra/db/database.service';
import type { ShopifySettings } from '../../infra/providers/ecom/ecom.port';
import { AuthAuditService, PlatformSettingsService } from '../auth';
import { DEFAULT_SCOPES } from './ecom-rules';
import { StoresRepository } from './stores.repository';

const SHOPIFY_DOC = 'ecom.shopify';
const SHOPIFY_SECRET = 'ecom.shopify.client_secret';
const WOO_DOC = 'ecom.woocommerce';

interface StoredShopify {
  enabled?: boolean;
  clientId?: string;
  scopes?: string;
  redirectUri?: string;
}

/**
 * The platform operator's switches (WD-ECOM-001, 002). Shopify needs the platform's own app (client id and secret); WooCommerce is
 * only a switch. The client secret is an encrypted platform secret: the screen learns only whether one is saved, a blank save keeps
 * it, and the services read it here, server side, to sign and check Shopify's calls.
 */
@Injectable()
export class EcomSettingsService {
  constructor(
    private readonly settings: PlatformSettingsService,
    private readonly db: DatabaseService,
    private readonly repo: StoresRepository,
    private readonly audit: AuthAuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private defaultRedirect(): string {
    return `${this.config.get('APP_URL', { infer: true }).replace(/\/+$/, '')}/v2/shopify/oauth/callback`;
  }

  /** What the Shopify connection needs, secret included. A switch that is off, or no client id, means "not configured". */
  async shopify(): Promise<ShopifySettings> {
    const s = (await this.settings.get<StoredShopify>(SHOPIFY_DOC)) ?? {};
    return {
      enabled: s.enabled === true,
      clientId: s.clientId ?? '',
      clientSecret: (await this.settings.getSecret(SHOPIFY_SECRET)) ?? '',
      scopes: s.scopes || DEFAULT_SCOPES,
      redirectUri: s.redirectUri || this.defaultRedirect(),
    };
  }

  async woocommerceEnabled(): Promise<boolean> {
    return ((await this.settings.get<{ enabled?: boolean }>(WOO_DOC)) ?? {}).enabled === true;
  }

  async shopifyPage(): Promise<ShopifyPlatformSettings> {
    const [s, hasSecret, c] = await Promise.all([
      this.shopify(),
      this.settings.hasSecret(SHOPIFY_SECRET),
      this.db.privileged((tx) => this.repo.counts(tx)),
    ]);
    return {
      enabled: s.enabled,
      clientId: s.clientId,
      hasSecret,
      scopes: s.scopes,
      redirectUri: s.redirectUri,
      integrationsCount: c.shopify.integrations,
      eventsCount: c.shopify.events,
      logsCount: c.shopify.logs,
    };
  }

  async updateShopify(input: UpdateShopifySettingsInput): Promise<ShopifyPlatformSettings> {
    const operatorId = this.operatorId();
    const partial: Record<string, unknown> = {};
    if (input.enabled !== undefined) partial.enabled = input.enabled;
    if (input.clientId !== undefined) partial.clientId = input.clientId;
    if (input.scopes !== undefined) partial.scopes = input.scopes || DEFAULT_SCOPES;
    if (input.redirectUri !== undefined) partial.redirectUri = input.redirectUri;
    if (Object.keys(partial).length > 0) {
      await this.settings.mergeDocument(SHOPIFY_DOC, partial, operatorId);
    }
    // A blank secret leaves the saved one alone: the field is masked, so an empty box means "unchanged".
    const secretChanged = Boolean(input.clientSecret);
    if (secretChanged)
      await this.settings.setSecret(SHOPIFY_SECRET, input.clientSecret!, operatorId);
    await this.settings.inTx((tx) =>
      this.audit.record(tx, {
        event: 'platform.ecom.shopify.update',
        status: 'success',
        actorType: 'platform_operator',
        actorId: operatorId,
        // Which fields changed, never their values.
        payload: { fields: Object.keys(partial), secretChanged },
      }),
    );
    return this.shopifyPage();
  }

  async woocommercePage(): Promise<WoocommercePlatformSettings> {
    const [enabled, c] = await Promise.all([
      this.woocommerceEnabled(),
      this.db.privileged((tx) => this.repo.counts(tx)),
    ]);
    return {
      enabled,
      integrationsCount: c.woocommerce.integrations,
      eventsCount: c.woocommerce.events,
      logsCount: c.woocommerce.logs,
    };
  }

  async updateWoocommerce(
    input: UpdateWoocommerceSettingsInput,
  ): Promise<WoocommercePlatformSettings> {
    const operatorId = this.operatorId();
    await this.settings.mergeDocument(WOO_DOC, { enabled: input.enabled }, operatorId);
    await this.settings.inTx((tx) =>
      this.audit.record(tx, {
        event: 'platform.ecom.woocommerce.update',
        status: 'success',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { enabled: input.enabled },
      }),
    );
    return this.woocommercePage();
  }

  private operatorId(): number {
    const id = RequestContextStore.require().actorId;
    if (!id) throw AppError.unauthenticated();
    return id;
  }
}
