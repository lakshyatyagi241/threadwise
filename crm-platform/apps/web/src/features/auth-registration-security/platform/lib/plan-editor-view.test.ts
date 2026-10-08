import { PLAN_LIMIT_KEYS, type PlanAddonOption, type PlanAdminItem } from '@crm/contracts';
import { describe, expect, it } from 'vitest';
import {
  LIMIT_UNITS,
  addonRows,
  addonSaleState,
  filterAddonRows,
  filterKeys,
  firstProblemField,
  isPlatformDefaultLimit,
  limitDisabledByPlatform,
  matchesQuery,
  planCounts,
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
    expect(
      addonSaleState(option({ id: A, app: { id: A, slug: 's', name: 'S', status: 'draft' } })),
    ).toBe('appUnpublished');
    // An inactive pack is reported before an unpublished app.
    expect(
      addonSaleState(
        option({ id: A, isActive: false, app: { id: A, slug: 's', name: 'S', status: 'draft' } }),
      ),
    ).toBe('packInactive');
  });

  it('keeps a selected id the options no longer list as an unknown row, listed first', () => {
    const rows = addonRows([option({ id: A }), option({ id: B })], [B, GONE, GONE]);
    expect(rows.map((r) => `${r.kind}:${r.id}`)).toEqual([
      `unknown:${GONE}`,
      `option:${A}`,
      `option:${B}`,
    ]);
  });

  it('has no unknown rows when every selected id is listed', () => {
    expect(addonRows([option({ id: A })], [A]).every((r) => r.kind === 'option')).toBe(true);
    expect(addonRows([], [])).toEqual([]);
  });

  it('filters by add-on, app and pack names; unknown rows always stay so they can be unticked', () => {
    const rows = addonRows(
      [
        option({ id: A, name: 'Booking pack' }),
        option({
          id: B,
          name: 'Chat pack',
          app: { id: B, slug: 'chat', name: 'Live chat', status: 'published' },
        }),
      ],
      [GONE],
    );
    expect(filterAddonRows(rows, 'live').map((r) => r.id)).toEqual([GONE, B]);
    expect(filterAddonRows(rows, 'booking').map((r) => r.id)).toEqual([GONE, A]);
    expect(filterAddonRows(rows, '').length).toBe(3);
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
    limits.users = 5;
    limits.contacts = 1000;
    const c = planCounts({ features, limits, visibleAddons: [A, B, GONE] });
    expect(c.featuresTotal).toBe(Object.keys(d.features).length);
    expect(c.featuresOn).toBe(c.featuresTotal - 2);
    expect(c.limitsTotal).toBe(PLAN_LIMIT_KEYS.length);
    expect(c.limitsSet).toBe(2);
    expect(c.addons).toBe(3);
  });
});
