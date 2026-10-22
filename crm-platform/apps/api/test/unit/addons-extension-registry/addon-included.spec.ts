import { describe, expect, it } from 'vitest';
import {
  cardState,
  isIncludedInPlan,
  missingGrants,
} from '../../../src/modules/addons-extension-registry/addon-grants';

const smart = { features: ['inbox_assignment_sticky', 'inbox_routing'], limits: {} };
const teams = { features: ['custom_roles', 'team_hierarchy'], limits: { teams: 10 } };
const capOnly = { features: [], limits: { users: 5 } };

describe('an add-on the plan already includes', () => {
  it('is included only when every feature is granted and the pack adds no cap', () => {
    const both = new Set(['inbox_routing', 'inbox_assignment_sticky']);
    expect(isIncludedInPlan(smart, both)).toBe(true);
    expect(isIncludedInPlan(smart, new Set(['inbox_routing']))).toBe(false); // partial
    expect(isIncludedInPlan(smart, new Set())).toBe(false);
    expect(isIncludedInPlan(teams, new Set(teams.features))).toBe(false); // +10 teams is still something to sell
    expect(isIncludedInPlan(capOnly, new Set())).toBe(false); // nothing but caps: never included
  });

  it('lists only what is still missing', () => {
    expect(missingGrants(smart, new Set(['inbox_routing']))).toEqual({
      features: ['inbox_assignment_sticky'],
      limits: {},
    });
    expect(missingGrants(teams, new Set(teams.features))).toEqual({
      features: [],
      limits: { teams: 10 },
    });
  });

  it('the card state: included beats owned, otherwise buy / active / buy again as before', () => {
    const both = new Set(['inbox_routing', 'inbox_assignment_sticky']);
    expect(cardState(smart, 0, both)).toBe('included');
    expect(cardState(smart, 2, both)).toBe('included');
    expect(cardState(smart, 0)).toBe('buy');
    expect(cardState(smart, 1)).toBe('active');
    expect(cardState(capOnly, 1)).toBe('buy_again');
    expect(cardState(teams, 0, new Set(teams.features))).toBe('buy');
  });
});
