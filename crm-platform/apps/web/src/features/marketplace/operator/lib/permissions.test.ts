import { describe, expect, it } from 'vitest';
import { PLATFORM_PERMISSION_KEYS } from '@crm/contracts';
import {
  MARKET_PERMISSIONS,
  marketAccess,
  missingForWrite,
  missingReadPermission,
} from './permissions';

describe('marketAccess', () => {
  it('names the three real platform permission keys', () => {
    expect(PLATFORM_PERMISSION_KEYS).toContain(MARKET_PERMISSIONS.manage);
    expect(PLATFORM_PERMISSION_KEYS).toContain(MARKET_PERMISSIONS.review);
    expect(PLATFORM_PERMISSION_KEYS).toContain(MARKET_PERMISSIONS.pricing);
    expect(MARKET_PERMISSIONS).toEqual({
      manage: 'platform.market.manage',
      review: 'platform.market.review',
      pricing: 'platform.market.pricing',
    });
  });

  it('reads the caller own permission map; a missing key is not held', () => {
    const none = { manage: false, review: false, pricing: false, canRead: false };
    expect(marketAccess(undefined)).toEqual(none);
    expect(marketAccess({})).toEqual(none);
    expect(marketAccess({ 'platform.market.manage': true })).toEqual({
      ...none,
      manage: true,
      canRead: true,
    });
    expect(marketAccess({ 'platform.market.review': true })).toEqual({
      ...none,
      review: true,
      canRead: true,
    });
    expect(marketAccess({ 'platform.market.pricing': true })).toEqual({
      ...none,
      pricing: true,
      canRead: true,
    });
    expect(
      marketAccess({
        'platform.market.manage': true,
        'platform.market.review': true,
        'platform.market.pricing': true,
      }),
    ).toEqual({ manage: true, review: true, pricing: true, canRead: true });
  });

  it('counts only an explicit true', () => {
    expect(
      marketAccess({
        'platform.market.manage': false,
        'platform.market.review': false,
        'platform.market.pricing': false,
      }).canRead,
    ).toBe(false);
  });
});

describe('missing keys', () => {
  it('names all three keys when none is held, nothing when any is', () => {
    const none = marketAccess({});
    expect(missingReadPermission(none)).toBe(
      'platform.market.manage, platform.market.review or platform.market.pricing',
    );
    expect(missingReadPermission(marketAccess({ 'platform.market.review': true }))).toBeNull();
    expect(missingReadPermission(marketAccess({ 'platform.market.manage': true }))).toBeNull();
    expect(missingReadPermission(marketAccess({ 'platform.market.pricing': true }))).toBeNull();
  });

  it('names the key a write needs when it is not held', () => {
    const reviewOnly = marketAccess({ 'platform.market.review': true });
    expect(missingForWrite(reviewOnly, 'manage')).toBe('platform.market.manage');
    expect(missingForWrite(reviewOnly, 'review')).toBeNull();
    expect(missingForWrite(reviewOnly, 'pricing')).toBe('platform.market.pricing');
    const manageOnly = marketAccess({ 'platform.market.manage': true });
    expect(missingForWrite(manageOnly, 'review')).toBe('platform.market.review');
    expect(missingForWrite(manageOnly, 'manage')).toBeNull();
    const pricingOnly = marketAccess({ 'platform.market.pricing': true });
    expect(missingForWrite(pricingOnly, 'pricing')).toBeNull();
    expect(missingForWrite(pricingOnly, 'manage')).toBe('platform.market.manage');
  });
});
