import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import { fetchUnreadCount } from './unread';

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

describe('fetchUnreadCount', () => {
  it('reads the number from the unread-count route', async () => {
    const http = mockFetch(jsonResponse(200, { unread: 7 }));
    await expect(fetchUnreadCount()).resolves.toBe(7);
    expect(new URL(http.calls[0].url).pathname).toBe('/v2/notifications/unread-count');
  });
});
