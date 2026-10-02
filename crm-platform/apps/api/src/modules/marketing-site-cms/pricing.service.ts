import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  PLAN_FEATURE_KEYS,
  PLAN_LIMIT_KEYS,
  moneyCents,
  storedFeature,
  storedLimit,
  type PlanFeatures,
  type PlanLimits,
  type PublicPlanCard,
  type PublicPricingResponse,
} from '@crm/contracts';
import { DatabaseService } from '../../infra/db/database.service';
import { buildPlanCard, type PlanFacts } from '../plans-subscriptions-trials';
import { PlatformSettingsService } from '../auth';
import { centsToMoney, yearlyCents } from './cms-rules';

interface PlanRow {
  uuid: string;
  slug: string;
  name: string;
  subtitle: string | null;
  amount: string;
  offer_amount: string | null;
  currency: string;
  billing_unit: PlanFacts['billingUnit'];
  billing_duration: number;
  is_free: boolean;
  is_lifetime: boolean;
  is_active: boolean;
  is_default: boolean;
  is_highlighted: boolean;
  is_custom_quote: boolean;
  sort_order: number;
  cta_label: string;
  limits: unknown;
  features: unknown;
}

const DEFAULT_DISCOUNT = 20;

/**
 * The data behind the public pricing page (WD-CMS-003). The PLAN catalogue is the single source of price and limits:
 * the cards are built with PLAN's own `buildPlanCard`, so the public page and the in-app plan list cannot drift.
 * Only active PLANS are listed (WaDesk also listed add-ons here, most likely by accident).
 *
 * The yearly price is twelve months of the effective monthly price at the configured discount, computed in integer
 * cents. Lifetime and custom-quote plans never get one, nor do plans billed on any period other than one month.
 */
@Injectable()
export class PricingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly settings: PlatformSettingsService,
  ) {}

  async publicPricing(): Promise<PublicPricingResponse> {
    const res = await this.db.primary.execute(sql`
      SELECT uuid, slug, name, subtitle, amount::text AS amount, offer_amount::text AS offer_amount, currency,
             billing_unit, billing_duration, is_free, is_lifetime, is_active, is_default, is_highlighted,
             is_custom_quote, sort_order, cta_label, limits, features
      FROM plans
      WHERE kind = 'plan' AND is_active
      ORDER BY sort_order, plans.amount, slug
    `);
    const toggleSetting = await this.settings.get<unknown>('pricing.yearly_toggle_enabled');
    const pctSetting = await this.settings.get<unknown>('pricing.yearly_discount_pct');
    const pct =
      typeof pctSetting === 'number' && Number.isFinite(pctSetting)
        ? Math.min(90, Math.max(0, Math.round(pctSetting)))
        : DEFAULT_DISCOUNT;

    const plans: PublicPlanCard[] = (res.rows as unknown as PlanRow[]).map((r) => {
      const facts: PlanFacts = {
        id: r.uuid,
        slug: r.slug,
        name: r.name,
        subtitle: r.subtitle,
        amount: r.amount,
        offerAmount: r.offer_amount,
        currency: r.currency,
        billingUnit: r.billing_unit,
        billingDuration: r.billing_duration,
        isFree: r.is_free,
        isLifetime: r.is_lifetime,
        isActive: r.is_active,
        isDefault: r.is_default,
        isHighlighted: r.is_highlighted,
        isCustomQuote: r.is_custom_quote,
        sortOrder: r.sort_order,
        ctaLabel: r.cta_label,
        limits: r.limits,
        features: r.features,
      };
      const { current: _current, action: _action, ...card } = buildPlanCard(facts, null, null);
      const monthly =
        card.kind === 'paid' &&
        !card.lifetime &&
        card.price.period?.unit === 'months' &&
        card.price.period.count === 1;
      const effective = card.price.offerAmount ?? card.price.amount;
      return {
        ...card,
        limits: Object.fromEntries(
          PLAN_LIMIT_KEYS.map((k) => [k, storedLimit(r.limits, k)]),
        ) as PlanLimits,
        features: Object.fromEntries(
          PLAN_FEATURE_KEYS.map((k) => [k, storedFeature(r.features, k)]),
        ) as PlanFeatures,
        yearlyAmount: monthly ? centsToMoney(yearlyCents(moneyCents(effective), pct)) : null,
        ctaUrl:
          card.kind === 'custom_quote'
            ? '/contact'
            : card.kind === 'free'
              ? '/register'
              : `/register?plan=${encodeURIComponent(card.slug)}`,
      };
    });

    return {
      plans,
      yearlyToggle:
        toggleSetting !== false && pct > 0 && plans.some((p) => p.yearlyAmount !== null),
      yearlyDiscountPct: pct,
    };
  }
}
