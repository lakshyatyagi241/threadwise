import { ApiError } from '@/lib/api';
import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import { newMessage, notificationPage } from '@/test/notifications-fixtures';
import {
  dismissNotification,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from './api';

beforeEach(async () => {
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

const url = (call: { url: string } | undefined) => new URL((call as { url: string }).url);

describe('notifications api', () => {
  it('lists a page and sends the cursor and the unread filter only when set', async () => {
    const http = mockFetch(
      jsonResponse(200, notificationPage([newMessage], { nextCursor: 'c-2' })),
    );
    const result = await listNotifications({ limit: 30, cursor: 'c-1', unreadOnly: true });
    expect(url(http.calls[0]).pathname).toBe('/v2/notifications');
    expect(Object.fromEntries(url(http.calls[0]).searchParams)).toEqual({
      limit: '30',
      cursor: 'c-1',
      unreadOnly: 'true',
    });
    expect(result.page.nextCursor).toBe('c-2');
    expect(result.meta.unread).toBe(1);
  });

  it('asks for everything (no filter) by default', async () => {
    const http = mockFetch(jsonResponse(200, notificationPage([])));
    await listNotifications({ limit: 30, unreadOnly: false });
    expect(Object.fromEntries(url(http.calls[0]).searchParams)).toEqual({ limit: '30' });
  });

  it('marks one read with a POST and an Idempotency-Key', async () => {
    const http = mockFetch(
      jsonResponse(200, { ...newMessage, readAt: '2026-10-16T10:00:00.000Z' }),
    );
    const row = await markNotificationRead(newMessage.id, 'key-1');
    expect(http.calls[0].init.method).toBe('POST');
    expect(url(http.calls[0]).pathname).toBe(`/v2/notifications/${newMessage.id}/read`);
    expect(http.calls[0].headers['Idempotency-Key']).toBe('key-1');
    expect(row.readAt).not.toBeNull();
  });

  it('marks all read and says how many changed', async () => {
    const http = mockFetch(jsonResponse(200, { updated: 4 }));
    await expect(markAllNotificationsRead()).resolves.toEqual({ updated: 4 });
    expect(url(http.calls[0]).pathname).toBe('/v2/notifications/read-all');
    expect(http.calls[0].init.method).toBe('POST');
  });

  it('dismisses one with a DELETE', async () => {
    const http = mockFetch(jsonResponse(200, { deleted: 1 }));
    await expect(dismissNotification(newMessage.id)).resolves.toEqual({ deleted: 1 });
    expect(http.calls[0].init.method).toBe('DELETE');
    expect(url(http.calls[0]).pathname).toBe(`/v2/notifications/${newMessage.id}`);
  });

  it("turns a 404 on someone else's notification into an ApiError with its code", async () => {
    mockFetch(
      jsonResponse(404, {
        type: 'about:blank',
        title: 'Not found',
        status: 404,
        code: 'NOT_FOUND',
      }),
    );
    await expect(markNotificationRead(newMessage.id)).rejects.toMatchObject({
      constructor: ApiError,
      status: 404,
      code: 'NOT_FOUND',
    });
  });
});
