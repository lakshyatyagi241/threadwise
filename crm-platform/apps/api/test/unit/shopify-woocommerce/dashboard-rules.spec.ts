import { describe, expect, it } from 'vitest';
import {
  discountPct,
  paramCount,
  trend14,
  wooDashboardCustomer,
  wooDashboardOrder,
  wooDashboardProduct,
} from '../../../src/modules/shopify-woocommerce/dashboard-rules';

describe('the store dashboard rules (WD-ECOM-023)', () => {
  it('rounds the discount off the compare-at price and gives 0 when there is none', () => {
    expect(discountPct(75, 100)).toBe(25);
    expect(discountPct(66.67, 100)).toBe(33);
    expect(discountPct(100, 100)).toBe(0);
    expect(discountPct(120, 100)).toBe(0);
    expect(discountPct(50, null)).toBe(0);
  });

  it('counts the numbered variables a template declares', () => {
    expect(paramCount('Hi {{1}}, {{ 3 }} and {{name}}')).toBe(3);
    expect(paramCount('only {{name}}')).toBe(0);
    expect(paramCount('')).toBe(0);
  });

  it('builds 14 days oldest first with empty days at 0', () => {
    const now = new Date('2026-03-15T10:00:00Z');
    const t = trend14(
      new Map([
        ['2026-03-15', 50],
        ['2026-03-02', 7.5],
        ['2026-03-01', 99],
      ]),
      now,
    );
    expect(t).toHaveLength(14);
    expect(t[0]).toEqual({ label: 'Mar 2', value: 7.5 });
    expect(t[13]).toEqual({ label: 'Mar 15', value: 50 });
    expect(t.filter((d) => d.value === 0)).toHaveLength(12);
  });

  it('crosses a month boundary', () => {
    const t = trend14(new Map(), new Date('2026-03-05T00:30:00Z'));
    expect(t[0]!.label).toBe('Feb 20');
    expect(t[13]!.label).toBe('Mar 5');
  });

  it('shapes a WooCommerce order, product and customer, with fallbacks', () => {
    expect(
      wooDashboardOrder(
        {
          number: '8001',
          status: 'processing',
          total: '40.50',
          currency: 'EUR',
          date_created_gmt: '2026-03-01T10:00:00',
          billing: { first_name: 'Bo', last_name: 'K', email: 'b@x.test', phone: '0801' },
        },
        'USD',
      ),
    ).toEqual({
      name: '#8001',
      customer: 'Bo K',
      email: 'b@x.test',
      phone: '0801',
      status: 'processing',
      fulfillment: null,
      total: 40.5,
      currency: 'EUR',
      createdAt: '2026-03-01T10:00:00.000Z',
    });
    expect(wooDashboardOrder({ id: 5 }, 'USD')).toMatchObject({
      name: '#5',
      customer: '—',
      currency: 'USD',
      total: 0,
      createdAt: null,
    });
    expect(
      wooDashboardProduct({
        id: 9,
        name: 'Hat',
        price: '15',
        regular_price: '20',
        on_sale: true,
        images: [{ src: 'https://i/h.jpg' }],
        permalink: 'https://s/h',
        stock_status: 'outofstock',
      }),
    ).toMatchObject({
      id: '9',
      title: 'Hat',
      price: 15,
      comparePrice: 20,
      discountPct: 25,
      imageUrl: 'https://i/h.jpg',
      inStock: false,
    });
    expect(
      wooDashboardProduct({ id: 1, name: 'X', price: '15', regular_price: '20', on_sale: false }),
    ).toMatchObject({ comparePrice: null, discountPct: 0, inStock: true });
    expect(
      wooDashboardCustomer({
        first_name: '',
        last_name: '',
        email: 'c@x.test',
        orders_count: 3,
        total_spent: '120.40',
        billing: { phone: '1' },
      }),
    ).toEqual({
      name: 'c@x.test',
      email: 'c@x.test',
      phone: '1',
      ordersCount: 3,
      totalSpent: 120.4,
    });
  });
});
