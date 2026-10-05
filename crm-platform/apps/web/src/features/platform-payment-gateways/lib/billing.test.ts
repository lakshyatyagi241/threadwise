import { describe, expect, it } from 'vitest';
import {
  billingSettingsSchema,
  manualInvoiceRequestSchema,
  adminOrdersQuerySchema,
  invoicesQuerySchema,
  billingHistoryQuerySchema,
} from '@crm/contracts';
import { toSettings } from '../components/billing/billing-settings-page';
import { niceMax } from '../components/billing/charts';
import {
  capitalize,
  pageRange,
  pageWindow,
  periodEnd,
  shortMoney,
  signedPct,
  wholeMoney,
  ymd,
  ymdHm,
} from './billing-format';

describe('billing display helpers', () => {
  it('formats money for the KPI cards in the reporting currency', () => {
    expect(wholeMoney('1234.56', 'USD', 'en-US')).toBe('$1,235');
    expect(shortMoney('12400', 'USD', 'en-US')).toBe('$12.4K');
    expect(shortMoney('85', 'USD', 'en-US')).toBe('$85');
    expect(wholeMoney('5', 'not-a-code', 'en-US')).toBe('5 not-a-code');
  });

  it('signs percentages and shortens dates the way the tables print them', () => {
    expect(signedPct(12.3)).toBe('+12.3%');
    expect(signedPct(-4.5)).toBe('-4.5%');
    expect(signedPct(0)).toBe('+0%');
    expect(ymd('2026-10-03T08:30:00.000Z')).toBe('2026-10-03');
    expect(ymdHm('2026-10-03T08:30:00.000Z')).toBe('2026-10-03 08:30');
    expect(capitalize('stripe')).toBe('Stripe');
  });

  it('footer range and pager window: first, last, current and one each side, gaps marked', () => {
    expect(pageRange(1, 12, 30)).toEqual({ from: 1, to: 12 });
    expect(pageRange(3, 12, 30)).toEqual({ from: 25, to: 30 });
    expect(pageRange(1, 12, 0)).toEqual({ from: 0, to: 0 });
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(5, 10)).toEqual([1, 'gap', 4, 5, 6, 'gap', 10]);
    expect(pageWindow(2, 10)).toEqual([1, 2, 3, 'gap', 10]);
    expect(pageWindow(1, 1)).toEqual([1]);
  });

  it('the service period under an invoice item: one month or one year after issue, clamped to month end', () => {
    expect(periodEnd('2026-01-31T00:00:00.000Z', 'monthly').slice(0, 10)).toBe('2026-02-28');
    expect(periodEnd('2026-03-15T00:00:00.000Z', 'monthly').slice(0, 10)).toBe('2026-04-15');
    expect(periodEnd('2026-03-15T00:00:00.000Z', 'yearly').slice(0, 10)).toBe('2027-03-15');
    expect(periodEnd('2024-02-29T00:00:00.000Z', 'yearly').slice(0, 10)).toBe('2025-02-28');
  });

  it('the chart axis gets a round top', () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(7)).toBe(10);
    expect(niceMax(120)).toBe(200);
    expect(niceMax(430)).toBe(500);
    expect(niceMax(501)).toBe(1000);
  });
});

describe('billing settings form (WD-PAYGW-007)', () => {
  const draft = {
    taxEnabled: true,
    taxRate: '18',
    taxLabel: 'GST',
    refundEnabled: true,
    refundDays: '7',
    yearlyToggleEnabled: true,
    yearlyDiscountPct: '20',
    recurringEnabled: false,
    graceDays: '7',
    countries: 'India\r\nIndia\n Germany \n\n',
    companyName: 'Acme',
    companyAddress: '',
    companyTaxId: '',
    companyRegNo: '',
    companyEmail: 'a@b.co',
    companyPhone: '',
  };

  it('splits the country box on any line break, trims and drops blanks', () => {
    expect(toSettings(draft).countries).toEqual(['India', 'India', 'Germany']);
  });

  it('rejects a rate over 100, an empty label, a bad email and a blank number; accepts the form as saved', () => {
    expect(billingSettingsSchema.safeParse(toSettings(draft)).success).toBe(true);
    expect(billingSettingsSchema.safeParse(toSettings({ ...draft, taxRate: '101' })).success).toBe(
      false,
    );
    expect(billingSettingsSchema.safeParse(toSettings({ ...draft, taxRate: '' })).success).toBe(
      false,
    );
    expect(billingSettingsSchema.safeParse(toSettings({ ...draft, taxRate: '7.5' })).success).toBe(
      false,
    );
    expect(billingSettingsSchema.safeParse(toSettings({ ...draft, taxLabel: '' })).success).toBe(
      false,
    );
    expect(
      billingSettingsSchema.safeParse(toSettings({ ...draft, companyEmail: 'nope' })).success,
    ).toBe(false);
    expect(
      billingSettingsSchema.safeParse(toSettings({ ...draft, refundDays: '366' })).success,
    ).toBe(false);
  });
});

describe('filters sent to the API', () => {
  it('apply WaDesk defaults: 90 days and all types, 90 days and all statuses, invoices all time', () => {
    expect(adminOrdersQuerySchema.parse({})).toEqual({ window: '90d', type: 'all', page: 1 });
    expect(billingHistoryQuerySchema.parse({})).toEqual({ window: '90d', status: 'all', page: 1 });
    expect(invoicesQuerySchema.parse({})).toEqual({ status: 'all', window: 'all', page: 1 });
    expect(adminOrdersQuerySchema.safeParse({ window: '7d' }).success).toBe(false);
  });

  it('the manual invoice needs a positive amount with at most two decimals and a three-letter currency', () => {
    const base = {
      workspaceId: '6f1c0e0a-5b6d-4b1e-9a3a-0a1b2c3d4e5f',
      description: 'Custom quote',
      amount: '250',
      currency: 'eur',
      status: 'pending',
    };
    expect(manualInvoiceRequestSchema.parse(base).currency).toBe('EUR');
    expect(manualInvoiceRequestSchema.safeParse({ ...base, amount: '0' }).success).toBe(false);
    expect(manualInvoiceRequestSchema.safeParse({ ...base, amount: '1.234' }).success).toBe(false);
    expect(manualInvoiceRequestSchema.safeParse({ ...base, currency: 'EURO' }).success).toBe(false);
    expect(manualInvoiceRequestSchema.safeParse({ ...base, description: ' ' }).success).toBe(false);
    expect(manualInvoiceRequestSchema.safeParse({ ...base, status: 'refunded' }).success).toBe(
      false,
    );
  });
});
