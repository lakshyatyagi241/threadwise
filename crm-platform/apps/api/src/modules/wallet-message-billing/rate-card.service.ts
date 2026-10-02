import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { microsToMinor } from '@crm/contracts';
import type { Tx } from '@crm/db';
import {
  priceMessageWithMargin,
  type MarginLayers,
  type MarginRule,
  type Priced,
  type RateCardRow,
} from './wallet-rules';
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
  private marginCache: { at: number; rows: Array<MarginRule & { planSlug: string }> } | null = null;

  constructor(private readonly settings: WalletSettingsService) {}

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

  /** What one message to `phone` in `category` costs the customer and Meta. */
  async price(
    tx: Tx,
    orgId: number,
    phone: string | null | undefined,
    category: string | null | undefined,
  ): Promise<Priced & { country: string | null }> {
    const country = countryOfPhone(phone);
    return { ...(await this.priceFor(tx, orgId, country, category)), country };
  }

  /** The same, for a known country (the operator's preview and the price panel). */
  async priceFor(
    tx: Tx,
    orgId: number,
    country: string | null,
    category: string | null | undefined,
  ): Promise<Priced> {
    const [rows, s] = await Promise.all([this.rows(tx), this.settings.effective()]);
    // Margins are only read when they can matter: a fixed-price install does no extra query per message.
    const layers =
      s.pricingMode === 'margin'
        ? await this.layersFor(tx, orgId)
        : { workspace: [], plan: [], platform: [] };
    return priceMessageWithMargin(rows, layers, {
      country,
      category,
      perCountryEnabled: s.perCountryEnabled,
      flatPriceMinor: s.flatPriceMinor,
      pricingMode: s.pricingMode,
    });
  }

  /** The whole-cent figure the reseller P&L reads. */
  costMinor(micros: number | null): number | null {
    return micros === null ? null : microsToMinor(micros);
  }
}
