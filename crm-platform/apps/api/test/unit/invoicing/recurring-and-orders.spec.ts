import { describe, expect, it } from 'vitest';
import { occurrenceDate, upcomingRuns } from '@crm/contracts';
import { dateOfPeriod, firstPeriodFrom, templateFromInvoice } from '../../../src/modules/crm/invoicing/recurring-invoices.service';
import {
  fulfilmentStatusOf,
  invoicingStatusOf,
  specsFromQuote,
  taxSpecOfItem,
} from '../../../src/modules/crm/invoicing/sales-orders.service';
import { priceInvoice } from '../../../src/modules/crm/invoicing/invoice-content';
import type { SalesOrderItemRow } from '../../../src/modules/crm/invoicing/sales-orders.repository';

describe('recurring schedule dates', () => {
  it('monthly periods keep the start day and clamp to the month end without drifting', () => {
    const dates = [0, 1, 2, 3, 4].map((n) => occurrenceDate('2026-01-31', 'month', 1, n));
    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  });

  it('yearly on 29 February lands on 28 February in a common year and on the 29th in a leap year', () => {
    expect(occurrenceDate('2024-02-29', 'year', 1, 1)).toBe('2025-02-28');
    expect(occurrenceDate('2024-02-29', 'year', 1, 4)).toBe('2028-02-29');
  });

  it('weekly and every-N-days steps are exact', () => {
    expect(occurrenceDate('2026-03-01', 'week', 2, 3)).toBe('2026-04-12');
    expect(occurrenceDate('2026-03-01', 'day', 10, 2)).toBe('2026-03-21');
  });

  it('upcomingRuns stops at the end date and at the run cap', () => {
    const byEnd = upcomingRuns({ start: '2026-01-01', frequency: 'month', interval: 1, fromIndex: 0, end: '2026-03-15', count: 10 });
    expect(byEnd.map((r) => r.date)).toEqual(['2026-01-01', '2026-02-01', '2026-03-01']);
    const byCap = upcomingRuns({ start: '2026-01-01', frequency: 'month', interval: 1, fromIndex: 0, maxRuns: 2, count: 10 });
    expect(byCap).toHaveLength(2);
  });

  const shape = { startDate: '2026-01-10', frequency: 'month' as const, interval: 1, endDate: null, maxRuns: null };

  it('dateOfPeriod is null past the cap or the end date (the schedule has ended)', () => {
    expect(dateOfPeriod({ ...shape, maxRuns: 3 }, 3)).toBeNull();
    expect(dateOfPeriod({ ...shape, endDate: '2026-02-15' }, 2)).toBeNull();
    expect(dateOfPeriod(shape, 2)).toBe('2026-03-10');
  });

  it('firstPeriodFrom skips what already passed (resume does not back-date a flood of invoices)', () => {
    expect(firstPeriodFrom(shape, '2026-03-11', 0)).toEqual({ index: 3, date: '2026-04-10' });
    expect(firstPeriodFrom(shape, '2026-03-10', 0)).toEqual({ index: 2, date: '2026-03-10' });
    // never before the floor (periods that already ran)
    expect(firstPeriodFrom(shape, '2026-01-01', 5)).toEqual({ index: 5, date: '2026-06-10' });
    expect(firstPeriodFrom({ ...shape, maxRuns: 2 }, '2026-06-01', 0)).toBeNull();
  });

  it('a template copied from an invoice carries the buyer, links, tax mode and lines but no dates', () => {
    const t = templateFromInvoice({
      docType: 'tax_invoice',
      buyer: { name: 'Acme', email: 'a@acme.test', phone: null, address: null, taxId: null, country: 'IN' },
      contact: { id: '00000000-0000-4000-8000-000000000001', name: 'Acme' },
      company: null,
      deal: null,
      owner: null,
      currency: 'INR',
      taxRegime: 'gst',
      taxExplanation: null,
      placeOfSupply: 'IN-MH',
      reverseCharge: false,
      reference: 'PO-1',
      discount: null,
      amounts: { shipping: '0.00' },
      notes: null,
      terms: null,
      legalNotes: null,
      lines: [
        { description: 'Hosting', sku: null, hsnSac: '998315', qty: '1', unitPrice: '1000.00', discount: null, taxRateId: null },
      ],
    } as never);
    expect(t).toMatchObject({ buyerName: 'Acme', currency: 'INR', taxMode: 'rates', contactId: '00000000-0000-4000-8000-000000000001' });
    expect(t.lines).toHaveLength(1);
    expect('issueDate' in t).toBe(false);
    expect(t.shipping).toBeNull();
  });
});

describe('sales order progress and quote conversion', () => {
  it('the two statuses are derived from the summed quantities', () => {
    expect(invoicingStatusOf({ qtyTotal: '10.0000', qtyInvoiced: '0.0000' })).toBe('not_invoiced');
    expect(invoicingStatusOf({ qtyTotal: '10.0000', qtyInvoiced: '4.0000' })).toBe('partially_invoiced');
    expect(invoicingStatusOf({ qtyTotal: '10.0000', qtyInvoiced: '10.0000' })).toBe('invoiced');
    expect(fulfilmentStatusOf({ qtyTotal: '10.0000', qtyFulfilled: '0.0000' })).toBe('unfulfilled');
    expect(fulfilmentStatusOf({ qtyTotal: '10.0000', qtyFulfilled: '10.0000' })).toBe('fulfilled');
  });

  const item = (over: Partial<SalesOrderItemRow> = {}): SalesOrderItemRow => ({
    id: 1,
    uuid: 'u',
    position: 0,
    description: 'Widget',
    sku: null,
    hsnSac: null,
    qty: '4.0000',
    qtyInvoiced: '0.0000',
    qtyFulfilled: '0.0000',
    unitPriceMinor: 2500n,
    discountKind: 'none',
    discountValue: 0n,
    discountInvoicedMinor: 0n,
    taxRateId: null,
    taxName: null,
    taxType: null,
    taxInclusive: false,
    taxItems: null,
    taxRatePercent: '0',
    subtotalMinor: 10000n,
    discountMinor: 0n,
    taxMinor: 0n,
    totalMinor: 10000n,
    ...over,
  });

  it('a stored line keeps its compound tax as a snapshot an invoice can be priced under', () => {
    const tax = taxSpecOfItem(
      item({
        taxName: 'GST 18%',
        taxType: 'gst',
        taxRatePercent: '18',
        taxItems: [
          { code: 'CGST', name: 'CGST 9%', ratePercent: '9' },
          { code: 'SGST', name: 'SGST 9%', ratePercent: '9' },
        ],
      }),
    );
    expect(tax?.items.map((i) => i.code)).toEqual(['CGST', 'SGST']);
    expect(taxSpecOfItem(item())).toBeNull();
  });

  it('a quote converts with its document discount folded into the lines, and the order totals match', () => {
    const specs = specsFromQuote({
      id: 1,
      uuid: 'q',
      number: 'PRO-0001',
      status: 'accepted',
      docType: 'proposal',
      contactId: null,
      companyId: null,
      dealId: null,
      ownerId: null,
      buyerName: 'Buyer',
      buyerEmail: null,
      buyerPhone: null,
      currency: 'USD',
      taxRateBp: 1000,
      discountMinor: 1000n,
      notes: null,
      terms: null,
      items: [
        { description: 'A', qty: '1.0000', unitPriceMinor: 10000n, discountKind: 'none', discountValue: 0n, taxRateBp: null, grossMinor: 10000n, netMinor: 10000n },
        { description: 'B', qty: '2.0000', unitPriceMinor: 5000n, discountKind: 'none', discountValue: 0n, taxRateBp: 0, grossMinor: 10000n, netMinor: 10000n },
      ],
    });
    const priced = priceInvoice({ currency: 'USD', specs, discount: null, shipping: null, reverseCharge: false });
    // 200.00 gross, 10.00 discount spread 5.00 + 5.00, tax 10% only on the first line: (100 - 5) * 10% = 9.50
    expect(priced.totals.discountMinor).toBe(0n); // folded into the lines: an order has no document discount
    expect(priced.totals.subtotalMinor).toBe(19000n);
    expect(priced.totals.taxMinor).toBe(950n);
    expect(priced.totals.totalMinor).toBe(20000n - 1000n + 950n);
  });
});
