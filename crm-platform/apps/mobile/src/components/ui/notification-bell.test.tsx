import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { initI18n } from '@/lib/i18n';
import { resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import { renderApp } from '@/test/render';
import { NotificationBell } from './notification-bell';

jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

const push = jest.fn();

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
    mockFetch(jsonResponse(200, { unread: 4 }));
    await renderApp(<NotificationBell />);
    const bell = await screen.findByLabelText('Notifications, 4 unread');
    await fireEvent.press(bell);
    expect(push).toHaveBeenCalledWith('/notifications');
  });

  it('is plain "Notifications" when nothing is unread', async () => {
    const http = mockFetch(jsonResponse(200, { unread: 0 }));
    await renderApp(<NotificationBell />);
    await waitFor(() => expect(http.calls).toHaveLength(1));
    expect(screen.getByLabelText('Notifications')).toBeTruthy();
  });
});
