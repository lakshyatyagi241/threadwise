import { describe, expect, it, vi } from 'vitest';
import type { StoreCoupon } from '@crm/contracts';
import { ToastProvider } from '@crm/ui';
import {
  makeSession,
  renderAccount,
} from '@/features/auth-registration-security/account/render-test-utils';
import { CHK_KEYS } from '../api/hooks';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => '/store/coupons',
  useSearchParams: () => new URLSearchParams(),
}));

import { CouponFormModal } from './coupons-form-modal';
import { CouponsScreen } from './coupons-screen';

/**
 * Static renders with the real English and Arabic messages: they prove the text is complete (a missing message throws), that the
 * data a screen is given is shown the way the brief says, and that permissions decide which controls exist. No browser here.
 */

const LOCALES = ['en', 'ar'] as const;
const READ = { 'store.coupons.read': 'all' } as const;
const MANAGE = { ...READ, 'store.coupons.manage': 'all' } as const;
const as = (permissions: Record<string, 'all'>) => ({ session: makeSession({ permissions }) });

const ID = (n: number) => `5b4d4a3c-2b8a-4f0e-9a52-0c3f6a8e1d${String(n).padStart(2, '0')}`;
const coupon = (over: Partial<StoreCoupon> = {}): StoreCoupon => ({
  id: ID(1),
  code: 'SUMMER10',
  type: 'percent',
  amount: 10,
  minSubtotalMinor: 50000,
  maxDiscountMinor: 20000,
  freeShipping: true,
  active: true,
  startsAt: null,
  expiresAt: '2026-12-31T12:00:00.000Z',
  usageLimit: null,
  usedCount: 7,
  state: 'active',
  storefrontId: null,
  storefrontName: null,
  rowVersion: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

const flat = coupon({
  id: ID(2),
  code: 'FLAT250',
  type: 'flat',
  amount: 25000,
  minSubtotalMinor: null,
  maxDiscountMinor: null,
  freeShipping: false,
  active: false,
  state: 'inactive',
  usageLimit: 20,
  usedCount: 20,
  storefrontId: ID(9),
  storefrontName: 'Main shop',
});

const listSeed = (items: StoreCoupon[]) =>
  [
    [...CHK_KEYS.coupons, {}] as const,
    {
      pages: [{ data: items, page: { nextCursor: null, hasMore: false, limit: 30 } }],
      pageParams: [undefined],
    },
  ] as const;

const overviewSeed = [
  ['store', 'overview', ''] as const,
  { shop: { currencyCode: 'INR' }, shops: [{ id: ID(9), shopName: 'Main shop', slug: 'main' }] },
] as const;

const screen = () => (
  <ToastProvider>
    <CouponsScreen />
  </ToastProvider>
);

describe('Coupons screen', () => {
  for (const locale of LOCALES) {
    it(`lists every coupon with its code, discount, usage and scope in ${locale}`, () => {
      const html = renderAccount(screen(), {
        locale,
        ...as(MANAGE),
        seed: [listSeed([coupon(), flat]), overviewSeed],
      });
      expect(html.match(/data-testid="coupon-row"/g)).toHaveLength(2);
      expect(html).toContain('SUMMER10');
      expect(html).toContain('FLAT250');
      // percent shows a percentage, flat shows money (minor units 25000 = 250.00), unlimited shows the infinity sign
      expect(html).toContain('%');
      expect(html).toMatch(/250\.00|٢٥٠٫٠٠/);
      expect(html).toContain('∞');
      expect(html).toContain('Main shop');
      expect(html.match(/role="switch"/g)).toHaveLength(2);
    });
  }

  it('offers create, edit, delete and the on/off switch to a person who can manage', () => {
    const html = renderAccount(screen(), {
      ...as(MANAGE),
      seed: [listSeed([coupon()]), overviewSeed],
    });
    expect(html).toContain('New coupon');
    expect(html).toContain('Edit coupon SUMMER10');
    expect(html).toContain('Delete coupon SUMMER10');
    expect(html).toContain('Orders that used coupon SUMMER10');
    expect(html).not.toMatch(/role="switch"[^>]*\sdisabled=""/);
  });

  it('a read-only person sees the list and the usages but no create, edit or delete, and a locked switch', () => {
    const html = renderAccount(screen(), {
      ...as(READ),
      seed: [listSeed([coupon()]), overviewSeed],
    });
    expect(html).toContain('SUMMER10');
    expect(html).not.toContain('New coupon');
    expect(html).not.toContain('Edit coupon');
    expect(html).not.toContain('Delete coupon SUMMER10');
    expect(html).toContain('Orders that used coupon SUMMER10');
    expect(html).toMatch(/role="switch"[^>]*\sdisabled=""/);
  });

  it('a person without the read right gets the no-access panel and no table', () => {
    const html = renderAccount(screen(), { ...as({}) });
    expect(html).toContain('You do not have access to this page');
    expect(html).not.toContain('<table');
  });

  for (const locale of LOCALES) {
    it(`an empty list offers the first coupon in ${locale}`, () => {
      const html = renderAccount(screen(), {
        locale,
        ...as(MANAGE),
        seed: [listSeed([]), overviewSeed],
      });
      expect(html).not.toContain('<table');
      expect(html).toContain(locale === 'en' ? 'No coupons yet' : 'لا توجد قسائم بعد');
      expect(html).toContain(locale === 'en' ? 'New coupon' : 'قسيمة جديدة');
    });
  }

  it('shows a loading skeleton while the list loads', () => {
    const html = renderAccount(screen(), { ...as(MANAGE) });
    expect(html).toContain('role="status"');
    expect(html).not.toContain('<table');
  });

  it('keeps the table scrollable on a phone and uses logical alignment only', () => {
    const html = renderAccount(screen(), {
      ...as(MANAGE),
      seed: [listSeed([coupon()]), overviewSeed],
    });
    expect(html).toContain('overflow-x-auto');
    expect(html).not.toMatch(/\b(text-left|text-right|ml-\d|mr-\d|pl-\d|pr-\d)\b/);
  });
});

describe('Coupon form', () => {
  const shops = [{ id: ID(9), name: 'Main shop' }];
  for (const locale of LOCALES) {
    it(`a new percent coupon asks for code, value, minimum, cap, limit, dates and scope in ${locale}`, () => {
      const html = renderAccount(
        <ToastProvider>
          <CouponFormModal coupon={null} currency="INR" shops={shops} onClose={() => undefined} />
        </ToastProvider>,
        { locale, ...as(MANAGE) },
      );
      for (const id of [
        'coupon-code',
        'coupon-type',
        'coupon-value',
        'coupon-min',
        'coupon-max',
        'coupon-limit',
        'coupon-starts',
        'coupon-expires',
        'coupon-scope',
        'coupon-free-shipping',
        'coupon-active',
      ]) {
        expect(html, id).toContain(`id="${id}"`);
      }
      expect(html).toContain('type="datetime-local"');
      expect(html).toContain('Main shop');
    });
  }

  it('an edit starts from the coupon and a flat coupon has no cap field', () => {
    const html = renderAccount(
      <ToastProvider>
        <CouponFormModal coupon={flat} currency="INR" shops={shops} onClose={() => undefined} />
      </ToastProvider>,
      as(MANAGE),
    );
    expect(html).toContain('value="FLAT250"');
    expect(html).toContain('value="250"');
    expect(html).not.toContain('id="coupon-max"');
    expect(html).toContain('Edit coupon FLAT250');
  });
});
