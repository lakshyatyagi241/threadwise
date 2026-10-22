import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NextIntlClientProvider } from 'next-intl';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { AnalyticsResponse } from '@crm/contracts';
import { AnalyticsScreen } from './analytics-screen';

const state = vi.hoisted(() => ({ data: undefined as unknown }));

vi.mock('server-only', () => ({}));
vi.mock('../api/hooks', () => ({
  useAnalytics: () => ({ data: state.data, error: null, isFetching: false }),
  useWidgets: () => ({ data: undefined }),
  usePanels: () => ({ data: undefined }),
}));

const messages = JSON.parse(
  readFileSync(join(process.cwd(), 'messages', 'en', 'dashboards-analytics-charts.json'), 'utf8'),
) as Record<string, unknown>;

const html = () =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="UTC">
      <AnalyticsScreen />
    </NextIntlClientProvider>,
  );

const stat = {
  sent: 0,
  delivered: 0,
  queued: 0,
  failed: 0,
  read: 0,
  replies: 0,
  replyRate: 0,
  deliverability: 0,
};

/** Only the parts the screen reads; the rest of the response is not drawn on this page. */
function analytics(conversations: AnalyticsResponse['conversations']): AnalyticsResponse {
  const zeros = Array.from({ length: 31 }, () => 0);
  return {
    range: '30d',
    window: {
      from: '2026-09-21T00:00:00.000Z',
      to: '2026-10-22T00:00:00.000Z',
      prevFrom: '2026-08-21T00:00:00.000Z',
      prevTo: '2026-09-21T00:00:00.000Z',
      timezone: 'UTC',
      days: 31,
      fromDate: '2026-09-21',
      toDate: '2026-10-21',
    },
    current: stat,
    previous: stat,
    trends: {
      sentPct: 0,
      deliveredPct: 0,
      failedPct: 0,
      queuedPct: 0,
      repliesPct: 0,
      replyRatePp: 0,
      replyRateContactPp: 0,
      endToEndPp: 0,
    },
    daily: { dates: [], sent: zeros, delivered: zeros, failed: zeros, queued: zeros },
    funnel: {
      stages: [],
      endToEnd: 0,
      contacts: { messaged: 0, delivered: 0, replied: 0, goalCompleted: 0 },
      activity: { inbound: 0, respondingContacts: 0, repliesPerContact: 0 },
      replyRate: 0,
      comparison: { previousReplyRate: 0, replyRatePp: 0 },
    },
    types: [],
    heatmap: Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0)),
    conversations,
  } as unknown as AnalyticsResponse;
}

describe('AnalyticsScreen conversation tiles', () => {
  it('shows Resolved and Closed as separate tiles, each with its own count', () => {
    state.data = analytics({
      total: 5,
      open: 2,
      resolved: 2,
      closed: 1,
      assigned: 3,
      unassigned: 2,
    });
    const out = html();
    expect(out).toContain('Resolved conversations');
    expect(out).toContain('Closed conversations');
    expect(out).toMatch(/Resolved conversations[\s\S]*?>2</);
    expect(out).toMatch(/Closed conversations[\s\S]*?>1</);
  });
});
