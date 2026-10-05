import { describe, expect, it } from 'vitest';
import {
  isOrderOnlyCustomerId,
  listStoreCustomersQuerySchema,
  storeCustomerIdSchema,
} from '@crm/contracts';
import {
  decodeCustomerCursor,
  encodeCustomerCursor,
  type BuyerRow,
} from '../../../src/modules/storefront-builder/admin/store-customers.repository';
import { toCustomer } from '../../../src/modules/storefront-builder/admin/store-customers.service';

const buyer = (over: Partial<BuyerRow> = {}): BuyerRow => ({
  key: '917999834066',
  profileId: null,
  profileUuid: null,
  profilePhone: null,
  name: 'SHubham',
  company: null,
  address: null,
  contactUuid: null,
  rowVersion: 0,
  createdAt: new Date('2026-10-05T09:06:44.542Z'),
  updatedAt: new Date('2026-10-05T09:06:44.542Z'),
  activityUs: '1790000000000000',
  stats: {
    orderCount: 1,
    totals: [{ currencyCode: 'INR', totalMinor: 10000, orders: 1 }],
    lastOrderAt: new Date('2026-10-05T09:06:44.542Z'),
  },
  ...over,
});

describe('toCustomer: an order-only buyer, a profile, and the address flag', () => {
  it('an order-only buyer is keyed by phone:<digits> and has no profile or saved address', () => {
    expect(toCustomer(buyer())).toMatchObject({
      id: 'phone:917999834066',
      phone: '917999834066',
      hasProfile: false,
      hasSavedAddress: false,
      rowVersion: 0,
      orderCount: 1,
      lifetimeTotals: [{ currencyCode: 'INR', totalMinor: 10000, orders: 1 }],
      lastOrderAt: '2026-10-05T09:06:44.542Z',
    });
  });

  it('a profile is keyed by its uuid and keeps the number as it was saved', () => {
    const c = toCustomer(
      buyer({
        profileId: 4,
        profileUuid: '5b4d4a3c-2b8a-4f0e-9a52-0c3f6a8e1d99',
        profilePhone: '7999834066',
        address: '12 MG Road',
        company: 'Acme',
        rowVersion: 3,
      }),
    );
    expect(c).toMatchObject({
      id: '5b4d4a3c-2b8a-4f0e-9a52-0c3f6a8e1d99',
      phone: '7999834066',
      hasProfile: true,
      hasSavedAddress: true,
      rowVersion: 3,
    });
  });

  it('a profile without an address (or with a blank one) has no saved address', () => {
    for (const address of [null, '', '   ']) {
      const c = toCustomer(buyer({ profileId: 4, profileUuid: 'u', profilePhone: '1', address }));
      expect(c.hasProfile).toBe(true);
      expect(c.hasSavedAddress).toBe(false);
    }
  });

  it('a saved customer nobody ordered with has no orders and no last order', () => {
    const c = toCustomer(
      buyer({
        profileId: 4,
        profileUuid: 'u',
        profilePhone: '9',
        stats: { orderCount: 0, totals: [], lastOrderAt: null },
      }),
    );
    expect(c).toMatchObject({ orderCount: 0, lifetimeTotals: [], lastOrderAt: null });
  });
});

describe('customer ids and the list query', () => {
  it('accepts a uuid or phone:<digits>, nothing else', () => {
    for (const ok of ['5b4d4a3c-2b8a-4f0e-9a52-0c3f6a8e1d99', 'phone:917999834066', 'phone:1']) {
      expect(storeCustomerIdSchema.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of [
      '',
      'phone:',
      'phone:+91',
      'phone:12ab',
      'phone:' + '1'.repeat(33),
      'x',
      '5b4d4a3c',
    ]) {
      expect(storeCustomerIdSchema.safeParse(bad).success, bad).toBe(false);
    }
    expect(isOrderOnlyCustomerId('phone:917999834066')).toBe(true);
    expect(isOrderOnlyCustomerId('5b4d4a3c-2b8a-4f0e-9a52-0c3f6a8e1d99')).toBe(false);
  });

  it('keeps q and limit, and takes an optional shop uuid', () => {
    expect(listStoreCustomersQuerySchema.parse({})).toEqual({ limit: 20 });
    const q = listStoreCustomersQuerySchema.parse({
      q: ' asha ',
      limit: '5',
      storefrontId: '5b4d4a3c-2b8a-4f0e-9a52-0c3f6a8e1d99',
    });
    expect(q).toMatchObject({ q: 'asha', limit: 5 });
    expect(listStoreCustomersQuerySchema.safeParse({ storefrontId: 'nope' }).success).toBe(false);
  });
});

describe('customer cursor', () => {
  it('round-trips the activity in exact microseconds, the phone key and the profile', () => {
    const c = { activityUs: '1790000000123456', key: '917999834066', profileId: 12 };
    expect(decodeCustomerCursor(encodeCustomerCursor(c))).toEqual(c);
    expect(decodeCustomerCursor(encodeCustomerCursor({ ...c, profileId: 0 })).profileId).toBe(0);
  });

  it.each([
    'not-base64-json',
    Buffer.from('[]').toString('base64url'),
    Buffer.from(JSON.stringify([1, 'k', 1])).toString('base64url'),
    Buffer.from(JSON.stringify(['12x', 'k', 1])).toString('base64url'),
    Buffer.from(JSON.stringify(['12', 5, 1])).toString('base64url'),
    Buffer.from(JSON.stringify(['12', 'k', 'x'])).toString('base64url'),
  ])('rejects a malformed cursor %s', (raw) => {
    expect(() => decodeCustomerCursor(raw)).toThrow();
  });
});
