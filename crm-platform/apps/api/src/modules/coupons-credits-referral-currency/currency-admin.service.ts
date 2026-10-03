import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  CURRENCY_PAGE_SIZE,
  ERROR_CODES,
  type CreateCurrencyPayload,
  type CurrencyItem,
  type CurrencyListQuery,
  type CurrencyListResponse,
  type FetchRatesResponse,
  type UpdateCurrencyPayload,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import {
  FX_RATES,
  FxRatesError,
  type FxRatesPort,
} from '../../infra/providers/coupons-credits-referral-currency';
import { AuthAuditService } from '../auth';
import { CurrencyService, SettingsService } from '../platform-settings-branding-storage';
import { CpnStore, type UniqueMap } from './cpn-store';

interface CurrencyRow {
  id: string | number;
  uuid: string;
  code: string;
  name: string;
  symbol: string | null;
  precision: number;
  exchange_rate: string;
  is_active: boolean;
  created_at: string | Date;
  updated_at: string | Date;
  row_version: number;
}

const COLUMNS = sql.raw(
  `id, uuid, code, name, symbol, "precision", exchange_rate::text AS exchange_rate, is_active, created_at, updated_at, row_version`,
);

const UNIQUE: UniqueMap = {
  uq_currencies_code: {
    code: ERROR_CODES.CPN_CURRENCY_CODE_TAKEN,
    message: 'A currency with this code already exists.',
  },
};

const iso = (v: string | Date): string => new Date(v).toISOString();

/** "83.250000" -> "83.25": the rate as an operator reads it; four decimals are kept at least (WaDesk showed `1 USD -> x` with 4). */
export function trimRate(rate: string): string {
  const [whole = '0', frac = ''] = rate.split('.');
  const trimmed = frac.replace(/0+$/, '');
  return trimmed ? `${whole}.${trimmed}` : whole;
}

const toItem = (row: CurrencyRow, defaultCode: string): CurrencyItem => ({
  id: row.uuid,
  code: row.code,
  name: row.name,
  symbol: row.symbol,
  precision: row.precision,
  exchangeRate: trimRate(row.exchange_rate),
  isActive: row.is_active,
  isDefault: row.code === defaultCode,
  createdAt: iso(row.created_at),
  updatedAt: iso(row.updated_at),
  rowVersion: row.row_version,
});

/**
 * The platform currency catalogue (WD-CPN-018..024). One platform transaction per write with its security event; updates are
 * optimistic-locked. The platform DEFAULT currency is the `defaultCurrency` field of the general settings group (the one the
 * settings screen shows and every display helper reads), so there is exactly one writer of it: this service (WaDesk had two, with
 * different validation, and one of them corrupted the value).
 *
 * Differences from WaDesk (parity doc): the default cannot be deactivated or deleted, a currency still referenced cannot be
 * deleted, the code is a three-letter ISO shape, unique case-insensitively, and immutable once created; an inline edit exists
 * (WaDesk had the route but no screen).
 */
@Injectable()
export class CurrencyAdminService {
  constructor(
    private readonly store: CpnStore,
    private readonly audit: AuthAuditService,
    private readonly settings: SettingsService,
    private readonly display: CurrencyService,
    @Inject(FX_RATES) private readonly fx: FxRatesPort,
  ) {}

  private operatorId(): number {
    const id = RequestContextStore.require().actorId;
    if (!id) throw AppError.unauthenticated();
    return id;
  }

  /** The platform default as the settings group holds it; USD until one is set. */
  async defaultCode(): Promise<string> {
    const v = (await this.settings.values('general')).defaultCurrency;
    return (typeof v === 'string' && v.trim() ? v : 'USD').toUpperCase();
  }

  // --- reads ----------------------------------------------------------------------------------------------------------------

  async list(query: CurrencyListQuery): Promise<CurrencyListResponse> {
    const defaultCode = await this.defaultCode();
    return this.store.tx(async (tx) => {
      const q = query.q ?? null;
      const search = q
        ? sql`AND (strpos(lower(code), lower(${q})) > 0 OR strpos(lower(name), lower(${q})) > 0
                   OR strpos(lower(coalesce(symbol, '')), lower(${q})) > 0)`
        : sql``;
      const kpi = await tx.execute(sql`
        SELECT count(*)::int AS total, count(*) FILTER (WHERE is_active)::int AS active FROM currencies`);
      const k = kpi.rows[0] as unknown as { total: number; active: number };
      const filtered = await tx.execute(
        sql`SELECT count(*)::int AS n FROM currencies WHERE true ${search}`,
      );
      const total = (filtered.rows[0] as unknown as { n: number }).n;
      const pageCount = Math.max(1, Math.ceil(total / CURRENCY_PAGE_SIZE));
      const page = Math.min(query.page, pageCount);
      const offset = (page - 1) * CURRENCY_PAGE_SIZE;
      const rows = await tx.execute(sql`
        SELECT ${COLUMNS} FROM currencies WHERE true ${search}
        ORDER BY code ASC LIMIT ${CURRENCY_PAGE_SIZE} OFFSET ${offset}`);
      const choices = await tx.execute(
        sql`SELECT code, name, symbol FROM currencies WHERE is_active ORDER BY code`,
      );
      const data = (rows.rows as unknown as CurrencyRow[]).map((r) => toItem(r, defaultCode));
      return {
        data,
        summary: {
          total: k.total,
          active: k.active,
          inactive: k.total - k.active,
          defaultCode,
        },
        defaultChoices: choices.rows as unknown as Array<{
          code: string;
          name: string;
          symbol: string | null;
        }>,
        page,
        pageSize: CURRENCY_PAGE_SIZE,
        total,
        pageCount,
        from: data.length === 0 ? 0 : offset + 1,
        to: offset + data.length,
      };
    });
  }

  // --- writes ---------------------------------------------------------------------------------------------------------------

  async create(body: CreateCurrencyPayload): Promise<CurrencyItem> {
    const operatorId = this.operatorId();
    const defaultCode = await this.defaultCode();
    const item = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        INSERT INTO currencies (code, name, symbol, "precision", exchange_rate, is_active)
        VALUES (${body.code}, ${body.name}, ${body.symbol}, ${body.precision}, ${body.exchangeRate}::numeric, ${body.isActive})
        RETURNING ${COLUMNS}`);
      const row = toItem(res.rows[0] as unknown as CurrencyRow, defaultCode);
      await this.record(tx, 'platform.currency.created', operatorId, {
        currencyCode: row.code,
        rate: row.exchangeRate,
      });
      return row;
    }, UNIQUE);
    this.display.flush();
    return item;
  }

  async update(uuid: string, patch: UpdateCurrencyPayload): Promise<CurrencyItem> {
    const operatorId = this.operatorId();
    const defaultCode = await this.defaultCode();
    const item = await this.store.tx(async (tx) => {
      const stored = await this.byUuid(tx, uuid, true);
      if (stored.row_version !== patch.rowVersion)
        throw AppError.rowVersionConflict('The currency');
      if (patch.isActive === false && stored.is_active && stored.code === defaultCode) {
        throw this.defaultProtected('deactivated');
      }
      const next = {
        name: patch.name ?? stored.name,
        symbol: patch.symbol === undefined ? stored.symbol : patch.symbol,
        precision: patch.precision ?? stored.precision,
        rate: patch.exchangeRate ?? stored.exchange_rate,
        isActive: patch.isActive ?? stored.is_active,
      };
      const res = await tx.execute(sql`
        UPDATE currencies SET name = ${next.name}, symbol = ${next.symbol}, "precision" = ${next.precision},
               exchange_rate = ${next.rate}::numeric, is_active = ${next.isActive}
        WHERE id = ${stored.id} AND row_version = ${patch.rowVersion}
        RETURNING ${COLUMNS}`);
      if (res.rows.length === 0) throw AppError.rowVersionConflict('The currency');
      const row = toItem(res.rows[0] as unknown as CurrencyRow, defaultCode);
      const before = toItem(stored, defaultCode);
      const changes: Record<string, { from: unknown; to: unknown }> = {};
      for (const k of ['name', 'symbol', 'precision', 'exchangeRate', 'isActive'] as const) {
        if (before[k] !== row[k]) changes[k] = { from: before[k], to: row[k] };
      }
      if (Object.keys(changes).length > 0) {
        await this.record(tx, 'platform.currency.updated', operatorId, {
          currencyCode: row.code,
          fields: Object.keys(changes),
          changes,
        });
      }
      return row;
    });
    this.display.flush();
    return item;
  }

  /** Idempotent. The platform default cannot be switched off (WaDesk allowed it and silently corrupted every conversion). */
  async setActive(uuid: string, isActive: boolean): Promise<CurrencyItem> {
    const operatorId = this.operatorId();
    const defaultCode = await this.defaultCode();
    const item = await this.store.tx(async (tx) => {
      const stored = await this.byUuid(tx, uuid, true);
      if (stored.is_active === isActive) return toItem(stored, defaultCode);
      if (!isActive && stored.code === defaultCode) throw this.defaultProtected('deactivated');
      const res = await tx.execute(
        sql`UPDATE currencies SET is_active = ${isActive} WHERE id = ${stored.id} RETURNING ${COLUMNS}`,
      );
      await this.record(
        tx,
        isActive ? 'platform.currency.activated' : 'platform.currency.deactivated',
        operatorId,
        { currencyCode: stored.code },
      );
      return toItem(res.rows[0] as unknown as CurrencyRow, defaultCode);
    });
    this.display.flush();
    return item;
  }

  /**
   * Chooses the platform default (WD-CPN-024). The currency must exist AND be active. The value is stored as text in the
   * general settings group, in the same transaction as the audit row; the legacy flat `default_currency` key (what the checkout
   * reads) is kept in step in that transaction too.
   */
  async setDefault(code: string): Promise<{ defaultCode: string }> {
    const operatorId = this.operatorId();
    const previous = await this.defaultCode();
    await this.settings.mutate(
      'general',
      operatorId,
      (v) => ({ ...v, defaultCurrency: code }),
      async (tx) => {
        const res = await tx.execute(sql`SELECT is_active FROM currencies WHERE code = ${code}`);
        const row = res.rows[0] as unknown as { is_active: boolean } | undefined;
        if (!row) {
          throw new AppError(
            ERROR_CODES.CPN_CURRENCY_UNKNOWN,
            'That currency is not in the catalogue.',
            HttpStatus.UNPROCESSABLE_ENTITY,
            [{ path: 'code', message: code }],
          );
        }
        if (!row.is_active) {
          throw new AppError(
            ERROR_CODES.CPN_CURRENCY_UNKNOWN,
            'The default currency must be active.',
            HttpStatus.UNPROCESSABLE_ENTITY,
            [{ path: 'code', message: code }],
          );
        }
        await tx.execute(sql`
          INSERT INTO platform_settings (key, value, is_secret, updated_by, updated_at)
          VALUES ('default_currency', to_jsonb(${code}::text), false, ${operatorId}, now())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
          WHERE NOT platform_settings.is_secret`);
        await this.record(tx, 'platform.currency.default_changed', operatorId, {
          previous,
          now: code,
        });
      },
    );
    this.display.flush();
    return { defaultCode: code };
  }

  /**
   * Hard delete, refused for the platform default and for a currency that something still names (WaDesk deleted anything but the
   * default and left prices "orphaned"): plans, credit packages, coupons, orders and payment gateways are checked.
   */
  async remove(uuid: string): Promise<void> {
    const operatorId = this.operatorId();
    const defaultCode = await this.defaultCode();
    try {
      await this.store.tx(async (tx) => {
        const stored = await this.byUuid(tx, uuid, true);
        if (stored.code === defaultCode) throw this.defaultProtected('deleted', stored.code);
        const used = await this.usedBy(tx, stored.code);
        if (used.length > 0) {
          throw new AppError(
            ERROR_CODES.CPN_CURRENCY_IN_USE,
            `Cannot delete ${stored.code}: it is still used by ${used.join(', ')}. Deactivate it instead.`,
            HttpStatus.CONFLICT,
            used.map((u) => ({ path: 'usedBy', message: u })),
          );
        }
        await tx.execute(sql`DELETE FROM currencies WHERE id = ${stored.id}`);
        await this.record(tx, 'platform.currency.deleted', operatorId, {
          currencyCode: stored.code,
          name: stored.name,
        });
      });
    } catch (e) {
      // The refusal rolled its transaction back, so the "blocked" audit row is written on its own (WaDesk logged it too).
      if (e instanceof AppError && e.code === ERROR_CODES.CPN_CURRENCY_DEFAULT_PROTECTED) {
        await this.audit.recordStandalone({
          event: 'platform.currency.delete_blocked',
          status: 'failure',
          actorType: 'platform_operator',
          actorId: operatorId,
          payload: { currencyCode: defaultCode, reason: 'is_system_default' },
        });
      }
      throw e;
    }
    this.display.flush();
  }

  /**
   * Replaces the rate of every catalogue currency (active or not) the provider knows (WD-CPN-023). A failure changes nothing and
   * is recorded; currencies the provider does not list keep their rate.
   */
  async fetchRates(): Promise<FetchRatesResponse> {
    const operatorId = this.operatorId();
    let rates: Record<string, number>;
    try {
      rates = await this.fx.fetchUsdRates();
    } catch (e) {
      const message =
        e instanceof FxRatesError ? e.message : `Fetch failed: ${(e as Error).message}`;
      await this.audit.recordStandalone({
        event: 'platform.currency.rates_fetch_failed',
        status: 'failure',
        actorType: 'platform_operator',
        actorId: operatorId,
        payload: { provider: this.fx.name, error: message.slice(0, 300) },
      });
      throw new AppError(ERROR_CODES.CPN_RATES_FETCH_FAILED, message, HttpStatus.BAD_GATEWAY);
    }
    const updated = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`SELECT id, code FROM currencies`);
      let n = 0;
      for (const row of res.rows as unknown as Array<{ id: string | number; code: string }>) {
        const rate = rates[row.code.toUpperCase()];
        if (rate === undefined) continue;
        const text = rate.toFixed(6);
        if (Number(text) < 0.000001) continue;
        await tx.execute(
          sql`UPDATE currencies SET exchange_rate = ${text}::numeric WHERE id = ${row.id}`,
        );
        n++;
      }
      await this.record(tx, 'platform.currency.rates_fetched', operatorId, {
        provider: this.fx.name,
        updated: n,
      });
      return n;
    });
    this.display.flush();
    return { updated, provider: this.fx.name };
  }

  // --- internals ------------------------------------------------------------------------------------------------------------

  private defaultProtected(verb: 'deleted' | 'deactivated', code?: string): AppError {
    return new AppError(
      ERROR_CODES.CPN_CURRENCY_DEFAULT_PROTECTED,
      `Cannot be ${verb}: this is the system default currency. Change the default first.`,
      HttpStatus.CONFLICT,
      code ? [{ path: 'code', message: code }] : undefined,
    );
  }

  private async byUuid(tx: Tx, uuid: string, lock = false): Promise<CurrencyRow> {
    const res = await tx.execute(
      lock
        ? sql`SELECT ${COLUMNS} FROM currencies WHERE uuid = ${uuid}::uuid FOR UPDATE`
        : sql`SELECT ${COLUMNS} FROM currencies WHERE uuid = ${uuid}::uuid`,
    );
    const row = res.rows[0] as unknown as CurrencyRow | undefined;
    if (!row) throw AppError.notFound('Currency');
    return row;
  }

  private async usedBy(tx: Tx, code: string): Promise<string[]> {
    const checks: Array<[string, ReturnType<typeof sql>]> = [
      ['plans', sql`SELECT 1 FROM plans WHERE currency = ${code} LIMIT 1`],
      ['credit packages', sql`SELECT 1 FROM credit_packages WHERE currency_code = ${code} LIMIT 1`],
      ['coupons', sql`SELECT 1 FROM coupons WHERE upper(currency_code) = ${code} LIMIT 1`],
      ['orders', sql`SELECT 1 FROM orders WHERE currency = ${code} LIMIT 1`],
    ];
    const used: string[] = [];
    for (const [label, q] of checks) {
      if ((await tx.execute(q)).rows.length > 0) used.push(label);
    }
    return used;
  }

  private async record(
    tx: Tx,
    event: string,
    operatorId: number,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record(tx, {
      event,
      status: 'info',
      actorType: 'platform_operator',
      actorId: operatorId,
      payload,
    });
  }
}
