import { describe, expect, it, vi } from 'vitest';
import type { StoreCustomer } from '@crm/contracts';
import { ToastProvider } from '@crm/ui';
import {
  makeSession,
  renderAccount,
} from '@/features/auth-registration-security/account/render-test-utils';
import { CHK_KEYS } from '../api/hooks';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => '/store/customers',
  useSearchParams: () => new URLSearchParams('shop=5b4d4a3c-2b8a-4f0e-9a52-0c3f6a8e1d99'),
}));

import { CustomerFormModal } from './customers-form-modal';
import { CustomersScreen } from './customers-screen';

const LOCALES = ['en', 'ar'] as const;
const READ = { 'store.customers.read': 'all' } as const;
const MANAGE = { ...READ, 'store.customers.manage': 'all' } as const;
const as = (permissions: Record<string, 'all'>) => ({ session: makeSession({ permissions }) });

const ID = (n: number) => `5b4d4a3c-2b8a-4f0e-9a52-0c3f6a8e1d${String(n).padStart(2, '0')}`;
const customer = (over: Partial<StoreCustomer> = {}): StoreCustomer => ({
  id: ID(1),
  phone: '919800000001',
  name: 'Asha Rao',
  company: 'Acme Traders',
  address: '12 MG Road\nBengaluru',
  orderCount: 3,
  lifetimeTotals: [
    { currencyCode: 'INR', totalMinor: 150000, orders: 2 },
    { currencyCode: 'USD', totalMinor: 2500, orders: 1 },
  ],
  lastOrderAt: '2026-10-02T09:30:00.000Z',
  contactId: ID(7),
  rowVersion: 1,
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
  ...over,
});
const newcomer = customer({
  id: ID(2),
  phone: '919800000002',
  name: null,
  company: null,
  address: null,
  orderCount: 0,
  lifetimeTotals: [],
  lastOrderAt: null,
  contactId: null,
});

const seed = (items: StoreCustomer[]) =>
  [
    [...CHK_KEYS.customers, {}] as const,
    {
      pages: [{ data: items, page: { nextCursor: null, hasMore: false, limit: 20 } }],
      pageParams: [undefined],
    },
  ] as const;

const screen = () => (
  <ToastProvider>
    <CustomersScreen />
  </ToastProvider>
);

describe('Customers screen', () => {
  for (const locale of LOCALES) {
    it(`shows each customer with phone, order count, totals per currency, contact link and address in ${locale}`, () => {
      const html = renderAccount(screen(), {
        locale,
        ...as(MANAGE),
        seed: [seed([customer(), newcomer])],
      });
      expect(html.match(/data-testid="customer-row"/g)).toHaveLength(2);
      expect(html).toContain('Asha Rao');
      expect(html).toContain('Acme Traders');
      expect(html).toContain('+919800000001');
      // orders link filters by the digits of the phone and keeps the shop
      expect(html).toContain(
        'href="/store/orders?q=919800000001&amp;shop=5b4d4a3c-2b8a-4f0e-9a52-0c3f6a8e1d99"',
      );
      // one totals line per currency
      expect(html).toMatch(/1,500\.00|١٬٥٠٠٫٠٠/);
      expect(html).toMatch(/25\.00|٢٥٫٠٠/);
      expect(html).toContain(`href="/contacts/${ID(7)}"`);
      expect(html).toContain('12 MG Road');
    });
  }

  it('a customer without a CRM contact or orders shows muted dashes, not links', () => {
    const html = renderAccount(screen(), { ...as(MANAGE), seed: [seed([newcomer])] });
    expect(html).not.toContain('/contacts/');
    expect(html).not.toContain('/store/orders?q=919800000002');
    expect(html).toContain('No orders yet');
  });

  it('offers add, edit and delete to a person who can manage', () => {
    const html = renderAccount(screen(), { ...as(MANAGE), seed: [seed([customer()])] });
    expect(html).toContain('Add a customer');
    expect(html).toContain('Edit Asha Rao');
    expect(html).toContain('Delete Asha Rao');
    expect(html).toContain('View Asha Rao');
  });

  it('a read-only person can view but not add, edit or delete', () => {
    const html = renderAccount(screen(), { ...as(READ), seed: [seed([customer()])] });
    expect(html).toContain('Asha Rao');
    expect(html).toContain('View Asha Rao');
    expect(html).not.toContain('Add a customer');
    expect(html).not.toContain('Edit Asha Rao');
    expect(html).not.toContain('Delete Asha Rao');
  });

  it('a person without the read right gets the no-access panel', () => {
    const html = renderAccount(screen(), { ...as({}) });
    expect(html).toContain('You do not have access to this page');
    expect(html).not.toContain('<table');
  });

  for (const locale of LOCALES) {
    it(`an empty list offers the first customer in ${locale}`, () => {
      const html = renderAccount(screen(), { locale, ...as(MANAGE), seed: [seed([])] });
      expect(html).not.toContain('<table');
      expect(html).toContain(
        locale === 'en' ? 'No saved customers yet' : 'لا يوجد عملاء محفوظون بعد',
      );
      expect(html).toContain(locale === 'en' ? 'Add a customer' : 'إضافة عميل');
    });
  }

  it('shows a loading skeleton while the list loads', () => {
    const html = renderAccount(screen(), { ...as(MANAGE) });
    expect(html).toContain('role="status"');
    expect(html).not.toContain('<table');
  });

  it('keeps the table scrollable on a phone and uses logical alignment only', () => {
    const html = renderAccount(screen(), { ...as(MANAGE), seed: [seed([customer()])] });
    expect(html).toContain('overflow-x-auto');
    expect(html).not.toMatch(/\b(text-left|text-right|ml-\d|mr-\d|pl-\d|pr-\d)\b/);
  });
});

describe('Customer form', () => {
  for (const locale of LOCALES) {
    it(`adding asks for phone, name, company and the address in a textarea in ${locale}`, () => {
      const html = renderAccount(
        <ToastProvider>
          <CustomerFormModal customer={null} onClose={() => undefined} />
        </ToastProvider>,
        { locale, ...as(MANAGE) },
      );
      for (const id of ['cust-phone', 'cust-name', 'cust-company', 'cust-address']) {
        expect(html, id).toContain(`id="${id}"`);
      }
      expect(html).toMatch(/<textarea[^>]*id="cust-address"/);
      expect(html).not.toContain('readOnly');
    });
  }

  it('editing locks the phone and starts from the saved details', () => {
    const html = renderAccount(
      <ToastProvider>
        <CustomerFormModal customer={customer()} onClose={() => undefined} />
      </ToastProvider>,
      as(MANAGE),
    );
    expect(html).toMatch(/id="cust-phone"[^>]*readOnly=""/);
    expect(html).toContain('value="919800000001"');
    expect(html).toContain('value="Asha Rao"');
    expect(html).toContain('Edit customer');
  });
});
