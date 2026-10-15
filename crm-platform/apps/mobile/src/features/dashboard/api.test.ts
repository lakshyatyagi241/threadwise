import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { conversationStats, summary, throughput, wallet, widgets } from '@/test/dashboard-fixtures';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import {
  fetchConversationStats,
  fetchEntitlements,
  fetchInboxCounts,
  fetchNewContacts,
  fetchSummary,
  fetchTaskCounts,
  fetchThroughput,
  fetchWalletSummary,
  fetchWidgets,
} from './api';

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

describe('dashboard api', () => {
  it('asks the summary, throughput and widgets endpoints for the chosen window', async () => {
    const http = mockFetch(
      jsonResponse(200, summary),
      jsonResponse(200, throughput),
      jsonResponse(200, widgets),
    );
    const win = { from: '2026-09-13', to: '2026-10-12' };
    await expect(fetchSummary(win)).resolves.toMatchObject({ sentDeltaPct: 25 });
    await expect(fetchThroughput(win)).resolves.toMatchObject({ bucket: 'day' });
    await expect(fetchWidgets(win)).resolves.toMatchObject({ contacts: { total: 480 } });
    const query = 'range=custom&from=2026-09-13&to=2026-10-12';
    expect(http.calls.map((call) => call.url)).toEqual([
      expect.stringContaining(`/v2/dashboard/summary?${query}`),
      expect.stringContaining(`/v2/dashboard/throughput?${query}`),
      expect.stringContaining(`/v2/dashboard/widgets?${query}`),
    ]);
    expect(http.calls[0]?.headers.Authorization).toBe('Bearer access-1');
  });

  it('asks for the conversation numbers of the window, narrowed to one person when asked', async () => {
    const http = mockFetch(
      jsonResponse(200, conversationStats),
      jsonResponse(200, conversationStats),
    );
    const win = { from: '2026-09-13', to: '2026-10-12' };
    await expect(fetchConversationStats(win)).resolves.toMatchObject({ counts: { total: 17 } });
    await fetchConversationStats(win, 'b1111111-1111-4111-8111-111111111111');
    expect(http.calls[0]?.url).toContain(
      '/v2/analytics/conversations?range=custom&from=2026-09-13&to=2026-10-12',
    );
    expect(http.calls[0]?.url).not.toContain('agent=');
    expect(http.calls[1]?.url).toContain('&agent=b1111111-1111-4111-8111-111111111111');
  });

  it('reads the wallet and the plan features', async () => {
    const http = mockFetch(
      jsonResponse(200, wallet),
      jsonResponse(200, { features: ['unofficial_whatsapp'] }),
    );
    await expect(fetchWalletSummary()).resolves.toMatchObject({ balanceMinor: 250000 });
    await expect(fetchEntitlements()).resolves.toEqual({ features: ['unofficial_whatsapp'] });
    expect(http.calls.map((call) => call.url)).toEqual([
      expect.stringContaining('/v2/wallet/summary'),
      expect.stringContaining('/v2/billing/entitlements'),
    ]);
  });

  it('counts the contacts created in the window with a one-row page and its total', async () => {
    const http = mockFetch(
      jsonResponse(200, {
        data: [],
        page: { nextCursor: null, hasMore: true, limit: 1 },
        meta: { total: 42 },
      }),
    );
    await expect(fetchNewContacts({ from: '2026-09-13', to: '2026-10-12' })).resolves.toBe(42);
    const url = new URL(http.calls[0]!.url);
    expect(url.pathname).toBe('/v2/contacts');
    expect(url.searchParams.get('createdFrom')).toBe('2026-09-13');
    expect(url.searchParams.get('createdTo')).toBe('2026-10-12');
    expect(url.searchParams.get('includeTotal')).toBe('true');
    expect(url.searchParams.get('limit')).toBe('1');
  });

  it('falls back to the rows it got when the API sends no total', async () => {
    mockFetch(
      jsonResponse(200, { data: [{}], page: { nextCursor: null, hasMore: false, limit: 1 } }),
    );
    await expect(fetchNewContacts({ from: '2026-10-12', to: '2026-10-12' })).resolves.toBe(1);
  });

  it('reads the task counts and the live inbox counts', async () => {
    const http = mockFetch(
      jsonResponse(200, {
        overdue: 1,
        today: 2,
        upcoming: 3,
        noDate: 4,
        open: 10,
        done: 5,
        mine: { open: 6, overdue: 1 },
      }),
      jsonResponse(200, { all: 9, mine: 4, unassigned: 3, unread: 2, archived: 1 }),
    );
    await expect(fetchTaskCounts()).resolves.toMatchObject({ open: 10 });
    await expect(fetchInboxCounts()).resolves.toMatchObject({ all: 9, unassigned: 3 });
    expect(http.calls.map((call) => new URL(call.url).pathname)).toEqual([
      '/v2/tasks/counts',
      '/v2/inbox/counts',
    ]);
  });
});
