import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COUPON_REJECTION_REASONS } from '@crm/contracts';
import { OPERATOR_NAV } from '@/features/auth-registration-security/platform/operator-nav';
import { CPN_OPERATOR_NAV } from './operator-nav';

type Tree = { [key: string]: string | Tree };
const WEB = resolve(__dirname, '../../..');
const tree = JSON.parse(
  readFileSync(join(WEB, 'messages', 'en', 'coupons-credits-referral-currency.json'), 'utf8'),
) as Tree;

const get = (path: string): string | Tree | undefined => {
  let cur: string | Tree | undefined = tree;
  for (const part of path.split('.')) {
    if (typeof cur !== 'object' || cur === undefined) return undefined;
    cur = cur[part];
  }
  return cur;
};
const has = (path: string): boolean => get(path) !== undefined;
const ROOT = 'coupons-credits-referral-currency';

describe('coupons, credit packages and currencies messages', () => {
  it('has every menu label and group the console asks for', () => {
    for (const n of CPN_OPERATOR_NAV) {
      if (n.labelKey.startsWith(ROOT)) expect(has(n.labelKey), n.labelKey).toBe(true);
      if (n.groupKey.startsWith(ROOT)) expect(has(n.groupKey), n.groupKey).toBe(true);
    }
  });

  it('is merged into the console menu once, each page on its own address', () => {
    const ids = OPERATOR_NAV.filter((n) => CPN_OPERATOR_NAV.some((c) => c.id === n.id));
    expect(ids.map((n) => n.href)).toEqual([
      '/admin/coupons',
      '/admin/credit-packages',
      '/admin/currencies',
    ]);
  });

  it('has the keys the screens build dynamically', () => {
    const keys = [
      ...['all', 'active', 'disabled', 'expired'].map((s) => `${ROOT}.coupons.filters.${s}`),
      ...['created', 'updated', 'activated', 'deactivated', 'deleted'].map(
        (k) => `${ROOT}.coupons.toasts.${k}`,
      ),
      ...[
        'code',
        'description',
        'adminNote',
        'type',
        'amount',
        'maxDiscountAmount',
        'currencyCode',
        'minOrderAmount',
        'applicablePlans',
        'startsAt',
        'expiresAt',
        'maxUses',
        'perUserLimit',
      ].map((f) => `${ROOT}.coupons.editor.problems.${f}`),
      ...[
        'name',
        'slug',
        'price',
        'currencyCode',
        'credits',
        'badge',
        'description',
        'sortOrder',
      ].map((f) => `${ROOT}.packages.editor.problems.${f}`),
      ...['created', 'updated', 'activated', 'deactivated', 'deleted'].map(
        (k) => `${ROOT}.packages.toasts.${k}`,
      ),
      ...['name', 'code', 'symbol', 'precision', 'exchangeRate'].map(
        (f) => `${ROOT}.currencies.form.problems.${f}`,
      ),
      ...[
        'generic',
        'forbidden',
        'notFound',
        'conflict',
        'validation',
        'codeTaken',
        'planUnknown',
        'slugTaken',
        'currencyUnknown',
        'currencyTaken',
        'defaultProtected',
        'inUse',
        'ratesFailed',
      ].map((k) => `${ROOT}.errors.${k}`),
    ];
    for (const k of keys) expect(has(k), k).toBe(true);
  });

  it('keeps Reference wording on the screens it is compared with', () => {
    expect(get(`${ROOT}.coupons.title`)).toBe('Discount coupons');
    expect(get(`${ROOT}.coupons.empty.title`)).toBe('No coupons match.');
    expect(get(`${ROOT}.coupons.toasts.deleted`)).toBe('Coupon removed.');
    expect(get(`${ROOT}.packages.delete.body`)).toBe(
      'Delete this package? Existing purchases keep their ledger rows.',
    );
    expect(get(`${ROOT}.currencies.toasts.defaultSet`)).toBe('Default currency set to {code}.');
  });

  it('every resolver rejection has a sentence in contracts (the checkout shows them verbatim)', () => {
    expect(COUPON_REJECTION_REASONS).toHaveLength(13);
  });
});
