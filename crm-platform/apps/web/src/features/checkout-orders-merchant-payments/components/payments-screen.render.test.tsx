import { describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@crm/ui';
import {
  makeSession,
  renderAccount,
} from '@/features/auth-registration-security/account/render-test-utils';
import { CHK_KEYS } from '../api/hooks';
import { payment, waPayConfig } from '../lib/gateway-test-fixtures';

const nav = vi.hoisted(() => ({ search: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => '/store/payments',
  useSearchParams: () => new URLSearchParams(nav.search),
}));

import { PaymentsScreen } from './payments-screen';

const LOCALES = ['en', 'ar'] as const;
const VIEW = { 'store.payments.view': 'all' } as const;
const MANAGE = { ...VIEW, 'store.payments.manage': 'all' } as const;
const PAGE = { nextCursor: null, hasMore: false, limit: 25 };

const SUMMARY = [
  CHK_KEYS.paymentSummary,
  {
    paid: 12,
    awaiting: 3,
    cod: 5,
    unpaid: 2,
    collected: [
      { currencyCode: 'INR', totalMinor: 1250000 },
      { currencyCode: 'USD', totalMinor: 4500 },
    ],
  },
] as const;
const WA = [CHK_KEYS.whatsappPay, { data: [waPayConfig()], page: PAGE }] as const;

/** A cursor list is an infinite query: its cached data is `{ pages, pageParams }` under the key plus the query. */
const list = (query: object, rows: unknown[], hasMore = false) =>
  [
    [...CHK_KEYS.payments, query],
    {
      pages: [{ data: rows, page: { ...PAGE, hasMore, nextCursor: hasMore ? 'c1' : null } }],
      pageParams: [undefined],
    },
  ] as const;

function renderScreen(
  locale: 'en' | 'ar',
  permissions: Record<string, 'all'>,
  seed: ReadonlyArray<readonly [readonly unknown[], unknown]>,
  search = '',
) {
  nav.search = search;
  return renderAccount(
    <ToastProvider>
      <PaymentsScreen />
    </ToastProvider>,
    { locale, session: makeSession({ permissions }), seed },
  );
}

describe('Payments screen', () => {
  it('shows the summary, the payment rows and the WhatsApp Pay section (en)', () => {
    const html = renderScreen('en', MANAGE, [SUMMARY, list({}, [payment()]), WA]);
    // summary: counts and money per currency
    expect(html).toContain('data-testid="summary-paid"');
    expect(html).toContain('>12<');
    expect(html).toContain('₹12,500.00');
    expect(html).toContain('$45.00');
    // the row
    expect(html).toContain('href="/store/orders/22222222-2222-4222-8222-222222222222"');
    expect(html).toContain('#1042');
    expect(html).toContain('Asha Rao');
    expect(html).toContain('+919800000001');
    expect(html).toContain('Razorpay link');
    expect(html).toContain('pay_QX12345');
    expect(html).toContain('₹2,500.00');
    expect(html).toContain('Main shop');
    // WhatsApp Pay
    expect(html).toContain('my-razorpay-pay');
    expect(html).toContain('India · INR');
    expect(html).toContain('India is the only supported market');
    expect(html).toContain('Must exactly match the Direct Pay Method name');
  });

  it('keeps the shop of the store area on the order links', () => {
    const shop = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const html = renderScreen('en', MANAGE, [SUMMARY, list({}, [payment()]), WA], `shop=${shop}`);
    expect(html).toContain(
      `href="/store/orders/22222222-2222-4222-8222-222222222222?shop=${shop}"`,
    );
  });

  it('a payment with no customer, reference or via shows dashes, never "null"', () => {
    const html = renderScreen('en', MANAGE, [
      SUMMARY,
      list({}, [
        payment({
          customerName: null,
          customerPhone: null,
          paidVia: null,
          reference: null,
          storefrontName: null,
          status: 'cod',
          method: 'cod',
        }),
      ]),
      WA,
    ]);
    expect(html).not.toContain('null');
    expect(html).toContain('Cash on delivery');
  });

  it('shows a load more button when the server has another page', () => {
    const html = renderScreen('en', MANAGE, [SUMMARY, list({}, [payment()], true), WA]);
    expect(html).toContain('Load more');
  });

  it('with nothing yet, says so and points to Orders', () => {
    const html = renderScreen('en', MANAGE, [SUMMARY, list({}, []), WA]);
    expect(html).toContain('No payments yet');
    expect(html).toContain('href="/store/orders"');
  });

  it('reads the filters from the address, asks the server for them and offers a reset', () => {
    const html = renderScreen(
      'en',
      MANAGE,
      [SUMMARY, list({ status: 'paid', method: 'razorpay', q: 'asha' }, []), WA],
      'status=paid&method=razorpay&q=asha',
    );
    expect(html).toContain('No payments match');
    expect(html).toContain('Reset filters');
    // the select shows the status, the box shows the gateway code
    expect(html).toMatch(/<option value="paid" selected/);
    expect(html).toContain('value="razorpay"');
    expect(html).toContain('value="asha"');
  });

  it('warns about an inverted date range', () => {
    const html = renderScreen(
      'en',
      MANAGE,
      [SUMMARY, list({}, [payment()]), WA],
      'from=2026-10-09&to=2026-10-01',
    );
    expect(html).toContain('The start date is after the end date');
  });

  it('shows loading placeholders before anything arrives', () => {
    const html = renderScreen('en', MANAGE, []);
    expect(html).toContain('aria-label="Loading payments"');
    expect(html).toContain('aria-label="Loading payment totals"');
    expect(html).toContain('aria-label="Loading configurations"');
  });

  it('manage shows the form and the row actions', () => {
    const html = renderScreen('en', MANAGE, [SUMMARY, list({}, [payment()]), WA]);
    expect(html).toContain('Add a payment configuration');
    expect(html).toContain('Save configuration');
    expect(html).toContain('maxLength="60"');
    for (const type of ['Razorpay', 'PayU', 'BillDesk', 'Zaakpay']) expect(html).toContain(type);
    expect(html).toContain('Auto-charge new orders');
    expect(html).toContain('>Remove<');
    expect(html).toContain('>Edit<');
  });

  it('view-only shows the configurations but no form and no row actions', () => {
    const html = renderScreen('en', VIEW, [SUMMARY, list({}, [payment()]), WA]);
    expect(html).toContain('my-razorpay-pay');
    expect(html).not.toContain('Add a payment configuration');
    expect(html).not.toContain('Save configuration');
    expect(html).not.toContain('>Remove<');
    expect(html).toContain('You can see the WhatsApp Pay configurations but not change them');
  });

  it('empty WhatsApp Pay list asks the manager to add one', () => {
    const html = renderScreen('en', MANAGE, [
      SUMMARY,
      list({}, [payment()]),
      [CHK_KEYS.whatsappPay, { data: [], page: PAGE }],
    ]);
    expect(html).toContain('No payment configurations yet');
    expect(html).toContain('Add one on this page');
  });

  it('without the view permission nothing is loaded or shown', () => {
    const html = renderScreen('en', {}, [SUMMARY, list({}, [payment()]), WA]);
    expect(html).toContain('You do not have access to this page');
    expect(html).not.toContain('data-testid="payments-table"');
  });

  for (const locale of LOCALES) {
    it(`renders every string of the loaded page in ${locale}`, () => {
      const html = renderScreen(locale, MANAGE, [SUMMARY, list({}, [payment()]), WA]);
      expect(html).toContain('data-testid="payments-table"');
      expect(html).toContain('data-testid="payments-filters"');
      expect(html).toContain('data-testid="wa-pay-row"');
      if (locale === 'ar') {
        expect(html).toContain('المدفوعات');
        expect(html).toContain('الهند هي السوق الوحيدة المدعومة');
      }
    });

    it(`renders the empty and filtered states in ${locale}`, () => {
      expect(renderScreen(locale, VIEW, [SUMMARY, list({}, []), WA])).toContain('/store/orders');
      const filtered = renderScreen(
        locale,
        VIEW,
        [SUMMARY, list({ status: 'unpaid' }, []), WA],
        'status=unpaid',
      );
      expect(filtered).toContain('data-testid="payments-filters"');
    });
  }
});
