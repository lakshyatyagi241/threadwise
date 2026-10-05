import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { microsToMinor } from '@crm/contracts';
import type { Tx } from '@crm/db';
import {
  priceInCurrency,
  priceMessageWithMargin,
  type MarginLayers,
  type MarginRule,
  type Priced,
  type RateCardRow,
} from './wallet-rules';
import { countryOfPhone } from './phone-country';
import { CurrencyService } from '../platform-settings-branding-storage';
import { BillingCurrencyService } from './billing-currency.service';
import { MetaRateCardService } from './meta-rate-card.service';
import { WalletSettingsService } from './wallet-settings.service';

const CACHE_MS = 30_000;

/**
 * The customer price and Meta cost of a message (TW-WALLET-004). The rows are tiny and global, so they are read from the
 * database and held for 30 seconds per process; every write in this module drops the snapshot of ITS process at once and the
 * others see it within the window (Reference's 5-minute cache made a rate edit take 5 minutes to apply). The per-message settlement
 * passes its own transaction so a price is read in the same snapshot as the charge.
 */
@Injectable()
export class RateCardService {
  private cache: { at: number; rows: RateCardRow[] } | null = null;
  private marginCache: { at: number; rows: Array<MarginRule & { planSlug: string }> } | null = null;

  constructor(
    private readonly settings: WalletSettingsService,
    private readonly cards: MetaRateCardService,
    private readonly billing: BillingCurrencyService,
    private readonly fx: CurrencyService,
  ) {}

  invalidate(): void {
    this.cache = null;
    this.marginCache = null;
  }

  /** Every plan margin row (the platform default is plan ''), held 30 s like the rate card. */
  private async planMargins(tx: Tx): Promise<Array<MarginRule & { planSlug: string }>> {
    if (this.marginCache && Date.now() - this.marginCache.at < CACHE_MS)
      return this.marginCache.rows;
    const res = await tx.execute(
      sql`SELECT plan_slug, country_code, category, margin_bps FROM plan_message_margins`,
    );
    const rows = (
      res.rows as unknown as Array<{
        plan_slug: string;
        country_code: string;
        category: string;
        margin_bps: number;
      }>
    ).map((r) => ({
      planSlug: r.plan_slug,
      countryCode: r.country_code,
      category: r.category,
      marginBps: r.margin_bps,
    }));
    this.marginCache = { at: Date.now(), rows };
    return rows;
  }

  /** The three margin layers that apply to ONE workspace: its override, its plan's, the platform default. */
  async layersFor(tx: Tx, orgId: number): Promise<MarginLayers & { planSlug: string | null }> {
    const [plans, own, org] = await Promise.all([
      this.planMargins(tx),
      tx.execute(
        sql`SELECT country_code, category, margin_bps FROM workspace_message_margins WHERE org_id = ${orgId}`,
      ),
      tx.execute(sql`SELECT plan FROM organizations WHERE id = ${orgId}`),
    ]);
    const planSlug = (org.rows[0] as { plan?: string } | undefined)?.plan ?? null;
    return {
      planSlug,
      workspace: (
        own.rows as unknown as Array<{ country_code: string; category: string; margin_bps: number }>
      ).map((r) => ({
        countryCode: r.country_code,
        category: r.category,
        marginBps: r.margin_bps,
      })),
      plan: planSlug ? plans.filter((m) => m.planSlug === planSlug) : [],
      platform: plans.filter((m) => m.planSlug === ''),
    };
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

  /** What one message to `phone` in `category` costs the customer and Meta, in the workspace's billing currency. */
  async price(
    tx: Tx,
    orgId: number,
    phone: string | null | undefined,
    category: string | null | undefined,
    currency?: string,
  ): Promise<Priced & { country: string | null; currency: string }> {
    const country = countryOfPhone(phone);
    return { ...(await this.priceFor(tx, orgId, country, category, currency)), country };
  }

  /**
   * The same, for a known country (the operator's preview and the price panel). `currency` is the workspace's billing currency;
   * pass it when the caller already resolved it, otherwise it is looked up.
   *
   * In the platform currency the grid answers as before, with Meta's published cost behind any country whose row carries none.
   * In another currency Meta's card for THAT currency is the cost, and a margin is applied to it; a typed or flat price (which
   * only exists in the platform currency) is converted at the rate on file.
   */
  async priceFor(
    tx: Tx,
    orgId: number,
    country: string | null,
    category: string | null | undefined,
    currency?: string,
  ): Promise<Priced & { currency: string }> {
    const [rows, s, own] = await Promise.all([
      this.rows(tx),
      this.settings.effective(),
      currency ? Promise.resolve(currency) : this.billing.forOrg(tx, orgId),
    ]);
    // Margins are only read when they can matter: a fixed-price install does no extra query per message.
    const layers =
      s.pricingMode === 'margin'
        ? await this.layersFor(tx, orgId)
        : { workspace: [], plan: [], platform: [] };
    const cardCost = (await this.cards.lookup(tx, own))(country, category);
    if (own === s.currency) {
      return {
        ...priceMessageWithMargin(rows, layers, {
          country,
          category,
          perCountryEnabled: s.perCountryEnabled,
          flatPriceMinor: s.flatPriceMinor,
          pricingMode: s.pricingMode,
          fallbackCostMicros: cardCost,
        }),
        currency: own,
      };
    }
    const [from, to] = await Promise.all([this.fx.find(s.currency), this.fx.find(own)]);
    return {
      ...priceInCurrency(rows, layers, {
        country,
        category,
        perCountryEnabled: s.perCountryEnabled,
        flatPriceMinor: s.flatPriceMinor,
        pricingMode: s.pricingMode,
        costMicros: cardCost,
        fromRate: Number(from?.rate ?? 1),
        toRate: Number(to?.rate ?? 1),
      }),
      currency: own,
    };
  }

  /** The whole-cent figure the reseller P&L reads. */
  costMinor(micros: number | null): number | null {
    return micros === null ? null : microsToMinor(micros);
  }
}
