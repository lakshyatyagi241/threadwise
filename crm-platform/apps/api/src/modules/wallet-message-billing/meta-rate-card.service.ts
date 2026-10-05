import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  META_CARD_CATEGORIES,
  microsToMajor,
  type ImportMetaCardResult,
  type MetaCardCategory,
  type MetaCardDetail,
  type MetaCardSummary,
  type MetaCardsResponse,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { PlatformStore } from '../auth';
import { cardFreshness, mostPressing } from './meta-card-freshness';
import { ALL_MARKETS, countriesOf, marketOf, OTHER_MARKET } from './meta-markets';
import { MetaCardFileError, parseMetaCardFile, type ParsedMetaCard } from './meta-rate-card-file';
import { WalletSettingsService } from './wallet-settings.service';

const BIGGEST = 8;
const CACHE_MS = 30_000;

/** Meta's cost for one message to `country` in `category`, in the card's currency (millionths); null when the card has none. */
export type MetaCostLookup = (
  country: string | null | undefined,
  category: string | null | undefined,
) => number | null;

interface StoredRow {
  market: string;
  category: string;
  cost_micros: string;
  effective_on: string;
  imported_at: Date;
}

const key = (market: string, category: string): string => `${market}|${category}`;

/**
 * Meta's published rate cards, one per billing currency. Stores the file Meta publishes each quarter, shows it (and how old it is),
 * and hands its rows to whatever applies them to pricing.
 * A card replaces the previous one for its currency as a whole, so a market Meta dropped does not linger.
 */
@Injectable()
export class MetaRateCardService {
  private costs = new Map<string, { at: number; byKey: ReadonlyMap<string, number> }>();
  private currencyList: { at: number; list: string[] } | null = null;

  constructor(
    private readonly store: PlatformStore,
    private readonly settings: WalletSettingsService,
  ) {}

  /** Drops the cached cards; an import calls it so the engine sees the new prices at once (other processes within 30 s). */
  invalidate(): void {
    this.costs.clear();
    this.currencyList = null;
  }

  // --- reading the file -----------------------------------------------------------------------------------------------------

  /** Reads the uploaded file; a file that is not Meta's card is a 422 that says why. */
  parse(base64: string): ParsedMetaCard {
    try {
      return parseMetaCardFile(Buffer.from(base64, 'base64'));
    } catch (err) {
      if (err instanceof MetaCardFileError) {
        throw new AppError(
          ERROR_CODES.WALLET_IMPORT_FAILED,
          err.message,
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      throw err;
    }
  }

  // --- comparing and storing ------------------------------------------------------------------------------------------------

  private async readRows(tx: Tx, currency: string): Promise<StoredRow[]> {
    const res = await tx.execute(sql`
      SELECT market, category, cost_micros::text AS cost_micros, effective_on::text AS effective_on, imported_at
      FROM meta_rate_cards WHERE currency = ${currency}`);
    return res.rows as unknown as StoredRow[];
  }

  /** What importing `card` would change against the card now stored for its currency. */
  async compare(
    tx: Tx,
    card: ParsedMetaCard,
  ): Promise<Omit<ImportMetaCardResult, 'dryRun' | 'appliedToPricing' | 'pricing'>> {
    const current = await this.readRows(tx, card.currency);
    const before = new Map(current.map((r) => [key(r.market, r.category), Number(r.cost_micros)]));
    const incoming = new Set<string>();
    let added = 0;
    let changed = 0;
    let unchanged = 0;
    const moves: Array<{
      market: string;
      category: MetaCardCategory;
      before: number | null;
      after: number;
      size: number;
    }> = [];
    for (const r of card.rows) {
      const k = key(r.market, r.category);
      incoming.add(k);
      const old = before.get(k);
      if (old === undefined) {
        added += 1;
        moves.push({
          market: r.market,
          category: r.category,
          before: null,
          after: r.costMicros,
          size: Number.POSITIVE_INFINITY,
        });
      } else if (old === r.costMicros) {
        unchanged += 1;
      } else {
        changed += 1;
        moves.push({
          market: r.market,
          category: r.category,
          before: old,
          after: r.costMicros,
          size: old === 0 ? Number.POSITIVE_INFINITY : Math.abs(r.costMicros - old) / old,
        });
      }
    }
    const removed = [...before.keys()].filter((k) => !incoming.has(k)).length;
    // New rows are listed after real changes: on a first import every row is "new" and says nothing.
    const real = moves.filter((m) => m.before !== null).sort((a, b) => b.size - a.size);
    return {
      currency: card.currency,
      effectiveOn: card.effectiveOn,
      replaces: current.length > 0 ? (current[0]?.effective_on ?? null) : null,
      added,
      changed,
      unchanged,
      removed,
      biggestChanges: real.slice(0, BIGGEST).map((m) => ({
        market: m.market,
        category: m.category,
        before: m.before === null ? null : microsToMajor(m.before),
        after: microsToMajor(m.after),
      })),
      problems: card.problems.slice(0, 20),
    };
  }

  /** Makes `card` the stored card of its currency: upsert every row, drop the ones the new file no longer lists. */
  async replace(tx: Tx, card: ParsedMetaCard, fileName: string | undefined): Promise<void> {
    const label =
      `Meta rate card (${card.currency}), effective ${card.effectiveOn}${fileName ? `, ${fileName}` : ''}`.slice(
        0,
        300,
      );
    for (const r of card.rows) {
      await tx.execute(sql`
        INSERT INTO meta_rate_cards (currency, market, category, cost_micros, effective_on, source_label, imported_at)
        VALUES (${card.currency}, ${r.market}, ${r.category}, ${r.costMicros}, ${card.effectiveOn}::date, ${label}, now())
        ON CONFLICT (currency, market, category) DO UPDATE
          SET cost_micros = EXCLUDED.cost_micros, effective_on = EXCLUDED.effective_on,
              source_label = EXCLUDED.source_label, imported_at = now()`);
    }
    this.invalidate();
    const keep = new Set(card.rows.map((r) => key(r.market, r.category)));
    for (const old of await this.readRows(tx, card.currency)) {
      if (keep.has(key(old.market, old.category))) continue;
      await tx.execute(sql`
        DELETE FROM meta_rate_cards
        WHERE currency = ${card.currency} AND market = ${old.market} AND category = ${old.category}`);
    }
  }

  // --- reading what is stored -----------------------------------------------------------------------------------------------

  /** Every row of one currency's card. */
  async rowsFor(
    tx: Tx,
    currency: string,
  ): Promise<Array<{ market: string; category: MetaCardCategory; costMicros: number }>> {
    const rows = await this.readRows(tx, currency);
    return rows.map((r) => ({
      market: r.market,
      category: r.category as MetaCardCategory,
      costMicros: Number(r.cost_micros),
    }));
  }

  /** The currencies that have a stored card, held for 30 seconds per process. */
  async currencies(tx: Tx): Promise<string[]> {
    if (this.currencyList && Date.now() - this.currencyList.at < CACHE_MS)
      return this.currencyList.list;
    const res = await tx.execute(
      sql`SELECT DISTINCT currency FROM meta_rate_cards ORDER BY currency`,
    );
    const list = (res.rows as unknown as Array<{ currency: string }>).map((r) => r.currency);
    this.currencyList = { at: Date.now(), list };
    return list;
  }

  /**
   * What Meta charges per message in `currency`, by country and category: the country's market, else Meta's "Other" market.
   * Always answers; with no card for the currency every lookup is null. Held for 30 seconds per process like the rate grid.
   */
  async lookup(tx: Tx, currency: string): Promise<MetaCostLookup> {
    let hit = this.costs.get(currency);
    if (!hit || Date.now() - hit.at >= CACHE_MS) {
      const rows = await this.readRows(tx, currency);
      hit = {
        at: Date.now(),
        byKey: new Map(rows.map((r) => [key(r.market, r.category), Number(r.cost_micros)])),
      };
      this.costs.set(currency, hit);
    }
    const byKey = hit.byKey;
    return (country, category) => {
      const c = (category ?? '').trim().toLowerCase();
      if (!c) return null;
      return byKey.get(key(marketOf(country), c)) ?? byKey.get(key(OTHER_MARKET, c)) ?? null;
    };
  }

  // --- the screens ----------------------------------------------------------------------------------------------------------

  private summarise(
    currency: string,
    platformCurrency: string,
    agg: { rows: number; markets: number; effective: string; checked: string; label: string },
    today: Date,
  ): MetaCardSummary {
    return {
      currency,
      effectiveOn: agg.effective,
      checkedOn: agg.checked,
      sourceLabel: agg.label,
      markets: agg.markets,
      rows: agg.rows,
      isPlatformCurrency: currency === platformCurrency,
      freshness: cardFreshness(agg.checked, today),
    };
  }

  async overview(today = new Date()): Promise<MetaCardsResponse> {
    const platformCurrency = await this.settings.currency();
    const { cards, inUse } = await this.store.tx(async (tx) => {
      const agg = await tx.execute(sql`
        SELECT currency, count(*)::int AS rows, count(DISTINCT market)::int AS markets,
               max(effective_on)::text AS effective, max(imported_at)::date::text AS checked, max(source_label) AS label
        FROM meta_rate_cards GROUP BY currency ORDER BY currency`);
      const used = await tx.execute(sql`
        SELECT DISTINCT upper(settings->>'currency') AS currency FROM organizations
        WHERE settings->>'currency' ~ '^[A-Za-z]{3}$'`);
      return {
        cards: agg.rows as unknown as Array<{
          currency: string;
          rows: number;
          markets: number;
          effective: string;
          checked: string;
          label: string;
        }>,
        inUse: (used.rows as unknown as Array<{ currency: string }>).map((r) => r.currency),
      };
    });
    const summaries = cards.map((c) => this.summarise(c.currency, platformCurrency, c, today));
    const have = new Set(summaries.map((s) => s.currency));
    const missing = [...new Set([platformCurrency, ...inUse])].filter((c) => !have.has(c)).sort();
    return {
      platformCurrency,
      cards: summaries,
      missing,
      reminder: mostPressing(
        [...summaries.map((s) => s.freshness), ...missing.map(() => cardFreshness(null, today))],
        today,
      ),
    };
  }

  async detail(currency: string, today = new Date()): Promise<MetaCardDetail> {
    const code = currency.trim().toUpperCase();
    const overview = await this.overview(today);
    const card = overview.cards.find((c) => c.currency === code);
    if (!card) throw AppError.notFound('Meta rate card');
    const rows = await this.store.tx((tx) => this.rowsFor(tx, code));
    const byMarket = new Map<string, Map<string, number>>();
    for (const r of rows) {
      const m = byMarket.get(r.market) ?? new Map<string, number>();
      m.set(r.category, r.costMicros);
      byMarket.set(r.market, m);
    }
    const markets = ALL_MARKETS.filter((m) => byMarket.has(m)).map((market) => {
      const costs = byMarket.get(market)!;
      return {
        market,
        countries: market === OTHER_MARKET ? [] : countriesOf(market),
        costs: Object.fromEntries(
          META_CARD_CATEGORIES.map((c) => [c, costs.has(c) ? microsToMajor(costs.get(c)!) : null]),
        ) as MetaCardDetail['markets'][number]['costs'],
      };
    });
    return { card, markets };
  }
}
