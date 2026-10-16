import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { ApiError } from '@/lib/api';
import { initI18n } from '@/lib/i18n';
import { renderApp } from '@/test/render';
import { reachEnd } from '@/test/scroll';
import {
  CONVERSATION_ID,
  TASK_ID,
  deviceDown,
  feed,
  futureType,
  newMessage,
  notificationPage,
  taskAssigned,
} from '@/test/notifications-fixtures';
import * as api from './api';
import { NotificationsScreen } from './notifications-screen';

jest.mock('./api');
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

const listCall = jest.mocked(api.listNotifications);
const readCall = jest.mocked(api.markNotificationRead);
const readAllCall = jest.mocked(api.markAllNotificationsRead);
const dismissCall = jest.mocked(api.dismissNotification);
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() };

let client: QueryClient | undefined;
async function show() {
  const view = await renderApp(<NotificationsScreen />);
  client = view.queryClient;
  return view;
}

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(() => {
  jest.resetAllMocks();
  client = undefined;
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  router.canGoBack.mockReturnValue(true);
  listCall.mockResolvedValue(notificationPage(feed, { unread: 3 }));
});
afterEach(async () => {
  if (client) {
    const cache = client;
    await waitFor(() => expect(cache.isFetching()).toBe(0));
  }
});

describe('NotificationsScreen', () => {
  it("lists the person's notifications in day sections, in their own words", async () => {
    await show();
    expect(await screen.findByText('3 new messages from Aarav Sharma')).toBeTruthy();
    expect(screen.getByText('Is the demo on Friday?')).toBeTruthy();
    expect(screen.getByText('Task assigned to you')).toBeTruthy();
    expect(screen.getByText('Sales line disconnected')).toBeTruthy();
    expect(screen.getAllByRole('header').length).toBeGreaterThan(1);
    expect(listCall).toHaveBeenCalledWith(
      { limit: 30, cursor: undefined, unreadOnly: false },
      expect.anything(),
    );
  });

  it("shows the server's English for a type the app has no words for", async () => {
    await show();
    expect(await screen.findByText('Quote expired')).toBeTruthy();
    expect(screen.getByText('The quote for Acme expired today.')).toBeTruthy();
  });

  it('marks unread rows with a dot, and announces them to a screen reader', async () => {
    await show();
    await screen.findByText('Quote expired');
    expect(screen.getAllByTestId('notification-unread-dot')).toHaveLength(
      feed.filter((r) => r.readAt === null).length,
    );
    expect(screen.getByLabelText(/^Unread\. 3 new messages from Aarav Sharma/)).toBeTruthy();
  });

  it('opens a chat notification: marks it read and goes to the thread', async () => {
    readCall.mockResolvedValue({ ...newMessage, readAt: '2026-10-16T10:00:00.000Z' });
    await show();
    await fireEvent.press(await screen.findByLabelText(/3 new messages from Aarav Sharma/));
    await waitFor(() => expect(readCall).toHaveBeenCalledWith(newMessage.id, expect.any(String)));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/conversation/[id]',
      params: { id: CONVERSATION_ID },
    });
  });

  it('opens a task notification without marking an already read row read again', async () => {
    await show();
    await fireEvent.press(await screen.findByLabelText(/Task assigned to you/));
    expect(readCall).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith({ pathname: '/task/[id]', params: { id: TASK_ID } });
  });

  it('a row with no screen in the app is only marked read', async () => {
    readCall.mockResolvedValue({ ...deviceDown, readAt: '2026-10-16T10:00:00.000Z' });
    await show();
    await fireEvent.press(await screen.findByLabelText(/Sales line disconnected/));
    await waitFor(() => expect(readCall).toHaveBeenCalledWith(deviceDown.id, expect.any(String)));
    expect(router.push).not.toHaveBeenCalled();
  });

  it('removes a row from the list when it is dismissed', async () => {
    dismissCall.mockResolvedValue({ deleted: 1 });
    await show();
    await screen.findByText('Quote expired');
    const buttons = screen.getAllByLabelText('Dismiss this notification');
    await fireEvent.press(buttons[1]);
    await waitFor(() =>
      expect(dismissCall).toHaveBeenCalledWith(futureType.id, expect.any(String)),
    );
    await waitFor(() => expect(screen.queryByText('Quote expired')).toBeNull());
  });

  it('treats a row that is already gone as dismissed', async () => {
    dismissCall.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Not found'));
    await show();
    await screen.findByText('Quote expired');
    await fireEvent.press(screen.getAllByLabelText('Dismiss this notification')[1]);
    await waitFor(() => expect(screen.queryByText('Quote expired')).toBeNull());
  });

  it('marks everything read from the header, only while something is unread', async () => {
    readAllCall.mockResolvedValue({ updated: 3 });
    await show();
    await fireEvent.press(await screen.findByLabelText('Mark all read'));
    await waitFor(() => expect(readAllCall).toHaveBeenCalled());
    await waitFor(() => expect(listCall.mock.calls.length).toBeGreaterThan(1));
  });

  it('hides Mark all read when nothing is unread', async () => {
    listCall.mockResolvedValue(notificationPage([taskAssigned], { unread: 0 }));
    await show();
    await screen.findByText('Task assigned to you');
    expect(screen.queryByLabelText('Mark all read')).toBeNull();
  });

  it('asks the API for unread only when the Unread switch is chosen', async () => {
    await show();
    await screen.findByText('Quote expired');
    listCall.mockResolvedValue(notificationPage([newMessage], { unread: 1 }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Unread' }));
    await waitFor(() =>
      expect(listCall).toHaveBeenLastCalledWith(
        { limit: 30, cursor: undefined, unreadOnly: true },
        expect.anything(),
      ),
    );
    await waitFor(() => expect(screen.queryByText('Task assigned to you')).toBeNull());
  });

  it('says so when there is nothing yet, and when the Unread view is empty', async () => {
    listCall.mockResolvedValue(notificationPage([]));
    await show();
    expect(await screen.findByText('No notifications yet')).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'Unread' }));
    expect(await screen.findByText('No notifications match these filters')).toBeTruthy();
  });

  it('shows the error with a retry when the first page cannot be loaded', async () => {
    listCall.mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'boom'));
    await show();
    expect(await screen.findByRole('alert')).toBeTruthy();
    listCall.mockResolvedValue(notificationPage(feed));
    await fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByText('Quote expired')).toBeTruthy();
  });

  it('loads the next page at the end of the list', async () => {
    listCall
      .mockResolvedValueOnce(notificationPage([newMessage], { nextCursor: 'c-2' }))
      .mockResolvedValueOnce(notificationPage([taskAssigned]));
    await show();
    await screen.findByText('3 new messages from Aarav Sharma');
    await act(async () => {
      await reachEnd(screen.getByTestId('notifications-list'));
    });
    await waitFor(() =>
      expect(listCall).toHaveBeenLastCalledWith(
        { limit: 30, cursor: 'c-2', unreadOnly: false },
        expect.anything(),
      ),
    );
    expect(await screen.findByText('Task assigned to you')).toBeTruthy();
  });

  it('goes back to where it was opened from', async () => {
    await show();
    await fireEvent.press(await screen.findByLabelText('Back'));
    expect(router.back).toHaveBeenCalled();
    router.canGoBack.mockReturnValue(false);
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(router.replace).toHaveBeenCalledWith('/menu');
  });
});
