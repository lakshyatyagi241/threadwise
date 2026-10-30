import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { initI18n } from '@/lib/i18n';
import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import { renderApp } from '@/test/render';
import { NotificationBell } from './notification-bell';

jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

const push = jest.fn();

const unreadRow = (n: number, type: string) => ({
  id: `8000000${n}-1111-4111-8111-111111111111`,
  type,
  title: type,
  body: null,
  link: null,
  data: null,
  count: 1,
  readAt: null,
  createdAt: '2026-10-16T09:00:00.000Z',
  subject: null,
});
const rows = (types: string[]) =>
  jsonResponse(200, {
    data: types.map((type, n) => unreadRow(n, type)),
    page: { nextCursor: null, hasMore: false, limit: 50 },
    meta: { unread: types.length },
  });

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(async () => {
  jest.resetAllMocks();
  jest.mocked(useRouter).mockReturnValue({ push } as unknown as ReturnType<typeof useRouter>);
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

describe('NotificationBell', () => {
  it('names the unread count for a screen reader and opens the list', async () => {
    mockFetch(rows(['new_message', 'new_chat', 'task_due', 'task_assigned']));
    await renderApp(<NotificationBell />);
    const bell = await screen.findByLabelText('Notifications, 4 unread');
    await fireEvent.press(bell);
    expect(push).toHaveBeenCalledWith('/notifications');
  });

  it('does not count the kinds the app hides', async () => {
    mockFetch(rows(['new_message', 'new_lead', 'device_disconnected']));
    await renderApp(<NotificationBell />);
    expect(await screen.findByLabelText('Notifications, 1 unread')).toBeTruthy();
  });

  it('has no dot when everything unread is a hidden kind', async () => {
    const http = mockFetch(rows(['wallet_credited', 'mention']));
    await renderApp(<NotificationBell />);
    await waitFor(() => expect(http.calls).toHaveLength(1));
    expect(screen.getByLabelText('Notifications')).toBeTruthy();
  });

  it('is plain "Notifications" when nothing is unread', async () => {
    const http = mockFetch(rows([]));
    await renderApp(<NotificationBell />);
    await waitFor(() => expect(http.calls).toHaveLength(1));
    expect(screen.getByLabelText('Notifications')).toBeTruthy();
  });
});
