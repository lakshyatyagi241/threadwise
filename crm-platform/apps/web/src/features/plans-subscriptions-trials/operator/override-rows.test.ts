import { describe, expect, it } from 'vitest';
import { PLAN_LIMIT_KEYS, type WorkspaceAddons } from '@crm/contracts';
import {
  addonLists,
  limitGroups,
  limitRowState,
  planValueView,
  unlimitedToggle,
} from './override-rows';

describe('limit override rows', () => {
  it('treats -1 as unlimited and an empty box as the plan value', () => {
    expect(limitRowState('contacts', '-1')).toEqual({
      overridden: true,
      unlimited: true,
      platformDefault: false,
    });
    expect(limitRowState('contacts', '')).toEqual({
      overridden: false,
      unlimited: false,
      platformDefault: false,
    });
    expect(limitRowState('contacts', '500')).toEqual({
      overridden: true,
      unlimited: false,
      platformDefault: false,
    });
  });

  it('reads 0 as unlimited, except for the API rate where it is the platform default', () => {
    expect(limitRowState('contacts', '0').unlimited).toBe(true);
    expect(limitRowState('api_rate_limit_per_minute', '0')).toEqual({
      overridden: true,
      unlimited: false,
      platformDefault: true,
    });
    expect(limitRowState('api_rate_limit_per_minute', '-1').unlimited).toBe(true);
  });

  it('the Unlimited checkbox writes -1 or clears the box', () => {
    expect(unlimitedToggle(true)).toBe('-1');
    expect(unlimitedToggle(false)).toBe('');
  });

  it('shows the plan value for reference', () => {
    expect(planValueView('contacts', 0)).toEqual({ kind: 'unlimited' });
    expect(planValueView('api_rate_limit_per_minute', 0)).toEqual({ kind: 'platformDefault' });
    expect(planValueView('contacts', 250)).toEqual({ kind: 'value', value: 250 });
  });

  it('groups every limit key exactly once', () => {
    const groups = limitGroups();
    expect(groups.flatMap((g) => g.keys).sort()).toEqual([...PLAN_LIMIT_KEYS].sort());
    expect(groups[0]!.group).toBe('messaging');
  });
});

const app = (slug: string) => ({
  id: `00000000-0000-4000-8000-00000000000${slug.length}`,
  slug,
  name: slug,
});
describe('add-on lists', () => {
  const addons: WorkspaceAddons = {
    visible: [
      {
        id: '00000000-0000-4000-8000-000000000001',
        packSlug: 'mkt_a',
        app: app('a'),
        price: { amount: '5', currency: 'USD', period: { unit: 'months', count: 1 } },
        owned: true,
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        packSlug: 'mkt_b',
        app: app('bb'),
        price: { amount: '5', currency: 'USD', period: { unit: 'months', count: 1 } },
        owned: false,
      },
    ],
    owned: [
      {
        id: '00000000-0000-4000-8000-000000000001',
        packSlug: 'mkt_a',
        app: app('a'),
        endsAt: null,
        visibleOnPlan: true,
      },
      {
        id: '00000000-0000-4000-8000-000000000003',
        packSlug: 'mkt_z',
        app: app('zz'),
        endsAt: '2027-01-01T00:00:00.000Z',
        visibleOnPlan: false,
      },
    ],
  };

  it('lists visible add-ons with their owned state and the owned ones the plan no longer shows', () => {
    const l = addonLists(addons);
    expect(l.visible.map((v) => [v.app.slug, v.owned])).toEqual([
      ['a', true],
      ['bb', false],
    ]);
    expect(l.former.map((o) => o.app.slug)).toEqual(['zz']);
  });
});
