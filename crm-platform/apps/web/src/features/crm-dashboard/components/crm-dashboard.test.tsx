import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { CrmDashboardResponse } from '@crm/contracts';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { isEmptyDashboard } from './crm-dashboard-screen';
import { FunnelPanel, TrendPanel } from './deal-panels';
import { KpiGrid } from './kpi-grid';
import { LeaderboardPanel } from './table-panels';
import { changePercent, moneyText } from '../lib/format';
import { filtersToSearch, parseFilters, DEFAULT_FILTERS, links } from '../lib/query';

const load = (locale: string, file: string) =>
  JSON.parse(readFileSync(join(process.cwd(), 'messages', locale, file), 'utf8')) as Record<
    string,
    unknown
  >;
const messagesFor = (locale: string) => ({
  ...load(locale, 'crm-dashboard.json'),
  ...load(locale, 'dashboards-analytics-charts.json'),
});
const html = (el: ReactElement, locale = 'en') =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={messagesFor(locale)} timeZone="UTC">
      {el}
    </NextIntlClientProvider>,
  );

const usd = (amount: string) => ({
  byCurrency: [{ currency: 'USD', amount }],
  converted: { currency: 'USD', amount },
});
const none = { byCurrency: [], converted: { currency: 'USD', amount: '0.00' } };

const deals = (): NonNullable<CrmDashboardResponse['deals']> => ({
  open: { count: 3, value: usd('600.00'), forecast: usd('250.00') },
  won: {
    count: 3,
    value: usd('1000.00'),
    previousCount: 1,
    previousValue: usd('500.00'),
    averageSize: usd('333.33'),
    averageCycleDays: 4.7,
  },
  lost: { count: 1, previousCount: 1 },
  winRate: 75,
  previousWinRate: 50,
  overdueCloseCount: 1,
  funnel: {
    pipeline: { id: 'p1', name: 'Sales', currency: 'USD' },
    cohortSize: 7,
    stages: [
      ['s1', 'New Lead', 7, null],
      ['s2', 'Qualified', 6, 86],
    ].map(([id, name, reached, conv]) => ({
      id: id as string,
      name: name as string,
      color: '#25D366',
      kind: 'open' as const,
      probability: 10,
      reached: reached as number,
      reachedValue: usd('100.00'),
      conversionFromPrevious: conv as number | null,
      openCount: 1,
      openValue: usd('100.00'),
    })),
  },
  trend: {
    bucket: 'day',
    points: [
      { start: '2026-10-12', wonCount: 1, wonValue: usd('400.00'), lostCount: 0 },
      { start: '2026-10-13', wonCount: 0, wonValue: none, lostCount: 1 },
    ],
  },
  leaderboard: [
    {
      owner: { id: 'u1', name: 'Alice' },
      wonCount: 2,
      wonValue: usd('900.00'),
      lostCount: 1,
      openCount: 2,
      activities: 5,
    },
  ],
});

const data = (over: Partial<CrmDashboardResponse> = {}): CrmDashboardResponse => ({
  period: {
    range: 'month',
    timezone: 'UTC',
    fromDate: '2026-10-01',
    toDate: '2026-10-14',
    days: 14,
    previous: { fromDate: '2026-09-17', toDate: '2026-09-30' },
    today: '2026-10-14',
  },
  convertedTo: 'USD',
  deals: deals(),
  contacts: null,
  tasks: { open: 4, overdue: 2, dueToday: 1, byAssignee: [], upcoming: [] },
  invoices: null,
  activity: [],
  ...over,
});

describe('the CRM dashboard pieces', () => {
  it('KPI cards show the figures, the delta against the previous period and drill-down links; sections the caller lacks are absent', () => {
    const out = html(<KpiGrid data={data()} currency="USD" pipeline="p1" />);
    expect(out).toContain('Open pipeline');
    expect(out).toContain('$600.00');
    expect(out).toContain('3 deals');
    expect(out).toContain('75%');
    expect(out).toContain('+100%'); // won value 500 -> 1000
    expect(out).toContain('href="/deals?pipeline=p1"');
    expect(out).toContain('href="/tasks?tab=overdue"');
    expect(out).not.toContain('Collected'); // invoices is null
    expect(out).not.toContain('New contacts'); // contacts is null
  });

  it('the funnel lists the stages with the conversion between them and links a stage to its open deals', () => {
    const out = html(<FunnelPanel funnel={deals().funnel} currency="USD" />);
    expect(out).toContain('Pipeline funnel');
    expect(out).toContain('86% moved on');
    expect(out).toContain('href="/deals?pipeline=p1&amp;view=list&amp;status=open&amp;stage=s2"');
    expect(out).toContain('7 deals created');
  });

  it('the funnel says so when no deal was created or there is no pipeline', () => {
    const f = deals().funnel;
    expect(html(<FunnelPanel funnel={{ ...f, cohortSize: 0 }} currency="USD" />)).toContain(
      'No deals were created',
    );
    expect(html(<FunnelPanel funnel={{ ...f, pipeline: null }} currency="USD" />)).toContain(
      'no pipeline yet',
    );
  });

  it('the trend draws a chart with an accessible table, and the leaderboard links an owner to their deals', () => {
    const d = deals();
    const trend = html(<TrendPanel trend={d.trend} wonValue={d.won.value} currency="USD" />);
    expect(trend).toContain('Deals won and deals lost over the period');
    expect(trend).toContain('<table');
    const lb = html(<LeaderboardPanel rows={d.leaderboard} pipeline="" currency="USD" />);
    expect(lb).toContain('href="/deals?owner=u1"');
    expect(lb).toContain('Alice');
  });

  it('renders in Arabic from the Arabic messages without falling back to a raw key', () => {
    const out = html(<KpiGrid data={data()} currency="USD" pipeline="" />, 'ar');
    expect(out).not.toContain('crm-dashboard.');
    expect(out).toContain('kpi-open');
  });

  it('knows an empty workspace', () => {
    const empty = data({
      deals: {
        ...deals(),
        open: { count: 0, value: none, forecast: none },
        won: { ...deals().won, count: 0, previousCount: 0 },
        lost: { count: 0, previousCount: 0 },
      },
      tasks: { open: 0, overdue: 0, dueToday: 0, byAssignee: [], upcoming: [] },
    });
    expect(isEmptyDashboard(empty)).toBe(true);
    expect(isEmptyDashboard(data())).toBe(false);
  });
});

describe('the address and the formatting', () => {
  it('keeps the plain dashboard address plain and round-trips the filters', () => {
    expect(filtersToSearch(DEFAULT_FILTERS)).toBe('');
    const id = '0b9a7f06-4c7a-4f0e-8d1d-6a0a8f3f6a11';
    const f = {
      ...DEFAULT_FILTERS,
      range: 'custom' as const,
      from: '2026-09-01',
      to: '2026-09-30',
      owner: id,
    };
    expect(parseFilters(new URLSearchParams(filtersToSearch(f)))).toEqual(f);
  });

  it('falls back to the defaults on malformed values and drops a custom date outside custom', () => {
    const p = parseFilters(new URLSearchParams('range=forever&owner=nope&from=2026-01-01'));
    expect(p).toEqual(DEFAULT_FILTERS);
    expect(parseFilters(new URLSearchParams('range=7d&from=2026-01-01')).from).toBe('');
  });

  it('drill-down addresses point at the filters the target screens read', () => {
    expect(links.deals()).toBe('/deals');
    expect(links.deals({ owner: 'u1' })).toBe('/deals?owner=u1');
    expect(links.tasks({ tab: 'all', assignee: 'none' })).toBe('/tasks?tab=all&assignee=none');
  });

  it('change is a whole percent and null against nothing; money with several currencies and no total joins them', () => {
    expect(changePercent(150, 100)).toBe(50);
    expect(changePercent(5, 0)).toBeNull();
    const mixed = {
      byCurrency: [
        { currency: 'EUR', amount: '10.00' },
        { currency: 'USD', amount: '5.00' },
      ],
      converted: null,
      unconverted: ['EUR'],
    };
    expect(moneyText(mixed, 'en', 'USD')).toBe('€10.00 + $5.00');
    expect(moneyText({ byCurrency: [] }, 'en', 'USD')).toBe('$0.00');
  });
});
