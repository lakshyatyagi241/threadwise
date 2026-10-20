import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  type PaygwGatewayItem,
  type PaygwGatewayListResponse,
  type SetPaygwGatewayActiveRequest,
  type UpdatePaygwGatewayRequest,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { CryptoService } from '../../common/crypto/crypto.service';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import type { Env } from '../../config/env.schema';
import {
  GATEWAY_CATALOGUE,
  createDriver,
  credentialFieldsFor,
  gatewayMeta,
  hasDriver,
  defaultHttp,
  type HttpFetch,
  type PaymentDriver,
  type ProviderPlanCache,
  type ProviderPlanKey,
} from '../../infra/providers/platform-payment-gateways';
import { AuthAuditService } from '../auth';
import { mergeCredentials, missingRequired, type Credentials } from './gateway-rules';
import { PaygwStore } from './paygw.store';
import { cacheMetrics } from '@crm/observability';

const cache = cacheMetrics('gateway_plan');

export interface GatewayRow {
  id: string;
  uuid: string;
  slug: string;
  name: string;
  description: string | null;
  is_active: boolean;
  credentials: string | null;
  mode: 'sandbox' | 'live';
  supported_currencies: string[] | null;
  sort_order: number;
  row_version: number;
  updated_at: Date | string;
}

const COLUMNS = sql.raw(
  'id, uuid, slug, name, description, is_active, credentials, mode, supported_currencies, sort_order, row_version, updated_at',
);

/**
 * The operator's side of the gateways (TW-PAYGW-001..005) plus the read side the checkout needs. Credentials are one AES-GCM
 * envelope over the JSON map; they are decrypted only here, only to build a driver or to say which fields hold a value, and
 * they never appear in a response, a log line or an audit row (only the KEYS that changed do).
 */
@Injectable()
export class GatewayService {
  private readonly logger = new Logger(GatewayService.name);

  constructor(
    private readonly store: PaygwStore,
    private readonly crypto: CryptoService,
    private readonly audit: AuthAuditService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  // ---- credentials ---------------------------------------------------------------------------------------------------

  /** A blob that cannot be decrypted (key rotated) reads as "no keys saved", as in Reference, but is logged for the operator's host. */
  decryptCredentials(row: Pick<GatewayRow, 'credentials' | 'slug'>): Credentials {
    if (!row.credentials) return {};
    try {
      const parsed: unknown = JSON.parse(this.crypto.decrypt(row.credentials));
      return parsed && typeof parsed === 'object' ? (parsed as Credentials) : {};
    } catch {
      this.logger.error({ slug: row.slug }, 'could not decrypt gateway credentials');
      return {};
    }
  }

  /** A driver for one platform gateway row. The HTTP function is injectable for tests. */
  driverFor(row: GatewayRow, http: HttpFetch = defaultHttp): PaymentDriver {
    return createDriver(row.slug, {
      credentials: this.decryptCredentials(row),
      mode: row.mode,
      http,
      // Square signs the exact URL the provider calls; it is the same one the admin screen tells the operator to paste.
      webhookUrl: `${this.config.get('APP_URL', { infer: true })}/v2/payments/webhook/${row.slug}`,
      planCache: this.planCache(row.slug),
    });
  }

  /** The provider-plan cache of one gateway (`gateway_plan_cache`): a plan for the same account, price and cadence is made once. */
  private planCache(slug: string): ProviderPlanCache {
    const where = (k: ProviderPlanKey) => sql`gateway = ${slug} AND account_hash = ${k.account}
      AND currency = ${k.currency} AND amount_minor = ${k.amountMinor.toString()}::bigint
      AND interval_unit = ${k.unit} AND interval_count = ${k.count}`;
    return {
      find: (k) =>
        this.store.tx(async (tx) => {
          const res = await tx.execute(
            sql`SELECT gateway_plan_id FROM gateway_plan_cache WHERE ${where(k)}`,
          );
          const id =
            (res.rows[0] as { gateway_plan_id: string } | undefined)?.gateway_plan_id ?? null;
          if (id === null) cache.miss();
          else cache.hit();
          return id;
        }),
      save: (k, id) =>
        this.store.tx(async (tx) => {
          await tx.execute(sql`
            INSERT INTO gateway_plan_cache (gateway, account_hash, currency, amount_minor, interval_unit, interval_count, gateway_plan_id)
            VALUES (${slug}, ${k.account}, ${k.currency}, ${k.amountMinor.toString()}::bigint, ${k.unit}, ${k.count}, ${id})
            ON CONFLICT ON CONSTRAINT uq_gateway_plan_cache DO UPDATE SET gateway_plan_id = EXCLUDED.gateway_plan_id`);
        }),
    };
  }

  // ---- reads ---------------------------------------------------------------------------------------------------------

  /** Creates a row for every catalogue slug that has none (never touches an existing row), then reads them all. */
  private async ensureRows(tx: Tx): Promise<void> {
    const values = GATEWAY_CATALOGUE.map(
      (g) =>
        sql`(${g.slug}, ${g.name}, ${g.description}, ${g.sortOrder}, ${JSON.stringify(g.currencies)}::jsonb)`,
    );
    await tx.execute(sql`
      INSERT INTO payment_gateways (slug, name, description, sort_order, supported_currencies)
      VALUES ${sql.join(values, sql`, `)}
      ON CONFLICT (slug) DO NOTHING
    `);
    // A row created before the whitelist existed is back-filled, never overwritten.
    for (const g of GATEWAY_CATALOGUE) {
      await tx.execute(
        sql`UPDATE payment_gateways SET supported_currencies = ${JSON.stringify(g.currencies)}::jsonb WHERE slug = ${g.slug} AND supported_currencies IS NULL`,
      );
    }
  }

  private toItem(row: GatewayRow): PaygwGatewayItem {
    const meta = gatewayMeta(row.slug);
    const creds = this.decryptCredentials(row);
    const fields = credentialFieldsFor(row.slug).map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      required: !!f.required,
      hint: f.hint ?? null,
      options: f.options ?? null,
      hasValue: (creds[f.key] ?? '').trim() !== '',
    }));
    return {
      id: row.uuid,
      slug: row.slug,
      name: row.name,
      description: row.description ?? meta?.description ?? '',
      regions: meta?.regions ?? [],
      isActive: row.is_active,
      mode: row.mode,
      sortOrder: row.sort_order,
      supportedCurrencies: row.supported_currencies ?? [],
      fields,
      keysSaved: fields.some((f) => f.hasValue),
      driverAvailable: hasDriver(row.slug),
      webhookUrl: `${this.config.get('APP_URL', { infer: true })}/v2/payments/webhook/${row.slug}`,
      rowVersion: row.row_version,
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  async list(): Promise<PaygwGatewayListResponse> {
    const rows = await this.store.tx(async (tx) => {
      await this.ensureRows(tx);
      const res = await tx.execute(
        sql`SELECT ${COLUMNS} FROM payment_gateways ORDER BY sort_order, name`,
      );
      return res.rows as unknown as GatewayRow[];
    });
    const data = rows.map((r) => this.toItem(r));
    return {
      data,
      summary: {
        total: data.length,
        active: data.filter((g) => g.isActive).length,
        india: data.filter((g) => g.regions.includes('india')).length,
        crypto: data.filter((g) => g.regions.includes('crypto')).length,
      },
    };
  }

  /** Active gateways, in display order. Credentials are returned for server use only; callers map to public fields. */
  async activeRows(): Promise<GatewayRow[]> {
    return this.store.tx(async (tx) => {
      const res = await tx.execute(
        sql`SELECT ${COLUMNS} FROM payment_gateways WHERE is_active ORDER BY sort_order, id`,
      );
      return res.rows as unknown as GatewayRow[];
    });
  }

  async byUuid(uuid: string): Promise<GatewayRow | null> {
    return this.store.tx(async (tx) => {
      const res = await tx.execute(
        sql`SELECT ${COLUMNS} FROM payment_gateways WHERE uuid = ${uuid}`,
      );
      return (res.rows as unknown as GatewayRow[])[0] ?? null;
    });
  }

  /** Callbacks and webhooks resolve by slug whether or not the gateway is still active (an in-flight order must finish). */
  async bySlug(slug: string): Promise<GatewayRow | null> {
    return this.store.tx(async (tx) => {
      const res = await tx.execute(
        sql`SELECT ${COLUMNS} FROM payment_gateways WHERE slug = ${slug}`,
      );
      return (res.rows as unknown as GatewayRow[])[0] ?? null;
    });
  }

  // ---- writes (operator) ---------------------------------------------------------------------------------------------

  private async lock(tx: Tx, uuid: string): Promise<GatewayRow> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM payment_gateways WHERE uuid = ${uuid} FOR UPDATE`,
    );
    const row = (res.rows as unknown as GatewayRow[])[0];
    if (!row) throw AppError.notFound('Payment gateway', uuid);
    return row;
  }

  async update(uuid: string, input: UpdatePaygwGatewayRequest): Promise<PaygwGatewayItem> {
    const actor = RequestContextStore.require();
    const row = await this.store.tx(async (tx) => {
      const current = await this.lock(tx, uuid);
      if (current.row_version !== input.rowVersion)
        throw AppError.rowVersionConflict('Payment gateway');
      const { merged, keysSet, keysCleared } = mergeCredentials(
        current.slug,
        this.decryptCredentials(current),
        input.credentials,
        input.clearCredentials,
      );
      const credentials =
        Object.keys(merged).length > 0 ? this.crypto.encrypt(JSON.stringify(merged)) : null;
      const currencies = input.supportedCurrencies ?? current.supported_currencies ?? [];
      const res = await tx.execute(sql`
        UPDATE payment_gateways
        SET mode = ${input.mode},
            sort_order = ${input.sortOrder ?? current.sort_order},
            supported_currencies = ${JSON.stringify([...new Set(currencies)])}::jsonb,
            credentials = ${credentials}
        WHERE uuid = ${uuid}
        RETURNING ${COLUMNS}
      `);
      await this.audit.record(tx, {
        event: 'platform.payment_gateway.updated',
        status: 'success',
        actorType: 'platform_operator',
        actorId: actor.actorId,
        payload: {
          gateway: current.slug,
          mode: input.mode,
          fieldsSet: keysSet,
          fieldsCleared: keysCleared,
          supportedCurrencies: currencies,
        },
      });
      return (res.rows as unknown as GatewayRow[])[0]!;
    });
    return this.toItem(row);
  }

  /**
   * Activation needs a driver and every required field; deactivation always works and leaves in-flight orders, callbacks and
   * webhooks alone (they resolve by slug, not by is_active).
   */
  async setActive(uuid: string, input: SetPaygwGatewayActiveRequest): Promise<PaygwGatewayItem> {
    const actor = RequestContextStore.require();
    const outcome = await this.store.tx<
      { blocked: string[]; noDriver: boolean } | { row: GatewayRow }
    >(async (tx) => {
      const current = await this.lock(tx, uuid);
      if (current.row_version !== input.rowVersion)
        throw AppError.rowVersionConflict('Payment gateway');
      if (input.isActive && !current.is_active) {
        const missing = hasDriver(current.slug)
          ? missingRequired(current.slug, this.decryptCredentials(current))
          : null;
        if (missing === null || missing.length > 0) {
          await this.audit.record(tx, {
            event: 'platform.payment_gateway.toggle_blocked',
            status: 'failure',
            actorType: 'platform_operator',
            actorId: actor.actorId,
            payload: { gateway: current.slug, missingFields: missing ?? ['driver'] },
          });
          return { blocked: missing ?? ['driver'], noDriver: missing === null };
        }
      }
      const res = await tx.execute(
        sql`UPDATE payment_gateways SET is_active = ${input.isActive} WHERE uuid = ${uuid} RETURNING ${COLUMNS}`,
      );
      await this.audit.record(tx, {
        event: input.isActive
          ? 'platform.payment_gateway.activated'
          : 'platform.payment_gateway.deactivated',
        status: 'success',
        actorType: 'platform_operator',
        actorId: actor.actorId,
        payload: { gateway: current.slug },
      });
      return { row: (res.rows as unknown as GatewayRow[])[0]! };
    });
    if ('blocked' in outcome) {
      // The refusal row was written in the transaction above, which committed (nothing threw) before this error leaves.
      throw new AppError(
        outcome.noDriver
          ? ERROR_CODES.PAYGW_GATEWAY_UNAVAILABLE
          : ERROR_CODES.PAYGW_GATEWAY_NOT_CONFIGURED,
        outcome.noDriver
          ? 'This gateway has no driver in this release yet, so it cannot be activated.'
          : `Configure required fields first: ${outcome.blocked.join(', ')}`,
        HttpStatus.UNPROCESSABLE_ENTITY,
        outcome.blocked.map((key) => ({ path: key, message: 'required' })),
      );
    }
    return this.toItem(outcome.row);
  }
}
