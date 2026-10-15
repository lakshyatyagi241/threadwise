import { describe, expect, it } from 'vitest';
import {
  revenueReportResponseSchema,
  type DealTotals,
  type RevenueMetrics,
  type RevenueReportResponse,
} from '@crm/contracts';
import {
  LEDGER_HEADER,
  ledgerCsvLine,
  ledgerCsvStart,
  renderRevenuePdf,
  rowName,
  summaryCsv,
  totalsText,
} from '../../../src/modules/crm/revenue-report/revenue-files';
import type { LedgerRow } from '../../../src/modules/crm/revenue-report/revenue-report.repository';

const t = (...parts: Array<[string, string]>): DealTotals => ({
  byCurrency: parts.map(([currency, amount]) => ({ currency, amount })),
});
const pair = (cur: DealTotals, prev: DealTotals | null = null) => ({
  current: cur,
  previous: prev,
});
const metrics = (over: Partial<RevenueMetrics> = {}): RevenueMetrics => ({
  invoiced: pair(t(['USD', '1000.00']), t(['USD', '800.00'])),
  credited: pair(t()),
  paid: pair(t(['USD', '600.00'])),
  outstanding: pair(t(['USD', '400.00'])),
  overdue: pair(t(['USD', '100.00'])),
  collected: pair(t(['USD', '700.00'], ['EUR', '50.00']), t(['USD', '300.00'])),
  refunded: pair(t(['USD', '25.00'])),
  ...over,
});

const report = (over: Partial<RevenueReportResponse> = {}): RevenueReportResponse => ({
  period: {
    range: 'month',
    timezone: 'UTC',
    fromDate: '2026-10-01',
    toDate: '2026-10-15',
    days: 15,
    today: '2026-10-15',
  },
  comparison: { mode: 'previous', fromDate: '2026-09-01', toDate: '2026-09-15' },
  convertedTo: null,
  currencies: ['EUR', 'USD'],
  mixedCurrency: true,
  summary: {
    metrics: metrics(),
    taxCollected: pair(t(['USD', '90.00']), t(['USD', '70.00'])),
    invoices: { issued: { current: 4, previous: 3 }, paidInFull: { current: 2, previous: 1 } },
    receivables: { outstanding: t(['USD', '400.00']), overdue: t(['USD', '100.00']), invoices: 2 },
    collectedAllTime: t(['USD', '5000.00']),
  },
  rows: {
    groupBy: 'source',
    truncated: false,
    items: [
      {
        key: 'meta',
        label: 'meta',
        id: null,
        invoices: { current: 3, previous: 2 },
        metrics: metrics(),
      },
      {
        key: '',
        label: null,
        id: null,
        invoices: { current: 1, previous: 1 },
        metrics: metrics({ invoiced: pair(t(['USD', '=cmd()'])) }),
      },
    ],
  },
  trend: {
    bucket: 'day',
    points: [{ start: '2026-10-01', invoiced: t(['USD', '10.00']), collected: t() }],
  },
  aging: {
    asOf: '2026-10-15',
    currencies: [
      {
        currency: 'USD',
        total: '400.00',
        invoices: 2,
        buckets: [
          { bucket: 'current', amount: '300.00', invoices: 1 },
          { bucket: 'd1_30', amount: '100.00', invoices: 1 },
          { bucket: 'd31_60', amount: '0.00', invoices: 0 },
          { bucket: 'd61_90', amount: '0.00', invoices: 0 },
          { bucket: 'd90_plus', amount: '0.00', invoices: 0 },
        ],
      },
    ],
  },
  ...over,
});

const ledger = (over: Partial<LedgerRow> = {}): LedgerRow => ({
  id: 1,
  paidAt: new Date('2026-10-14T10:30:00Z'),
  paidAtText: '2026-10-14 10:30:00+00',
  paidLocal: '2026-10-14 10:30',
  kind: 'payment',
  amount: 12_345n,
  currency: 'USD',
  method: 'bank',
  source: 'manual',
  invoiceNumber: 'INV-2026-000001',
  contactName: 'Acme, Inc.',
  companyName: null,
  reference: 'ref "1"',
  receiptNumber: 'RCT-1',
  ownerName: 'Alice',
  ...over,
});

describe('the ledger CSV (Reference file first)', () => {
  it('starts with the nine columns of the Reference file in its order, then the additions', () => {
    expect(LEDGER_HEADER.slice(0, 9)).toEqual([
      'Date',
      'Amount',
      'Currency',
      'Method',
      'Source',
      'Invoice',
      'Contact',
      'Company',
      'Reference',
    ]);
    expect(LEDGER_HEADER.slice(9)).toEqual(['Type', 'Receipt', 'Owner']);
    expect(ledgerCsvStart().startsWith('\uFEFFDate,Amount,Currency,')).toBe(true);
  });

  it('writes the amount exactly in major units, quotes what needs it and defuses formulas', () => {
    expect(ledgerCsvLine(ledger())).toBe(
      '2026-10-14 10:30,123.45,USD,bank,manual,INV-2026-000001,"Acme, Inc.",,"ref ""1""",payment,RCT-1,Alice\n',
    );
    const line = ledgerCsvLine(
      ledger({ contactName: '=HYPERLINK("x")', reference: '+1', ownerName: '@me' }),
    );
    expect(line).toContain(`"'=HYPERLINK(""x"")"`);
    expect(line).toContain(",'+1,");
    expect(line.trimEnd().endsWith(",'@me")).toBe(true);
  });

  it('a refund is a negative amount and uses the currency exponent', () => {
    expect(ledgerCsvLine(ledger({ kind: 'refund', amount: -500n, currency: 'JPY' }))).toContain(
      ',-500,JPY,',
    );
    expect(ledgerCsvLine(ledger({ kind: 'refund', amount: -1_250n, currency: 'KWD' }))).toContain(
      ',-1.250,KWD,',
    );
    expect(ledgerCsvLine(ledger({ kind: 'refund' }))).toContain(',refund,');
  });
});

describe('the summary CSV', () => {
  it('one line per group and currency, a Total line first, comparison columns when comparing', () => {
    const lines = summaryCsv(report()).split('\n');
    expect(lines[0]).toBe(
      '\uFEFFLead source,Basis,Currency,Invoices,Invoiced,Credited,Paid,Outstanding,Overdue,Collected,Refunded,Invoices (comparison),Invoiced (comparison),Collected (comparison)',
    );
    // Total: EUR then USD, each currency with its own amounts, 0 where a metric has none in it
    expect(lines[1]).toBe('Total,actual,EUR,4,0,0,0,0,0,50.00,0,3,0,0');
    expect(lines[2]).toBe(
      'Total,actual,USD,4,1000.00,0,600.00,400.00,100.00,700.00,25.00,3,800.00,300.00',
    );
    expect(lines[3]).toBe('meta,actual,EUR,3,0,0,0,0,0,50.00,0,2,0,0');
  });

  it('names a group with no value, defuses a formula in a name and leaves the comparison out when not comparing', () => {
    const csv = summaryCsv(
      report({
        comparison: null,
        rows: {
          groupBy: 'owner',
          truncated: false,
          items: [
            {
              key: '',
              label: null,
              id: null,
              invoices: { current: 1, previous: null },
              metrics: metrics(),
            },
            {
              key: 'u',
              label: '=SUM(1)',
              id: 'u',
              invoices: { current: 1, previous: null },
              metrics: metrics(),
            },
          ],
        },
      }),
    );
    expect(csv.split('\n')[0]).toBe(
      '\uFEFFOwner,Basis,Currency,Invoices,Invoiced,Credited,Paid,Outstanding,Overdue,Collected,Refunded',
    );
    expect(csv).toContain('\nUnassigned,actual,USD,1,');
    expect(csv).toContain("\n'=SUM(1),actual,USD,1,");
  });

  it('with a target currency adds a converted line per group, blank where a currency had no rate', () => {
    const converted = (amount: string | null): DealTotals => ({
      byCurrency: [{ currency: 'USD', amount: '1.00' }],
      converted: amount === null ? null : { currency: 'USD', amount },
      unconverted: amount === null ? ['EUR'] : [],
    });
    const csv = summaryCsv(
      report({
        convertedTo: 'USD',
        comparison: null,
        summary: {
          ...report().summary,
          metrics: metrics({
            invoiced: pair(converted('1000.00')),
            collected: pair(converted(null)),
          }),
        },
      }),
    );
    expect(csv).toContain('\nTotal,converted,USD,4,1000.00,,,,,,\n');
  });
});

describe('row names and money text', () => {
  it('rowName: the label, the origin in words, and a sentence for the rows with no value', () => {
    expect(rowName('source', { key: 'meta', label: 'meta' })).toBe('meta');
    expect(rowName('source', { key: '', label: null })).toBe('No source');
    expect(rowName('origin', { key: 'shopify', label: null })).toBe('Shopify');
    expect(rowName('origin', { key: 'weird', label: null })).toBe('weird');
    expect(rowName('origin', { key: '', label: null })).toBe('Unknown');
    expect(rowName('product', { key: '', label: null })).toBe('No line items');
    expect(rowName('team', { key: '', label: null })).toBe('No team');
    expect(rowName('product', { key: 'sku', label: null })).toBe('sku');
  });

  it('totalsText: the converted figure, else every currency, else zero in the fallback currency', () => {
    expect(totalsText(null, 'USD')).toBe('');
    expect(
      totalsText({ byCurrency: [], converted: { currency: 'EUR', amount: '5.00' } }, 'USD'),
    ).toBe('EUR 5.00');
    expect(totalsText(t(['USD', '1234.50'], ['EUR', '2.00']), 'USD')).toBe(
      'USD 1,234.50 + EUR 2.00',
    );
    expect(totalsText(t(), 'INR')).toBe('INR 0');
  });
});

describe('the PDF', () => {
  it('is a well-formed PDF that carries the figures and the period', () => {
    const pdf = renderRevenuePdf({
      report: report(),
      brand: 'Acme Ltd',
      generatedAt: '15 Oct 2026, 10:00',
    });
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('Acme Ltd - Revenue report');
    expect(text).toContain('Period 2026-10-01 to 2026-10-15');
    expect(text).toContain('Compared with Previous period: 2026-09-01 to 2026-09-15');
    expect(text).toContain('USD 1,000.00');
    expect(text).toContain('BY LEAD SOURCE');
    expect(text).toContain('No source');
    expect(text).toContain('RECEIVABLES AGING AS OF 2026-10-15');
    expect(text).toContain('Several currencies');
  });

  it('paginates a long table, handles an empty report and a converted one', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({
      key: `k${i}`,
      label: `Customer segment number ${i} with a rather long name that has to be cut to fit`,
      id: null,
      invoices: { current: 1, previous: null },
      metrics: metrics(),
    }));
    const long = renderRevenuePdf({
      report: report({
        comparison: null,
        rows: { groupBy: 'product', items: many, truncated: true },
      }),
      brand: 'Acme',
      generatedAt: 'now',
    }).toString('latin1');
    expect(long).toMatch(/\/Count [2-9]/);
    expect(long).toContain('Only the biggest rows are listed');

    const empty = renderRevenuePdf({
      report: report({
        comparison: null,
        convertedTo: 'USD',
        mixedCurrency: false,
        rows: { groupBy: 'team', items: [], truncated: false },
        trend: { bucket: 'month', points: [] },
        aging: { asOf: '2026-10-15', currencies: [] },
      }),
      brand: 'Acme',
      generatedAt: 'now',
    }).toString('latin1');
    expect(empty).toContain('Nothing was invoiced or collected in this period.');
    expect(empty).toContain('Nothing is owed.');
    expect(empty).toContain('Shown in USD');
  });

  it('the fixture is a valid report response', () => {
    expect(revenueReportResponseSchema.safeParse(report()).success).toBe(true);
  });
});
