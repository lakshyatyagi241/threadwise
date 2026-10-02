import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { microsToMinor } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { priceMessage, type Priced, type RateCardRow } from './wallet-rules';
import { countryOfPhone } from './phone-country';
import { WalletSettingsService } from './wallet-settings.service';

const CACHE_MS = 30_000;

/**
 * The customer price and Meta cost of a message (WD-WALLET-004). The rows are tiny and global, so they are read from the
 * database and held for 30 seconds per process; every write in this module drops the snapshot of ITS process at once and the
 * others see it within the window (WaDesk's 5-minute cache made a rate edit take 5 minutes to apply). The per-message settlement
 * passes its own transaction so a price is read in the same snapshot as the charge.
 */
@Injectable()
export class RateCardService {
  private cache: { at: number; rows: RateCardRow[] } | null = null;

  constructor(private readonly settings: WalletSettingsService) {}

  invalidate(): void {
    this.cache = null;
  }

  async rows(tx: Tx): Promise<RateCardRow[]> {
    if (this.cache && Date.now() - this.cache.at < CACHE_MS) return this.cache.rows;
    const res = await tx.execute(sql`
      SELECT country_code, category, credits, meta_cost_micros::text AS micros, meta_cost_minor::text AS minor
      FROM message_rates WHERE is_active`);
    const rows = (
      res.rows as unknown as Array<{
        country_code: string;
        category: string;
        credits: number;
        micros: string | null;
        minor: string | null;
      }>
    ).map<RateCardRow>((r) => ({
      countryCode: r.country_code,
      category: r.category,
      priceMinor: r.credits,
      // A row written before micros existed carries only whole cents.
      metaCostMicros:
        r.micros !== null ? Number(r.micros) : r.minor !== null ? Number(r.minor) * 10_000 : null,
    }));
    this.cache = { at: Date.now(), rows };
    return rows;
  }

  /** What one message to `phone` in `category` costs the customer and Meta. */
  async price(
    tx: Tx,
    phone: string | null | undefined,
    category: string | null | undefined,
  ): Promise<Priced & { country: string | null }> {
    const [rows, s] = await Promise.all([this.rows(tx), this.settings.effective()]);
    const country = countryOfPhone(phone);
    const priced = priceMessage(rows, {
      country,
      category,
      perCountryEnabled: s.perCountryEnabled,
      flatPriceMinor: s.flatPriceMinor,
    });
    return { ...priced, country };
  }

  /** The whole-cent figure the reseller P&L reads. */
  costMinor(micros: number | null): number | null {
    return micros === null ? null : microsToMinor(micros);
  }
}
