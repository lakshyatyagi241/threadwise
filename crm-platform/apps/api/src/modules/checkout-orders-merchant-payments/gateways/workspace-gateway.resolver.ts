import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { StoreGatewayMode, StoreGatewaySource } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { CryptoService } from '../../../common/crypto/crypto.service';
import type { Env } from '../../../config/env.schema';
import { DatabaseService } from '../../../infra/db/database.service';
import {
  createDriver,
  hasDriver,
  type HttpFetch,
  type PaymentDriver,
} from '../../../infra/providers/platform-payment-gateways';
import {
  chooseGateway,
  decodeLegacyRazorpay,
  gatewayName,
  isConfigured,
  toDriverMode,
  type Credentials,
  type GatewayCandidate,
  type LegacyRazorpayRaw,
} from './gateway-rules';
import { MerchantGatewaysRepository, type GatewayRow } from './merchant-gateways.repository';

/** The HTTP function every driver call goes through: a fixture in `STORE_PROVIDER_MODE=fixture`, `fetch` with a timeout otherwise. */
export const GATEWAY_HTTP = Symbol('CHK_GATEWAY_HTTP');

/** A gateway ready to use. `credentials` are decrypted: callers use them to build a driver or sign a call, never to return them. */
export interface ResolvedGateway {
  source: StoreGatewaySource;
  slug: string;
  name: string;
  mode: StoreGatewayMode;
  credentials: Credentials;
  /** Internal id of the shop the row belongs to; 0 for a workspace row; the shop asked about for the legacy keys. */
  storefrontId: number;
  /** The row's public id (it addresses the gateway's webhook); null for the legacy keys. */
  gatewayUuid: string | null;
}

export interface ResolveOptions {
  /** Narrow to one gateway (an operator picked it). */
  slug?: string;
  /** Run inside this transaction instead of opening one. */
  tx?: Tx;
}

interface Prepared extends GatewayCandidate {
  row: GatewayRow;
  credentials: Credentials;
}

/**
 * The one answer to "which payment gateway does this workspace use" (owner decision 2026-10-05: configure it once in Settings, with an
 * optional override per store). Used by the storefront checkout and by Sales invoices.
 *
 * Order: the shop's own override, the workspace default, the keys saved on the shop itself before the shared store existed
 * (`wa_storefronts.payment_config_json`), nothing. Within a scope: the row flagged default, else the lowest sort order. Only active
 * rows with every required field present count (a half-typed row never wins over a working one).
 */
@Injectable()
export class WorkspaceGatewayResolver {
  private readonly logger = new Logger(WorkspaceGatewayResolver.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MerchantGatewaysRepository,
    private readonly crypto: CryptoService,
    private readonly config: ConfigService<Env, true>,
    @Inject(GATEWAY_HTTP) private readonly http: HttpFetch,
  ) {}

  /** Decrypts a row's credentials. A blob that cannot be opened (key rotated away) reads as "no keys": fail closed, logged for the host. */
  credentialsOf(row: Pick<GatewayRow, 'credentials' | 'meta' | 'slug' | 'id'>): Credentials {
    if (row.credentials) {
      try {
        const parsed: unknown = JSON.parse(this.crypto.decrypt(row.credentials));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? (parsed as Credentials)
          : {};
      } catch {
        this.logger.error(
          { gateway: row.id, slug: row.slug },
          'could not decrypt gateway credentials',
        );
        return {};
      }
    }
    // A row copied from a shop's own keys by the data migration: the same per-field shape, until its first save here.
    const legacy = row.meta?.legacy;
    if (legacy && typeof legacy === 'object') {
      return decodeLegacyRazorpay(legacy as LegacyRazorpayRaw, (c) => this.crypto.decrypt(c));
    }
    return {};
  }

  /** The gateway a checkout (`storefrontId`) or an invoice (none) uses; null when nothing is configured. */
  async resolve(
    orgId: number,
    storefrontId?: number | null,
    opts: ResolveOptions = {},
  ): Promise<ResolvedGateway | null> {
    const run = (tx: Tx) => this.resolveIn(tx, orgId, storefrontId ?? null, opts.slug);
    return opts.tx ? run(opts.tx) : this.db.txAs({ orgId }, run);
  }

  /** Every gateway the shop can be paid with, one per slug, the winner of each (feeds the "Send checkout" picker). */
  async available(
    orgId: number,
    storefrontId?: number | null,
    opts: { tx?: Tx } = {},
  ): Promise<ResolvedGateway[]> {
    const run = async (tx: Tx): Promise<ResolvedGateway[]> => {
      const { prepared, legacy } = await this.load(tx, orgId, storefrontId ?? null);
      const slugs = [...new Set(prepared.map((p) => p.slug)), ...(legacy ? ['razorpay'] : [])];
      const out: ResolvedGateway[] = [];
      for (const slug of [...new Set(slugs)]) {
        const hit = this.choose(prepared, storefrontId ?? null, legacy, slug);
        if (hit) out.push(hit);
      }
      return out;
    };
    return opts.tx ? run(opts.tx) : this.db.txAs({ orgId }, run);
  }

  /** A driver built from a resolved gateway: the same adapters platform billing uses, with the merchant's keys. */
  driverFor(gateway: ResolvedGateway): PaymentDriver {
    if (!hasDriver(gateway.slug)) throw new Error(`no payment driver for "${gateway.slug}"`);
    return createDriver(gateway.slug, {
      credentials: gateway.credentials,
      mode: toDriverMode(gateway.mode),
      http: this.http,
      webhookUrl: gateway.gatewayUuid ? this.webhookUrl(gateway.gatewayUuid) : undefined,
    });
  }

  /** The address a provider posts notifications to; the row's uuid names the workspace and the shop, so the right secret is used. */
  webhookUrl(gatewayUuid: string): string {
    return `${this.config.get('APP_URL', { infer: true })}/v2/store-public/webhooks/gateway/${gatewayUuid}`;
  }

  // ---- internals -----------------------------------------------------------------------------------------------------

  private async resolveIn(
    tx: Tx,
    orgId: number,
    storefrontId: number | null,
    slug?: string,
  ): Promise<ResolvedGateway | null> {
    const { prepared, legacy } = await this.load(tx, orgId, storefrontId);
    return this.choose(prepared, storefrontId, legacy, slug);
  }

  private choose(
    prepared: Prepared[],
    storefrontId: number | null,
    legacy: { credentials: Credentials } | null,
    slug?: string,
  ): ResolvedGateway | null {
    const hit = chooseGateway(prepared, storefrontId, legacy ? { slug: 'razorpay' } : null, slug);
    if (!hit) return null;
    if (hit.source === 'legacy_storefront') {
      return {
        source: 'legacy_storefront',
        slug: 'razorpay',
        name: gatewayName('razorpay'),
        mode: 'live',
        credentials: legacy?.credentials ?? {},
        storefrontId: storefrontId ?? 0,
        gatewayUuid: null,
      };
    }
    const p = hit.row;
    return {
      source: hit.source,
      slug: p.slug,
      name: gatewayName(p.slug),
      mode: p.row.mode === 'test' ? 'test' : 'live',
      credentials: p.credentials,
      storefrontId: p.storefrontId,
      gatewayUuid: p.row.uuid,
    };
  }

  private async load(
    tx: Tx,
    orgId: number,
    storefrontId: number | null,
  ): Promise<{ prepared: Prepared[]; legacy: { credentials: Credentials } | null }> {
    const scope = storefrontId && storefrontId > 0 ? storefrontId : 0;
    const rows = await this.repo.list(tx, orgId, scope);
    const prepared = rows.map((row): Prepared => {
      const credentials = this.credentialsOf(row);
      return {
        id: row.id,
        storefrontId: row.storefrontId,
        slug: row.slug,
        active: row.active,
        isDefault: row.isDefault,
        sortOrder: row.sortOrder,
        configured: isConfigured(row.slug, credentials),
        row,
        credentials,
      };
    });
    let legacy: { credentials: Credentials } | null = null;
    if (scope > 0) {
      const shop = await this.repo.legacyShopPayment(tx, orgId, scope);
      if (shop?.paymentProvider === 'razorpay_api') {
        const credentials = decodeLegacyRazorpay(
          shop.paymentConfig as LegacyRazorpayRaw | null,
          (c) => this.crypto.decrypt(c),
        );
        if (isConfigured('razorpay', credentials)) legacy = { credentials };
      }
    }
    return { prepared, legacy };
  }
}
