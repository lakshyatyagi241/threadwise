import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  addonCardSchema,
  createAddonRequestSchema,
  includedBy,
  isLegacyAddonPack,
  ownershipFromAccess,
  resolveOwnership,
  workspaceAddonsResponseSchema,
} from '@crm/contracts';
import { cardState } from '../../../src/modules/addons-extension-registry/addon-grants';
import {
  WorkspaceAddonsService,
  unavailableReason,
  type PlanStateRow,
} from '../../../src/modules/addons-extension-registry/workspace-addons.service';

/**
 * The one ownership resolver (contracts `resolveOwnership`) and the plain add-on list built on it: every state, and the edge cases of the
 * owner's list (free, lapsed, trial, platform-owned, override, partial, limits only, stacked, renewal stopped, inactive, wallet).
 */

describe('resolveOwnership: included beats owned beats buyable', () => {
  it('has exactly the four answers', () => {
    expect(resolveOwnership({ includedByPlan: true, owned: true, purchasable: true })).toBe(
      'included',
    );
    expect(resolveOwnership({ includedByPlan: false, owned: true, purchasable: false })).toBe(
      'owned',
    );
    expect(resolveOwnership({ includedByPlan: false, owned: false, purchasable: true })).toBe(
      'buyable',
    );
    expect(resolveOwnership({ includedByPlan: false, owned: false, purchasable: false })).toBe(
      'unavailable',
    );
  });

  it('a Marketplace app access reads in the same four words', () => {
    expect(ownershipFromAccess('included')).toBe('included');
    expect(ownershipFromAccess('entitled')).toBe('owned');
    expect(ownershipFromAccess('subscription_required')).toBe('buyable');
    expect(ownershipFromAccess('not_for_sale')).toBe('unavailable');
    expect(ownershipFromAccess('free')).toBe('free');
  });
});

describe('an app whose every plan feature the plan itself carries is included', () => {
  const base = {
    includedPlanFeature: null,
    planFeatureOn: false,
    includedMinPlan: null,
    orgPlanSlug: 'pro',
    planLapsed: false,
    catalogue: ['free', 'pro'],
  };
  it('plan_grants only when the plan carries them all (the app not installed, or subscribed, does not matter)', () => {
    expect(includedBy({ ...base, planCarriesGrants: true })).toBe('plan_grants');
    expect(includedBy({ ...base, planCarriesGrants: false })).toBeNull();
    expect(includedBy(base)).toBeNull();
  });
  it('the operator-set rules keep their own names and win', () => {
    expect(
      includedBy({
        ...base,
        includedPlanFeature: 'x',
        planFeatureOn: true,
        planCarriesGrants: true,
      }),
    ).toBe('plan_feature');
    expect(includedBy({ ...base, includedMinPlan: 'pro', planCarriesGrants: true })).toBe(
      'min_plan',
    );
  });
});

describe('cardState with eligibility', () => {
  const smart = { features: ['inbox_routing', 'inbox_assignment_sticky'], limits: {} };
  const boost = { features: [], limits: { users: 5 } };
  const both = new Set(smart.features);
  it('not on an active paid plan: unavailable, unless the plan already grants it or the workspace holds it', () => {
    expect(cardState(smart, 0, new Set(), false)).toBe('unavailable');
    expect(cardState(smart, 0, both, false)).toBe('included');
    expect(cardState(smart, 1, new Set(), false)).toBe('active');
    expect(cardState(boost, 2, new Set(), false)).toBe('buy_again');
  });
  it('eligible behaves exactly as before', () => {
    expect(cardState(smart, 0)).toBe('buy');
    expect(cardState(smart, 1)).toBe('active');
    expect(cardState(boost, 1)).toBe('buy_again');
    expect(cardState(boost, 0, new Set(), true)).toBe('buy');
  });
});

describe('unavailableReason', () => {
  const row = (o: Partial<PlanStateRow>): PlanStateRow => ({
    plan_found: true,
    is_free: false,
    is_custom_quote: false,
    amount: '29',
    plan_ends_at: null,
    ...o,
  });
  it('names why, and is null for an active paid plan (a trial on a paid plan included)', () => {
    expect(unavailableReason(undefined)).toBe('no_plan');
    expect(unavailableReason(row({ plan_found: false }))).toBe('no_plan');
    expect(unavailableReason(row({ is_free: true, amount: '0' }))).toBe('free_plan');
    expect(unavailableReason(row({ plan_ends_at: '2020-01-01T00:00:00Z' }))).toBe('plan_expired');
    expect(unavailableReason(row({}))).toBeNull();
    expect(unavailableReason(row({ plan_ends_at: '2999-01-01T00:00:00Z' }))).toBeNull();
    // a custom quote is not free: it keeps buying add-ons, as checkout allows
    expect(unavailableReason(row({ is_custom_quote: true, amount: '0' }))).toBeNull();
  });
});

describe('legacy and new pack shapes', () => {
  const pack = { name: 'Boost', amount: '10', currency: 'USD' };
  it('a new pack with no billing mode is recurring and monthly by default', () => {
    const p = createAddonRequestSchema.parse(pack);
    expect(p.billingMode).toBe('recurring');
    expect(p.billingUnit).toBe('months');
    expect(p.billingDuration).toBe(1);
  });
  it('legacy shapes an older client still sends keep working: lifetime and zero price default to one-time', () => {
    expect(createAddonRequestSchema.parse({ ...pack, isLifetime: true }).billingMode).toBe(
      'one_time',
    );
    expect(createAddonRequestSchema.parse({ ...pack, amount: '0' }).billingMode).toBe('one_time');
    expect(createAddonRequestSchema.parse({ ...pack, billingMode: 'one_time' }).billingMode).toBe(
      'one_time',
    );
  });
  it('an explicit recurring lifetime or free pack is still refused', () => {
    expect(
      createAddonRequestSchema.safeParse({ ...pack, isLifetime: true, billingMode: 'recurring' })
        .success,
    ).toBe(false);
    expect(
      createAddonRequestSchema.safeParse({ ...pack, amount: '0', billingMode: 'recurring' })
        .success,
    ).toBe(false);
  });
  it('legacy detection: one-time, lifetime, or a period that is not one month / one year', () => {
    const ok = {
      billingMode: 'recurring' as const,
      isLifetime: false,
      billingUnit: 'months',
      billingDuration: 1,
    };
    expect(isLegacyAddonPack(ok)).toBe(false);
    expect(isLegacyAddonPack({ ...ok, billingUnit: 'years' })).toBe(false);
    expect(isLegacyAddonPack({ ...ok, billingMode: 'one_time' })).toBe(true);
    expect(isLegacyAddonPack({ ...ok, isLifetime: true })).toBe(true);
    expect(isLegacyAddonPack({ ...ok, billingDuration: 3 })).toBe(true);
    expect(isLegacyAddonPack({ ...ok, billingUnit: 'weeks' })).toBe(true);
  });
});

// --- the list, with a fake database ---------------------------------------------------------------------------------------------------

interface World {
  plan: Partial<PlanStateRow>;
  packs: Array<Record<string, unknown>>;
  owned: Array<Record<string, unknown>>;
  /** feature keys the PLAN grants, and the subset that is only an override / platform-owned */
  planGrants: string[];
  support?: string[];
}

const dialect = new PgDialect();

function service(w: World) {
  const queries: string[] = [];
  const tx = {
    execute: async (q: unknown) => {
      const text = dialect.sqlToQuery(q as never).sql;
      queries.push(text);
      if (text.includes('FROM organizations o'))
        return {
          rows: [
            {
              plan_found: true,
              is_free: false,
              is_custom_quote: false,
              amount: '29',
              plan_ends_at: null,
              ...w.plan,
            },
          ],
        };
      if (text.includes('FROM workspace_addons a')) return { rows: w.owned };
      if (text.includes("kind = 'addon'")) return { rows: w.packs };
      throw new Error(`unexpected query: ${text}`);
    },
  };
  const svc = new WorkspaceAddonsService(
    { tx: async (fn: (t: typeof tx) => unknown) => fn(tx) } as never,
    { planFeatures: async () => [], planLimits: async () => [] } as never,
    {
      graceDays: async () => 7,
      includedByPlanDetailed: async (_o: number, keys: string[]) => ({
        included: new Set(keys.filter((k) => w.planGrants.includes(k))),
        support: new Set(keys.filter((k) => (w.support ?? []).includes(k))),
      }),
    } as never,
  );
  return { svc, queries };
}

const pack = (o: Record<string, unknown>) => ({
  id: 1,
  uuid: '11111111-1111-4111-8111-111111111111',
  slug: 'smart_routing',
  name: 'Smart routing',
  subtitle: null,
  amount: '9.00',
  offer_amount: null,
  currency: 'USD',
  is_free: false,
  is_lifetime: false,
  billing_unit: 'months',
  billing_duration: 1,
  billing_mode: 'recurring',
  features: { inbox_routing: true, inbox_assignment_sticky: true },
  limits: {},
  ...o,
});
const own = (o: Record<string, unknown>) => ({
  uuid: '22222222-2222-4222-8222-222222222222',
  pack_uuid: '11111111-1111-4111-8111-111111111111',
  name: 'Smart routing',
  starts_at: null,
  ends_at: '2030-01-01T00:00:00Z',
  package_id: 1,
  renews: true,
  ...o,
});

describe('the workspace add-on list', () => {
  it('free plan: the packs are listed, every one unavailable, with the reason (not an empty list)', async () => {
    const { svc } = service({
      plan: { is_free: true, amount: '0' },
      packs: [pack({})],
      owned: [],
      planGrants: [],
    });
    const r = await svc.forWorkspace(1, true);
    expect(r.eligible).toBe(false);
    expect(r.unavailableReason).toBe('free_plan');
    expect(r.catalog.map((c) => c.state)).toEqual(['unavailable']);
    expect(workspaceAddonsResponseSchema.safeParse(r).success).toBe(true);
  });

  it('a paid plan that ran out (falls back to free) is unavailable with its own reason', async () => {
    const { svc } = service({
      plan: { plan_ends_at: '2020-01-01T00:00:00Z' },
      packs: [pack({})],
      owned: [],
      planGrants: [],
    });
    const r = await svc.forWorkspace(1, true);
    expect(r.unavailableReason).toBe('plan_expired');
    expect(r.catalog[0]!.state).toBe('unavailable');
  });

  it('active paid plan: buy; held feature pack: active; stackable pack held twice: buy again', async () => {
    const boost = pack({
      id: 2,
      uuid: '33333333-3333-4333-8333-333333333333',
      slug: 'seats',
      features: {},
      limits: { users: 5 },
    });
    const { svc } = service({
      plan: {},
      packs: [pack({}), boost],
      owned: [own({ package_id: 2, uuid: 'a' }), own({ package_id: 2, uuid: 'b' })],
      planGrants: [],
    });
    const r = await svc.forWorkspace(1, true);
    expect(r.eligible).toBe(true);
    expect(r.unavailableReason).toBeNull();
    expect(Object.fromEntries(r.catalog.map((c) => [c.slug, c.state]))).toEqual({
      smart_routing: 'buy',
      seats: 'buy_again',
    });
    expect(r.catalog.find((c) => c.slug === 'seats')!.ownedCount).toBe(2);
    const held = service({ plan: {}, packs: [pack({})], owned: [own({})], planGrants: [] });
    expect((await held.svc.forWorkspace(1, true)).catalog[0]!.state).toBe('active');
  });

  it('the plan grants everything: included (no buy), and a held purchase whose renewal the job stopped keeps its end date', async () => {
    const { svc } = service({
      plan: {},
      packs: [pack({})],
      owned: [own({ renews: false })],
      planGrants: ['inbox_routing', 'inbox_assignment_sticky'],
    });
    const c = (await svc.forWorkspace(1, true)).catalog[0]!;
    expect(c.state).toBe('included');
    expect(c.includedVia).toBe('plan');
    expect(c.ownedRenews).toBe(false);
    expect(c.ownedEndsAt).toBe('2030-01-01T00:00:00.000Z');
  });

  it('an override or platform-owned status that makes it included is flagged as support', async () => {
    const { svc } = service({
      plan: {},
      packs: [pack({})],
      owned: [],
      planGrants: ['inbox_routing', 'inbox_assignment_sticky'],
      support: ['inbox_routing', 'inbox_assignment_sticky'],
    });
    const c = (await svc.forWorkspace(1, true)).catalog[0]!;
    expect(c.state).toBe('included');
    expect(c.includedVia).toBe('support');
  });

  it('the plan grants only some features: still buy, and only what is missing is listed', async () => {
    const { svc } = service({
      plan: {},
      packs: [pack({})],
      owned: [],
      planGrants: ['inbox_routing'],
    });
    const c = (await svc.forWorkspace(1, true)).catalog[0]!;
    expect(c.state).toBe('buy');
    expect(c.includedVia).toBeNull();
    expect(c.grantBullets.map((b) => b.key)).toEqual(['inbox_assignment_sticky']);
  });

  it('plan switched from includes to not includes: the card is a buy card again with its price', async () => {
    const w = {
      plan: {},
      packs: [pack({ offer_amount: '7.00' })],
      owned: [],
      planGrants: [] as string[],
    };
    const c = (await service(w).svc.forWorkspace(1, true)).catalog[0]!;
    expect(c.state).toBe('buy');
    expect(c.amount).toBe('9.00');
    expect(c.offerAmount).toBe('7.00');
  });

  it('a pack with limits only is never included, even when the plan grants every flag', async () => {
    const seats = pack({ slug: 'seats', features: {}, limits: { users: 5 } });
    const { svc } = service({ plan: {}, packs: [seats], owned: [], planGrants: ['inbox_routing'] });
    expect((await svc.forWorkspace(1, true)).catalog[0]!.state).toBe('buy');
  });

  it('a pack that adds a cap stays buyable even when the plan grants its features (Teams +10)', async () => {
    const teams = pack({
      slug: 'teams_permissions',
      features: { team_hierarchy: true, custom_roles: true },
      limits: { teams: 10 },
    });
    const { svc } = service({
      plan: {},
      packs: [teams],
      owned: [],
      planGrants: ['team_hierarchy', 'custom_roles'],
    });
    const c = (await svc.forWorkspace(1, true)).catalog[0]!;
    expect(c.state).toBe('buy');
    expect(c.grantBullets.map((b) => b.kind)).toEqual(['limit_add']);
  });

  it('who may buy rides along; the list itself is for everyone', async () => {
    const { svc } = service({ plan: {}, packs: [pack({})], owned: [], planGrants: [] });
    expect((await svc.forWorkspace(1, false)).canBuy).toBe(false);
    expect((await svc.forWorkspace(1, true)).canBuy).toBe(true);
  });

  it('only plain, active add-on plans are listed: no Marketplace app pack, no inactive pack, nothing that is not an add-on plan (a wallet top-up is never a plan row)', async () => {
    const { svc, queries } = service({ plan: {}, packs: [], owned: [], planGrants: [] });
    await svc.forWorkspace(1, true);
    const catalogue = queries.find((q) => q.includes("FROM plans WHERE kind = 'addon'"))!;
    expect(catalogue).toContain('is_active');
    expect(catalogue).toContain('marketplace_app_id IS NULL');
    const heldQuery = queries.find((q) => q.includes('FROM workspace_addons a'))!;
    expect(heldQuery).toContain('marketplace_app_id IS NULL');
    expect(catalogue).not.toMatch(/wallet/i);
  });

  it('every card parses with the contract', async () => {
    const { svc } = service({ plan: {}, packs: [pack({})], owned: [own({})], planGrants: [] });
    const r = await svc.forWorkspace(1, true);
    for (const c of r.catalog) expect(addonCardSchema.safeParse(c).success).toBe(true);
  });
});
