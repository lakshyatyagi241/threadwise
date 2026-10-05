import { describe, expect, it } from 'vitest';
import {
  WORKSPACE_SCOPE,
  canSetDefault,
  cardState,
  chooseScope,
  defaultOverrideShop,
  filterDrivers,
  orderDrivers,
  rowInScope,
  savedForScope,
  scopeFromStorefrontId,
  scopeStorefrontId,
} from './gateway-scope';
import {
  SHOP_A,
  SHOP_B,
  comingDriver,
  razorpayDriver,
  savedGateway,
  stripeDriver,
} from './gateway-test-fixtures';

const workspaceRow = savedGateway();
const shopRow = savedGateway({
  id: '44444444-4444-4444-8444-444444444444',
  scope: 'store',
  storefrontId: SHOP_A,
  storefrontName: 'Main shop',
});

describe('scope <-> storefrontId', () => {
  it('the workspace has no storefrontId', () => {
    expect(scopeStorefrontId(WORKSPACE_SCOPE)).toBeUndefined();
    expect(scopeStorefrontId({ kind: 'store', storefrontId: SHOP_A })).toBe(SHOP_A);
  });

  it('no id, an empty id and the legacy 0 are the workspace', () => {
    expect(scopeFromStorefrontId(undefined)).toEqual(WORKSPACE_SCOPE);
    expect(scopeFromStorefrontId(null)).toEqual(WORKSPACE_SCOPE);
    expect(scopeFromStorefrontId('')).toEqual(WORKSPACE_SCOPE);
    expect(scopeFromStorefrontId('0')).toEqual(WORKSPACE_SCOPE);
    expect(scopeFromStorefrontId(SHOP_B)).toEqual({ kind: 'store', storefrontId: SHOP_B });
  });

  it('chooseScope falls back to the workspace when no shop is known', () => {
    expect(chooseScope('store', undefined)).toEqual(WORKSPACE_SCOPE);
    expect(chooseScope('workspace', SHOP_A)).toEqual(WORKSPACE_SCOPE);
    expect(chooseScope('store', SHOP_A)).toEqual({ kind: 'store', storefrontId: SHOP_A });
  });
});

describe('which saved row applies to a scope', () => {
  it('matches the workspace row only in the workspace scope', () => {
    expect(rowInScope(workspaceRow, WORKSPACE_SCOPE)).toBe(true);
    expect(rowInScope(workspaceRow, { kind: 'store', storefrontId: SHOP_A })).toBe(false);
  });

  it('matches a shop override only for that shop', () => {
    expect(rowInScope(shopRow, { kind: 'store', storefrontId: SHOP_A })).toBe(true);
    expect(rowInScope(shopRow, { kind: 'store', storefrontId: SHOP_B })).toBe(false);
    expect(rowInScope(shopRow, WORKSPACE_SCOPE)).toBe(false);
  });

  it('savedForScope picks by slug and scope', () => {
    const rows = [workspaceRow, shopRow];
    expect(savedForScope(rows, 'razorpay', WORKSPACE_SCOPE)).toBe(workspaceRow);
    expect(savedForScope(rows, 'razorpay', { kind: 'store', storefrontId: SHOP_A })).toBe(shopRow);
    expect(savedForScope(rows, 'stripe', WORKSPACE_SCOPE)).toBeUndefined();
    expect(
      savedForScope(rows, 'razorpay', { kind: 'store', storefrontId: SHOP_B }),
    ).toBeUndefined();
  });
});

describe('defaultOverrideShop', () => {
  const shops = [{ id: SHOP_A }, { id: SHOP_B }];
  it('prefers the shop in the address, then the overview shop, then the first', () => {
    expect(defaultOverrideShop(SHOP_B, SHOP_A, shops)).toBe(SHOP_B);
    expect(defaultOverrideShop(undefined, SHOP_B, shops)).toBe(SHOP_B);
    expect(defaultOverrideShop(undefined, undefined, shops)).toBe(SHOP_A);
  });
  it('ignores a shop that is not in the list', () => {
    expect(defaultOverrideShop('gone', SHOP_B, shops)).toBe(SHOP_B);
    expect(defaultOverrideShop('gone', 'also-gone', shops)).toBe(SHOP_A);
  });
  it('trusts the address while the list is empty', () => {
    expect(defaultOverrideShop(SHOP_A, undefined, [])).toBe(SHOP_A);
    expect(defaultOverrideShop(undefined, undefined, [])).toBeUndefined();
  });
});

describe('the catalogue', () => {
  const drivers = [comingDriver, stripeDriver, razorpayDriver];

  it('puts saved rows first, then available, then not available yet', () => {
    const ordered = orderDrivers(drivers, [workspaceRow], WORKSPACE_SCOPE).map((d) => d.slug);
    expect(ordered).toEqual(['razorpay', 'stripe', 'paystack']);
  });

  it('a row saved for another scope does not move a card', () => {
    const ordered = orderDrivers(drivers, [shopRow], WORKSPACE_SCOPE).map((d) => d.slug);
    expect(ordered).toEqual(['stripe', 'razorpay', 'paystack']);
  });

  it('searches name, description, regions and currencies', () => {
    expect(filterDrivers(drivers, '').length).toBe(3);
    expect(filterDrivers(drivers, 'RAZOR').map((d) => d.slug)).toEqual(['razorpay']);
    expect(filterDrivers(drivers, 'gbp').map((d) => d.slug)).toEqual(['stripe']);
    expect(filterDrivers(drivers, 'ng').map((d) => d.slug)).toContain('paystack');
    expect(filterDrivers(drivers, 'zzz')).toEqual([]);
  });
});

describe('card state and the default button', () => {
  it('reports the state of a card', () => {
    expect(cardState(comingDriver, undefined)).toBe('unavailable');
    expect(cardState(razorpayDriver, undefined)).toBe('notSetUp');
    expect(cardState(razorpayDriver, savedGateway({ configured: false }))).toBe('incomplete');
    expect(cardState(razorpayDriver, savedGateway({ active: false }))).toBe('off');
    expect(cardState(razorpayDriver, savedGateway())).toBe('active');
  });

  it('only a saved, complete, active row that is not the default can be made the default', () => {
    expect(canSetDefault(undefined)).toBe(false);
    expect(canSetDefault(savedGateway({ isDefault: true }))).toBe(false);
    expect(canSetDefault(savedGateway({ isDefault: false, configured: false }))).toBe(false);
    expect(canSetDefault(savedGateway({ isDefault: false, active: false }))).toBe(false);
    expect(canSetDefault(savedGateway({ isDefault: false }))).toBe(true);
  });
});
