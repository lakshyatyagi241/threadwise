import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  type CreateCurrencyRequest,
  type CurrencyItem,
  type CurrencyListResponse,
  type FetchRatesResponse,
  type ListCurrenciesQuery,
  type UpdateCurrencyRequest,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import {
  FX_RATE_PROVIDER,
  FxRateError,
  type FxRateProvider,
} from '../../infra/providers/coupons-credits-referral-currency';
import { AuthAuditService, PlatformStore } from '../auth';
import { CurrencyService, SettingsService } from '../platform-settings-branding-storage';
import { decodeKey, encodeKey, escapeLike, operatorId } from './operator';
import { pgArray } from './pg-array';

interface Db {
  uuid: string;
  name: string;
  code: string;
  symbol: string | null;
  precision: number;
  exchange_rate: string;
  is_active: boolean;
  row_version: number;
  updated_at: string | Date;
}

const COLUMNS = sql`uuid, name, code, symbol, "precision", exchange_rate::text AS exchange_rate, is_active, row_version, updated_at`;

const toItem = (r: Db, defaultCode: string): CurrencyItem => ({
  id: r.uuid,
  name: r.name,
  code: r.code,
  symbol: r.symbol,
  precision: Number(r.precision),
  exchangeRate: r.exchange_rate,
  isActive: r.is_active,
  isDefault: r.code.toUpperCase() === defaultCode,
  rowVersion: Number(r.row_version),
  updatedAt: new Date(r.updated_at).toISOString(),
});

/**
 * The currency catalog (TW-CPN-018..024). Global rows: reads and writes go through the privileged connection and the routes are
 * guarded by operator roles. Every write flushes the display cache of the money helpers (`CurrencyService`) and is audited.
 *
 * Deliberate differences from Reference, each a defect it documents in its own inventory: the default currency is stored as text and
 * must be an ACTIVE catalog currency; it cannot be switched off, deleted or have its code changed (Reference allowed all three and
 * silently corrupted every conversion); a currency still named by a workspace, plan, gateway, coupon, package or deal cannot be
 * deleted; the code is immutable once saved; and there is one writer of the default (the general settings page validates the
 * same way).
 */
@Injectable()
export class CurrenciesService {
  constructor(
    private readonly store: PlatformStore,
    private readonly audit: AuthAuditService,
    private readonly settings: SettingsService,
    private readonly money: CurrencyService,
    @Inject(FX_RATE_PROVIDER) private readonly fx: FxRateProvider,
  ) {}

  /** The platform default's code, upper-case; "USD" when nothing is saved. */
  async defaultCode(): Promise<string> {
    return ((await this.settings.values('general')).defaultCurrency || 'USD').toUpperCase();
  }

  async list(q: ListCurrenciesQuery): Promise<CurrencyListResponse> {
    const defaultCode = await this.defaultCode();
    return this.store.tx(async (tx) => {
      const filters = [sql`true`];
      if (q.q) {
        const like = `%${escapeLike(q.q)}%`;
        filters.push(sql`(code ILIKE ${like} OR name ILIKE ${like} OR symbol ILIKE ${like})`);
      }
      const where = sql.join(filters, sql` AND `);
      const after = q.cursor ? sql`AND code > ${decodeKey(q.cursor)}` : sql``;
      const rows = await tx.execute(
        sql`SELECT ${COLUMNS} FROM currencies WHERE ${where} ${after} ORDER BY code LIMIT ${q.limit + 1}`,
      );
      const all = rows.rows as unknown as Db[];
      const hasMore = all.length > q.limit;
      const items = hasMore ? all.slice(0, q.limit) : all;

      const counts = await tx.execute(sql`
        SELECT count(*) FILTER (WHERE ${where})::int AS matching, count(*)::int AS total,
               count(*) FILTER (WHERE is_active)::int AS active
        FROM currencies`);
      const c = counts.rows[0] as { matching: number; total: number; active: number };
      const options = await tx.execute(
        sql`SELECT code, name, symbol FROM currencies WHERE is_active ORDER BY code`,
      );
      return {
        data: items.map((r) => toItem(r, defaultCode)),
        page: {
          nextCursor: hasMore ? encodeKey(items[items.length - 1]!.code) : null,
          hasMore,
          limit: q.limit,
        },
        total: c.matching,
        stats: {
          total: c.total,
          active: c.active,
          inactive: c.total - c.active,
          defaultCode,
        },
        activeOptions: options.rows as unknown as Array<{
          code: string;
          name: string;
          symbol: string | null;
        }>,
      };
    });
  }

  async create(input: CreateCurrencyRequest): Promise<CurrencyItem> {
    const operator = operatorId();
    const defaultCode = await this.defaultCode();
    const item = await this.store.tx(async (tx) => {
      let row: Db;
      try {
        const res = await tx.execute(sql`
          INSERT INTO currencies (name, code, symbol, "precision", exchange_rate, is_active)
          VALUES (${input.name}, ${input.code}, ${input.symbol}, ${input.precision}, ${input.exchangeRate}, ${input.isActive})
          RETURNING ${COLUMNS}`);
        row = res.rows[0] as unknown as Db;
      } catch (err) {
        throw this.mapConflict(err);
      }
      await this.record(tx, 'platform.currency.created', operator, {
        currencyCode: row.code,
        rate: row.exchange_rate,
      });
      return toItem(row, defaultCode);
    });
    this.money.flush();
    return item;
  }

  async update(uuid: string, patch: UpdateCurrencyRequest): Promise<CurrencyItem> {
    const operator = operatorId();
    const defaultCode = await this.defaultCode();
    const item = await this.store.tx(async (tx) => {
      const stored = await this.lock(tx, uuid);
      if (Number(stored.row_version) !== patch.rowVersion)
        throw AppError.rowVersionConflict('Currency');
      if (patch.isActive === false && stored.code.toUpperCase() === defaultCode) {
        throw this.isDefault(stored.code);
      }
      const next = {
        name: patch.name ?? stored.name,
        symbol: patch.symbol === undefined ? stored.symbol : patch.symbol,
        precision: patch.precision ?? Number(stored.precision),
        rate: patch.exchangeRate ?? stored.exchange_rate,
        isActive: patch.isActive ?? stored.is_active,
      };
      const unchanged =
        next.name === stored.name &&
        next.symbol === stored.symbol &&
        next.precision === Number(stored.precision) &&
        Number(next.rate) === Number(stored.exchange_rate) &&
        next.isActive === stored.is_active;
      // Nothing differed: no write, no version burned, nothing audited (the same rule as a coupon edit).
      if (unchanged) return toItem(stored, defaultCode);
      const res = await tx.execute(sql`
        UPDATE currencies SET name = ${next.name}, symbol = ${next.symbol}, "precision" = ${next.precision},
          exchange_rate = ${next.rate}, is_active = ${next.isActive}
        WHERE uuid = ${uuid}::uuid RETURNING ${COLUMNS}`);
      const row = res.rows[0] as unknown as Db;
      await this.record(tx, 'platform.currency.updated', operator, {
        currencyCode: row.code,
        before: { rate: stored.exchange_rate, isActive: stored.is_active },
        after: { rate: row.exchange_rate, isActive: row.is_active },
      });
      return toItem(row, defaultCode);
    });
    this.money.flush();
    return item;
  }

  async setActive(uuid: string, value: boolean): Promise<CurrencyItem> {
    const operator = operatorId();
    const defaultCode = await this.defaultCode();
    const item = await this.store.tx(async (tx) => {
      const stored = await this.lock(tx, uuid);
      if (stored.is_active === value) return toItem(stored, defaultCode);
      if (!value && stored.code.toUpperCase() === defaultCode) throw this.isDefault(stored.code);
      const res = await tx.execute(
        sql`UPDATE currencies SET is_active = ${value} WHERE uuid = ${uuid}::uuid RETURNING ${COLUMNS}`,
      );
      await this.record(
        tx,
        value ? 'platform.currency.activated' : 'platform.currency.deactivated',
        operator,
        { currencyCode: stored.code },
      );
      return toItem(res.rows[0] as unknown as Db, defaultCode);
    });
    this.money.flush();
    return item;
  }

  async remove(uuid: string): Promise<void> {
    const operator = operatorId();
    const defaultCode = await this.defaultCode();
    try {
      await this.store.tx(async (tx) => {
        const stored = await this.lock(tx, uuid);
        const code = stored.code.toUpperCase();
        if (code === defaultCode) throw this.isDefault(stored.code);
        const using = await this.usedBy(tx, code);
        if (using.length > 0) {
          throw new AppError(
            ERROR_CODES.CPN_CURRENCY_IN_USE,
            `${code} is still used by ${using.join(', ')}. Switch it off instead.`,
            HttpStatus.CONFLICT,
            using.map((u) => ({ path: 'currency', message: u })),
          );
        }
        await tx.execute(sql`DELETE FROM currencies WHERE uuid = ${uuid}::uuid`);
        await this.record(tx, 'platform.currency.deleted', operator, {
          currencyCode: code,
          name: stored.name,
        });
      });
    } catch (err) {
      // The refusal itself is evidence (Reference logged `delete_blocked` with reason `is_system_default`), and the transaction that
      // would have carried it has rolled back, so it is written on its own.
      if (err instanceof AppError && err.code === ERROR_CODES.CPN_CURRENCY_IS_DEFAULT) {
        await this.audit.recordStandalone({
          event: 'platform.currency.delete_blocked',
          status: 'failure',
          actorType: 'platform_operator',
          actorId: operator,
          payload: { reason: 'is_system_default' },
        });
      }
      throw err;
    }
    this.money.flush();
  }

  /** Makes `code` the platform default: it must exist and be active. One writer, audited, through the settings service. */
  async setDefault(code: string): Promise<{ defaultCode: string }> {
    const operator = operatorId();
    const next = code.trim().toUpperCase();
    const previous = await this.defaultCode();
    const found = await this.store.tx(
      async (tx) =>
        (await tx.execute(sql`SELECT is_active FROM currencies WHERE code = ${next}`)).rows[0] as
          { is_active: boolean } | undefined,
    );
    if (!found) {
      throw AppError.validation(`${next} is not in the currency catalog.`, [
        { path: 'code', message: 'Choose a currency from the catalog.' },
      ]);
    }
    if (!found.is_active) {
      throw new AppError(
        ERROR_CODES.CPN_CURRENCY_NOT_ACTIVE,
        `${next} is switched off. Activate it before making it the default.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'code', message: 'inactive' }],
      );
    }
    await this.settings.mutate(
      'general',
      operator,
      (values) => ({ ...values, defaultCurrency: next }),
      (tx) =>
        this.record(tx, 'platform.currency.default_changed', operator, { previous, now: next }),
    );
    this.money.flush();
    return { defaultCode: next };
  }

  /** The "Fetch live rates" button (TW-CPN-023): every catalog currency the provider knows is updated; the rest are untouched. */
  async fetchRates(): Promise<FetchRatesResponse> {
    const operator = operatorId();
    let latest;
    try {
      latest = await this.fx.latest();
    } catch (err) {
      const message = err instanceof FxRateError ? err.message : `Fetch failed: ${String(err)}`;
      await this.audit.recordStandalone({
        event: 'platform.currency.rates_fetch_failed',
        status: 'failure',
        actorType: 'platform_operator',
        actorId: operator,
        payload: { provider: this.fx.name, error: message },
      });
      throw new AppError(ERROR_CODES.CPN_RATES_FETCH_FAILED, message, HttpStatus.BAD_GATEWAY);
    }
    const codes = [...latest.rates.keys()];
    const rates = codes.map((c) => latest.rates.get(c)!);
    const updated = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        UPDATE currencies c SET exchange_rate = v.rate
        FROM (SELECT unnest(${pgArray(codes, 'text')}) AS code, unnest(${pgArray(rates, 'numeric')}) AS rate) v
        WHERE upper(c.code) = v.code
        RETURNING c.code`);
      await this.record(tx, 'platform.currency.rates_fetched', operator, {
        provider: latest.provider,
        updated: res.rows.length,
      });
      return res.rows.length;
    });
    this.money.flush();
    return { updated, provider: latest.provider };
  }

  // ---- helpers -------------------------------------------------------------------------------------------------------

  private async lock(tx: Tx, uuid: string): Promise<Db> {
    const res = await tx.execute(
      sql`SELECT ${COLUMNS} FROM currencies WHERE uuid = ${uuid}::uuid FOR UPDATE`,
    );
    const row = res.rows[0] as unknown as Db | undefined;
    if (!row) throw AppError.notFound('Currency');
    return row;
  }

  private isDefault(code: string): AppError {
    return new AppError(
      ERROR_CODES.CPN_CURRENCY_IS_DEFAULT,
      `${code.toUpperCase()} is the system default currency. Change the default first.`,
      HttpStatus.CONFLICT,
    );
  }

  /** What still prices something in this currency: the reasons a delete is refused. */
  private async usedBy(tx: Tx, code: string): Promise<string[]> {
    const res = await tx.execute(sql`
      SELECT
        EXISTS (SELECT 1 FROM workspace_settings WHERE upper(currency) = ${code})
          OR EXISTS (SELECT 1 FROM organizations WHERE upper(settings->>'currency') = ${code}) AS workspaces,
        EXISTS (SELECT 1 FROM plans WHERE upper(currency) = ${code}) AS plans,
        EXISTS (
          SELECT 1 FROM payment_gateways g,
            jsonb_array_elements_text(CASE WHEN jsonb_typeof(g.supported_currencies) = 'array' THEN g.supported_currencies ELSE '[]'::jsonb END) AS c
          WHERE upper(c) = ${code}) AS gateways,
        EXISTS (SELECT 1 FROM coupons WHERE upper(currency_code) = ${code}) AS coupons,
        EXISTS (SELECT 1 FROM credit_packages WHERE upper(currency_code) = ${code}) AS packages,
        EXISTS (SELECT 1 FROM deals WHERE upper(currency) = ${code}) AS deals`);
    const r = res.rows[0] as Record<string, boolean>;
    return (['workspaces', 'plans', 'gateways', 'coupons', 'packages', 'deals'] as const).filter(
      (k) => r[k],
    );
  }

  private mapConflict(err: unknown): unknown {
    const e = err as { code?: string; constraint?: string };
    if (e.code === '23505' && e.constraint === 'uq_currencies_code') {
      return new AppError(
        ERROR_CODES.CPN_CURRENCY_CODE_TAKEN,
        'A currency with this code already exists.',
        HttpStatus.CONFLICT,
        [{ path: 'code', message: 'The code has already been taken.' }],
      );
    }
    return err;
  }

  private async record(tx: Tx, event: string, operator: number, payload: Record<string, unknown>) {
    await this.audit.record(tx, {
      event,
      status: 'info',
      actorType: 'platform_operator',
      actorId: operator,
      payload,
    });
  }
}
