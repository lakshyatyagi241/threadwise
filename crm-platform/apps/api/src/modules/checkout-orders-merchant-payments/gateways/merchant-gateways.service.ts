import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type SaveStoreGatewayInput,
  type StoreGateway,
  type StoreGatewayDriverListResponse,
  type StoreGatewayListResponse,
  type StoreGatewayTestResult,
  type StoreResolvedGateway,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { probeCredentials } from '../../../infra/providers/checkout-orders-merchant-payments/credential-probe';
import {
  GATEWAY_CATALOGUE,
  credentialFieldsFor,
  gatewayMeta,
  hasDriver,
  type HttpFetch,
} from '../../../infra/providers/platform-payment-gateways';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import {
  gatewayName,
  isConfigured,
  maskCredential,
  mergeCredentials,
  missingRequired,
  supportsPaymentLinks,
  webhookSecretMissing,
  type Credentials,
} from './gateway-rules';
import { MerchantGatewaysRepository, type GatewayRow } from './merchant-gateways.repository';
import { GATEWAY_HTTP, WorkspaceGatewayResolver } from './workspace-gateway.resolver';

export const GATEWAY_MODULE = 'wa_merchant_gateways';

const dup = (err: unknown): boolean => {
  let e = err as { code?: string; cause?: unknown } | null;
  for (let depth = 0; e && depth < 4; depth += 1) {
    if (e.code === '23505') return true;
    e = (e.cause as typeof e) ?? null;
  }
  return false;
};

/**
 * The Settings side of the shared workspace gateway: the driver catalogue, the saved gateways (workspace default and per-shop
 * overrides), save, test, enable, default and delete (Reference MerchantGatewaysController, extended with scope, default and test).
 *
 * Credentials are one AES-GCM envelope over the JSON map, decrypted only inside the resolver and here (to merge a partial save, to say
 * which fields hold a value, to probe the provider). They never appear in a response, a log line or an audit row; only the KEYS that
 * changed are audited.
 */
@Injectable()
export class MerchantGatewaysService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: MerchantGatewaysRepository,
    private readonly resolver: WorkspaceGatewayResolver,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    @Inject(GATEWAY_HTTP) private readonly http: HttpFetch,
  ) {}

  /** The catalogue: every gateway with the fields it needs. `available: false` means no driver in this build ("not available yet"). */
  drivers(): StoreGatewayDriverListResponse {
    const data = GATEWAY_CATALOGUE.map((g) => ({
      slug: g.slug as string,
      name: g.name,
      description: g.description,
      regions: [...g.regions] as string[],
      currencies: [...g.currencies],
      available: hasDriver(g.slug),
      supportsPaymentLinks: supportsPaymentLinks(g.slug),
      fields: g.fields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        required: !!f.required,
        hint: f.hint ?? null,
        options: f.options ?? null,
        webhook: !!f.webhook,
      })),
    }));
    return { data, page: { nextCursor: null, hasMore: false, limit: data.length } };
  }

  async list(storefrontUuid?: string): Promise<StoreGatewayListResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      let scope: number | undefined;
      if (storefrontUuid) scope = (await this.shopOrFail(tx, ctx.orgId, storefrontUuid)).id;
      const rows = await this.repo.list(tx, ctx.orgId, scope);
      const data = rows.map((r) => this.toResponse(r));
      return { data, page: { nextCursor: null, hasMore: false, limit: data.length } };
    });
  }

  async save(slugRaw: string, input: SaveStoreGatewayInput): Promise<StoreGateway> {
    const ctx = RequestContextStore.require();
    const slug = this.knownSlug(slugRaw);
    if (!hasDriver(slug)) {
      throw new AppError(
        ERROR_CODES.STORE_GATEWAY_UNAVAILABLE,
        `${gatewayName(slug)} is not available yet.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    return this.db.tx(async (tx) => {
      const scope = await this.scopeId(tx, ctx.orgId, input.storefrontId);
      const existing = await this.repo.find(tx, ctx.orgId, scope, slug, { lock: true });
      if (existing && input.rowVersion !== undefined && input.rowVersion !== existing.rowVersion) {
        throw AppError.rowVersionConflict('Gateway');
      }

      const merge = mergeCredentials(
        slug,
        existing ? this.resolver.credentialsOf(existing) : {},
        input.credentials,
        input.clear,
      );
      if (merge.unknown.length > 0) {
        throw AppError.validation(
          'Request payload failed validation',
          merge.unknown.map((k) => ({
            path: `credentials.${k}`,
            message: `${gatewayName(slug)} has no field "${k}"`,
          })),
        );
      }
      const envelope =
        Object.keys(merge.merged).length > 0
          ? this.crypto.encrypt(JSON.stringify(merge.merged))
          : null;

      let id: number;
      const delta: Record<string, { old: unknown; new: unknown }> = {
        credentialKeys: {
          old: null,
          new: { set: merge.keysSet, cleared: merge.keysCleared },
        },
      };
      if (existing) {
        id = existing.id;
        const mode = input.mode ?? existing.mode;
        const active = input.active ?? existing.active;
        // Saving here is what turns a row copied from a shop's own keys into a normal one: the keys are now in the envelope.
        const meta = existing.meta ? stripLegacy(existing.meta) : null;
        const ok = await this.repo.update(
          tx,
          ctx.orgId,
          id,
          {
            credentials: envelope,
            mode,
            active,
            sortOrder: input.sortOrder ?? existing.sortOrder,
            meta,
          },
          existing.rowVersion,
        );
        if (!ok) throw AppError.rowVersionConflict('Gateway');
        if (mode !== existing.mode) delta.mode = { old: existing.mode, new: mode };
        if (active !== existing.active) delta.active = { old: existing.active, new: active };
      } else {
        try {
          id = await tx.transaction((sp) =>
            this.repo.insert(sp, ctx.orgId, {
              storefrontId: scope,
              slug,
              credentials: envelope,
              mode: input.mode ?? 'live',
              active: input.active ?? true,
              sortOrder: input.sortOrder ?? 0,
            }),
          );
        } catch (err) {
          if (dup(err)) throw AppError.rowVersionConflict('Gateway');
          throw err;
        }
      }
      await this.audit.record(tx, {
        module: GATEWAY_MODULE,
        recordId: id,
        action: existing ? 'update' : 'insert',
        delta: { slug: { old: existing?.slug ?? null, new: slug }, ...delta },
      });
      await this.outbox.emit(tx, {
        aggregateModule: GATEWAY_MODULE,
        aggregateId: id,
        eventType: 'store.gateway_saved',
        payload: { slug, scope: scope === 0 ? 'workspace' : 'store', keysSet: merge.keysSet },
      });
      return this.toResponse((await this.repo.findById(tx, ctx.orgId, id))!);
    });
  }

  /** Reference `toggle`: flips active. Turning off the default also clears its flag so the next usable row takes over. */
  async toggle(slugRaw: string, storefrontUuid?: string): Promise<StoreGateway> {
    const ctx = RequestContextStore.require();
    const slug = this.knownSlug(slugRaw);
    return this.db.tx(async (tx) => {
      const row = await this.rowOrFail(tx, ctx.orgId, slug, storefrontUuid);
      const active = !row.active;
      await this.repo.setActive(tx, ctx.orgId, row.id, active);
      if (!active && row.isDefault) await this.repo.clearDefault(tx, ctx.orgId, row.id);
      await this.audit.record(tx, {
        module: GATEWAY_MODULE,
        recordId: row.id,
        action: 'update',
        delta: { active: { old: row.active, new: active } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: GATEWAY_MODULE,
        aggregateId: row.id,
        eventType: active ? 'store.gateway_enabled' : 'store.gateway_disabled',
        payload: { slug, scope: row.storefrontId === 0 ? 'workspace' : 'store' },
      });
      return this.toResponse((await this.repo.findById(tx, ctx.orgId, row.id))!);
    });
  }

  /** Makes a usable gateway the default of its scope (the workspace, or one shop). A half-configured one cannot be. */
  async setDefault(slugRaw: string, storefrontUuid?: string): Promise<StoreGateway> {
    const ctx = RequestContextStore.require();
    const slug = this.knownSlug(slugRaw);
    return this.db.tx(async (tx) => {
      const row = await this.rowOrFail(tx, ctx.orgId, slug, storefrontUuid);
      const creds = this.resolver.credentialsOf(row);
      const missing = missingRequired(slug, creds);
      if (!row.active || missing.length > 0 || !hasDriver(slug)) {
        throw new AppError(
          ERROR_CODES.STORE_GATEWAY_NOT_CONFIGURED,
          row.active
            ? `${gatewayName(slug)} is missing: ${missing.join(', ')}`
            : `${gatewayName(slug)} is switched off.`,
          HttpStatus.UNPROCESSABLE_ENTITY,
          missing.map((k) => ({ path: `credentials.${k}`, message: 'required' })),
        );
      }
      await this.repo.setDefault(tx, ctx.orgId, row.storefrontId, row.id);
      await this.audit.record(tx, {
        module: GATEWAY_MODULE,
        recordId: row.id,
        action: 'update',
        delta: { isDefault: { old: row.isDefault, new: true } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: GATEWAY_MODULE,
        aggregateId: row.id,
        eventType: 'store.gateway_default_set',
        payload: { slug, scope: row.storefrontId === 0 ? 'workspace' : 'store' },
      });
      return this.toResponse((await this.repo.findById(tx, ctx.orgId, row.id))!);
    });
  }

  async remove(slugRaw: string, storefrontUuid?: string): Promise<void> {
    const ctx = RequestContextStore.require();
    const slug = this.knownSlug(slugRaw);
    await this.db.tx(async (tx) => {
      const row = await this.rowOrFail(tx, ctx.orgId, slug, storefrontUuid);
      await this.repo.delete(tx, ctx.orgId, row.id);
      await this.audit.record(tx, {
        module: GATEWAY_MODULE,
        recordId: row.id,
        action: 'delete',
        delta: { slug: { old: slug, new: null } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: GATEWAY_MODULE,
        aggregateId: row.id,
        eventType: 'store.gateway_removed',
        payload: { slug, scope: row.storefrontId === 0 ? 'workspace' : 'store' },
      });
    });
  }

  /**
   * Checks the saved keys. Razorpay and Stripe answer an authenticated read, so their keys are really verified (`level: verified`);
   * every other gateway has no cheap, money-free auth call here, so only the required fields are checked (`level: fields`) and the
   * answer says so. The secret is only ever sent to the provider.
   */
  async test(slugRaw: string, storefrontUuid?: string): Promise<StoreGatewayTestResult> {
    const ctx = RequestContextStore.require();
    const slug = this.knownSlug(slugRaw);
    const { row, creds } = await this.db.tx(async (tx) => {
      const r = await this.rowOrFail(tx, ctx.orgId, slug, storefrontUuid);
      return { row: r, creds: this.resolver.credentialsOf(r) };
    });
    const missing = missingRequired(slug, creds);
    if (missing.length > 0) {
      return {
        ok: false,
        level: 'fields',
        message: `Missing: ${missing.join(', ')}`,
        missing,
      };
    }
    const probe = await probeCredentials(
      slug,
      creds,
      row.mode === 'test' ? 'test' : 'live',
      this.http,
    );
    if (!probe) {
      return {
        ok: true,
        level: 'fields',
        message: `${gatewayName(slug)}: every required field is filled. The keys are not checked with the provider until a payment is made.`,
        missing: [],
      };
    }
    if (probe.verdict === 'accepted') {
      return {
        ok: true,
        level: 'verified',
        message: `${gatewayName(slug)} accepted the keys.`,
        missing: [],
      };
    }
    return {
      ok: false,
      level: 'verified',
      message:
        probe.verdict === 'rejected'
          ? `${gatewayName(slug)} rejected the keys.`
          : `Could not reach ${gatewayName(slug)}. Try again.`,
      missing: [],
    };
  }

  /** What a checkout (with `storefrontId`) or an invoice (without) would use right now. No secret. */
  async resolved(storefrontUuid?: string): Promise<StoreResolvedGateway> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const scope = await this.scopeId(tx, ctx.orgId, storefrontUuid);
      const hit = await this.resolver.resolve(ctx.orgId, scope || null, { tx });
      if (!hit) return { resolved: null };
      const shop =
        hit.storefrontId > 0 ? await this.shopById(tx, ctx.orgId, hit.storefrontId) : null;
      return {
        resolved: {
          slug: hit.slug,
          name: hit.name,
          source: hit.source,
          mode: hit.mode,
          storefrontId: shop?.uuid ?? null,
          id: hit.gatewayUuid,
        },
      };
    });
  }

  // ---- internals -----------------------------------------------------------------------------------------------------

  private knownSlug(raw: string): string {
    const slug = raw
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '');
    if (!gatewayMeta(slug)) throw AppError.notFound('Gateway', slug);
    return slug;
  }

  private async shopOrFail(tx: Tx, orgId: number, uuid: string) {
    const shop = await this.repo.shopByUuid(tx, orgId, uuid);
    if (!shop) throw AppError.notFound('Shop', uuid);
    return shop;
  }

  private async shopById(tx: Tx, orgId: number, id: number) {
    return this.repo.shopById(tx, orgId, id);
  }

  /** 0 for the workspace, else the shop's internal id (404 for a shop of another workspace: RLS hides it). */
  private async scopeId(
    tx: Tx,
    orgId: number,
    storefrontUuid: string | null | undefined,
  ): Promise<number> {
    if (!storefrontUuid) return 0;
    return (await this.shopOrFail(tx, orgId, storefrontUuid)).id;
  }

  private async rowOrFail(
    tx: Tx,
    orgId: number,
    slug: string,
    storefrontUuid: string | undefined,
  ): Promise<GatewayRow> {
    const scope = await this.scopeId(tx, orgId, storefrontUuid);
    const row = await this.repo.find(tx, orgId, scope, slug, { lock: true });
    if (!row) throw AppError.notFound('Gateway', slug);
    return row;
  }

  toResponse(row: GatewayRow): StoreGateway {
    const creds: Credentials = this.resolver.credentialsOf(row);
    const fields = credentialFieldsFor(row.slug);
    return {
      id: row.uuid,
      slug: row.slug,
      name: gatewayName(row.slug),
      scope: row.storefrontId === 0 ? 'workspace' : 'store',
      storefrontId: row.storefrontUuid,
      storefrontName: row.storefrontName,
      mode: row.mode === 'test' ? 'test' : 'live',
      active: row.active,
      isDefault: row.isDefault,
      configured: isConfigured(row.slug, creds),
      credentials: fields.map((f) => ({
        key: f.key,
        hasValue: (creds[f.key] ?? '').trim() !== '',
        masked: maskCredential(creds[f.key]),
      })),
      webhookSecretMissing: webhookSecretMissing(row.slug, creds),
      webhookUrl: this.resolver.webhookUrl(row.uuid),
      migratedFromStorefront: row.meta?.migratedFromStorefront === true && !row.credentials,
      sortOrder: row.sortOrder,
      rowVersion: row.rowVersion,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

/** A row's `meta` without the markers of the data migration (the copied keys now live in the envelope). */
function stripLegacy(meta: Record<string, unknown>): Record<string, unknown> | null {
  const rest = { ...meta };
  delete rest.legacy;
  delete rest.migratedFromStorefront;
  return Object.keys(rest).length > 0 ? rest : null;
}
