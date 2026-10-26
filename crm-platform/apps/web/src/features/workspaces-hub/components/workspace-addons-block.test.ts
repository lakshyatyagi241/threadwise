import { describe, expect, it } from 'vitest';
import type { AddonCard } from '@crm/contracts';
import { addonSource } from './workspace-addons-block';

const card = (o: Partial<AddonCard>): AddonCard => ({
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'smart_routing',
  name: 'Smart routing',
  subtitle: null,
  amount: '9.00',
  offerAmount: null,
  currency: 'USD',
  isFree: false,
  isLifetime: false,
  billingUnit: 'months',
  billingDuration: 1,
  billingMode: 'recurring',
  grantBullets: [],
  ownedCount: 0,
  ownedEndsAt: null,
  ownedRenews: false,
  state: 'buy',
  includedVia: null,
  kind: 'feature',
  activation: 'active',
  canToggle: false,
  ...o,
});

describe('addonSource: why an add-on is on or off for the workspace', () => {
  it('names the plan, an override, the platform, a purchase, a buy and what is unavailable', () => {
    expect(addonSource(card({ state: 'included', includedVia: 'plan' }), {}, false).key).toBe(
      'plan',
    );
    expect(
      addonSource(
        card({ state: 'included', includedVia: 'support' }),
        { inbox_routing: true },
        false,
      ),
    ).toEqual({ key: 'override', tone: 'warning' });
    expect(addonSource(card({ state: 'included', includedVia: 'support' }), {}, true).key).toBe(
      'platform',
    );
    expect(addonSource(card({ state: 'active', ownedCount: 1 }), {}, false).key).toBe('bought');
    expect(addonSource(card({ state: 'buy_again', ownedCount: 2 }), {}, false).key).toBe('bought');
    expect(addonSource(card({}), {}, false).key).toBe('buy');
    expect(addonSource(card({ state: 'unavailable' }), {}, false).key).toBe('unavailable');
  });
});
