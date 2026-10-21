import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  ERROR_CODES,
  revenueReportResponseSchema,
  type DealTotals,
  type RevenueMetrics,
  type RevenueReportResponse,
} from '@crm/contracts';
import { ApiError } from '@/lib/api/errors';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { errorKey } from '../lib/errors';
import {
  DEFAULT_FILTERS,
  apiQuery,
  exportBody,
  filtersToSearch,
  isDefault,
  parseFilters,
} from '../lib/query';
import { isOneScale, sharePercent } from '../lib/split';
import { RevenueKpis } from './revenue-kpis';
import { FlowPanel, RevenueAgingPanel, RevenueTrendPanel } from './revenue-panels';
import { isEmptyRevenue, missingRates } from './revenue-screen';
import { SplitTable } from './revenue-split';

const load = (locale: string, file: string) =>
  JSON.parse(readFileSync(join(process.cwd(), 'messages', locale, file), 'utf8')) as Record<
    string,
    unknown
  >;
const messagesFor = (locale: string) => ({
  ...load(locale, 'crm-revenue.json'),
  ...load(locale, 'crm-dashboard.json'),
  ...load(locale, 'dashboards-analytics-charts.json'),
});
const html = (el: ReactElement, locale = 'en') =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messagesFor(locale)} timeZone="UTC">
      {el}
    </NextIntlClientProvider>,
  );

const usd = (amount: string): DealTotals => ({
  byCurrency: [{ currency: 'USD', amount }],
  converted: { currency: 'USD', amount },
});
const none: DealTotals = { byCurrency: [], converted: { currency: 'USD', amount: '0.00' } };
const pair = (cur: DealTotals, prev: DealTotals | null = null) => ({
  current: cur,
  previous: prev,
});

const metrics = (): RevenueMetrics => ({
  invoiced: pair(usd('1000.00'), usd('800.00')),
  credited: pair(none),
  paid: pair(usd('600.00'), usd('500.00')),
  outstanding: pair(usd('400.00'), usd('100.00')),
  overdue: pair(usd('150.00'), usd('0.00')),
  collected: pair(usd('700.00'), usd('350.00')),
  refunded: pair(usd('25.00'), usd('50.00')),
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
  convertedTo: 'USD',
  currencies: ['EUR', 'USD'],
  mixedCurrency: false,
  summary: {
    metrics: metrics(),
    taxCollected: pair(usd('90.00'), usd('70.00')),
    invoices: { issued: { current: 4, previous: 3 }, paidInFull: { current: 2, previous: 1 } },
    receivables: { outstanding: usd('450.00'), overdue: usd('150.00'), invoices: 3 },
    collectedAllTime: {
      byCurrency: [
        { currency: 'EUR', amount: '90.00' },
        { currency: 'USD', amount: '5000.00' },
      ],
      converted: { currency: 'USD', amount: '5100.00' },
    },
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
      { key: '', label: null, id: null, invoices: { current: 1, previous: 1 }, metrics: metrics() },
    ],
  },
  trend: {
    bucket: 'day',
    points: [
      { start: '2026-10-01', invoiced: usd('100.00'), collected: usd('40.00') },
      { start: '2026-10-02', invoiced: none, collected: usd('60.00') },
    ],
  },
  aging: {
    asOf: '2026-10-15',
    currencies: [
      {
        currency: 'USD',
        total: '450.00',
        invoices: 3,
        buckets: [
          { bucket: 'current', amount: '300.00', invoices: 1 },
          { bucket: 'd1_30', amount: '100.00', invoices: 1 },
          { bucket: 'd31_60', amount: '0.00', invoices: 0 },
          { bucket: 'd61_90', amount: '0.00', invoices: 0 },
          { bucket: 'd90_plus', amount: '50.00', invoices: 1 },
        ],
      },
    ],
  },
  ...over,
});

describe('the filters live in the address', () => {
  const search = (q: string) => new URLSearchParams(q);

  it('defaults are left out and read back', () => {
    expect(filtersToSearch(DEFAULT_FILTERS)).toBe('');
    expect(parseFilters(search(''))).toEqual(DEFAULT_FILTERS);
    expect(isDefault(DEFAULT_FILTERS)).toBe(true);
  });

  it('a view round-trips through the address', () => {
    const id = '0f1e2d3c-4b5a-4968-8776-655443322110';
    const f = {
      range: 'custom' as const,
      from: '2026-09-01',
      to: '2026-09-30',
      compare: 'lastYear' as const,
      group: 'product' as const,
      owner: id,
      team: id,
      currency: 'EUR',
    };
    const qs = filtersToSearch(f);
    expect(qs).toBe(
      `?range=custom&from=2026-09-01&to=2026-09-30&compare=lastYear&group=product&owner=${id}&team=${id}&currency=EUR`,
    );
    expect(parseFilters(search(qs.slice(1)))).toEqual(f);
    expect(isDefault(f)).toBe(false);
  });

  it('unknown or malformed values fall back instead of failing; dates only count with a custom range', () => {
    const f = parseFilters(
      search(
        'range=forever&compare=never&group=colour&owner=not-a-uuid&currency=euro&from=2026-09-01',
      ),
    );
    expect(f).toEqual(DEFAULT_FILTERS);
    expect(parseFilters(search('range=30d&from=2026-09-01')).from).toBe('');
    expect(parseFilters(search('currency=eur')).currency).toBe('EUR');
  });

  it('the API query converts into the workspace currency unless one currency is picked', () => {
    expect(apiQuery(DEFAULT_FILTERS, 'USD')).toMatchObject({
      range: 'month',
      compare: 'previous',
      groupBy: 'source',
      convertTo: 'USD',
      currency: undefined,
    });
    expect(apiQuery({ ...DEFAULT_FILTERS, currency: 'EUR' }, 'USD')).toMatchObject({
      currency: 'EUR',
      convertTo: undefined,
    });
    expect(
      apiQuery(
        { ...DEFAULT_FILTERS, range: 'custom', from: '2026-09-01', to: '2026-09-30' },
        'USD',
      ),
    ).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('a file request carries the filters on screen and the file wanted', () => {
    expect(
      exportBody({ ...DEFAULT_FILTERS, group: 'owner' }, 'USD', {
        format: 'csv',
        csvKind: 'summary',
      }),
    ).toMatchObject({
      range: 'month',
      compare: 'previous',
      groupBy: 'owner',
      convertTo: 'USD',
      format: 'csv',
      csvKind: 'summary',
    });
  });
});

describe('errors and small rules', () => {
  const err = (status: number, code: string) => new ApiError(status, code, 'x');
  it('branches on the problem code, never on the wording', () => {
    expect(errorKey(new Error('offline'))).toBe('network');
    expect(errorKey(err(403, 'FORBIDDEN'))).toBe('forbidden');
    expect(errorKey(err(409, ERROR_CODES.REVENUE_EXPORT_IN_PROGRESS))).toBe('exportInProgress');
    expect(errorKey(err(409, ERROR_CODES.REVENUE_EXPORT_NOT_READY))).toBe('exportNotReady');
    expect(errorKey(err(404, ERROR_CODES.REVENUE_EXPORT_NOT_FOUND))).toBe('notFound');
    expect(errorKey(err(429, 'RATE_LIMITED'))).toBe('rateLimited');
    expect(errorKey(err(400, ERROR_CODES.VALIDATION_FAILED))).toBe('validation');
    expect(errorKey(err(500, 'BOOM'))).toBe('unexpected');
  });

  it('sharePercent and isOneScale', () => {
    expect(sharePercent(usd('250.00'), usd('1000.00'))).toBe(25);
    expect(sharePercent(usd('1.00'), usd('3.00'))).toBe(33.3);
    expect(sharePercent(usd('5.00'), usd('0.00'))).toBe(0);
    expect(sharePercent(usd('2000.00'), usd('1000.00'))).toBe(100);
    expect(isOneScale(usd('1.00'))).toBe(true);
    expect(
      isOneScale({
        byCurrency: [
          { currency: 'USD', amount: '1' },
          { currency: 'EUR', amount: '1' },
        ],
      }),
    ).toBe(false);
    expect(
      isOneScale({
        byCurrency: [{ currency: 'EUR', amount: '1' }],
        converted: null,
        unconverted: ['EUR'],
      }),
    ).toBe(false);
  });

  it('isEmptyRevenue and missingRates', () => {
    expect(isEmptyRevenue(report())).toBe(false);
    const empty = report({
      rows: { groupBy: 'source', items: [], truncated: false },
      summary: {
        ...report().summary,
        receivables: { outstanding: none, overdue: none, invoices: 0 },
        collectedAllTime: none,
        metrics: {
          ...metrics(),
          collected: pair(none),
          invoiced: pair(none),
        },
      },
    });
    expect(
      isEmptyRevenue({
        ...empty,
        summary: { ...empty.summary, collectedAllTime: { byCurrency: [] } },
      }),
    ).toBe(true);
    const gap = report({
      summary: {
        ...report().summary,
        metrics: {
          ...metrics(),
          invoiced: pair({
            byCurrency: [{ currency: 'EUR', amount: '1.00' }],
            converted: null,
            unconverted: ['EUR'],
          }),
        },
      },
    });
    expect(missingRates(gap)).toEqual(['EUR']);
    expect(missingRates(report())).toEqual([]);
  });

  it('the fixture is a valid response', () => {
    expect(revenueReportResponseSchema.safeParse(report()).success).toBe(true);
  });
});

describe('the screen parts', () => {
  it('KPIs: the Reference four first, the converted figure large, the currencies it was made of under it, the change against the comparison', () => {
    const out = html(<RevenueKpis data={report()} currency="USD" />);
    const ids = [...out.matchAll(/data-testid="kpi-([A-Za-z]+)"/g)].map((m) => m[1]);
    expect(ids).toEqual([
      'collected',
      'collectedAll',
      'outstanding',
      'tax',
      'invoiced',
      'paid',
      'overdue',
      'refunded',
      'paidInFull',
    ]);
    expect(out).toContain('$700.00');
    expect(out).toContain('$5,100.00');
    expect(out).toContain('€90.00');
    expect(out).toContain('$450.00');
    // collected doubled against the comparison window
    expect(out).toContain('+100%');
    expect(out).toContain('3 open invoices');
  });

  it('KPIs: no change figure without a comparison, and an overdue amount turns the outstanding card amber', () => {
    const base = report();
    const out = html(
      <RevenueKpis
        data={{
          ...base,
          comparison: null,
          summary: {
            ...base.summary,
            metrics: Object.fromEntries(
              Object.entries(base.summary.metrics).map(([k, v]) => [k, { ...v, previous: null }]),
            ) as RevenueMetrics,
            taxCollected: pair(usd('90.00')),
            invoices: {
              issued: { current: 4, previous: null },
              paidInFull: { current: 2, previous: null },
            },
          },
        }}
        currency="USD"
      />,
    );
    expect(out).not.toContain('▲');
    expect(out).toContain('border-warning/40');
  });

  it('the split table: a total line, rows with their names, the empty row in words, no arithmetic on screen', () => {
    const out = html(<SplitTable data={report()} currency="USD" />);
    expect(out).toContain('By lead source');
    expect(out).toContain('Total');
    expect(out).toContain('meta');
    expect(out).toContain('No lead source');
    expect(out.match(/data-testid="split-row"/g)).toHaveLength(2);
    expect(out).toContain('$1,000.00');
  });

  it('the split table names an origin in words, flags the team and product caveats and a cut-off list', () => {
    const origin = html(
      <SplitTable
        data={report({
          rows: {
            groupBy: 'origin',
            truncated: true,
            items: [
              {
                key: 'shopify',
                label: null,
                id: null,
                invoices: { current: 1, previous: null },
                metrics: metrics(),
              },
              {
                key: 'brand-new',
                label: null,
                id: null,
                invoices: { current: 1, previous: null },
                metrics: metrics(),
              },
            ],
          },
        })}
        currency="USD"
      />,
    );
    expect(origin).toContain('Shopify');
    expect(origin).toContain('brand-new');
    expect(origin).toContain('Only the 2 biggest rows');
    const team = html(
      <SplitTable data={report({ rows: { ...report().rows, groupBy: 'team' } })} currency="USD" />,
    );
    // BL-382 D8: a person counts for their PRIMARY team only (the report reads team_members.is_primary), so team rows add up to the total;
    // the note used to warn that a person in two teams "counts in both".
    expect(team).toContain('primary team only');
    expect(team).not.toContain('counts in both');
    const product = html(
      <SplitTable
        data={report({ rows: { ...report().rows, groupBy: 'product' } })}
        currency="USD"
      />,
    );
    expect(product).toContain('spread over the lines');
  });

  it('several currencies with no total are listed one per line, never added', () => {
    const mixed: DealTotals = {
      byCurrency: [
        { currency: 'EUR', amount: '10.00' },
        { currency: 'USD', amount: '20.00' },
      ],
    };
    const m = { ...metrics(), invoiced: pair(mixed) };
    const out = html(
      <SplitTable
        data={report({
          convertedTo: null,
          currencies: ['EUR', 'USD'],
          summary: { ...report().summary, metrics: m },
          rows: { groupBy: 'owner', truncated: false, items: [] },
        })}
        currency="USD"
      />,
    );
    expect(out).toContain('€10.00');
    expect(out).toContain('$20.00');
    expect(out).toContain('Money is listed per currency');
  });

  it('the flow bar splits the invoiced total into paid, owed and overdue; several currencies get words instead of a bar', () => {
    const out = html(<FlowPanel data={report()} currency="USD" />);
    expect(out).toContain('data-testid="flow-paid"');
    expect(out).toContain('width:60%');
    expect(out).toContain('width:25%'); // owed not yet due: 400 - 150 of 1000...
    expect(out).toContain('width:15%');
    const mixed = html(
      <FlowPanel
        data={report({
          convertedTo: null,
          summary: {
            ...report().summary,
            metrics: {
              ...metrics(),
              invoiced: pair({
                byCurrency: [
                  { currency: 'EUR', amount: '10.00' },
                  { currency: 'USD', amount: '20.00' },
                ],
              }),
            },
          },
        })}
        currency="USD"
      />,
    );
    expect(mixed).not.toContain('data-testid="flow-paid"');
    expect(mixed).toContain('several currencies');
    const nothing = html(
      <FlowPanel
        data={report({
          summary: { ...report().summary, metrics: { ...metrics(), invoiced: pair(none) } },
        })}
        currency="USD"
      />,
    );
    expect(nothing).toContain('Nothing was invoiced in this period.');
  });

  it('the trend and the aging render', () => {
    expect(html(<RevenueTrendPanel trend={report().trend} currency="USD" />)).toContain(
      'Invoiced and collected',
    );
    const aging = html(<RevenueAgingPanel aging={report().aging} />);
    expect(aging).toContain('Not yet due');
    expect(aging).toContain('$50.00');
    expect(html(<RevenueAgingPanel aging={{ asOf: '2026-10-15', currencies: [] }} />)).toContain(
      'Nothing is owed.',
    );
  });

  it('reads in Arabic too (same keys, right-to-left languages need no layout change here)', () => {
    const ar = messagesFor('ar') as { 'crm-revenue': { title: string } };
    expect(ar['crm-revenue'].title).not.toBe('Revenue report');
    const out = html(<SplitTable data={report()} currency="USD" />, 'ar');
    expect(out).toContain('data-testid="split-table"');
  });
});
