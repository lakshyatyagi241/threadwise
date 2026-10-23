import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  addonKindOf,
  type AddonCard,
  type AddonUnavailableReason,
  type OperatorWorkspaceAddonsResponse,
  type OwnedAddon,
  type WorkspaceAddonsResponse,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import {
  PlanEntitlementService,
  offerOf,
  offersOfPlanSlug,
  planKind,
} from '../plans-subscriptions-trials';
import {
  addonLiveSql,
  cardState,
  grantBullets,
  isIncludedInPlan,
  missingGrants,
  readGrants,
  titledKey,
} from './addon-grants';
import { ModuleRegistryService } from './module-registry.service';

export interface PlanStateRow {
  plan_found: boolean;
  is_free: boolean | null;
  is_custom_quote: boolean | null;
  amount: string | null;
  plan_ends_at: string | null;
}

interface CardRow {
  id: number;
  uuid: string;
  slug: string;
  name: string;
  subtitle: string | null;
  amount: string;
  offer_amount: string | null;
  currency: string;
  is_free: boolean;
  is_lifetime: boolean;
  billing_unit: AddonCard['billingUnit'];
  billing_mode: AddonCard['billingMode'];
  billing_duration: number;
  features: unknown;
  limits: unknown;
}

/**
 * Why a workspace cannot buy a plain add-on, or null when it can: it needs an active PAID catalogue plan (not free, not a custom quote, not run
 * out). A paid plan that has run out falls back to free entitlements, which is what `plan_expired` tells the buyer to fix by renewing.
 */
export function unavailableReason(st: PlanStateRow | undefined): AddonUnavailableReason | null {
  if (!st?.plan_found) return 'no_plan';
  const kind = planKind({
    isFree: st.is_free ?? false,
    isCustomQuote: st.is_custom_quote ?? false,
    amount: st.amount ?? '0',
  });
  if (kind === 'free') return 'free_plan';
  if (st.plan_ends_at !== null && new Date(st.plan_ends_at) <= new Date()) return 'plan_expired';
  return null;
}

/**
 * What a workspace sees of the add-on catalogue (TW-ADD-033): the packs on sale, what each grants, what the
 * workspace already owns, and whether it may buy at all. Visibility is decided here, on the server: a workspace
 * without an active paid plan gets `eligible: false` and an empty catalogue, so the answer does not depend on the
 * screen hiding a button. The purchase itself belongs to checkout. The add-ons that sell a Marketplace app are not here (the Marketplace
 * shows them on the app's own page), so neither the catalogue nor the owned list carries them.
 */
@Injectable()
export class WorkspaceAddonsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly registry: ModuleRegistryService,
    private readonly plans: PlanEntitlementService,
  ) {}

  async forCurrentWorkspace(canBuy = true): Promise<WorkspaceAddonsResponse> {
    return this.forWorkspace(RequestContextStore.require().orgId, canBuy);
  }

  /**
   * The catalogue as one workspace sees it. The workspace screen and any operator view of the same workspace call this one function, so the
   * states cannot differ. A card is `included` when the PLAN already grants every feature of the pack (see `isIncludedInPlan`), and a
   * partly covered pack lists only what is still missing.
   */
  async forWorkspace(orgId: number, canBuy = true): Promise<WorkspaceAddonsResponse> {
    const { hidden: _hidden, ...out } = await this.list(orgId, canBuy, (fn) => this.db.tx(fn));
    return out;
  }

  /**
   * The operator's view of one workspace (the caller resolved its id through the operator's own store): the same list, run as that workspace, plus
   * the add-ons its plan hides and the feature overrides that win over the plan, so the console can say why each add-on is on or off.
   */
  async forOperator(orgId: number): Promise<OperatorWorkspaceAddonsResponse> {
    const e = await this.plans.forOrg(orgId, { ignorePacks: true });
    const listed = await this.list(orgId, false, (fn) => this.db.txAs({ orgId, userId: null }, fn));
    const featureOverrides = Object.fromEntries(
      Object.entries(e?.overrides.features ?? {}).filter(([, v]) => typeof v === 'boolean'),
    ) as Record<string, boolean>;
    return {
      ...listed,
      featureOverrides,
      platformOwned: e?.platformOwned ?? false,
      planName: e?.planName ?? null,
    };
  }

  private async list(
    orgId: number,
    canBuy: boolean,
    run: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>,
  ): Promise<WorkspaceAddonsResponse & { hidden: OperatorWorkspaceAddonsResponse['hidden'] }> {
    const live = sql.raw(addonLiveSql(await this.plans.graceDays()));
    // The plan whose add-on offers apply (a lapsed paid plan's free fallback has its own): included / paid at a plan price / hidden.
    // One resolution (packs ignored) feeds both the plan whose offers apply and what the plan already includes.
    const planOnly = await this.plans.forOrg(orgId, { ignorePacks: true });
    const offerPlanSlug = planOnly?.offerPlanSlug ?? null;
    return run(async (tx) => {
      const offers = offerPlanSlug ? await offersOfPlanSlug(tx, offerPlanSlug) : new Map();
      const stateRes = await tx.execute(sql`
        SELECT (p.id IS NOT NULL) AS plan_found, p.is_free, p.is_custom_quote, p.amount::text AS amount,
               s.plan_ends_at
        FROM organizations o
        LEFT JOIN plans p ON p.slug = o.plan AND p.kind = 'plan'
        LEFT JOIN org_plan_state s ON s.org_id = o.id
        WHERE o.id = ${orgId}
      `);
      const st = stateRes.rows[0] as unknown as PlanStateRow | undefined;
      // "Active paid plan": a catalogue plan that is not free and has not run out.
      const reason = unavailableReason(st);
      const eligible = reason === null;

      // A module's own labels win; a core key is spelled out.
      const [mf, ml] = await Promise.all([
        this.registry.planFeatures(),
        this.registry.planLimits(),
      ]);
      const labels = new Map([...mf, ...ml].map((f) => [f.key, f.label]));
      const labelOf = (key: string) => labels.get(key) ?? titledKey(key);

      const ownedRes = await tx.execute(sql`
        SELECT a.uuid, p.uuid AS pack_uuid, p.name, a.starts_at, a.ends_at, a.package_id::int AS package_id,
               EXISTS (SELECT 1 FROM subscriptions sb WHERE sb.org_id = a.org_id AND sb.workspace_addon_id = a.id
                       AND sb.kind = 'addon' AND sb.status IN ('active', 'past_due')) AS renews
        FROM workspace_addons a JOIN plans p ON p.id = a.package_id
        WHERE a.org_id = ${orgId} AND ${live}
          AND p.marketplace_app_id IS NULL
        ORDER BY a.created_at DESC, a.id DESC
      `);
      const ownedRows = ownedRes.rows as unknown as Array<{
        uuid: string;
        pack_uuid: string;
        name: string;
        starts_at: string | null;
        ends_at: string | null;
        package_id: number;
        renews: boolean;
      }>;
      const latestEnd = new Map<number, string | null>();
      const renewing = new Set<number>();
      for (const r of ownedRows) {
        if (r.renews) renewing.add(r.package_id);
        const end = r.ends_at ? new Date(r.ends_at).toISOString() : null;
        const have = latestEnd.get(r.package_id);
        if (have === undefined || (end !== null && (have === null || end > have)))
          latestEnd.set(r.package_id, end);
      }
      const ownedCount = new Map<number, number>();
      for (const r of ownedRows)
        ownedCount.set(r.package_id, (ownedCount.get(r.package_id) ?? 0) + 1);

      const catRes = await tx.execute(sql`
        SELECT id::int AS id, uuid, slug, name, subtitle, amount::text AS amount, offer_amount::text AS offer_amount,
               currency, is_free, is_lifetime, billing_unit, billing_duration, billing_mode, features, limits
        FROM plans WHERE kind = 'addon' AND is_active AND marketplace_app_id IS NULL ORDER BY sort_order ASC, amount ASC, slug ASC
      `);
      const packRows = catRes.rows as unknown as CardRow[];
      const { included, support } = await this.plans.includedByPlanDetailed(
        orgId,
        packRows.flatMap((r) => readGrants(r.features, r.limits).features),
        planOnly,
      );
      const catalog: AddonCard[] = [];
      const hidden: OperatorWorkspaceAddonsResponse['hidden'] = [];
      for (const r of packRows) {
        const grants = readGrants(r.features, r.limits);
        const owned = ownedCount.get(r.id) ?? 0;
        const offer = offerOf(offers, r.id);
        // A plan that hides an add-on does not list it; a workspace that still holds a purchase keeps seeing what it owns (it cannot buy again).
        if (offer.mode === 'hidden' && owned === 0) {
          hidden.push({ id: r.uuid, slug: r.slug, name: r.name });
          continue;
        }
        const state = cardState(grants, owned, included, eligible && offer.mode !== 'hidden');
        catalog.push({
          id: r.uuid,
          slug: r.slug,
          name: r.name,
          subtitle: r.subtitle,
          // The plan's own price wins over the add-on's (and its offer price, which belongs to the add-on's list price).
          amount: offer.amount ?? r.amount,
          offerAmount: offer.amount ? null : r.offer_amount,
          currency: r.currency,
          isFree: r.is_free,
          isLifetime: r.is_lifetime,
          billingUnit: r.billing_unit,
          billingMode: r.billing_mode,
          billingDuration: r.billing_duration,
          grantBullets: grantBullets(missingGrants(grants, included), labelOf),
          ownedCount: owned,
          ownedEndsAt: latestEnd.get(r.id) ?? null,
          ownedRenews: renewing.has(r.id),
          state: offer.mode === 'hidden' && state === 'buy_again' ? 'active' : state,
          includedVia: isIncludedInPlan(grants, included)
            ? grants.features.some((k) => support.has(k))
              ? 'support'
              : 'plan'
            : null,
          kind: addonKindOf(grants),
        });
      }
      const owned: OwnedAddon[] = ownedRows.map((r) => ({
        id: r.uuid,
        packId: r.pack_uuid,
        name: r.name,
        startsAt: r.starts_at ? new Date(r.starts_at).toISOString() : null,
        endsAt: r.ends_at ? new Date(r.ends_at).toISOString() : null,
        renews: r.renews,
      }));
      return { eligible, unavailableReason: reason, canBuy, owned, catalog, hidden };
    });
  }
}
