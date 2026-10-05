import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  WALLET_CATEGORIES,
  majorToMicros,
  microsToMajor,
  microsToMinor,
  normalizeWalletCategory,
  normalizeWalletCountry,
  walletMajorToMinor,
  type ImportMetaCardInput,
  type ImportMetaCardResult,
  type ImportRatesResult,
  type RateRow,
  type RatesResponse,
  type SaveRatesResult,
  type SyncMetaResult,
  type UpsertRateInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { PlatformSettingsService, PlatformStore } from '../auth';
import { CurrencyService } from '../platform-settings-branding-storage';
import { countryList, countryName } from './phone-country';
import { convertMicros, parseRateCardCsv } from './rate-card-csv';
import { BUNDLED_RATE_CARD, BUNDLED_RATE_CARD_VERSION } from './meta-rate-card';
import { countriesOf, OTHER_MARKET } from './meta-markets';
import { MetaRateCardService } from './meta-rate-card.service';
import { RateCardService } from './rate-card.service';
import type { Operator } from './platform-wallet.service';
import { WalletLogService } from './wallet-log.service';
import { WalletSettingsService } from './wallet-settings.service';
import { priceMessage, type RateCardRow } from './wallet-rules';

const SEED: ReadonlyArray<[string, string, number]> = [
  ['', '', 100],
  ['', 'service', 0],
  ['', 'utility', 100],
  ['', 'authentication', 100],
  ['IN', 'marketing', 100],
  ['US', 'marketing', 1200],
  ['GB', 'marketing', 1200],
  ['BR', 'marketing', 600],
  ['AE', 'marketing', 500],
  ['MX', 'marketing', 300],
];

interface CostEntry {
  country: string;
  category: string;
  /** Millionths of the platform currency; null keeps the stored cost. */
  micros: number | null;
  /** Customer price from the file (import only). */
  priceMinor?: number;
}

interface DbRate {
  id: string | number;
  uuid: string;
  country_code: string;
  category: string;
  credits: number;
  micros: string | null;
  minor: string | null;
  currency: string | null;
  is_active: boolean;
  row_version: number;
  updated_at: Date;
}

const RATES_ENDPOINT_DOC = 'bsp.reseller';
const RATES_TOKEN_KEY = 'bsp.system_user_token';
const FETCH_TIMEOUT_MS = 20_000;

/**
 * The operator's rate card: the grid, the starter card, the CSV import and "Sync Meta costs" (WD-WALLET-005, -006, -007).
 * Every write goes through the platform door in one transaction with its platform-log row, drops the resolver's snapshot, and is
 * validated server side, per row, with the reason a row was skipped (WaDesk skipped silently). Differences from WaDesk, each
 * deliberate and listed in the parity file: a rate save no longer touches the two master switches; Meta cost keeps 6 decimals; a
 * row that import or sync CREATES takes the price the same message already had (WaDesk created it at 0, which with per-country
 * pricing on made that country's messages free); import can be previewed before it writes.
 */
@Injectable()
export class PlatformRatesService {
  private readonly logger = new Logger(PlatformRatesService.name);

  constructor(
    private readonly store: PlatformStore,
    private readonly platform: PlatformSettingsService,
    private readonly currencies: CurrencyService,
    private readonly settings: WalletSettingsService,
    private readonly rates: RateCardService,
    private readonly log: WalletLogService,
    private readonly cards: MetaRateCardService,
  ) {}

  // --- the grid -----------------------------------------------------------------------------------------------------------------

  async list(): Promise<RatesResponse> {
    const s = await this.settings.effective();
    const rows = await this.store.tx((tx) => this.readAll(tx));
    return {
      currency: s.currency,
      perCountryEnabled: s.perCountryEnabled,
      data: rows.map((r) => this.toRow(r)),
      countries: countryList(),
    };
  }

  private async readAll(tx: Tx): Promise<DbRate[]> {
    const res = await tx.execute(sql`
      SELECT id, uuid, country_code, category, credits, meta_cost_micros::text AS micros, meta_cost_minor::text AS minor,
             currency, is_active, row_version, updated_at
      FROM message_rates ORDER BY (country_code = '' AND category = '') DESC, country_code, category`);
    return res.rows as unknown as DbRate[];
  }

  private toRow(r: DbRate): RateRow {
    const micros =
      r.micros !== null ? Number(r.micros) : r.minor !== null ? Number(r.minor) * 10_000 : null;
    return {
      id: r.uuid,
      countryCode: r.country_code,
      countryName: r.country_code ? countryName(r.country_code) : '',
      category: r.category as RateRow['category'],
      priceMinor: r.credits,
      metaCost: micros === null ? null : microsToMajor(micros),
      marginMinor: micros === null ? null : r.credits - microsToMinor(micros),
      currency: r.currency,
      isActive: r.is_active,
      rowVersion: r.row_version,
      updatedAt: new Date(r.updated_at).toISOString(),
    };
  }

  /**
   * Upserts the submitted rows. Per row: country 2 letters or blank, category one of the four or blank, a blank price leaves the
   * stored price (a new row then starts from the price that message has today), a blank cost clears the cost. A key repeated in
   * one submit keeps its FIRST row.
   */
  async save(rows: UpsertRateInput[], operator: Operator): Promise<SaveRatesResult> {
    const platformCurrency = await this.settings.currency();
    const skipped: SaveRatesResult['skipped'] = [];
    let saved = 0;
    const changes: Array<Record<string, unknown>> = [];
    await this.store.tx(async (tx) => {
      const existing = await this.readAll(tx);
      const card = existing.map(toCard);
      const seen = new Set<string>();
      for (const [index, r] of rows.entries()) {
        const country = normalizeWalletCountry(r.countryCode);
        if (r.countryCode.trim() !== '' && country === '') {
          skipped.push({ index, reason: 'Use a 2-letter country code' });
          continue;
        }
        const category = normalizeWalletCategory(r.category);
        const key = `${country}|${category}`;
        if (seen.has(key)) {
          skipped.push({ index, reason: 'Repeated country and category: the first row was kept' });
          continue;
        }
        seen.add(key);
        const priceText = (r.price ?? '').trim();
        const costText = (r.metaCost ?? '').trim();
        if (priceText === '' && costText === '') {
          skipped.push({ index, reason: 'Enter a price or a Meta cost' });
          continue;
        }
        const price = priceText === '' ? undefined : walletMajorToMinor(priceText);
        if (price === null) {
          skipped.push({ index, reason: 'The price is not an amount with at most 2 decimals' });
          continue;
        }
        const micros = costText === '' ? null : majorToMicros(costText);
        if (costText !== '' && micros === null) {
          skipped.push({ index, reason: 'The Meta cost is not an amount with at most 6 decimals' });
          continue;
        }
        const prior = existing.find((e) => e.country_code === country && e.category === category);
        const startPrice =
          price ?? prior?.credits ?? (await this.currentPrice(card, country, category));
        await tx.execute(sql`
          INSERT INTO message_rates (country_code, category, credits, meta_cost_micros, meta_cost_minor, currency, is_active)
          VALUES (${country}, ${category}, ${startPrice}, ${micros}, ${micros === null ? null : microsToMinor(micros)},
                  ${micros === null ? null : r.currency || platformCurrency}, true)
          ON CONFLICT (country_code, category) DO UPDATE
            SET credits = EXCLUDED.credits, meta_cost_micros = EXCLUDED.meta_cost_micros,
                meta_cost_minor = EXCLUDED.meta_cost_minor, currency = EXCLUDED.currency, is_active = true`);
        saved += 1;
        changes.push({
          key,
          priceMinor: { old: prior?.credits ?? null, new: startPrice },
          metaCostMicros: { old: prior?.micros ? Number(prior.micros) : null, new: micros },
        });
      }
      if (saved > 0) {
        await this.log.platform(tx, {
          event: 'platform.rate.saved',
          message: `${saved} rate${saved === 1 ? '' : 's'} saved${skipped.length ? `, ${skipped.length} skipped` : ''}`,
          operatorId: operator.id,
          actorLabel: operator.label,
          payload: { saved, skipped: skipped.length, changes: changes.slice(0, 50) },
        });
      }
    });
    this.rates.invalidate();
    return { saved, skipped };
  }

  async remove(uuid: string, operator: Operator): Promise<boolean> {
    const removed = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        DELETE FROM message_rates WHERE uuid = ${uuid}::uuid RETURNING country_code, category, credits`);
      const r = res.rows[0] as
        { country_code: string; category: string; credits: number } | undefined;
      if (!r) return false;
      await this.log.platform(tx, {
        event: 'platform.rate.deleted',
        severity: 'warning',
        message: `Rate ${r.country_code || 'any country'} / ${r.category || 'any category'} removed`,
        operatorId: operator.id,
        actorLabel: operator.label,
        payload: { key: `${r.country_code}|${r.category}`, priceMinor: r.credits },
      });
      return true;
    });
    if (!removed) throw AppError.notFound('Rate');
    this.rates.invalidate();
    return true;
  }

  async seed(operator: Operator): Promise<number> {
    await this.store.tx(async (tx) => {
      for (const [country, category, price] of SEED) {
        await tx.execute(sql`
          INSERT INTO message_rates (country_code, category, credits, is_active) VALUES (${country}, ${category}, ${price}, true)
          ON CONFLICT (country_code, category) DO UPDATE SET credits = EXCLUDED.credits, is_active = true`);
      }
      await this.log.platform(tx, {
        event: 'platform.rates.seeded',
        severity: 'warning',
        message: 'Starter rate card re-applied (prices of ten rows reset)',
        operatorId: operator.id,
        actorLabel: operator.label,
        payload: { rows: SEED.length },
      });
    });
    this.rates.invalidate();
    return SEED.length;
  }

  // --- import (WD-WALLET-006) ------------------------------------------------------------------------------------------------

  async import(csv: string, dryRun: boolean, operator: Operator): Promise<ImportRatesResult> {
    const parsed = parseRateCardCsv(csv);
    if (parsed.rows.length === 0) {
      throw new AppError(
        ERROR_CODES.WALLET_IMPORT_FAILED,
        parsed.problems[0]?.reason ?? 'No usable row in the file.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        parsed.problems.slice(0, 10).map((p) => ({ path: `line ${p.line}`, message: p.reason })),
      );
    }
    const platformCurrency = await this.settings.currency();
    const entries: CostEntry[] = [];
    const prices = new Map<string, number>();
    for (const r of parsed.rows) {
      const from = r.currency || platformCurrency;
      const micros =
        r.costMicros === undefined || r.costMicros === null
          ? null
          : await this.toPlatformMicros(r.costMicros, from, platformCurrency);
      const key = `${r.countryCode}|${r.category}`;
      if (r.priceMinor !== undefined) prices.set(key, r.priceMinor);
      // A long file may carry a price without a cost, or a cost without a price: either way the row upserts.
      if (micros === null && r.priceMinor === undefined) continue;
      entries.push({ country: r.countryCode, category: r.category, micros });
    }
    const result = await this.applyCosts(entries, prices, dryRun);
    const out: ImportRatesResult = {
      dryRun,
      shape: parsed.shape,
      added: result.added,
      updated: result.updated,
      skipped: parsed.problems.length,
      currency: platformCurrency,
      problems: parsed.problems.slice(0, 20),
    };
    if (!dryRun) {
      await this.store.tx((tx) =>
        this.log.platform(tx, {
          event: 'platform.rates.imported',
          message: `Rate card imported: ${out.added} added, ${out.updated} updated, ${out.skipped} skipped`,
          operatorId: operator.id,
          actorLabel: operator.label,
          payload: {
            shape: out.shape,
            added: out.added,
            updated: out.updated,
            skipped: out.skipped,
            currency: out.currency,
          },
        }),
      );
    }
    return out;
  }

  // --- sync (WD-WALLET-007) --------------------------------------------------------------------------------------------------

  async syncMeta(dryRun: boolean, operator: Operator): Promise<SyncMetaResult> {
    const platformCurrency = await this.settings.currency();
    const live = await this.fetchLive();
    // Order: the operator's live endpoint, then the official Meta card stored for the platform currency, then the bundled
    // indicative card (a last resort that the result says plainly is "bundled").
    let entries: CostEntry[] = [];
    let source: SyncMetaResult['source'] = 'bundled';
    let sourceLabel = 'bundled reference';
    let version: string | null = BUNDLED_RATE_CARD_VERSION;
    if (live) {
      source = 'live';
      sourceLabel = 'Meta (live)';
      version = live.version;
      entries = await this.liveEntries(live.rows, platformCurrency);
    } else {
      const stored = await this.storedCardEntries(platformCurrency);
      if (stored) {
        source = 'card';
        sourceLabel = `Meta rate card (${platformCurrency}, effective ${stored.effectiveOn})`;
        version = stored.effectiveOn;
        entries = stored.entries;
      } else {
        entries = await this.liveEntries(bundledAsRows(), platformCurrency);
      }
    }
    if (entries.length === 0) {
      throw new AppError(
        ERROR_CODES.WALLET_SYNC_FAILED,
        'Could not fetch rates from Meta, and the bundled fallback is unreadable.',
        HttpStatus.BAD_GATEWAY,
      );
    }
    const result = await this.applyCosts(entries, new Map(), dryRun);
    const out: SyncMetaResult = {
      dryRun,
      source,
      sourceLabel,
      version,
      currency: platformCurrency,
      added: result.added,
      updated: result.updated,
    };
    if (!dryRun) {
      await this.store.tx((tx) =>
        this.log.platform(tx, {
          event: 'platform.rates.synced',
          message: `Meta costs synced from ${out.sourceLabel}: ${out.added} added, ${out.updated} updated`,
          operatorId: operator.id,
          actorLabel: operator.label,
          payload: { ...out },
        }),
      );
    }
    return out;
  }

  /** Costs from rows of one amount per category, converted into the platform currency. */
  private async liveEntries(rows: LiveRow[], platformCurrency: string): Promise<CostEntry[]> {
    const entries: CostEntry[] = [];
    for (const row of rows) {
      const country = row.country === '*' ? '' : normalizeWalletCountry(row.country);
      if (row.country !== '*' && country === '') continue;
      for (const category of ['marketing', 'utility', 'authentication'] as const) {
        const amount = row[category];
        if (amount === undefined || amount === null) continue;
        const micros = majorToMicros(String(amount));
        if (micros === null) continue;
        entries.push({
          country,
          category,
          micros: await this.toPlatformMicros(micros, row.currency || 'USD', platformCurrency),
        });
      }
    }
    return entries;
  }

  /**
   * The costs of the stored official card for `currency`, one entry per country Meta prices and category, plus the any-country
   * default (Meta's "Other" market). No conversion: the card is already in this currency. Null when no card is stored.
   */
  private async storedCardEntries(
    currency: string,
  ): Promise<{ effectiveOn: string; entries: CostEntry[] } | null> {
    const detail = await this.cards.detail(currency).catch(() => null);
    if (!detail) return null;
    const entries: CostEntry[] = [];
    for (const m of detail.markets) {
      const countries = m.market === OTHER_MARKET ? [''] : countriesOf(m.market);
      for (const category of ['marketing', 'utility', 'authentication', 'service'] as const) {
        const amount = m.costs[category];
        const micros = amount === null || amount === undefined ? null : majorToMicros(amount);
        if (micros === null) continue;
        for (const country of countries) entries.push({ country, category, micros });
      }
    }
    return entries.length === 0 ? null : { effectiveOn: detail.card.effectiveOn, entries };
  }

  // --- Meta's published card (the quarterly file) ---------------------------------------------------------------------------

  /**
   * Imports the file Meta publishes for one currency. The card is stored as a whole; when it is the platform currency's card the
   * Meta cost behind pricing, margins and the reseller P&L is refreshed from it in the same call (customer prices are not touched).
   * `dryRun` reads the file and reports what would change without writing.
   */
  async importMetaCard(
    input: ImportMetaCardInput,
    operator: Operator,
  ): Promise<ImportMetaCardResult> {
    const card = this.cards.parse(input.file);
    const platformCurrency = await this.settings.currency();
    const appliesToPricing = card.currency === platformCurrency;
    const diff = await this.store.tx((tx) => this.cards.compare(tx, card));
    let pricing: ImportMetaCardResult['pricing'] = null;
    if (!input.dryRun) {
      await this.store.tx(async (tx) => {
        await this.cards.replace(tx, card, input.fileName);
        await this.log.platform(tx, {
          event: 'platform.meta_card.imported',
          message: `Meta ${card.currency} rate card imported (effective ${card.effectiveOn}): ${diff.added} added, ${diff.changed} changed, ${diff.removed} removed`,
          operatorId: operator.id,
          actorLabel: operator.label,
          payload: {
            currency: card.currency,
            effectiveOn: card.effectiveOn,
            fileName: input.fileName ?? null,
            added: diff.added,
            changed: diff.changed,
            unchanged: diff.unchanged,
            removed: diff.removed,
            problems: diff.problems.length,
          },
        });
      });
    }
    if (appliesToPricing) {
      // On a dry run nothing is stored yet, so the entries come from the parsed file; either way the same expansion.
      const entries = this.cardEntries(card.rows);
      pricing = await this.applyCosts(entries, new Map(), input.dryRun);
      if (!input.dryRun) {
        await this.store.tx((tx) =>
          this.log.platform(tx, {
            event: 'platform.rates.synced',
            message: `Meta costs refreshed from the ${card.currency} card: ${pricing!.added} added, ${pricing!.updated} updated`,
            operatorId: operator.id,
            actorLabel: operator.label,
            payload: { currency: card.currency, effectiveOn: card.effectiveOn, ...pricing },
          }),
        );
      }
    }
    return { ...diff, dryRun: input.dryRun, appliedToPricing: appliesToPricing, pricing };
  }

  private cardEntries(
    rows: ReadonlyArray<{ market: string; category: string; costMicros: number }>,
  ): CostEntry[] {
    const entries: CostEntry[] = [];
    for (const r of rows) {
      if (!['marketing', 'utility', 'authentication', 'service'].includes(r.category)) continue;
      const countries = r.market === OTHER_MARKET ? [''] : countriesOf(r.market);
      for (const country of countries) {
        entries.push({ country, category: r.category, micros: r.costMicros });
      }
    }
    return entries;
  }

  /** The operator's Meta pricing endpoint (set on the reseller page), or null: not configured, not 200, empty, or any error. */
  private async fetchLive(): Promise<{ version: string | null; rows: LiveRow[] } | null> {
    try {
      const doc = await this.platform.get<{ connection?: { ratesEndpoint?: string } }>(
        RATES_ENDPOINT_DOC,
      );
      const endpoint = doc?.connection?.ratesEndpoint?.trim();
      const token = await this.platform.getSecret(RATES_TOKEN_KEY);
      if (!endpoint || !token || !/^https:\/\//i.test(endpoint)) return null;
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(endpoint, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
          signal: ctl.signal,
        });
        if (!res.ok) {
          this.logger.warn(
            { status: res.status },
            '[RATE-SYNC] live source answered with an error',
          );
          return null;
        }
        const rows = parseLive(await res.json());
        return rows.rows.length > 0 ? rows : null;
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      this.logger.warn({ err }, '[RATE-SYNC] live source failed, using the bundled card');
      return null;
    }
  }

  // --- shared -----------------------------------------------------------------------------------------------------------------

  private async toPlatformMicros(micros: number, from: string, to: string): Promise<number> {
    if (from.toUpperCase() === to.toUpperCase()) return micros;
    const [a, b] = await Promise.all([this.currencies.find(from), this.currencies.find(to)]);
    return convertMicros(micros, Number(a?.rate ?? 1), Number(b?.rate ?? 1));
  }

  private async currentPrice(
    card: RateCardRow[],
    country: string,
    category: string,
  ): Promise<number> {
    const s = await this.settings.effective();
    return priceMessage(card, {
      country,
      category,
      perCountryEnabled: s.perCountryEnabled,
      flatPriceMinor: s.flatPriceMinor,
    }).priceMinor;
  }

  /**
   * Upserts costs for (country, category) pairs. Existing rows keep their customer price unless the file gave one; a NEW row takes
   * the price its messages already have so adding a cost never makes a country free.
   */
  private async applyCosts(
    entries: CostEntry[],
    prices: Map<string, number>,
    dryRun: boolean,
  ): Promise<{ added: number; updated: number }> {
    const platformCurrency = await this.settings.currency();
    let added = 0;
    let updated = 0;
    const run = async (tx: Tx) => {
      const existing = await this.readAll(tx);
      const card = existing.map(toCard);
      const done = new Set<string>();
      for (const e of entries) {
        const key = `${e.country}|${e.category}`;
        if (done.has(key)) continue;
        done.add(key);
        const prior = existing.find(
          (r) => r.country_code === e.country && r.category === e.category,
        );
        const price =
          prices.get(key) ??
          prior?.credits ??
          (await this.currentPrice(card, e.country, e.category));
        if (prior) updated += 1;
        else added += 1;
        if (dryRun) continue;
        const cost = e.micros ?? (prior?.micros ? Number(prior.micros) : null);
        await tx.execute(sql`
          INSERT INTO message_rates (country_code, category, credits, meta_cost_micros, meta_cost_minor, currency, is_active)
          VALUES (${e.country}, ${e.category}, ${price}, ${cost}, ${cost === null ? null : microsToMinor(cost)}, ${platformCurrency}, true)
          ON CONFLICT (country_code, category) DO UPDATE
            SET credits = EXCLUDED.credits, meta_cost_micros = EXCLUDED.meta_cost_micros,
                meta_cost_minor = EXCLUDED.meta_cost_minor, currency = EXCLUDED.currency, is_active = true`);
      }
    };
    await this.store.tx(run);
    if (!dryRun) this.rates.invalidate();
    return { added, updated };
  }
}

interface LiveRow {
  country: string;
  currency?: string;
  marketing?: number | string | null;
  utility?: number | string | null;
  authentication?: number | string | null;
}

function toCard(r: DbRate): RateCardRow {
  return {
    countryCode: r.country_code,
    category: r.category,
    priceMinor: r.credits,
    metaCostMicros:
      r.micros !== null ? Number(r.micros) : r.minor !== null ? Number(r.minor) * 10_000 : null,
  };
}

function bundledAsRows(): LiveRow[] {
  return BUNDLED_RATE_CARD.map((r) => ({ ...r, currency: 'USD' }));
}

/** Accepts `{rates:[{country,currency,marketing,...}], version}` or a flat (or `data:` wrapped) list of one amount per row. */
export function parseLive(body: unknown): { version: string | null; rows: LiveRow[] } {
  const obj = (body ?? {}) as Record<string, unknown>;
  const version = typeof obj.version === 'string' ? obj.version : null;
  const list = Array.isArray(obj.rates)
    ? obj.rates
    : Array.isArray(obj.data)
      ? obj.data
      : Array.isArray(body)
        ? (body as unknown[])
        : [];
  const folded = new Map<string, LiveRow>();
  for (const item of list) {
    const r = (item ?? {}) as Record<string, unknown>;
    const country = String(r.country ?? r.country_code ?? '').trim();
    if (!country) continue;
    const row = folded.get(country) ?? {
      country,
      currency: typeof r.currency === 'string' ? r.currency : undefined,
    };
    const category = typeof r.category === 'string' ? r.category.toLowerCase() : null;
    const amount = r.rate ?? r.amount ?? r.price;
    if (
      category &&
      (WALLET_CATEGORIES as readonly string[]).includes(category) &&
      amount !== undefined
    ) {
      (row as unknown as Record<string, unknown>)[category] = amount as number | string;
    } else {
      for (const c of ['marketing', 'utility', 'authentication'] as const) {
        if (r[c] !== undefined)
          (row as unknown as Record<string, unknown>)[c] = r[c] as number | string;
      }
    }
    folded.set(country, row);
  }
  return { version, rows: [...folded.values()] };
}
