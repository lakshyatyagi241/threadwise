import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { convertCurrency, formatMoney, type CurrencyRow } from '@crm/contracts';
import { PlatformStore } from '../auth';
import { SettingsService } from './settings.service';

const CACHE_MS = 60_000;

/**
 * Money display and conversion (WD-SET-044). The `currencies` table belongs to the currency domain (CPN); this only reads
 * the active rows (global-read table, through the platform door) and formats with the pure helpers. Amounts go in and out
 * as strings. Rates are units of that currency per 1 USD, as in WaDesk.
 */
@Injectable()
export class CurrencyService {
  private cache: { at: number; rows: Map<string, CurrencyRow> } | null = null;

  constructor(
    private readonly platform: PlatformStore,
    private readonly settings: SettingsService,
  ) {}

  flush(): void {
    this.cache = null;
  }

  private async rows(): Promise<Map<string, CurrencyRow>> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.rows;
    const res = await this.platform.tx((tx) =>
      tx.execute(
        sql`SELECT code, symbol, "precision", exchange_rate::text AS rate FROM currencies WHERE is_active`,
      ),
    );
    const rows = new Map<string, CurrencyRow>();
    for (const r of res.rows as Array<{
      code: string;
      symbol: string | null;
      precision: number;
      rate: string;
    }>) {
      rows.set(r.code.toUpperCase(), {
        code: r.code.toUpperCase(),
        symbol: r.symbol ?? '',
        precision: r.precision,
        rate: r.rate,
      });
    }
    this.cache = { at: Date.now(), rows };
    return rows;
  }

  /** The workspace's currency, else the platform default, else USD. */
  async effectiveCode(workspaceCurrency?: string | null): Promise<string> {
    const own = (workspaceCurrency ?? '').trim().toUpperCase();
    if (own) return own;
    return ((await this.settings.values('general')).defaultCurrency || 'USD').toUpperCase();
  }

  async find(code: string): Promise<CurrencyRow | null> {
    return (await this.rows()).get(code.trim().toUpperCase()) ?? null;
  }

  /** Strictly in the given currency, no conversion (invoices and receipts show what was paid). */
  async formatIn(amount: string | number, code: string): Promise<string> {
    return formatMoney(amount, await this.find(code));
  }

  /** Converts between two currencies; a missing rate counts as 1, a rate <= 0 leaves the amount alone. */
  async convert(amount: string | number, from: string, to: string): Promise<string> {
    const rows = await this.rows();
    const rate = (c: string) => rows.get(c.trim().toUpperCase())?.rate ?? '1';
    return convertCurrency(amount, rate(from), rate(to));
  }

  /** `amount` held in `fromCode`, shown in the workspace's currency. */
  async display(
    amount: string | number,
    fromCode: string | null,
    workspaceCurrency?: string | null,
  ): Promise<string> {
    const target = await this.effectiveCode(workspaceCurrency);
    const value =
      fromCode && fromCode.trim().toUpperCase() !== target
        ? await this.convert(amount, fromCode, target)
        : amount;
    return this.formatIn(value, target);
  }

  /** The symbol, or the code when there is none, or '' for a null code. */
  async symbolFor(code: string | null): Promise<string> {
    if (!code) return '';
    const row = await this.find(code);
    return row?.symbol || code.toUpperCase();
  }
}
