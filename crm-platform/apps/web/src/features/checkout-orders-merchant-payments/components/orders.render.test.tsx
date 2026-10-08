import { describe, expect, it, vi } from 'vitest';
import type { StoreOrderDetail, StoreOrderListItem } from '@crm/contracts';
import { ToastProvider } from '@crm/ui';
import {
  makeSession,
  renderAccount,
} from '@/features/auth-registration-security/account/render-test-utils';
import { CHK_KEYS } from '../api/hooks';
import { ordersQuery, parseOrdersFilters } from '../lib/orders-filters';

let search = '';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => '/store/orders',
  useSearchParams: () => new URLSearchParams(search),
}));

import { OrderDetailContent } from './order-detail-screen';
import { OrdersContent } from './orders-screen';

const LOCALES = ['en', 'ar'] as const;
const READ = { 'store.orders.read': 'all' } as const;
const MANAGE = { ...READ, 'store.orders.manage': 'all' } as const;
const ALL = { ...MANAGE, 'store.orders.delete': 'all' } as const;
const as = (permissions: Record<string, 'all'>) => ({ session: makeSession({ permissions }) });

const ID = '0b0f7c2e-1c58-4d3b-9d2e-6a1f0c4b7a10';
const SHOP2 = '5c1f0b9a-6c52-4a3b-8d5e-2f6a7c1b0e22';
const CONTACT = '7d1f0b9a-6c52-4a3b-8d5e-2f6a7c1b0e33';

const item = (over: Partial<StoreOrderListItem> = {}): StoreOrderListItem => ({
  id: ID,
  orderNo: 1042,
  source: 'storefront',
  status: 'new',
  paymentStatus: 'awaiting',
  paymentMethod: 'prepaid',
  customerName: 'Asha Rao',
  customerPhone: '919800000001',
  itemsCount: 2,
  totalMinor: 349900,
  currencyCode: 'INR',
  storefrontId: SHOP2,
  storefrontName: 'Main shop',
  createdAt: '2026-10-02T14:05:00.000Z',
  ...over,
});

function detail(over: Partial<StoreOrderDetail> = {}): StoreOrderDetail {
  return {
    ...item(),
    customerEmail: 'asha@example.com',
    customerAddress: '12 Park Street\nKolkata',
    items: [
      {
        productId: 1,
        name: 'Blue kurta',
        qty: 2,
        priceMinor: 100000,
        lineTotalMinor: 200000,
        image: null,
        retailerId: 'SKU-1',
      },
    ],
    subtotalMinor: 200000,
    shippingMinor: 5000,
    taxMinor: 10000,
    taxInclusive: true,
    discountMinor: 20000,
    couponCode: 'WELCOME10',
    notes: 'Leave at the door',
    paymentLink: null,
    rtoScore: 72,
    rtoBand: 'high',
    payments: [],
    timeline: [
      { at: '2026-10-02T14:05:00.000Z', kind: 'created', detail: null, actor: 'customer' },
    ],
    availableGateways: [{ slug: 'razorpay', name: 'Razorpay' }],
    contactId: CONTACT,
    invoiceId: null,
    salesOrderId: null,
    rowVersion: 3,
    updatedAt: '2026-10-02T14:06:00.000Z',
    ...over,
  };
}

const COUNTS = {
  all: 12,
  new: 4,
  pending: 1,
  confirmed: 2,
  paid: 3,
  processing: 0,
  completed: 1,
  shipped: 1,
  cancelled: 0,
};

const listSeed = (rows: StoreOrderListItem[], hasMore = false) =>
  [
    [
      ...CHK_KEYS.orders,
      ordersQuery(parseOrdersFilters(new URLSearchParams(search))),
    ] as readonly unknown[],
    {
      pages: [{ data: rows, page: { nextCursor: hasMore ? 'c1' : null, hasMore, limit: 25 } }],
      pageParams: [undefined],
    },
  ] as const;
const countsSeed = [CHK_KEYS.orderCounts, COUNTS] as const;
const shopsSeed = (n: number) =>
  [
    ['store', 'overview', ''],
    {
      shops: Array.from({ length: n }, (_, i) => ({
        id: i === 0 ? SHOP2 : `6c1f0b9a-6c52-4a3b-8d5e-2f6a7c1b0e${i}0`,
        shopName: `Shop ${i + 1}`,
        slug: `shop-${i + 1}`,
      })),
    },
  ] as const;

const renderList = (
  locale: 'en' | 'ar',
  permissions: Record<string, 'all'>,
  rows: StoreOrderListItem[] | null,
  shops = 1,
  hasMore = false,
) => {
  search = search || '';
  return renderAccount(
    <ToastProvider>
      <OrdersContent />
    </ToastProvider>,
    {
      locale,
      ...as(permissions),
      seed: [...(rows ? [listSeed(rows, hasMore)] : []), countsSeed, shopsSeed(shops)],
    },
  );
};

describe('Orders list', () => {
  for (const locale of LOCALES) {
    it(`shows the tabs with counts, the rows and the row actions in ${locale}`, () => {
      search = '';
      const html = renderList(locale, ALL, [
        item(),
        item({ id: SHOP2, orderNo: 1043, status: 'paid' }),
      ]);
      expect(html).toContain('#1042');
      expect(html).toContain('#1043');
      expect(html).toContain(`href="/store/orders/${ID}"`);
      // tabs: all + 8 statuses with their numbers
      expect((html.match(/aria-pressed/g) ?? []).length).toBe(9);
      expect(html).toContain('>12<');
      expect(html).toContain('+919800000001');
      // manage and delete controls are present
      expect(html).toMatch(/<select[^>]*aria-label="[^"]*1042/);
      expect(html).toMatch(/<button[^>]*aria-label="[^"]*1042/);
      // load-more is hidden without a next page
      expect(html).not.toContain('data-load-more');
    });
  }

  it('says no orders yet with a way forward when there are none and nothing is filtered', () => {
    search = '';
    const html = renderList('en', ALL, []);
    expect(html).toContain('No orders yet');
    expect(html).toContain('href="/store"');
    expect(html).not.toContain('Clear filters');
  });

  it('says nothing matches, with Clear filters, when a filter is on', () => {
    search = 'status=paid&q=zzz';
    const html = renderList('en', ALL, []);
    expect(html).toContain('No orders match these filters');
    expect(html).toContain('Clear filters');
    expect(html).not.toContain('No orders yet');
    search = '';
  });

  it('renders the empty state in Arabic', () => {
    search = '';
    const html = renderList('ar', ALL, []);
    expect(html).toContain('لا توجد طلبات بعد');
  });

  it('shows a loading skeleton before the first page arrives', () => {
    search = '';
    const html = renderList('en', ALL, null);
    expect(html).toContain('role="status"');
    expect(html).toContain('Loading orders');
  });

  it('hides status change and delete without the manage and delete permissions', () => {
    search = '';
    const html = renderList('en', READ, [item()]);
    expect(html).toContain('#1042');
    expect(html).not.toMatch(/<select[^>]*aria-label="Change status/);
    expect(html).not.toContain('Delete order #1042');
    const manageOnly = renderList('en', MANAGE, [item()]);
    expect(manageOnly).toMatch(/<select[^>]*aria-label="Change status/);
    expect(manageOnly).not.toContain('Delete order #1042');
  });

  it('shows the shop filter only with two or more shops', () => {
    search = '';
    expect(renderList('en', ALL, [item()], 1)).not.toContain('All shops');
    expect(renderList('en', ALL, [item()], 2)).toContain('All shops');
  });

  it('refuses the page without the read permission', () => {
    search = '';
    const html = renderList('en', {}, [item()]);
    expect(html).toContain('You do not have access to this page');
    expect(html).not.toContain('#1042');
  });

  it('warns about a date range that ends before it starts', () => {
    search = 'from=2026-10-05&to=2026-10-01';
    const html = renderList('en', ALL, [item()]);
    expect(html).toContain('The start date is after the end date');
    search = '';
  });
});

const renderDetail = (
  locale: 'en' | 'ar',
  permissions: Record<string, 'all'>,
  order: StoreOrderDetail | null,
) =>
  renderAccount(
    <ToastProvider>
      <OrderDetailContent id={ID} />
    </ToastProvider>,
    {
      locale,
      ...as(permissions),
      seed: order ? [[CHK_KEYS.order(ID), order]] : [],
    },
  );

describe('Order detail', () => {
  for (const locale of LOCALES) {
    it(`shows the order, totals, customer, timeline and the contact link in ${locale}`, () => {
      search = '';
      const html = renderDetail(locale, ALL, detail());
      expect(html).toContain('1042');
      expect(html).toContain('Blue kurta');
      expect(html).toContain('WELCOME10');
      expect(html).toContain('Asha Rao');
      expect(html).toContain('asha@example.com');
      expect(html).toContain(`href="/contacts/${CONTACT}"`);
      expect(html).toContain('href="/store/orders"');
      // RTO risk is shown for a scored order
      expect(html).toContain('72');
      // the status form carries all eight statuses
      expect(html).toContain('id="order-status"');
      expect(
        (
          html.match(
            /<option value="(new|pending|confirmed|paid|processing|completed|shipped|cancelled)"/g,
          ) ?? []
        ).length,
      ).toBeGreaterThanOrEqual(8);
    });
  }

  it('offers the gateway picker and the Create invoice button when none is linked yet', () => {
    search = '';
    const html = renderDetail('en', ALL, detail());
    expect(html).toContain('id="order-gateway"');
    expect(html).toContain('Razorpay');
    expect(html).toContain('Create invoice');
    expect(html).toContain('Delete order');
  });

  it('explains that a gateway must be set up first when none is available', () => {
    search = '';
    const html = renderDetail('en', ALL, detail({ availableGateways: [] }));
    expect(html).toContain('No payment gateway set up');
    expect(html).toContain('href="/store/gateways"');
    expect(html).not.toContain('id="order-gateway"');
  });

  it('replaces Create invoice with links to the invoice and the sales order', () => {
    search = '';
    const inv = '8e1f0b9a-6c52-4a3b-8d5e-2f6a7c1b0e44';
    const so = '9f1f0b9a-6c52-4a3b-8d5e-2f6a7c1b0e55';
    const html = renderDetail('en', ALL, detail({ invoiceId: inv, salesOrderId: so }));
    expect(html).toContain(`href="/invoices/${inv}"`);
    expect(html).toContain(`href="/sales-orders/${so}"`);
    expect(html).not.toContain('Create invoice');
  });

  it('is read-only without the manage permission: no form, no link actions, no delete', () => {
    search = '';
    const html = renderDetail('en', READ, detail());
    expect(html).toContain('You can view this order but not change it.');
    expect(html).not.toContain('id="order-status"');
    expect(html).not.toContain('Generate link and send');
    expect(html).not.toContain('Create invoice');
    expect(html).not.toContain('Delete order');
  });

  it('keeps the shop in the back link', () => {
    search = '';
    // useShopParam reads ?shop= from the same mocked address
    search = 'shop=abc';
    const html = renderDetail('en', ALL, detail());
    expect(html).toContain('href="/store/orders?shop=abc"');
    search = '';
  });

  it('shows a skeleton while loading and no access without read', () => {
    search = '';
    expect(renderDetail('en', ALL, null)).toContain('Loading order');
    expect(renderDetail('en', {}, detail())).toContain('You do not have access to this page');
  });

  it('lists payments with their reference and an open-link action', () => {
    search = '';
    const html = renderDetail(
      'en',
      ALL,
      detail({
        payments: [
          {
            kind: 'gateway',
            gateway: 'razorpay',
            status: 'paid',
            amountMinor: 349900,
            currencyCode: 'INR',
            reference: 'pay_123',
            url: 'https://pay.test/x',
            at: '2026-10-02T15:00:00.000Z',
          },
        ],
      }),
    );
    expect(html).toContain('pay_123');
    expect(html).toContain('href="https://pay.test/x"');
  });
});
