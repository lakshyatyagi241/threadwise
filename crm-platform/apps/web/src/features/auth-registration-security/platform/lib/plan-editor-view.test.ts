import { PLAN_LIMIT_KEYS, type PlanAddonOption, type PlanAdminItem } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  LIMIT_UNITS,
  PLAN_TABS,
  addonSaleState,
  appOptionsFor,
  appTabFor,
  appTabsOf,
  filterAppOptions,
  filterKeys,
  firstProblemField,
  isPlatformDefaultLimit,
  limitDisabledByPlatform,
  matchesQuery,
  planCounts,
  staleAppIds,
  tabForField,
  tabsWithProblems,
} from './plan-editor-view';
import { newPlanDraft } from './plan-draft';

const option = (over: Partial<PlanAddonOption> & { id: string }): PlanAddonOption => ({
  packSlug: 'mkt_appointments_pack',
  name: 'Appointments pack',
  isActive: true,
  amount: '9.00',
  currency: 'USD',
  billingUnit: 'months',
  billingDuration: 1,
  app: {
    id: '0b5f6f0e-5d1c-4a52-9a41-0f6a4b0c1d99',
    slug: 'appointments',
    name: 'Appointments',
    status: 'published',
    kind: 'mini_app',
  },
  ...over,
});

const A = '0b5f6f0e-5d1c-4a52-9a41-0f6a4b0c1d21';
const B = '0b5f6f0e-5d1c-4a52-9a41-0f6a4b0c1d22';
const GONE = '0b5f6f0e-5d1c-4a52-9a41-0f6a4b0c1dff';

describe('tabs and problems', () => {
  it('puts every field on its tab', () => {
    expect(tabForField('name')).toBe('details');
    expect(tabForField('amount')).toBe('details');
    expect(tabForField('limits.users')).toBe('limits');
    expect(tabForField('visibleAddons')).toBe('addons');
    // an add-on's plan price, and an offer error the API could not tie to one add-on
    expect(tabForField('addonOffers.0b5f6f0e-5d1c-4a52-9a41-0f6a4b0c1e01')).toBe('addons');
    expect(tabForField('addonOffers')).toBe('addons');
  });

  it('lists the six tabs in order', () => {
    expect([...PLAN_TABS]).toEqual([
      'details',
      'features',
      'limits',
      'addons',
      'integrations',
      'miniApps',
    ]);
  });

  it('opens the tab that holds the app an offer error names; an unknown id opens Add-ons', () => {
    const integration = {
      id: B,
      slug: 'razorpay',
      name: 'Razorpay',
      status: 'published',
      kind: 'integration',
    };
    const appTabs = appTabsOf([option({ id: A }), option({ id: B, app: integration })]);
    expect(tabForField(`addonOffers.${A}`, appTabs)).toBe('miniApps');
    expect(tabForField(`addonOffers.${B}`, appTabs)).toBe('integrations');
    expect(tabForField(`addonOffers.${GONE}`, appTabs)).toBe('addons');
    expect(tabForField(`addonOffers.${A}`)).toBe('addons');
    const problems = {
      [`addonOffers.${B}`]: { code: 'server' as const },
      name: { code: 'required' as const },
    };
    expect(tabsWithProblems(problems, appTabs)).toEqual(['details', 'integrations']);
    expect(firstProblemField({ [`addonOffers.${A}`]: { code: 'server' } }, appTabs)).toBe(
      `addonOffers.${A}`,
    );
    expect(
      firstProblemField(
        { [`addonOffers.${B}`]: { code: 'server' }, [`addonOffers.${A}`]: { code: 'server' } },
        appTabs,
      ),
    ).toBe(`addonOffers.${B}`);
  });

  it('lists the tabs with a problem in tab order, once each', () => {
    expect(
      tabsWithProblems({
        visibleAddons: { code: 'server' },
        'limits.users': { code: 'whole' },
        'limits.tags': { code: 'whole' },
        name: { code: 'required' },
      }),
    ).toEqual(['details', 'limits', 'addons']);
    expect(tabsWithProblems({})).toEqual([]);
  });

  it('focuses the first field in tab order, not the first found', () => {
    expect(
      firstProblemField({ visibleAddons: { code: 'server' }, 'limits.users': { code: 'whole' } }),
    ).toBe('limits.users');
    expect(
      firstProblemField({ visibleAddons: { code: 'server' }, name: { code: 'required' } }),
    ).toBe('name');
    expect(firstProblemField({})).toBeNull();
  });
});

describe('limits that only matter while unofficial WhatsApp is on', () => {
  it('greys the devices limit only when the switch is known to be off', () => {
    expect(limitDisabledByPlatform('devices', 'off')).toBe(true);
    expect(limitDisabledByPlatform('devices', 'on')).toBe(false);
    // unknown (the call failed, an older API): the operator is not told something the platform did not say
    expect(limitDisabledByPlatform('devices', 'unknown')).toBe(false);
  });

  it('never greys any other limit', () => {
    for (const k of PLAN_LIMIT_KEYS.filter((x) => x !== 'devices')) {
      expect(limitDisabledByPlatform(k, 'off')).toBe(false);
    }
  });
});

describe('limit units', () => {
  it('has a unit for every catalogue limit', () => {
    expect(Object.keys(LIMIT_UNITS).sort()).toEqual([...PLAN_LIMIT_KEYS].sort());
  });

  it('marks the API rate as the one whose 0 is the platform default', () => {
    expect(PLAN_LIMIT_KEYS.filter(isPlatformDefaultLimit)).toEqual(['api_rate_limit_per_minute']);
    expect(LIMIT_UNITS.api_rate_limit_per_minute).toBe('perMinute');
    expect(LIMIT_UNITS.monthly_messages).toBe('perMonth');
    expect(LIMIT_UNITS.broadcast_recipients).toBe('perBroadcast');
  });
});

describe('search', () => {
  it('matches every word, in any order, ignoring case; blank matches all', () => {
    expect(matchesQuery('', 'anything')).toBe(true);
    expect(matchesQuery('  ', 'anything')).toBe(true);
    expect(matchesQuery('MESSAGES month', 'Messages per month', 'x')).toBe(true);
    expect(matchesQuery('month messages', 'Messages per month')).toBe(true);
    expect(matchesQuery('invoice', 'Messages per month')).toBe(false);
  });

  it('filters keys by label or hint and keeps their order', () => {
    const label = (k: string) => ({ a: 'Alpha', b: 'Beta', c: 'Gamma' })[k]!;
    const hint = (k: string) => ({ a: 'first', b: 'second letter', c: 'third' })[k]!;
    expect(filterKeys(['a', 'b', 'c'], 'letter', label, hint)).toEqual(['b']);
    expect(filterKeys(['a', 'b', 'c'], 'a', label, hint)).toEqual(['a', 'b', 'c']);
    expect(filterKeys(['a', 'b', 'c'], 'zzz', label, hint)).toEqual([]);
  });
});

describe('add-on rows', () => {
  it('says whether an add-on can be bought', () => {
    expect(addonSaleState(option({ id: A }))).toBe('onSale');
    expect(addonSaleState(option({ id: A, isActive: false }))).toBe('packInactive');
    const draft = { id: A, slug: 's', name: 'S', status: 'draft', kind: 'mini_app' };
    expect(addonSaleState(option({ id: A, app: draft }))).toBe('appUnpublished');
    // An inactive pack is reported before an unpublished app.
    expect(addonSaleState(option({ id: A, isActive: false, app: draft }))).toBe('packInactive');
  });

  it('lists integrations on their tab and mini apps on theirs', () => {
    const integration = {
      id: B,
      slug: 'razorpay',
      name: 'Razorpay',
      status: 'published',
      kind: 'integration',
    };
    const options = [option({ id: A }), option({ id: B, app: integration })];
    expect(appOptionsFor(options, 'miniApps').map((o) => o.id)).toEqual([A]);
    expect(appOptionsFor(options, 'integrations').map((o) => o.id)).toEqual([B]);
    expect(appTabFor('integration')).toBe('integrations');
    expect(appTabFor('mini_app')).toBe('miniApps');
    // a kind this build does not know is still reachable, as a mini app
    expect(appTabFor('something_new')).toBe('miniApps');
  });

  it('finds the ids no option lists, once each', () => {
    expect(staleAppIds([option({ id: A }), option({ id: B })], [B, GONE, GONE])).toEqual([GONE]);
    expect(staleAppIds([option({ id: A })], [A])).toEqual([]);
    expect(staleAppIds([], [])).toEqual([]);
  });

  it('filters by add-on, app and pack names', () => {
    const options = [
      option({ id: A, name: 'Booking pack' }),
      option({
        id: B,
        name: 'Chat pack',
        app: { id: B, slug: 'chat', name: 'Live chat', status: 'published', kind: 'mini_app' },
      }),
    ];
    expect(filterAppOptions(options, 'live').map((o) => o.id)).toEqual([B]);
    expect(filterAppOptions(options, 'booking').map((o) => o.id)).toEqual([A]);
    expect(filterAppOptions(options, '').length).toBe(2);
  });
});

describe('planCounts', () => {
  it('counts features on, capped limits (a 0 is unlimited) and visible add-ons', () => {
    const d = newPlanDraft();
    const features = {
      ...d.features,
      automation: false,
      calling: false,
    } as PlanAdminItem['features'];
    const limits = Object.fromEntries(PLAN_LIMIT_KEYS.map((k) => [k, 0])) as Record<
      (typeof PLAN_LIMIT_KEYS)[number],
      number
    >;
    limits.teams = 1_000_000; // unlimited stand-in: not a cap
    limits.users = 5;
    limits.contacts = 1000;
    const c = planCounts({ features, limits, visibleAddons: [A, B, GONE] });
    expect(c.featuresTotal).toBe(Object.keys(d.features).length);
    // the two switched off here, and the six flags a new plan starts without (two Smart routing, two reminder upgrade tier, two agent status)
    expect(c.featuresOn).toBe(c.featuresTotal - 8);
    expect(c.limitsTotal).toBe(PLAN_LIMIT_KEYS.length);
    expect(c.limitsSet).toBe(2);
    expect(c.addons).toBe(3);
  });
});
