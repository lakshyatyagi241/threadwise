import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Coupon, CouponOptionsResponse } from '@crm/contracts';
import { ToastProvider } from '@/features/auth-registration-security/platform/ui/toast';
import { CouponForm } from './components/coupon-form-page';
import { CouponTable } from './components/coupons-page';
import { PlanPicker } from './components/plan-picker';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
}));

const WEB = resolve(__dirname, '../../../..');
const messages = (locale: 'en' | 'ar') =>
  JSON.parse(
    readFileSync(
      join(WEB, 'messages', locale, 'coupons-credits-referral-currency.coupons.json'),
      'utf8',
    ),
  ) as Record<string, unknown>;

const wrap = (el: ReactElement, locale: 'en' | 'ar' = 'en') =>
  renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <NextIntlClientProvider locale={locale} messages={messages(locale)} timeZone="UTC">
        <ToastProvider>{el}</ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );

const coupon = (over: Partial<Coupon> = {}): Coupon => ({
  id: '00000000-0000-4000-8000-000000000001',
  code: 'WELCOME10',
  description: '10% off the first month',
  adminNote: null,
  type: 'percent',
  amount: '10.0000',
  maxDiscountAmount: null,
  currencyCode: null,
  minOrderAmount: null,
  maxUses: 100,
  perUserLimit: null,
  usesCount: 12,
  applicablePlanSlugs: [],
  startsAt: null,
  expiresAt: null,
  isActive: true,
  isExpired: false,
  firstPurchaseOnly: false,
  stackableWithOther: false,
  rowVersion: 3,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...over,
});

const options: CouponOptionsResponse = {
  plans: [
    { slug: 'starter', name: 'Starter', kind: 'plan' },
    { slug: 'pro', name: 'Professional', kind: 'plan' },
  ],
  currencies: [
    { code: 'INR', symbol: '₹' },
    { code: 'USD', symbol: '$' },
  ],
};

describe('TW-CPN-001 list rows', () => {
  it('renders code, truncated description, discount, uses, validity, switch and the row menu', () => {
    const html = wrap(<CouponTable rows={[coupon()]} canWrite />);
    expect(html).toContain('WELCOME10');
    expect(html).toContain('10% off the first month');
    expect(html).toContain('10%');
    expect(html).toContain('12 / 100');
    expect(html).toContain('forever');
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('Actions for WELCOME10');
    for (const col of ['Code', 'Discount', 'Uses', 'Validity', 'Status'])
      expect(html).toContain(col);
  });

  it('dims an expired row and shows "now -> end" validity', () => {
    const html = wrap(
      <CouponTable
        rows={[coupon({ isExpired: true, expiresAt: '2026-09-30T10:00:00.000Z', maxUses: null })]}
        canWrite
      />,
    );
    expect(html).toContain('opacity-60');
    expect(html).toContain('now → Sep 30, 2026');
    expect(html).toContain('12 / ∞');
  });

  it('shows the empty state with a link to create the first coupon', () => {
    const html = wrap(<CouponTable rows={[]} canWrite />);
    expect(html).toContain('No coupons match.');
    expect(html).toContain('href="/admin/coupons/new"');
    expect(html).toContain('create the first one');
  });

  it('read-only operators get a disabled switch, no row menu and no create link', () => {
    const html = wrap(<CouponTable rows={[coupon()]} canWrite={false} />);
    expect(html).toContain('disabled');
    expect(html).not.toContain('Actions for WELCOME10');
    expect(wrap(<CouponTable rows={[]} canWrite={false} />)).not.toContain(
      'href="/admin/coupons/new"',
    );
  });
});

describe('TW-CPN-002 create form', () => {
  const render = (existing?: Coupon, locale: 'en' | 'ar' = 'en') =>
    wrap(
      <CouponForm
        existing={existing}
        options={options}
        onReload={() => undefined}
        reloading={false}
      />,
      locale,
    );

  it('has the four sections and every field with Reference labels, hints and defaults', () => {
    const html = render();
    for (const s of ['Identity', 'Discount', 'Eligibility', 'Limits &amp; behavior']) {
      expect(html).toContain(s);
    }
    for (const label of [
      'Code *',
      'Description',
      'Admin note',
      'Active',
      'Type *',
      'Amount *',
      'Max discount cap',
      'Currency lock',
      'Minimum order amount',
      'Applicable plans',
      'Starts at',
      'Expires at',
      'Max total redemptions',
      'Per-user limit',
      'First purchase only',
      'Stackable with other coupons',
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('Uppercased on save');
    expect(html).toContain('Create coupon');
    expect(html).toContain('Any currency');
    expect(html).toContain('₹ INR');
    expect(html).toContain('type="datetime-local"');
    expect(html).toContain('uppercase');
    expect(html).not.toContain('Please fix the following');
  });

  it('switches: Active ON, First purchase only OFF, Stackable OFF by default', () => {
    const html = render();
    const sw = (id: string) =>
      new RegExp(`id="${id}"[^>]*aria-checked="(true|false)"`).exec(html)?.[1];
    expect(sw('co-active')).toBe('true');
    expect(sw('co-first')).toBe('false');
    expect(sw('co-stack')).toBe('false');
  });

  it('renders in Arabic with the same structure', () => {
    const html = render(undefined, 'ar');
    expect(html).toContain('قسيمة جديدة');
    expect(html).toContain('إنشاء القسيمة');
  });
});

describe('TW-CPN-003 edit form', () => {
  const render = (c: Coupon) =>
    wrap(
      <CouponForm existing={c} options={options} onReload={() => undefined} reloading={false} />,
    );

  it('shows the code, the Active pill, "Redeemed N / max times" and the Save changes button', () => {
    const html = render(
      coupon({ expiresAt: new Date(Date.now() + 5 * 86_400_000 + 3_600_000).toISOString() }),
    );
    expect(html).toContain('WELCOME10');
    expect(html).toContain('Active');
    expect(html).toContain('Redeemed 12 / 100 times');
    expect(html).toContain('expires in 5 days');
    expect(html).toContain('Save changes');
  });

  it('shows the Disabled pill and plain "Redeemed N times" when uncapped', () => {
    const html = render(coupon({ isActive: false, maxUses: null }));
    expect(html).toContain('Disabled');
    expect(html).toContain('Redeemed 12 times');
    expect(html).toContain('Redeemed 12 times</p>');
  });

  it('prefills the stored values, plan chips included', () => {
    const html = render(
      coupon({
        amount: '20.0000',
        applicablePlanSlugs: ['pro'],
        currencyCode: 'INR',
        type: 'fixed',
      }),
    );
    expect(html).toContain('value="20"');
    expect(html).toContain('Professional');
    expect(html).toContain('Remove Professional');
    expect(html).toContain('Clear all');
    expect(html).toMatch(/<option value="INR" selected/);
  });
});

describe('plan picker (the Tom Select replacement)', () => {
  it('shows chips with remove buttons and Clear all only when something is chosen', () => {
    const none = wrap(
      <PlanPicker id="p" options={options.plans} value={[]} onChange={() => undefined} />,
    );
    expect(none).not.toContain('Clear all');
    const some = wrap(
      <PlanPicker
        id="p"
        options={options.plans}
        value={['starter', 'gone-slug']}
        onChange={() => undefined}
      />,
    );
    expect(some).toContain('Remove Starter');
    expect(some).toContain('Remove gone-slug');
    expect(some).toContain('Clear all');
  });
});
