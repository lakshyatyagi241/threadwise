import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallAnalytics, CallLogDetail, CallLogList } from '@crm/contracts';
import { ToastProvider } from '@crm/ui';
import { loadMessages } from '@/i18n/messages';
import { PlanFeaturesProvider } from '@/lib/plan-features';

/**
 * BL-257: the Call logs screens in a workspace WITHOUT the plan feature `waba_calling` (it logs calls by hand, from the mobile app or
 * from a telephony provider). The unified list, the Source filter and "Log a call" stay; what is WhatsApp's (the number filter, the
 * recording player and its consent card, the words that promise WhatsApp calls) is left out. With the feature the screens are the
 * ones `call-logs.render.test.tsx` covers; the last block here checks that the same data reads unchanged.
 */
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
  features: [] as string[] | null,
  list: {} as Record<string, unknown>,
  filters: {} as Record<string, unknown>,
  detail: {} as Record<string, unknown>,
  analytics: {} as Record<string, unknown>,
  lastListQuery: undefined as unknown,
  lastAnalyticsQuery: undefined as unknown,
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
  useCallLogs: (query: unknown) => {
    state.lastListQuery = query;
    return state.list;
  },
  useCallLogFilters: () => state.filters,
  useCallLog: () => state.detail,
  useCallAnalytics: (query: unknown) => {
    state.lastAnalyticsQuery = query;
    return state.analytics;
  },
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
      <PlanFeaturesProvider features={state.features}>
        <QueryClientProvider client={new QueryClient()}>
          <ToastProvider dismissLabel="Dismiss">{el}</ToastProvider>
        </QueryClientProvider>
      </PlanFeaturesProvider>
    </NextIntlClientProvider>,
  );

const row = (over: Record<string, unknown> = {}) => ({
  id: ID,
  direction: 'outbound',
  status: 'completed',
  customerPhone: '919811100001',
  ourPhone: '',
  contactId: null,
  contactName: 'Rahul Sharma',
  numberId: null,
  numberLabel: null,
  handlerType: 'operator',
  handlerId: NUM,
  handlerName: 'Priya Agent',
  startedAt: '2026-10-13T09:00:00.000Z',
  durationSec: 240,
  endReason: 'COMPLETED',
  hasRecording: false,
  source: 'manual',
  outcome: 'connected',
  notesPreview: null,
  ...over,
});

const LIST: CallLogList = {
  rows: [row()],
  page: 1,
  pageSize: 25,
  total: 1,
  kpis: {
    workspace: { total: 7, last24h: 2, minutes24h: 9, completed: 5, failed: 1 },
    selection: { total: 1, answered: 1, missed: 0, avgDurationSec: 240, totalMinutes: 4 },
  },
} as never;

const DETAIL: CallLogDetail = {
  call: {
    ...row(),
    answeredAt: null,
    endedAt: '2026-10-13T09:04:00.000Z',
    failureReason: null,
    conversationId: null,
    notes: 'Asked for the revised quote',
    followUpTaskId: null,
  },
  timeline: [{ type: 'logged', at: '2026-10-13T09:00:00.000Z', note: 'manual' }],
  recording: {
    available: false,
    mime: null,
    sizeBytes: null,
    lifecycle: {
      storedAt: null,
      expiresAt: null,
      legalHold: false,
      holdReason: null,
      deletedAt: null,
      deletedReason: null,
      consent: { status: null, method: null, at: null, noticeVersion: null, noticeSha256: null },
    },
  },
} as never;

const ANALYTICS: CallAnalytics = {
  from: '2026-10-07',
  to: '2026-10-13',
  tz: 'UTC',
  totals: {
    total: 3,
    answered: 2,
    missed: 1,
    answeredRate: 0.66,
    avgHandleSec: 100,
    totalMinutes: 5,
  },
  series: [{ day: '2026-10-13', total: 3, answered: 2, missed: 1 }],
  byAgent: [],
  bySource: [{ source: 'manual', calls: 3, answered: 2, missed: 1 }],
  heatmap: [{ weekday: 1, hour: 10, calls: 3 }],
} as never;

const TWO_NUMBERS = {
  data: {
    numbers: [
      { id: NUM, label: 'Support line', phoneNumber: null },
      { id: ID, label: 'Sales line', phoneNumber: null },
    ],
    agents: [],
  },
};

beforeEach(() => {
  state.perms = new Set(['call.logs.read', 'call.logs.create', 'call.recordings.play']);
  state.search = '';
  state.features = ['analytics']; // a plan with no `waba_calling`
  state.list = q({ data: LIST });
  state.detail = q({ data: DETAIL });
  state.analytics = q({ data: ANALYTICS });
  state.filters = q({ data: { numbers: [], agents: [{ id: NUM, name: 'Priya Agent' }] } });
});

describe('the call log without WhatsApp calling', () => {
  it('lists the logged calls with the Source filter and the Log a call button', () => {
    const out = html(<CallLogsScreen />);
    expect(out).toContain('Rahul Sharma');
    expect(out).toContain('Logged by hand');
    expect(out).toMatch(/<button[^>]*>Log a call<\/button>/);
    expect(out).toContain('All sources');
    for (const label of ['Logged by hand', 'Phone line', 'Mobile app', 'Click to call']) {
      expect(out, label).toContain(`>${label}</option>`);
    }
    // The four totals read as ever.
    for (const n of ['>7<', '>2<', '>5<', '>1<']) expect(out).toContain(n);
  });

  it('leaves out the WhatsApp source and the number filter, even when several numbers come back', () => {
    state.filters = q(TWO_NUMBERS);
    const out = html(<CallLogsScreen />);
    expect(out).not.toContain('>WhatsApp</option>');
    expect(out).not.toContain('All numbers');
    expect(out).not.toContain('Sales line');
  });

  it('does not promise WhatsApp calls in its words', () => {
    const out = html(<CallLogsScreen />);
    expect(out).not.toContain('Every WhatsApp call');
    expect(out).toContain('Every call your team logged');
    state.list = q({ data: { ...LIST, rows: [], total: 0 } });
    const empty = html(<CallLogsScreen />);
    expect(empty).toContain('No calls yet');
    expect(empty).toContain('Use Log a call');
    expect(empty).not.toContain('WhatsApp numbers');
  });

  it('does not ask the server for a WhatsApp number or the WhatsApp source from a stale address', () => {
    state.search = `numberId=${NUM}&source=whatsapp&status=completed`;
    html(<CallLogsScreen />);
    expect(state.lastListQuery).toMatchObject({ status: 'completed' });
    expect(state.lastListQuery).toMatchObject({ numberId: undefined, source: undefined });
    // A source that is not WhatsApp's is kept.
    state.search = 'source=telephony';
    html(<CallLogsScreen />);
    expect(state.lastListQuery).toMatchObject({ source: 'telephony' });
  });

  it('hides Log a call from a person who may not log calls', () => {
    state.perms = new Set(['call.logs.read']);
    expect(html(<CallLogsScreen />)).not.toMatch(/<button[^>]*>Log a call<\/button>/);
  });
});

describe('one call without WhatsApp calling', () => {
  it('shows the call, its notes and its timeline, and no recording column', () => {
    const out = html(<CallLogDetailScreen callId={ID} />);
    expect(out).toContain('Rahul Sharma');
    expect(out).toContain('Asked for the revised quote');
    expect(out).toContain('Call logged');
    expect(out).toContain('Logged by hand');
    expect(out).not.toContain('This call has no recording.');
    expect(out).not.toContain('Play recording');
    expect(out).not.toContain('<aside');
    expect(out).not.toContain('lg:grid-cols-[1fr_340px]');
  });

  it('a historical WhatsApp call still reads, with no player offered (playing needs the feature)', () => {
    state.detail = q({
      data: {
        ...DETAIL,
        call: { ...DETAIL.call, source: 'whatsapp', hasRecording: true },
        recording: { ...DETAIL.recording, available: true, mime: 'audio/webm' },
      },
    });
    const out = html(<CallLogDetailScreen callId={ID} />);
    expect(out).toContain('Rahul Sharma');
    expect(out).not.toContain('Play recording');
    expect(out).not.toContain('<aside');
  });
});

describe('the analytics without WhatsApp calling', () => {
  it('shows the figures and no number filter, and asks for no number', () => {
    state.filters = q(TWO_NUMBERS);
    state.search = `numberId=${NUM}&range=7d`;
    const out = html(<CallAnalyticsScreen />);
    expect(out).toContain('66%');
    expect(out).not.toContain('All numbers');
    expect(state.lastAnalyticsQuery).toMatchObject({ numberId: undefined });
    // The tab link carries the range but not the number the plan cannot filter by.
    expect(out).toContain('href="/call-logs?range=7d"');
  });
});

describe('with WhatsApp calling nothing changes', () => {
  beforeEach(() => {
    state.features = ['waba_calling'];
  });

  it('keeps the WhatsApp source, the number filter, the recording column and the WhatsApp words', () => {
    state.filters = q(TWO_NUMBERS);
    const list = html(<CallLogsScreen />);
    expect(list).toContain('>WhatsApp</option>');
    expect(list).toContain('All numbers');
    expect(list).toContain('Every WhatsApp call');
    const detail = html(<CallLogDetailScreen callId={ID} />);
    expect(detail).toContain('This call has no recording.');
    expect(detail).toContain('<aside');
  });

  it('and so does a plan that is not known yet', () => {
    state.features = null;
    state.search = `numberId=${NUM}&source=whatsapp`;
    html(<CallLogsScreen />);
    expect(state.lastListQuery).toMatchObject({ numberId: NUM, source: 'whatsapp' });
  });
});
