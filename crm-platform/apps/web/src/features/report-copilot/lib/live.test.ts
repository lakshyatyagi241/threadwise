import { describe, expect, it } from 'vitest';
import {
  REPORT_LIVE_METRICS,
  type AdminAnalytics,
  type AdminOverview,
  type DashSummaryResponse,
  type DashWidgets,
} from '@crm/contracts';
import {
  analyticsDaysFor,
  dashRangeFor,
  isLiveKey,
  liveSourceOf,
  liveUnitOf,
  readLive,
} from './live';

const summary = {
  current: {
    sent: 120,
    delivered: 110,
    failed: 4,
    read: 80,
    queued: 6,
    replies: 30,
    contactsMessaged: 60,
    deliverability: 91.7,
    readRate: 66.7,
    replyRate: 25,
  },
} as unknown as DashSummaryResponse;
const widgets = {
  contacts: { total: 500, subscribed: 450, blocked: 5 },
  campaigns: { running: 2, scheduled: 1, paused: 0, total: 9 },
  devices: { total: 3, online: 2 },
  templates: { count: 12 },
  inbox: { unread: 7 },
  pipeline: { openDeals: 4, winRatePct: 33 },
  flows: { total: 5, active: 3, subscribers: 100 },
} as unknown as DashWidgets;
const overview = {
  currency: 'USD',
  kpis: { income: { value: '1234.50' }, views: { value: '9000' }, conversion: { value: '3.4' } },
  users: { total: 80, premium: 20, basic: 60 },
  alerts: { open: 2 },
} as unknown as AdminOverview;
const analytics = {
  currency: 'USD',
  kpis: {
    revenue: '5000.25',
    workspaces: 40,
    newWorkspaces: 3,
    users: 80,
    newUsers: 5,
    messages: 777,
    messagesPerDay: 25,
    devicesOnline: 9,
    devicesTotal: 12,
    openTickets: 4,
  },
} as unknown as AdminAnalytics;
const all = { summary, widgets, overview, analytics };

describe('every key the contract lists is readable on the page', () => {
  for (const scope of ['workspace', 'platform'] as const) {
    it(`${scope}: each key has a reader and returns a number from the sample data`, () => {
      for (const { key } of REPORT_LIVE_METRICS[scope]) {
        expect(isLiveKey(scope, key), key).toBe(true);
        expect(liveSourceOf(scope, key), key).not.toBeNull();
        expect(readLive(scope, key, all), key).not.toBeNull();
      }
    });
  }
});

describe('readLive', () => {
  it('reads message figures from the summary, cards from the widgets, and platform figures from the overview and analytics', () => {
    expect(readLive('workspace', 'messages.sent', all)).toBe(120);
    expect(readLive('workspace', 'messages.replyRate', all)).toBe(25);
    expect(readLive('workspace', 'contacts.total', all)).toBe(500);
    expect(readLive('workspace', 'pipeline.winRatePct', all)).toBe(33);
    expect(readLive('platform', 'users.premium', all)).toBe(20);
    expect(readLive('platform', 'platform.income', all)).toBe(1234.5);
    expect(readLive('platform', 'platform.revenue', all)).toBe(5000.25);
    expect(readLive('platform', 'platform.openTickets', all)).toBe(4);
  });
  it('ignores a key that is not valid for the scope, or that nobody knows', () => {
    expect(readLive('workspace', 'platform.income', all)).toBeNull();
    expect(readLive('platform', 'messages.sent', all)).toBeNull();
    expect(readLive('workspace', 'secrets.everything', all)).toBeNull();
    expect(readLive('workspace', undefined, all)).toBeNull();
    expect(isLiveKey('workspace', 'secrets.everything')).toBe(false);
  });
  it('has nothing to show before the response loads, for a plan without the field, or for a value that is not a number', () => {
    expect(readLive('workspace', 'messages.sent', {})).toBeNull();
    expect(
      readLive('workspace', 'pipeline.openDeals', {
        widgets: { ...widgets, pipeline: null } as unknown as DashWidgets,
      }),
    ).toBeNull();
    const broken = {
      current: { ...summary.current, sent: Number.NaN },
    } as unknown as DashSummaryResponse;
    expect(readLive('workspace', 'messages.sent', { summary: broken })).toBeNull();
    const text = {
      ...overview,
      kpis: { ...overview.kpis, income: { value: 'n/a' } },
    } as unknown as AdminOverview;
    expect(readLive('platform', 'platform.income', { overview: text })).toBeNull();
  });
});

describe('units and ranges', () => {
  it('knows whether a key is a count, a percent or money', () => {
    expect(liveUnitOf('workspace', 'messages.replyRate')).toBe('percent');
    expect(liveUnitOf('workspace', 'contacts.total')).toBe('count');
    expect(liveUnitOf('platform', 'platform.income')).toBe('money');
  });
  it('maps the windows the dashboard has a range for, and nothing for 90 days', () => {
    expect(dashRangeFor('7d')).toBe('7d');
    expect(dashRangeFor('30d')).toBe('30d');
    expect(dashRangeFor('90d')).toBeNull();
    expect(analyticsDaysFor('90d')).toBe(90);
  });
});
