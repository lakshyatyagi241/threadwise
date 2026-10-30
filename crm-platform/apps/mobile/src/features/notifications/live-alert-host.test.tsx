import { REALTIME_EVENT } from '@crm/contracts';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { usePathname, useRouter } from 'expo-router';
import { initI18n } from '@/lib/i18n';
import { RealtimeProvider } from '@/lib/realtime';
import { fakeSocketFactory } from '@/test/fake-socket';
import {
  CONVERSATION_ID,
  deviceDown,
  newMessage,
  notificationPage,
  taskAssigned,
} from '@/test/notifications-fixtures';
import { renderApp } from '@/test/render';
import * as api from './api';
import { LiveAlertHost } from './live-alert-host';

jest.mock('./api');
jest.mock('expo-router', () => ({ useRouter: jest.fn(), usePathname: jest.fn() }));

const listCall = jest.mocked(api.listNotifications);
const readCall = jest.mocked(api.markNotificationRead);
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() };
const mint = jest.fn(async () => 'rtk_ticket-1234567890');

const created = (over: Record<string, unknown> = {}, seq = 1) => ({
  type: REALTIME_EVENT.notificationCreated,
  room: 'user',
  seq,
  payload: {
    notificationId: newMessage.id,
    type: 'new_message',
    unread: 4,
    subjectKind: 'conversation',
    subjectId: CONVERSATION_ID,
    collapsed: false,
    silent: false,
    ...over,
  },
});

async function show() {
  const { factory, sockets, last } = fakeSocketFactory();
  const view = await renderApp(
    <RealtimeProvider url="http://api.test/realtime" mintTicket={mint} createSocket={factory}>
      <LiveAlertHost />
    </RealtimeProvider>,
  );
  await waitFor(() => expect(sockets).toHaveLength(1));
  await act(async () => last().accept());
  return { ...view, socket: last };
}

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  jest.mocked(usePathname).mockReturnValue('/inbox');
  listCall.mockResolvedValue(notificationPage([newMessage, taskAssigned, deviceDown]));
  readCall.mockResolvedValue(newMessage);
});

describe('the alert for a new chat message', () => {
  it('drops down with the contact and the message, and has the bell read its count again', async () => {
    const { socket, queryClient } = await show();
    const invalidated = jest.spyOn(queryClient, 'invalidateQueries');
    expect(screen.queryByTestId('live-alert')).toBeNull();
    await act(async () => socket().push(created()));
    expect(await screen.findByText('3 new messages from Aarav Sharma')).toBeTruthy();
    expect(screen.getByText('Is the demo on Friday?')).toBeTruthy();
    expect(invalidated).toHaveBeenCalledWith({ queryKey: ['notifications', 'unread'] });
  });

  it('opens the chat, and marks the row read, when it is tapped', async () => {
    const { socket } = await show();
    await act(async () => socket().push(created()));
    await fireEvent.press(await screen.findByRole('button', { name: /Aarav Sharma/ }));
    await waitFor(() => expect(readCall).toHaveBeenCalledWith(newMessage.id, expect.anything()));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/conversation/[id]',
      params: { id: CONVERSATION_ID },
    });
    expect(screen.queryByTestId('live-alert')).toBeNull();
  });

  it('goes away with the cross, without opening anything', async () => {
    const { socket } = await show();
    await act(async () => socket().push(created()));
    await screen.findByTestId('live-alert');
    await fireEvent.press(screen.getByRole('button', { name: 'Dismiss this notification' }));
    expect(screen.queryByTestId('live-alert')).toBeNull();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('does not show for the chat the person is reading', async () => {
    jest.mocked(usePathname).mockReturnValue(`/conversation/${CONVERSATION_ID}`);
    const { socket } = await show();
    await act(async () => socket().push(created()));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 600)));
    expect(listCall).not.toHaveBeenCalled();
    expect(screen.queryByTestId('live-alert')).toBeNull();
  });

  it('does not show a silent event, one the person turned off, a mention, or a kind that is not a chat', async () => {
    const { socket, queryClient } = await show();
    const invalidated = jest.spyOn(queryClient, 'invalidateQueries');
    await act(async () => socket().push(created({ silent: true }, 1)));
    await act(async () => socket().push(created({ toast: false }, 2)));
    await act(async () =>
      socket().push(created({ type: 'device_disconnected', notificationId: deviceDown.id }, 3)),
    );
    await act(async () => socket().push(created({ type: 'mention' }, 4)));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 600)));
    expect(listCall).not.toHaveBeenCalled();
    expect(screen.queryByTestId('live-alert')).toBeNull();
    // The bell is read again for the kinds the app shows (the silent and the turned-off pop-ups), not for the hidden ones.
    expect(invalidated).toHaveBeenCalledTimes(4);
  });

  it('shows nothing when the row cannot be found any more', async () => {
    listCall.mockResolvedValue(notificationPage([taskAssigned]));
    const { socket } = await show();
    await act(async () => socket().push(created()));
    await waitFor(() => expect(listCall).toHaveBeenCalled());
    expect(screen.queryByTestId('live-alert')).toBeNull();
  });

  it('shows nothing, and does not break, when the rows cannot be read', async () => {
    listCall.mockRejectedValue(new Error('offline'));
    const { socket } = await show();
    await act(async () => socket().push(created()));
    await waitFor(() => expect(listCall).toHaveBeenCalled());
    expect(screen.queryByTestId('live-alert')).toBeNull();
  });
});
