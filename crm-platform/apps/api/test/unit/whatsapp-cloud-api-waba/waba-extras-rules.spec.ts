import { describe, expect, it } from 'vitest';
import {
  conversationsFrom,
  usernameOf,
  usernameProblem,
  usernameSuggestions,
  usernameUpdatePatch,
} from '../../../src/modules/whatsapp-cloud-api-waba/waba-extras-rules';

describe('business username rules (TW-WABA-025)', () => {
  it('accepts an ordinary handle', () => {
    expect(usernameProblem('acme.store_1')).toBeNull();
  });
  it.each([
    ['ab', 'length'],
    ['a'.repeat(25), 'length'],
    ['Acme!', 'characters'],
    ['12345', 'letter'],
    ['.acme', 'dot'],
    ['acme.', 'dot'],
    ['ac..me', 'dot'],
    ['www.brand', 'www'],
    ['brand.com', 'web address'],
    ['mystore.shop', 'web address'],
  ])('refuses %s', (handle) => {
    expect(usernameProblem(handle)).not.toBeNull();
  });
  it("suggests Meta's reserved handle first, then the brand, valid and distinct, at most five", () => {
    const s = usernameSuggestions('acmestore', 'Acme Store');
    // 'acme.store' ends like a web address, so it is not offered.
    expect(s).toEqual(['acmestore', 'acme_store']);
    expect(usernameSuggestions(null, 'x')).toEqual([]); // too short to be valid
    expect(usernameSuggestions('www.bad', 'Brand Co')).toEqual(['brandco', 'brand_co']);
  });
});

describe('business_username_update webhook (TW-WABA-026)', () => {
  const none = usernameOf(null);
  it('stores the handle and the status Meta reports', () => {
    expect(usernameUpdatePatch({ username: 'acme', status: 'APPROVED' }, none, 'T')).toEqual({
      wa_username: 'acme',
      wa_username_status: 'approved',
      wa_username_at: 'T',
    });
  });
  it('reads requested_username and username_status, and keeps the previous status on an unknown one', () => {
    const prev = usernameOf({ wa_username: 'acme', wa_username_status: 'approved' });
    expect(
      usernameUpdatePatch({ requested_username: 'acme2', username_status: 'pending' }, prev, 'T'),
    ).toMatchObject({ wa_username: 'acme2', wa_username_status: 'approved' });
  });
  it('clears everything when the handle was deleted, removed or released', () => {
    for (const status of ['deleted', 'removed', 'released']) {
      expect(usernameUpdatePatch({ status }, none, 'T')).toEqual({
        wa_username: null,
        wa_username_status: null,
        wa_username_at: null,
      });
    }
    expect(usernameOf({ wa_username: null, wa_username_status: null })).toEqual({
      username: null,
      status: null,
    });
  });
});

describe('free service-conversation allowance (TW-WABA-023)', () => {
  it('300 free and 40 paid this month leaves 700 of 1,000', () => {
    expect(
      conversationsFrom([
        { conversation_type: 'FREE_ENTRY_POINT', conversation: 100, cost: 0 },
        { conversation_type: 'FREE_TIER', conversation: 200, cost: 0 },
        { conversation_type: 'SERVICE', conversation: 40, cost: 1.234 },
      ]),
    ).toEqual({ freeUsed: 300, freeTotal: 1000, freeLeft: 700, paid: 40, total: 340, cost: 1.23 });
  });
  it('never goes below zero, and no answer means no card', () => {
    expect(
      conversationsFrom([{ conversation_type: 'FREE_TIER', conversation: 1500 }])?.freeLeft,
    ).toBe(0);
    expect(conversationsFrom(null)).toBeNull();
  });
});
