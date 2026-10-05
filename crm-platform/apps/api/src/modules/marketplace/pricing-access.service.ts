import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  accessFor,
  includedBy,
  marketCheckoutPath,
  marketEntitlementKey,
  marketPackSlug,
  trialAvailable,
  type MarketAccessState,
  type MarketCardPricing,
  type MarketIncludedBy,
} from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';
import { AddonEntitlementService } from '../addons-extension-registry';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import type { AppPricingRow, SubscriptionRow } from './pricing-model';

/** What it takes to decide what a workspace may do about one app's price. */
export interface PricingFacts {
  slug: string;
  uuid: string;
  pricing: AppPricingRow;
  sub: Pick<SubscriptionRow, 'status'> | null;
}

export interface PricingEvaluation {
  access: MarketAccessState;
  includedBy: MarketIncludedBy | null;
  /** The workspace's entitlement service says it may use the app (a subscription, a trial, a comp or an override). */
  entitled: boolean;
}

/**
 * Decides, for one workspace, whether a paid app is included in its plan, covered by a subscription, or still to be bought. It asks the
 * add-ons domain's entitlement service, which merges the workspace's plan, its overrides and every billing add-on it owns, so the
 * Marketplace has no gate of its own: the add-on that sells an app grants a feature key, and that key is the one source of truth.
 *
 * `evaluator` asks each question once per request, however many cards it is applied to; a free app costs no question at all.
 */
@Injectable()
export class PricingAccess {
  constructor(
    private readonly db: DatabaseService,
    private readonly entitlements: AddonEntitlementService,
    private readonly plans: PlanEntitlementService,
  ) {}

  async evaluator(orgId: number): Promise<(f: PricingFacts) => Promise<PricingEvaluation>> {
    const features = new Map<string, Promise<boolean>>();
    const feature = (key: string) => {
      let p = features.get(key);
      if (!p) {
        p = this.entitlements.featureEnabled(orgId, key);
        features.set(key, p);
      }
      return p;
    };
    let plan: Promise<{ slug: string | null; lapsed: boolean; catalogue: string[] }> | undefined;
    const planFacts = () =>
      (plan ??= (async () => {
        const [e, cat] = await Promise.all([
          this.plans.forOrg(orgId),
          // txAs, not tx: the sweep has no request context, and the catalogue is the same for every workspace anyway
          this.db.txAs({ orgId, userId: null }, (tx) =>
            tx.execute(
              sql`SELECT slug FROM plans WHERE kind = 'plan' ORDER BY sort_order, amount, slug`,
            ),
          ),
        ]);
        return {
          slug: e?.planSlug ?? null,
          lapsed: e?.state === 'paid_lapsed',
          catalogue: (cat.rows as unknown as Array<{ slug: string }>).map((r) => r.slug),
        };
      })());

    return async (f) => {
      if (f.pricing.pricingModel === 'free')
        return { access: 'free', includedBy: null, entitled: false };
      const needsPlan = f.pricing.includedMinPlan !== null;
      const p = needsPlan ? await planFacts() : null;
      const by = includedBy({
        includedPlanFeature: f.pricing.includedPlanFeature,
        planFeatureOn: f.pricing.includedPlanFeature
          ? await feature(f.pricing.includedPlanFeature)
          : false,
        includedMinPlan: f.pricing.includedMinPlan,
        orgPlanSlug: p?.slug ?? null,
        planLapsed: p?.lapsed ?? false,
        catalogue: p?.catalogue ?? [],
      });
      const entitled = by ? false : await feature(marketEntitlementKey(f.slug));
      return {
        access: accessFor({
          model: f.pricing.pricingModel,
          includedBy: by,
          entitled,
          purchasable: f.pricing.purchasable,
          hasActiveSubscription: f.sub?.status === 'active',
        }),
        includedBy: by,
        entitled,
      };
    };
  }
}

/** The pricing a card and an app page show a workspace. */
export function cardPricing(f: PricingFacts, ev: PricingEvaluation): MarketCardPricing {
  const paid = f.pricing.pricingModel === 'paid_monthly';
  return {
    model: f.pricing.pricingModel,
    amount: f.pricing.priceAmount,
    currency: f.pricing.priceCurrency,
    trialDays: f.pricing.trialDays,
    trialAvailable: trialAvailable({
      model: f.pricing.pricingModel,
      trialDays: f.pricing.trialDays,
      purchasable: f.pricing.purchasable,
      hasSubscriptionRow: f.sub !== null,
      access: ev.access,
    }),
    access: ev.access,
    includedBy: ev.access === 'included' ? ev.includedBy : null,
    checkoutPath:
      paid && (ev.access === 'subscription_required' || ev.access === 'entitled')
        ? marketCheckoutPath(marketPackSlug(f.uuid))
        : null,
  };
}
