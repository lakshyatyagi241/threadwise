import { describe, expect, it } from 'vitest';
import { ERROR_CODES, ownershipFromAccess } from '@crm/contracts';
import {
  PricingAccess,
  type PricingFacts,
} from '../../../src/modules/marketplace/pricing-access.service';
import { assertMarketplacePack } from '../../../src/modules/platform-payment-gateways/marketplace-pack';

/**
 * A paid Marketplace app is "Included in your plan" when the PLAN ITSELF carries every plan feature the app would grant (the app's own
 * `mkt_<slug>` key aside). Semantics under test, the same words the plain add-on list uses (`resolveOwnership`):
 *   - the app need not be installed: the plan carries the feature, the card says Included, installing stays free
 *   - subscribed AND included: Included wins (the subscription runs out its paid term; checkout refuses a new one)
 *   - plan downgrade (the plan no longer carries it): back to subscribe / owned, never silently granted
 *   - an app that grants nothing beyond its own key is never included this way
 */

const facts = (grants: string[], over: Partial<PricingFacts['pricing']> = {}): PricingFacts =>
  ({
    appId: 7,
    slug: 'appointments',
    uuid: '00000000-0000-4000-8000-000000000007',
    pricing: {
      pricingModel: 'paid_monthly',
      includedPlanFeature: null,
      includedMinPlan: null,
      purchasable: true,
      priceAmount: '9.00',
      priceCurrency: 'USD',
      billingMode: 'recurring',
      annualAmount: null,
      trialDays: 0,
      grantsPlanFeatures: grants,
      ...over,
    },
    sub: null,
  }) as unknown as PricingFacts;

function access(opts: {
  /** feature keys the plan alone grants */
  plan: string[];
  /** keys the workspace has with every pack and app merged (the entitlement service) */
  entitled?: string[];
}) {
  const entitlements = {
    featureEnabled: async (_org: number, key: string) => (opts.entitled ?? opts.plan).includes(key),
  };
  const plans = {
    forOrg: async () => ({
      planSlug: 'pro',
      state: 'paid_active',
      visibleApps: { all: true, appIds: new Set<number>() },
    }),
    includedByPlan: async (_org: number, keys: string[]) =>
      new Set(keys.filter((k) => opts.plan.includes(k))),
  };
  const db = {
    txAs: async (_c: unknown, fn: (t: unknown) => unknown) =>
      fn({ execute: async () => ({ rows: [] }) }),
  };
  return new PricingAccess(db as never, entitlements as never, plans as never);
}

describe('a paid app whose plan features the plan already carries', () => {
  it('is included when the plan carries them all, with the app not installed and not subscribed', async () => {
    const ev = await (
      await access({ plan: ['appointment_booking'] }).evaluator(1)
    )(facts(['mkt_appointments', 'appointment_booking']));
    expect(ev.access).toBe('included');
    expect(ev.includedBy).toBe('plan_grants');
    expect(ev.entitled).toBe(false);
    expect(ownershipFromAccess(ev.access)).toBe('included');
  });

  it('is still included when the app is also subscribed (the plan carries it; checkout refuses a new subscription)', async () => {
    const ev = await (
      await access({
        plan: ['appointment_booking'],
        entitled: ['appointment_booking', 'mkt_appointments'],
      }).evaluator(1)
    )({ ...facts(['mkt_appointments', 'appointment_booking']), sub: { status: 'active' } });
    expect(ev.access).toBe('included');
  });

  it('after a plan downgrade it is a subscribe card again, and owned when the subscription still runs', async () => {
    const noPlan = await (
      await access({ plan: [] }).evaluator(1)
    )(facts(['mkt_appointments', 'appointment_booking']));
    expect(noPlan.access).toBe('subscription_required');
    expect(noPlan.includedBy).toBeNull();
    const owned = await (
      await access({ plan: [], entitled: ['mkt_appointments'] }).evaluator(1)
    )(facts(['mkt_appointments', 'appointment_booking']));
    expect(owned.access).toBe('entitled');
    expect(ownershipFromAccess(owned.access)).toBe('owned');
  });

  it('only SOME of the features carried: not included (the app still adds something)', async () => {
    const ev = await (
      await access({ plan: ['appointment_booking'] }).evaluator(1)
    )(facts(['mkt_appointments', 'appointment_booking', 'appointment_confirm_buttons']));
    expect(ev.access).toBe('subscription_required');
  });

  it('an app that grants nothing but its own key is never included this way', async () => {
    const ev = await (
      await access({ plan: ['appointment_booking'] }).evaluator(1)
    )(facts(['mkt_appointments']));
    expect(ev.access).toBe('subscription_required');
    const none = await (await access({ plan: [] }).evaluator(1))(facts([]));
    expect(none.access).toBe('subscription_required');
  });

  it('the operator-set rules keep winning and keep their names', async () => {
    const ev = await (
      await access({ plan: ['x', 'appointment_booking'] }).evaluator(1)
    )(facts(['appointment_booking'], { includedPlanFeature: 'x' }));
    expect(ev.includedBy).toBe('plan_feature');
  });

  it('a free app is untouched', async () => {
    const ev = await (
      await access({ plan: ['appointment_booking'] }).evaluator(1)
    )(facts(['appointment_booking'], { pricingModel: 'free' }));
    expect(ev.access).toBe('free');
  });
});

describe('checkout refuses an app the plan already carries (the race: the plan just started including it)', () => {
  const row = (grants: string[]) => ({
    app_id: '7',
    app_status: 'published',
    pricing_model: 'paid_monthly',
    purchasable: true,
    included_plan_feature: null,
    grants_plan_features: grants,
    included_min_plan: null,
    sub_status: null,
    held: false,
    paid_until: null,
    catalogue: ['free', 'pro'],
    org_plan: 'pro',
  });
  const tx = (r: unknown) => ({ execute: async () => ({ rows: [r] }) });

  it('422 PAYGW_PLAN_NOT_PURCHASABLE (marketplace: included) when the plan carries every grant', async () => {
    await expect(
      assertMarketplacePack(
        tx(row(['mkt_appointments', 'appointment_booking'])) as never,
        1,
        'mkt_appointments',
        async () => false,
        async () => true,
        async (keys) => keys.length,
      ),
    ).rejects.toMatchObject({
      code: ERROR_CODES.PAYGW_PLAN_NOT_PURCHASABLE,
      details: [{ path: 'marketplace', message: 'included' }],
    });
  });

  it('allows the purchase when the plan carries none (or only part) of them', async () => {
    const ok = (carries: number) =>
      assertMarketplacePack(
        tx(row(['mkt_appointments', 'appointment_booking', 'appointment_rebook_steps'])) as never,
        1,
        'mkt_appointments',
        async () => false,
        async () => true,
        async () => carries,
      );
    await expect(ok(0)).resolves.toBe(true);
    await expect(ok(1)).resolves.toBe(true);
  });
});
