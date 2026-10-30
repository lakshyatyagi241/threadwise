import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import { fetchUnreadCount } from './unread';

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

const page = (types: string[]) =>
  jsonResponse(200, {
    data: types.map((type, i) => ({
      id: `8000000${i}-1111-4111-8111-111111111111`,
      type,
      title: type,
      body: null,
      link: null,
      data: null,
      count: 1,
      readAt: null,
      createdAt: '2026-10-16T09:00:00.000Z',
      subject: null,
    })),
    page: { nextCursor: null, hasMore: false, limit: 50 },
    meta: { unread: types.length },
  });

describe('fetchUnreadCount', () => {
  it('is zero when nothing is unread', async () => {
    mockFetch(page([]));
    await expect(fetchUnreadCount()).resolves.toBe(0);
  });

  it('reads the newest unread rows, within the page size the API allows', async () => {
    const http = mockFetch(page(['new_message']));
    await fetchUnreadCount();
    expect(http.calls).toHaveLength(1);
    const url = new URL(http.calls[0].url);
    expect(url.pathname).toBe('/v2/notifications');
    expect(url.searchParams.get('unreadOnly')).toBe('true');
    // The list route refuses more than 50 rows (`listNotificationsQuerySchema`): more would fail the bell for everyone.
    expect(Number(url.searchParams.get('limit'))).toBeLessThanOrEqual(50);
  });

  it('counts only the unread rows of kinds the app shows', async () => {
    mockFetch(page(['new_message', 'new_lead', 'device_disconnected', 'task_due', 'mention']));
    await expect(fetchUnreadCount()).resolves.toBe(2);
  });

  it('is zero when everything unread is a hidden kind', async () => {
    mockFetch(page(['wallet_credited', 'broadcast_failed']));
    await expect(fetchUnreadCount()).resolves.toBe(0);
  });
});
