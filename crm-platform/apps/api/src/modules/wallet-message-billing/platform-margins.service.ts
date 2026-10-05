import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  microsToMajor,
  normalizeWalletCategory,
  normalizeWalletCountry,
  percentToBps,
  priceFromMargin,
  type MarginInput,
  type MarginRow,
  type MarginsResponse,
  type PricePreview,
  type PricePreviewQuery,
  type SaveMarginsResult,
  type SaveWorkspaceMarginsInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuthAuditService, PlatformStore } from '../auth';
import { BillingCurrencyService } from './billing-currency.service';
import { MetaRateCardService } from './meta-rate-card.service';
import { countryList, countryName } from './phone-country';
import type { Operator } from './platform-wallet.service';
import { RateCardService } from './rate-card.service';
import { WalletLogService } from './wallet-log.service';
import { WalletSettingsService } from './wallet-settings.service';
import { priceMessage } from './wallet-rules';

interface DbMargin {
  uuid: string;
  country_code: string;
  category: string;
  margin_bps: number;
  note?: string | null;
  set_by?: string | null;
  updated_at: Date;
}

/**
 * Margin pricing for the operator (the pricing requirement): the margin over Meta's cost per country and message category,
 * set once for the platform, per plan, and overridden for a single workspace with a reason. `RateCardService` is what the
 * billing engine reads; this service only edits the margin tables and explains a price.
 */
@Injectable()
export class PlatformMarginsService {
  constructor(
    private readonly store: PlatformStore,
    private readonly db: DatabaseService,
    private readonly settings: WalletSettingsService,
    private readonly rates: RateCardService,
    private readonly cards: MetaRateCardService,
    private readonly billing: BillingCurrencyService,
    private readonly log: WalletLogService,
    private readonly audit: AuthAuditService,
  ) {}

  // --- plan margins (and the platform default, plan '') ----------------------------------------------------------------------

  async listPlan(planSlug: string): Promise<MarginsResponse> {
    const s = await this.settings.effective();
    return this.store.tx(async (tx) => {
      const plans = await this.plans(tx);
      if (planSlug !== '' && !plans.some((p) => p.slug === planSlug))
        throw AppError.notFound('Plan');
      const res = await tx.execute(sql`
        SELECT uuid, country_code, category, margin_bps, updated_at FROM plan_message_margins
        WHERE plan_slug = ${planSlug} ORDER BY (country_code = '' AND category = '') DESC, country_code, category`);
      const cost = await this.costOf(tx, s.currency);
      return {
        scope:
          planSlug === '' ? { type: 'platform' as const } : { type: 'plan' as const, planSlug },
        pricingMode: s.pricingMode,
        currency: s.currency,
        plans,
        data: (res.rows as unknown as DbMargin[]).map((r) => this.row(r, cost)),
        countries: countryList(),
      };
    });
  }

  async savePlan(
    planSlug: string,
    rows: MarginInput[],
    operator: Operator,
  ): Promise<SaveMarginsResult> {
    const skipped: SaveMarginsResult['skipped'] = [];
    let saved = 0;
    const changes: Array<Record<string, unknown>> = [];
    await this.store.tx(async (tx) => {
      if (planSlug !== '') {
        const ok = await tx.execute(
          sql`SELECT 1 FROM plans WHERE slug = ${planSlug} AND kind = 'plan'`,
        );
        if (ok.rows.length === 0) throw AppError.notFound('Plan');
      }
      const seen = new Set<string>();
      for (const [index, r] of rows.entries()) {
        const parsed = this.parse(r);
        if ('reason' in parsed) {
          skipped.push({ index, reason: parsed.reason });
          continue;
        }
        const key = `${parsed.country}|${parsed.category}`;
        if (seen.has(key)) {
          skipped.push({ index, reason: 'Repeated country and category: the first row was kept' });
          continue;
        }
        seen.add(key);
        const prior = await tx.execute(sql`
          SELECT margin_bps FROM plan_message_margins
          WHERE plan_slug = ${planSlug} AND country_code = ${parsed.country} AND category = ${parsed.category}`);
        await tx.execute(sql`
          INSERT INTO plan_message_margins (plan_slug, country_code, category, margin_bps)
          VALUES (${planSlug}, ${parsed.country}, ${parsed.category}, ${parsed.bps})
          ON CONFLICT (plan_slug, country_code, category) DO UPDATE SET margin_bps = EXCLUDED.margin_bps`);
        saved += 1;
        changes.push({
          key,
          marginBps: {
            old: (prior.rows[0] as { margin_bps?: number } | undefined)?.margin_bps ?? null,
            new: parsed.bps,
          },
        });
      }
      if (saved > 0) {
        await this.log.platform(tx, {
          event: 'platform.margins.saved',
          message: `${saved} margin${saved === 1 ? '' : 's'} saved for ${planSlug === '' ? 'the platform default' : `plan ${planSlug}`}`,
          operatorId: operator.id,
          actorLabel: operator.label,
          payload: { planSlug, saved, skipped: skipped.length, changes: changes.slice(0, 50) },
        });
      }
    });
    this.rates.invalidate();
    return { saved, removed: 0, skipped };
  }

  async removePlan(uuid: string, operator: Operator): Promise<boolean> {
    const removed = await this.store.tx(async (tx) => {
      const res = await tx.execute(sql`
        DELETE FROM plan_message_margins WHERE uuid = ${uuid}::uuid RETURNING plan_slug, country_code, category, margin_bps`);
      const r = res.rows[0] as
        | { plan_slug: string; country_code: string; category: string; margin_bps: number }
        | undefined;
      if (!r) return false;
      await this.log.platform(tx, {
        event: 'platform.margins.deleted',
        severity: 'warning',
        message: `Margin ${r.plan_slug || 'default'} / ${r.country_code || 'any country'} / ${r.category || 'any category'} removed`,
        operatorId: operator.id,
        actorLabel: operator.label,
        payload: {
          planSlug: r.plan_slug,
          key: `${r.country_code}|${r.category}`,
          marginBps: r.margin_bps,
        },
      });
      return true;
    });
    if (!removed) throw AppError.notFound('Margin');
    this.rates.invalidate();
    return true;
  }

  // --- one workspace's overrides ----------------------------------------------------------------------------------------------

  async listWorkspace(orgId: number, workspaceUuid: string): Promise<MarginsResponse> {
    const s = await this.settings.effective();
    const plans = await this.store.tx((tx) => this.plans(tx));
    return this.db.txAs({ orgId, userId: null }, async (tx) => {
      const res = await tx.execute(sql`
        SELECT uuid, country_code, category, margin_bps, note, set_by, updated_at FROM workspace_message_margins
        WHERE org_id = ${orgId} ORDER BY (country_code = '' AND category = '') DESC, country_code, category`);
      // A workspace billed in INR is shown Meta's INR cost and the INR price a margin gives.
      const unit = await this.billing.forOrg(tx, orgId);
      const cost = await this.costOf(tx, unit);
      return {
        scope: { type: 'workspace' as const, workspaceId: workspaceUuid },
        pricingMode: s.pricingMode,
        currency: unit,
        plans,
        data: (res.rows as unknown as DbMargin[]).map((r) => this.row(r, cost)),
        countries: countryList(),
      };
    });
  }

  /** Sets or removes overrides for one workspace. The reason is mandatory and goes to the workspace's wallet log and the audit trail. */
  async saveWorkspace(
    orgId: number,
    input: SaveWorkspaceMarginsInput,
    operator: Operator,
  ): Promise<SaveMarginsResult> {
    const skipped: SaveMarginsResult['skipped'] = [];
    let saved = 0;
    let removed = 0;
    const changes: Array<Record<string, unknown>> = [];
    await this.db.txAs({ orgId, userId: null }, async (tx) => {
      const seen = new Set<string>();
      for (const [index, r] of input.rows.entries()) {
        const parsed = this.parse(r);
        if ('reason' in parsed) {
          skipped.push({ index, reason: parsed.reason });
          continue;
        }
        const key = `${parsed.country}|${parsed.category}`;
        if (seen.has(key)) {
          skipped.push({ index, reason: 'Repeated country and category: the first row was kept' });
          continue;
        }
        seen.add(key);
        const prior = await tx.execute(sql`
          SELECT margin_bps FROM workspace_message_margins
          WHERE org_id = ${orgId} AND country_code = ${parsed.country} AND category = ${parsed.category}`);
        await tx.execute(sql`
          INSERT INTO workspace_message_margins (org_id, country_code, category, margin_bps, note, set_by)
          VALUES (${orgId}, ${parsed.country}, ${parsed.category}, ${parsed.bps}, ${input.note}, ${operator.label})
          ON CONFLICT (org_id, country_code, category) DO UPDATE
            SET margin_bps = EXCLUDED.margin_bps, note = EXCLUDED.note, set_by = EXCLUDED.set_by`);
        saved += 1;
        changes.push({
          key,
          marginBps: {
            old: (prior.rows[0] as { margin_bps?: number } | undefined)?.margin_bps ?? null,
            new: parsed.bps,
          },
        });
      }
      for (const id of input.removeIds) {
        const res = await tx.execute(sql`
          DELETE FROM workspace_message_margins WHERE org_id = ${orgId} AND uuid = ${id}::uuid
          RETURNING country_code, category, margin_bps`);
        const r = res.rows[0] as
          { country_code: string; category: string; margin_bps: number } | undefined;
        if (!r) continue;
        removed += 1;
        changes.push({
          key: `${r.country_code}|${r.category}`,
          marginBps: { old: r.margin_bps, new: null },
        });
      }
      if (saved + removed === 0) return;
      await this.log.event(tx, {
        orgId,
        event: 'wallet.margin.override_saved',
        severity: 'warning',
        message: `${operator.label} changed this workspace's pricing: ${saved} set, ${removed} removed`,
        actorType: 'platform_operator',
        actorLabel: operator.label,
        payload: { note: input.note, saved, removed, changes: changes.slice(0, 50) },
      });
      await this.audit.record(tx, {
        event: 'platform.wallet.margin_override',
        status: 'success',
        orgId,
        actorType: 'platform_operator',
        actorId: operator.id,
        payload: { note: input.note, saved, removed, changes: changes.slice(0, 50) },
      });
    });
    return { saved, removed, skipped };
  }

  // --- explaining a price -------------------------------------------------------------------------------------------------------

  async preview(q: PricePreviewQuery, orgId: number | null): Promise<PricePreview> {
    const s = await this.settings.effective();
    const country = normalizeWalletCountry(q.country);
    const category = normalizeWalletCategory(q.category);
    const run = async (tx: Tx, org: number) => {
      const priced = await this.rates.priceFor(tx, org, country || null, category);
      const layers = await this.rates.layersFor(tx, org);
      return { priced, planSlug: layers.planSlug };
    };
    const { priced, planSlug } =
      orgId === null
        ? await this.store.tx((tx) => run(tx, 0))
        : await this.db.txAs({ orgId, userId: null }, (tx) => run(tx, orgId));
    return {
      mode: s.pricingMode,
      currency: priced.currency,
      country,
      category,
      metaCost: priced.metaCostMicros === null ? null : microsToMajor(priced.metaCostMicros),
      marginBps: priced.margin?.marginBps ?? null,
      marginSource: priced.margin?.source ?? null,
      matchedMargin: priced.margin?.matched ?? null,
      priceMinor: priced.priceMinor,
      basis: priced.basis,
      matchedPrice: priced.matched,
      planSlug,
    };
  }

  async orgIdOf(workspaceUuid: string): Promise<number> {
    const res = await this.store.tx((tx) =>
      tx.execute(sql`SELECT id FROM organizations WHERE uuid = ${workspaceUuid}::uuid`),
    );
    const r = res.rows[0] as { id: string | number } | undefined;
    if (!r) throw AppError.notFound('Workspace');
    return Number(r.id);
  }

  // --- helpers -------------------------------------------------------------------------------------------------------------------

  private parse(
    r: MarginInput,
  ): { country: string; category: string; bps: number } | { reason: string } {
    const country = normalizeWalletCountry(r.countryCode);
    if (r.countryCode.trim() !== '' && country === '')
      return { reason: 'Use a 2-letter country code' };
    const bps = percentToBps(r.margin);
    if (bps === null) {
      return { reason: 'The margin is a percentage with at most 2 decimals, from -100 to 1000' };
    }
    return { country, category: normalizeWalletCategory(r.category), bps };
  }

  private async plans(tx: Tx): Promise<Array<{ slug: string; name: string }>> {
    const res = await tx.execute(
      sql`SELECT slug, name FROM plans WHERE kind = 'plan' ORDER BY sort_order, name`,
    );
    return res.rows as unknown as Array<{ slug: string; name: string }>;
  }

  /**
   * Meta's cost per (country, category) in `unit`. In the platform currency the grid's own cost wins and Meta's card fills the
   * gaps; in another currency Meta's card for that currency is the only source.
   */
  private async costOf(
    tx: Tx,
    unit: string,
  ): Promise<(country: string, category: string) => number | null> {
    const lookup = await this.cards.lookup(tx, unit);
    if (unit !== (await this.settings.currency())) return (c, k) => lookup(c || null, k || null);
    const card = await this.rates.rows(tx);
    return (c, k) =>
      priceMessage(card, {
        country: c,
        category: k,
        perCountryEnabled: false,
        flatPriceMinor: 0,
        fallbackCostMicros: lookup(c || null, k || null),
      }).metaCostMicros;
  }

  private row(
    r: DbMargin,
    costOf: (country: string, category: string) => number | null,
  ): MarginRow {
    const cost = costOf(r.country_code, r.category);
    return {
      id: r.uuid,
      countryCode: r.country_code,
      countryName: r.country_code ? countryName(r.country_code) : '',
      category: r.category as MarginRow['category'],
      marginBps: r.margin_bps,
      metaCost: cost === null ? null : microsToMajor(cost),
      priceMinor: cost === null ? null : priceFromMargin(cost, r.margin_bps),
      note: r.note ?? null,
      setBy: r.set_by ?? null,
      updatedAt: new Date(r.updated_at).toISOString(),
    };
  }
}
