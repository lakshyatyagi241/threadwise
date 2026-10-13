import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallAnalytics, CallLogDetail, CallLogList } from '@crm/contracts';
import { ToastProvider } from '@crm/ui';
import { ApiError } from '@/lib/api/errors';
import { loadMessages } from '@/i18n/messages';

const q = (over: Record<string, unknown> = {}) =>
  ({
    isPending: false,
    isFetching: false,
    isError: false,
    error: null,
    data: undefined,
    refetch: () => undefined,
    ...over,
  }) as never;

const state = vi.hoisted(() => ({
  perms: new Set<string>(),
  search: '',
  list: {} as Record<string, unknown>,
  filters: {} as Record<string, unknown>,
  detail: {} as Record<string, unknown>,
  analytics: {} as Record<string, unknown>,
}));

vi.mock('@/features/auth-registration-security/shared/session-context', () => ({
  useCan: (p: string) => state.perms.has(p),
  useSession: () => ({ effectiveTimezone: 'UTC' }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined }),
  usePathname: () => '/call-logs',
  useSearchParams: () => new URLSearchParams(state.search),
}));
vi.mock('../api/call-logs', () => ({
  useCallLogs: () => state.list,
  useCallLogFilters: () => state.filters,
  useCallLog: () => state.detail,
  useCallAnalytics: () => state.analytics,
  useCallLogsLive: () => undefined,
  usePlayback: () => ({ mutate: () => undefined, isPending: false, isError: false, error: null }),
}));

import { CallAnalyticsScreen } from './call-analytics-screen';
import { CallLogDetailScreen } from './call-log-detail-screen';
import { CallLogsScreen } from './call-logs-screen';

const ID = '4f0c1f6e-5b0b-4a52-9d0a-0c4a1d0a6b11';
const NUM = '5d0c1f6e-5b0b-4a52-9d0a-0c4a1d0a6b22';

const html = (el: ReactElement, locale = 'en') =>
  renderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      messages={loadMessages(locale)}
      timeZone="UTC"
      onError={(e) => {
        throw e;
      }}
    >
      <QueryClientProvider client={new QueryClient()}>
        <ToastProvider dismissLabel="Dismiss">{el}</ToastProvider>
      </QueryClientProvider>
    </NextIntlClientProvider>,
  );

const row = (over: Record<string, unknown> = {}) => ({
  id: ID,
  direction: 'inbound',
  status: 'completed',
  customerPhone: '919811100001',
  ourPhone: '919800000000',
  contactId: null,
  contactName: 'Rahul Sharma',
  numberId: NUM,
  numberLabel: 'Support line',
  handlerType: 'operator',
  handlerId: NUM,
  handlerName: 'Priya Agent',
  startedAt: '2026-10-13T09:00:00.000Z',
  durationSec: 65,
  endReason: 'COMPLETED',
  hasRecording: true,
  ...over,
});

const LIST: CallLogList = {
  rows: [
    row(),
    row({ id: NUM, status: 'no-answer', durationSec: 0, contactName: null, handlerName: null }),
  ],
  page: 1,
  pageSize: 25,
  total: 2,
  kpis: {
    workspace: { total: 40, last24h: 5, minutes24h: 12, completed: 30, failed: 4 },
    selection: { total: 2, answered: 1, missed: 1, avgDurationSec: 65, totalMinutes: 1 },
  },
} as never;

beforeEach(() => {
  state.perms = new Set(['call.logs.read', 'call.recordings.play']);
  state.search = '';
  state.list = q({ data: LIST });
  state.filters = q({
    data: {
      numbers: [
        { id: NUM, label: 'Support line', phoneNumber: '+919800000000' },
        { id: ID, label: 'Sales line', phoneNumber: '+919800000001' },
      ],
      agents: [{ id: ID, name: 'Priya Agent' }],
    },
  });
});

describe.each(['en', 'ar'])('the call log (%s)', (locale) => {
  it('shows Reference’s four totals, the totals of the selection, and the rows with links', () => {
    const out = html(<CallLogsScreen />, locale);
    for (const n of ['>40<', '>5<', '>30<', '>4<']) expect(out).toContain(n);
    expect(out).toContain(`href="/call-logs/${ID}"`);
    expect(out).toContain('Rahul Sharma');
    expect(out).toContain('+919811100001');
    expect(out).toContain('1:05');
    expect(out).toContain('<table');
    expect(out).toContain('<caption');
    if (locale === 'en') {
      expect(out).toContain('Call logs');
      expect(out).toContain('Last 30 days');
      expect(out).toContain('No answer');
      expect(out).toContain('12 min');
      expect(out).toContain('Showing 1-2 of 2 calls');
    } else {
      expect(out).toMatch(/[؀-ۿ]/);
      expect(out).not.toContain('Showing 1-2');
    }
  });

  it('marks customer text for the Help assistant and uses no left or right classes', () => {
    const out = html(<CallLogsScreen />, locale);
    expect(out).toContain('data-agent-ignore="true"');
    expect(out).toContain('data-agent-pii="true"');
    // Logical properties only (ms-, me-, ps-, pe-, text-start, text-end): the page must mirror in Arabic.
    expect(out).not.toMatch(
      /class="[^"]*(?:\b(?:ml|mr|pl|pr)-[\d[]|\b(?:left|right)-|\btext-(?:left|right)\b)/,
    );
  });

  it('has an accessible search form, pressed states on the side filters and a page nav', () => {
    const out = html(<CallLogsScreen />, locale);
    expect(out).toContain('role="search"');
    expect(out).toContain('aria-pressed="true"');
    expect(out).toContain('type="search"');
    expect(out).toContain('aria-current="page"');
  });

  it('offers the number filter only when there is more than one number, and the teammate filter when there is one', () => {
    expect(html(<CallLogsScreen />, locale)).toContain('Sales line');
    state.filters = q({
      data: { numbers: [{ id: NUM, label: 'Only line', phoneNumber: null }], agents: [] },
    });
    const out = html(<CallLogsScreen />, locale);
    expect(out).not.toContain('Only line');
    expect(out).not.toContain('Priya Agent</option>');
  });

  it('keeps the filters of the address on the controls', () => {
    state.search = `status=failed&direction=outbound&numberId=${NUM}&q=rahul&from=2026-10-01&to=2026-10-09`;
    const out = html(<CallLogsScreen />, locale);
    expect(out).toContain('value="rahul"');
    expect(out).toContain('value="2026-10-01"');
    expect(out).toContain('value="2026-10-09"');
    expect(out).toContain(`<option value="outbound" selected`);
  });
});

describe('call log states', () => {
  it('loading', () => {
    state.list = q({ isPending: true });
    const out = html(<CallLogsScreen />);
    expect(out).toContain('Loading calls');
    expect(out).not.toContain('<table');
  });

  it('an error with a retry, in words', () => {
    state.list = q({ isError: true, error: new ApiError(403, 'FORBIDDEN', 'no') });
    const out = html(<CallLogsScreen />);
    expect(out).toContain('Could not load the call log.');
    expect(out).toContain('You do not have permission to use calling.');
    expect(out).toContain('Try again');
  });

  it('a plan without calling says so', () => {
    state.list = q({ isError: true, error: new ApiError(422, 'PLAN_FEATURE_LOCKED', 'locked') });
    expect(html(<CallLogsScreen />)).toContain('Your plan does not include WhatsApp calling.');
  });

  it('empty: no calls yet, and no calls match the filters', () => {
    state.list = q({ data: { ...LIST, rows: [], total: 0 } });
    const none = html(<CallLogsScreen />);
    expect(none).toContain('No calls yet');
    expect(none).not.toContain('Clear filters');
    state.search = 'status=failed';
    const filtered = html(<CallLogsScreen />);
    expect(filtered).toContain('No calls match these filters');
    expect(filtered).toContain('Clear filters');
  });

  it('pages: the second page of three', () => {
    state.list = q({ data: { ...LIST, page: 2, pageSize: 2, total: 5 } });
    state.search = 'page=2';
    const out = html(<CallLogsScreen />);
    expect(out).toContain('Showing 3-4 of 5 calls');
    expect(out).toContain('Page 2 of 3');
  });
});

const DETAIL: CallLogDetail = {
  call: {
    ...row(),
    contactId: ID,
    answeredAt: '2026-10-13T09:00:06.000Z',
    endedAt: '2026-10-13T09:01:11.000Z',
    failureReason: null,
    conversationId: NUM,
  },
  timeline: [
    { type: 'connect', at: '2026-10-13T09:00:00.000Z', note: null },
    { type: 'accept_sent', at: '2026-10-13T09:00:04.000Z', note: null },
    { type: 'terminate', at: '2026-10-13T09:01:11.000Z', note: 'COMPLETED' },
    { type: 'brand_new_step', at: '2026-10-13T09:01:12.000Z', note: null },
  ],
  recording: { available: true, mime: 'audio/webm', sizeBytes: null },
} as never;

describe.each(['en', 'ar'])('one call (%s)', (locale) => {
  beforeEach(() => {
    state.detail = q({ data: DETAIL });
  });

  it('shows who, how long, the links, the timeline and the recording with its consent line', () => {
    const out = html(<CallLogDetailScreen callId={ID} />, locale);
    expect(out).toContain('Rahul Sharma');
    expect(out).toContain('1:05');
    expect(out).toContain(`href="/contacts/${ID}"`);
    expect(out).toContain(`href="/inbox?c=${NUM}"`);
    expect(out).toContain('<ol');
    expect(out).toContain('brand_new_step'); // a step with no words is shown as it came
    expect(out).toContain('COMPLETED');
    expect(out).toContain('role="note"');
    expect(out).toContain('data-agent-ignore="true"');
    if (locale === 'en') {
      expect(out).toContain('Call answered');
      expect(out).toContain('This call was recorded.');
      expect(out).toContain('Play recording');
      expect(out).toContain('Handled by Priya Agent');
    } else expect(out).toMatch(/[؀-ۿ]/);
    // The recording is not fetched, and no audio element exists, until Play is pressed.
    expect(out).not.toContain('<audio');
  });

  it('without the playback right the recording is described but not offered', () => {
    state.perms = new Set(['call.logs.read']);
    const out = html(<CallLogDetailScreen callId={ID} />, locale);
    expect(out).toContain('role="note"');
    if (locale === 'en') {
      expect(out).toContain('do not have permission to play recordings');
      expect(out).not.toContain('Play recording');
    }
  });
});

describe('one call: other states', () => {
  it('a call without a recording says so', () => {
    state.detail = q({
      data: {
        ...DETAIL,
        call: { ...DETAIL.call, hasRecording: false },
        recording: { available: false, mime: null, sizeBytes: null },
      },
    });
    const out = html(<CallLogDetailScreen callId={ID} />);
    expect(out).toContain('This call has no recording.');
    expect(out).not.toContain('role="note"');
  });

  it('a failed call gives the reason in words, an unknown reason as it came', () => {
    state.detail = q({
      data: {
        ...DETAIL,
        call: {
          ...DETAIL.call,
          status: 'failed',
          failureReason: 'NO_PERMISSION',
          endReason: 'NO_PERMISSION',
          durationSec: 0,
        },
      },
    });
    expect(html(<CallLogDetailScreen callId={ID} />)).toContain(
      'The customer had not allowed calls yet',
    );
    state.detail = q({
      data: {
        ...DETAIL,
        call: {
          ...DETAIL.call,
          status: 'failed',
          failureReason: 'WEIRD_CODE',
          endReason: 'WEIRD_CODE',
        },
      },
    });
    expect(html(<CallLogDetailScreen callId={ID} />)).toContain('WEIRD_CODE');
  });

  it('an AI-handled call and an unhandled one', () => {
    state.detail = q({
      data: { ...DETAIL, call: { ...DETAIL.call, handlerName: null, handlerType: 'ai_agent' } },
    });
    expect(html(<CallLogDetailScreen callId={ID} />)).toContain('Handled by AI assistant');
    state.detail = q({
      data: { ...DETAIL, call: { ...DETAIL.call, handlerName: null, handlerType: null } },
    });
    expect(html(<CallLogDetailScreen callId={ID} />)).toContain('Not handled by anyone');
  });

  it('an empty timeline, loading, not found and a failed load', () => {
    state.detail = q({ data: { ...DETAIL, timeline: [] } });
    expect(html(<CallLogDetailScreen callId={ID} />)).toContain(
      'No steps were recorded for this call.',
    );
    state.detail = q({ isPending: true });
    expect(html(<CallLogDetailScreen callId={ID} />)).toContain('Loading the call');
    state.detail = q({ isError: true, error: new ApiError(404, 'NOT_FOUND', 'x') });
    const gone = html(<CallLogDetailScreen callId={ID} />);
    expect(gone).toContain('This call could not be found.');
    expect(gone).not.toContain('Try again');
    state.detail = q({ isError: true, error: new ApiError(500, 'INTERNAL', 'x') });
    expect(html(<CallLogDetailScreen callId={ID} />)).toContain('Try again');
  });
});

const ANALYTICS: CallAnalytics = {
  from: '2026-10-07',
  to: '2026-10-13',
  tz: 'UTC',
  totals: {
    total: 10,
    answered: 6,
    missed: 3,
    answeredRate: 0.6,
    avgHandleSec: 200,
    totalMinutes: 20,
  },
  series: ['07', '08', '09', '10', '11', '12', '13'].map((d, i) => ({
    day: `2026-10-${d}`,
    total: i,
    answered: Math.floor(i / 2),
    missed: 0,
  })),
  byAgent: [
    {
      agentId: ID,
      name: 'Priya Agent',
      calls: 6,
      answered: 5,
      avgHandleSec: 210,
      totalMinutes: 18,
    },
    { agentId: null, name: null, calls: 4, answered: 1, avgHandleSec: 120, totalMinutes: 2 },
  ],
  heatmap: [
    { weekday: 1, hour: 10, calls: 4 },
    { weekday: 3, hour: 15, calls: 1 },
  ],
} as never;

describe.each(['en', 'ar'])('the analytics (%s)', (locale) => {
  beforeEach(() => {
    state.analytics = q({ data: ANALYTICS });
  });

  it('shows the figures, the bars with a table for screen readers, the teammates and the heat map', () => {
    const out = html(<CallAnalyticsScreen />, locale);
    expect(out).toContain('60%');
    expect(out).toContain('3:20');
    expect(out).toContain('role="img"');
    expect(out).toContain('class="sr-only"');
    expect(out).toContain('Priya Agent');
    expect(out).toContain('role="table"');
    expect(out).toContain('data-agent-pii="true"');
    // Time runs left to right whatever the language; the chart is its own island.
    expect(out).toContain('dir="ltr"');
    if (locale === 'en') {
      expect(out).toContain('Call analytics');
      expect(out).toContain('Not handled by anyone');
      expect(out).toContain('Mon, 10:00: 4 calls');
      expect(out).toContain('Sun, 0:00: no calls');
    } else expect(out).toMatch(/[؀-ۿ]/);
  });
});

describe('analytics states', () => {
  it('empty period, loading and error', () => {
    state.analytics = q({ data: { ...ANALYTICS, totals: { ...ANALYTICS.totals, total: 0 } } });
    expect(html(<CallAnalyticsScreen />)).toContain('No calls in this period');
    state.analytics = q({ isPending: true });
    expect(html(<CallAnalyticsScreen />)).toContain('Loading call analytics');
    state.analytics = q({ isError: true, error: new ApiError(422, 'CALL_RANGE_INVALID', 'x') });
    const err = html(<CallAnalyticsScreen />);
    expect(err).toContain('Could not load the call analytics.');
    expect(err).toContain('These dates do not make sense');
  });

  it('carries the range to the log tab and offers the number filter for several numbers', () => {
    state.analytics = q({ data: ANALYTICS });
    state.search = `range=7d&status=failed&numberId=${NUM}`;
    const out = html(<CallAnalyticsScreen />);
    expect(out).toContain(`href="/call-logs?range=7d&amp;numberId=${NUM}"`);
    expect(out).not.toContain('status=failed');
    expect(out).toContain('All numbers');
  });
});
