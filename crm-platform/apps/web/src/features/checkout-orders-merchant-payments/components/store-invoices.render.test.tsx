import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@crm/ui';
import {
  makeSession,
  renderAccount,
} from '@/features/auth-registration-security/account/render-test-utils';
import { CHK_KEYS } from '../api/hooks';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => '/store/invoices',
  useSearchParams: () => new URLSearchParams(),
}));

import { StoreInvoicesScreen } from './store-invoices-screen';

const LOCALES = ['en', 'ar'] as const;
const READ = { 'record.invoices.read': 'all' } as const;
const as = (permissions: Record<string, 'all'>) => ({ session: makeSession({ permissions }) });

const AMOUNTS = {
  subtotal: '0',
  discount: '0',
  shipping: '0',
  tax: '0',
  taxAdded: '0',
  total: '299800',
  paid: '0',
  refunded: '0',
  balance: '299800',
  credit: '0',
  credited: '0',
};
const invoice = (n: number, over: Record<string, unknown> = {}) => ({
  id: `00000000-0000-4000-8000-00000000010${n}`,
  number: `INV-00${n}`,
  docType: 'invoice',
  source: 'own',
  status: 'issued',
  storedStatus: 'issued',
  paymentStatus: 'unpaid',
  overdue: false,
  daysOverdue: null,
  currency: 'INR',
  currencyExponent: 2,
  amounts: AMOUNTS,
  amountsMinor: AMOUNTS,
  buyerName: `Buyer ${n}`,
  buyerEmail: null,
  contact: { id: `00000000-0000-4000-8000-00000000020${n}`, name: `Buyer ${n}` },
  company: null,
  deal: null,
  owner: null,
  issueDate: '2026-10-02',
  dueDate: '2026-10-16',
  issuedAt: null,
  paidAt: null,
  sentAt: null,
  viewCount: 0,
  reference: null,
  rowVersion: 1,
  createdAt: '2026-10-02T10:00:00.000Z',
  updatedAt: '2026-10-02T10:00:00.000Z',
  ...over,
});

const page = (rows: unknown[], hasMore = false) => ({
  pages: [{ items: rows, hasMore, nextCursor: hasMore ? 'c1' : null }],
  pageParams: [undefined],
});
const KEY = [...CHK_KEYS.invoices, { limit: 50, q: undefined, status: undefined }];

const render = (
  perms: Record<string, 'all'>,
  seed: Array<readonly [readonly unknown[], unknown]>,
  locale: 'en' | 'ar',
) =>
  renderAccount(
    <ToastProvider>
      <StoreInvoicesScreen />
    </ToastProvider>,
    { locale, ...as(perms), seed },
  );

describe('StoreInvoicesScreen', () => {
  for (const locale of LOCALES) {
    it(`lists only store invoices with links into Sales in ${locale}`, () => {
      const html = render(
        READ,
        [
          [
            KEY,
            page([
              invoice(1),
              invoice(2, { source: 'manual', number: 'INV-MANUAL' }),
              invoice(3, { status: 'paid', contact: null, buyerName: 'Walk-in' }),
            ]),
          ],
        ],
        locale,
      );
      expect(html).toContain('INV-001');
      expect(html).toContain('INV-003');
      expect(html).not.toContain('INV-MANUAL');
      expect(html).toContain('href="/invoices/00000000-0000-4000-8000-000000000101"');
      expect(html).toContain('href="/contacts/00000000-0000-4000-8000-000000000201"');
      // no contact: the buyer is plain text, not a link
      expect(html).not.toContain('/contacts/00000000-0000-4000-8000-000000000203');
      expect(html).toContain('href="/invoices"');
    });
  }

  it('prints the total with its currency and the two dates in English', () => {
    const html = render(READ, [[KEY, page([invoice(1)])]], 'en');
    expect(html).toContain('2,998.00');
    expect(html).toContain('Oct 02, 2026');
    expect(html).toContain('Oct 16, 2026');
    expect(html).toContain('Issued');
    expect(html).toContain('Open in Sales');
  });

  it('shows the status chips in this domain tones', () => {
    const html = render(
      READ,
      [
        [
          KEY,
          page([
            invoice(1, { status: 'paid' }),
            invoice(2, { status: 'overdue' }),
            invoice(3, { status: 'draft', number: null }),
          ]),
        ],
      ],
      'en',
    );
    expect(html).toMatch(/text-success[^>]*>Paid</);
    expect(html).toMatch(/text-danger[^>]*>Overdue</);
    expect(html).toMatch(/text-muted-foreground[^>]*>Draft</);
  });

  for (const locale of LOCALES) {
    it(`an empty list points at the orders in ${locale}`, () => {
      const html = render(READ, [[KEY, page([invoice(1, { source: 'manual' })])]], locale);
      expect(html).toContain('href="/store/orders"');
      expect(html).not.toContain('<table');
      if (locale === 'en') {
        expect(html).toContain('No invoices from store orders yet');
        expect(html).toContain('Open an order and select Create invoice.');
      }
    });
  }

  it('keeps looking by itself while pages remain and none matched yet', () => {
    const html = render(READ, [[KEY, page([invoice(1, { source: 'manual' })], true)]], 'en');
    expect(html).toContain('Looking for more store invoices...');
  });

  it('after the automatic page cap it says so and offers Load more', () => {
    const six = {
      pages: Array.from({ length: 6 }, (_, i) => ({
        items: [invoice(1, { source: 'manual', id: `00000000-0000-4000-8000-0000000003${i}0` })],
        hasMore: true,
        nextCursor: `c${i}`,
      })),
      pageParams: [undefined],
    };
    const html = render(READ, [[KEY, six]], 'en');
    expect(html).toContain('None found in the latest invoices');
    expect(html).toContain('Load more');
  });

  it('without the invoices right it says so and offers no link into Sales', () => {
    const html = render({}, [], 'en');
    expect(html).toContain('You do not have access to this page');
    expect(html).not.toContain('All invoices');
  });

  it('shows the loading skeleton before the first page arrives', () => {
    expect(render(READ, [], 'en')).toContain('Loading invoices');
  });
});
