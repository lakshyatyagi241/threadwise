import { describe, expect, it } from 'vitest';
import { PLATFORM_PERMISSION_KEYS } from '@crm/contracts';
import {
  MARKET_PERMISSIONS,
  marketAccess,
  missingForWrite,
  missingReadPermission,
} from './permissions';

describe('marketAccess', () => {
  it('names the two real platform permission keys', () => {
    expect(PLATFORM_PERMISSION_KEYS).toContain(MARKET_PERMISSIONS.manage);
    expect(PLATFORM_PERMISSION_KEYS).toContain(MARKET_PERMISSIONS.review);
    expect(MARKET_PERMISSIONS).toEqual({
      manage: 'platform.market.manage',
      review: 'platform.market.review',
    });
  });

  it('reads the caller own permission map; a missing key is not held', () => {
    expect(marketAccess(undefined)).toEqual({ manage: false, review: false, canRead: false });
    expect(marketAccess({})).toEqual({ manage: false, review: false, canRead: false });
    expect(marketAccess({ 'platform.market.manage': true })).toEqual({
      manage: true,
      review: false,
      canRead: true,
    });
    expect(marketAccess({ 'platform.market.review': true })).toEqual({
      manage: false,
      review: true,
      canRead: true,
    });
    expect(
      marketAccess({ 'platform.market.manage': true, 'platform.market.review': true }),
    ).toEqual({ manage: true, review: true, canRead: true });
  });

  it('counts only an explicit true', () => {
    expect(
      marketAccess({ 'platform.market.manage': false, 'platform.market.review': false }).canRead,
    ).toBe(false);
  });
});

describe('missing keys', () => {
  it('names both keys when neither is held, nothing when either is', () => {
    const none = marketAccess({});
    expect(missingReadPermission(none)).toBe('platform.market.manage or platform.market.review');
    expect(missingReadPermission(marketAccess({ 'platform.market.review': true }))).toBeNull();
    expect(missingReadPermission(marketAccess({ 'platform.market.manage': true }))).toBeNull();
  });

  it('names the key a write needs when it is not held', () => {
    const reviewOnly = marketAccess({ 'platform.market.review': true });
    expect(missingForWrite(reviewOnly, 'manage')).toBe('platform.market.manage');
    expect(missingForWrite(reviewOnly, 'review')).toBeNull();
    const manageOnly = marketAccess({ 'platform.market.manage': true });
    expect(missingForWrite(manageOnly, 'review')).toBe('platform.market.review');
    expect(missingForWrite(manageOnly, 'manage')).toBeNull();
  });
});
