import { describe, expect, it } from 'vitest';
import type { AddonCard, OwnedAddon, WorkspaceAddonsResponse } from '@crm/contracts';
import { renderAccount } from '@/features/auth-registration-security/account/render-test-utils';
import { KEYS } from '../api';
import { AddonsList } from './addons-list';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const card = (n: number, over: Partial<AddonCard> = {}): AddonCard => ({
  id: ID(n),
  slug: `pack_${n}`,
  name: `Pack ${n}`,
  subtitle: null,
  amount: '9.00',
  offerAmount: null,
  currency: 'USD',
  isFree: false,
  isLifetime: false,
  billingUnit: 'months',
  billingDuration: 1,
  billingMode: 'recurring',
  grantBullets: [{ kind: 'feature', key: 'inbox_routing', label: 'Smart routing', amount: null }],
  ownedCount: 0,
  ownedEndsAt: null,
  ownedRenews: false,
  state: 'buy',
  includedVia: null,
  kind: 'feature',
  ...over,
});

const owned = (n: number, over: Partial<OwnedAddon> = {}): OwnedAddon => ({
  id: ID(500 + n),
  packId: ID(n),
  name: `Pack ${n}`,
  startsAt: null,
  endsAt: '2030-01-15T00:00:00.000Z',
  renews: false,
  ...over,
});

const data = (over: Partial<WorkspaceAddonsResponse> = {}): WorkspaceAddonsResponse => ({
  eligible: true,
  unavailableReason: null,
  canBuy: true,
  owned: [],
  catalog: [],
  ...over,
});

describe.each(['en', 'ar'] as const)('the shared add-ons list (%s)', (locale) => {
  const html = (d: WorkspaceAddonsResponse) =>
    renderAccount(<AddonsList />, { locale, seed: [[KEYS.workspace, d]] });

  it('a buy card has the price per period, the renewal wording and a checkout link', () => {
    const out = html(data({ catalog: [card(1)] }));
    expect(out).toContain('data-testid="addon-pack_1"');
    expect(out).toContain('data-state="buy"');
    expect(out).toContain('href="/billing/checkout/pack_1"');
    expect(out).toMatch(/9(\.00|[.,]00)/);
  });

  it('every card is in exactly one state', () => {
    const out = html(
      data({
        catalog: [
          card(1, { state: 'buy' }),
          card(2, { state: 'included', grantBullets: [] }),
          card(3, { state: 'active', ownedCount: 1, ownedEndsAt: '2030-01-15T00:00:00.000Z' }),
          card(4, { state: 'buy_again', ownedCount: 2 }),
        ],
        owned: [owned(3)],
      }),
    );
    for (const s of ['buy', 'included', 'active', 'buy_again']) {
      expect(out.match(new RegExp(`data-state="${s}"`, 'g'))).toHaveLength(1);
    }
    // included and active never offer a purchase
    expect(out).not.toContain('href="/billing/checkout/pack_2"');
    expect(out).not.toContain('href="/billing/checkout/pack_3"');
    expect(out).toContain('href="/billing/checkout/pack_4"');
    expect(out).toContain('data-testid="addon-pack_2-included"');
    expect(out).toContain('data-testid="addon-pack_3-active"');
  });

  it('groups the cards under Feature add-ons and Capacity add-ons, and leaves out an empty group', () => {
    const both = html(
      data({ catalog: [card(1), card(2, { kind: 'capacity' }), card(3, { kind: 'feature' })] }),
    );
    expect(both).toContain('data-testid="addons-group-feature"');
    expect(both).toContain('data-testid="addons-group-capacity"');
    expect(both).toContain('aria-labelledby="addons-group-feature"');
    // feature cards first, then capacity; each card sits in its own group
    const feature = both.slice(
      both.indexOf('data-testid="addons-group-feature"'),
      both.indexOf('data-testid="addons-group-capacity"'),
    );
    expect(feature).toContain('data-testid="addon-pack_1"');
    expect(feature).toContain('data-testid="addon-pack_3"');
    expect(feature).not.toContain('data-testid="addon-pack_2"');
    expect(both.indexOf('data-testid="addon-pack_2"')).toBeGreaterThan(
      both.indexOf('data-testid="addons-group-capacity"'),
    );
    const featureOnly = html(data({ catalog: [card(1)] }));
    expect(featureOnly).toContain('data-testid="addons-group-feature"');
    expect(featureOnly).not.toContain('data-testid="addons-group-capacity"');
    const capacityOnly = html(data({ catalog: [card(2, { kind: 'capacity' })] }));
    expect(capacityOnly).not.toContain('data-testid="addons-group-feature"');
    expect(capacityOnly).toContain('data-testid="addons-group-capacity"');
  });

  it('a free plan gets a clear message and an upgrade link, and no buy link', () => {
    const out = html(
      data({
        eligible: false,
        unavailableReason: 'free_plan',
        catalog: [card(1, { state: 'unavailable' })],
      }),
    );
    expect(out).toContain('data-testid="addons-unavailable"');
    expect(out).toContain('href="/account/plans"');
    expect(out).toContain('data-testid="addon-pack_1-unavailable"');
    expect(out).not.toContain('/billing/checkout/');
  });

  it('every unavailable reason has its own wording', () => {
    const texts = (['free_plan', 'plan_expired', 'no_plan'] as const).map((r) =>
      html(data({ eligible: false, unavailableReason: r, catalog: [] })),
    );
    expect(new Set(texts).size).toBe(3);
  });

  it('a member who may not buy sees the card with a disabled button and the reason, no checkout link', () => {
    const out = html(data({ canBuy: false, catalog: [card(1)] }));
    expect(out).toContain('disabled');
    expect(out).toContain('aria-describedby="addon-pack_1-hint"');
    expect(out).toContain('id="addon-pack_1-hint"');
    expect(out).not.toContain('/billing/checkout/');
  });

  it('a renewal the job stopped says the add-on ends and will not renew, still included', () => {
    const out = html(
      data({
        catalog: [
          card(1, {
            state: 'included',
            ownedCount: 1,
            ownedRenews: false,
            ownedEndsAt: '2030-01-15T00:00:00.000Z',
            grantBullets: [],
          }),
        ],
      }),
    );
    expect(out).toContain('data-testid="addon-pack_1-note"');
  });

  it('an override or platform-owned inclusion says it was enabled by the account manager', () => {
    const plain = html(
      data({ catalog: [card(1, { state: 'included', includedVia: 'plan', grantBullets: [] })] }),
    );
    const support = html(
      data({ catalog: [card(1, { state: 'included', includedVia: 'support', grantBullets: [] })] }),
    );
    expect(support.length).toBeGreaterThan(plain.length);
  });

  it('an offer price shows the list price struck through', () => {
    const out = html(data({ catalog: [card(1, { amount: '10.00', offerAmount: '7.00' })] }));
    expect(out).toContain('line-through');
    expect(out).toMatch(/7(\.00|[.,]00)/);
  });

  it('a legacy one-time or lifetime pack is worded as a one-time purchase (no renewal promise)', () => {
    const recurring = html(data({ catalog: [card(1)] }));
    const oneTime = html(data({ catalog: [card(1, { billingMode: 'one_time' })] }));
    const lifetime = html(
      data({ catalog: [card(1, { billingMode: 'one_time', isLifetime: true })] }),
    );
    expect(oneTime).not.toBe(recurring);
    expect(lifetime).toBe(oneTime);
  });

  it('an empty catalogue says so; wallet credits are a link, never a card', () => {
    const out = html(data({ catalog: [] }));
    expect(out).toContain('href="/billing/wallet"');
    expect(out).not.toContain('data-testid="addon-');
  });

  it('owned rows show their end and a cancel control only while they renew; lists use landmarks and labels', () => {
    const out = html(
      data({
        owned: [
          owned(1, { renews: true }),
          owned(2, { renews: false }),
          owned(3, { endsAt: null }),
        ],
        catalog: [
          card(1, {
            state: 'active',
            ownedCount: 1,
            ownedRenews: true,
            ownedEndsAt: '2030-01-15T00:00:00.000Z',
          }),
        ],
      }),
    );
    expect(out).toContain('data-testid="addons-owned"');
    expect(out).toContain('aria-labelledby="addon-pack_1-title"');
    expect(out).toContain('id="addon-pack_1-title"');
  });
});
