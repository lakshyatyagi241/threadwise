import type { MessageResponse } from '@crm/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FlatList } from 'react-native';
import { ApiError } from '@/lib/api';
import { fetchSession } from '@/lib/session/api';
import {
  CONVERSATION_ID,
  detail,
  inboxSession,
  message,
  outgoing,
  summary,
  thread,
  withPermissions,
} from '@/test/inbox-fixtures';
import { renderApp } from '@/test/render';
import * as api from './api';
import { ThreadScreen } from './thread-screen';

jest.mock('./api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: jest.fn(),
    useLocalSearchParams: jest.fn(),
    // The screen is in front for the whole test.
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});

const sessionCall = jest.mocked(fetchSession);
const detailCall = jest.mocked(api.fetchConversation);
const messagesCall = jest.mocked(api.fetchMessages);
const sendCall = jest.mocked(api.sendTextMessage);
const readCall = jest.mocked(api.markConversationRead);
const statusCall = jest.mocked(api.setConversationStatus);
const retryCall = jest.mocked(api.retryMessage);
const back = jest.fn();

let client: QueryClient | undefined;
function show() {
  const view = renderApp(<ThreadScreen />);
  client = view.queryClient;
  // A finished mutation is otherwise kept for five minutes by a timer that holds the test process open.
  client.setDefaultOptions({ ...client.getDefaultOptions(), mutations: { gcTime: 0 } });
  return view;
}

const WINDOW_CLOSED = 'The 24-hour reply window is closed. Send a template instead.';

/** What the API answers; each test changes only what it is about. */
function arrange(
  over: {
    detail?: ReturnType<typeof detail>;
    messages?: MessageResponse[];
    hasMoreBefore?: boolean;
  } = {},
) {
  detailCall.mockResolvedValue(over.detail ?? detail());
  messagesCall.mockResolvedValue(
    thread(
      over.messages ?? [
        message(1),
        message(2, { body: 'Hello there' }),
        outgoing(3, { body: 'Hi Rohan' }),
      ],
      over.hasMoreBefore,
    ),
  );
  readCall.mockResolvedValue({ conversationId: CONVERSATION_ID, unreadCount: 0 });
}

async function loaded() {
  await screen.findByText('Hi Rohan');
}

const type = (text: string) => fireEvent.changeText(screen.getByLabelText('Message'), text);

beforeEach(() => {
  jest.resetAllMocks();
  client = undefined;
  jest.mocked(useRouter).mockReturnValue({ back } as unknown as ReturnType<typeof useRouter>);
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: CONVERSATION_ID });
  sessionCall.mockResolvedValue(inboxSession);
});
afterEach(async () => {
  if (client) {
    const cache = client;
    await waitFor(() => expect(cache.isFetching()).toBe(0));
  }
});

describe('ThreadScreen', () => {
  it('shows the conversation title, its status and the messages on the right side', async () => {
    arrange();
    show();
    await loaded();
    expect(screen.getByRole('header', { name: 'Rohan Mehta' })).toBeTruthy();
    expect(screen.getAllByText('Open').length).toBeGreaterThan(0);
    expect(screen.getByText('Hello there')).toBeTruthy();
    expect(screen.getByLabelText(/^Received: Hello there/)).toBeTruthy();
    expect(screen.getByLabelText(/^Sent by you: Hi Rohan, .*, Sent$/)).toBeTruthy();
  });

  it('goes back with the back button', async () => {
    arrange();
    show();
    await loaded();
    fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(back).toHaveBeenCalled();
  });

  it('names the kind of a message it cannot show yet', async () => {
    arrange({
      messages: [
        message(1, { kind: 'image', body: null }),
        message(2, { kind: 'template', body: 'Order shipped' }),
      ],
    });
    show();
    expect(await screen.findByText('Photo')).toBeTruthy();
    expect(screen.getByText('Template')).toBeTruthy();
    expect(screen.getByText('Order shipped')).toBeTruthy();
  });

  it('marks the thread read up to the newest message when it has unread messages', async () => {
    arrange({ detail: detail({ unreadCount: 2 }) });
    show();
    await loaded();
    await waitFor(() => expect(readCall).toHaveBeenCalledWith(CONVERSATION_ID, 3));
    expect(readCall).toHaveBeenCalledTimes(1);
  });

  it('does not mark a read thread read again', async () => {
    arrange({ detail: detail({ unreadCount: 0 }) });
    show();
    await loaded();
    expect(readCall).not.toHaveBeenCalled();
  });

  it('shows what was typed at once, then the stored message once the server answers', async () => {
    arrange();
    let accept: (m: MessageResponse) => void = () => undefined;
    sendCall.mockReturnValue(new Promise((resolve) => (accept = resolve)));
    show();
    await loaded();
    expect(screen.getByRole('button', { name: 'Send' }).props.accessibilityState.disabled).toBe(
      true,
    );
    type('See you at 5');
    fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    // The bubble is there before the server has answered, and the box is empty again.
    expect(await screen.findByText('See you at 5')).toBeTruthy();
    expect(screen.getByLabelText(/^Sent by you: See you at 5, .*, Sending$/)).toBeTruthy();
    expect(screen.getByLabelText('Message').props.value).toBe('');
    const [, clientMessageId, body] = sendCall.mock.calls[0] ?? [];
    expect(body).toBe('See you at 5');
    expect(clientMessageId).toMatch(/^[0-9a-f-]{36}$/);

    await act(async () =>
      accept(outgoing(4, { body: 'See you at 5', clientMessageId, status: 'queued' })),
    );
    await waitFor(() =>
      expect(screen.getByLabelText(/^Sent by you: See you at 5, .*, Sending$/)).toBeTruthy(),
    );
    // One bubble, not two.
    expect(screen.getAllByText('See you at 5')).toHaveLength(1);
    expect(screen.getByTestId('message-4')).toBeTruthy();
  });

  it('keeps Send off for a message that is only spaces or longer than the limit', async () => {
    arrange();
    show();
    await loaded();
    type('   ');
    expect(screen.getByRole('button', { name: 'Send' }).props.accessibilityState.disabled).toBe(
      true,
    );
    type('x'.repeat(4097));
    expect(screen.getByRole('button', { name: 'Send' }).props.accessibilityState.disabled).toBe(
      true,
    );
    expect(screen.getByText('Messages can be up to 4096 characters.')).toBeTruthy();
    type('x'.repeat(4096));
    expect(screen.getByRole('button', { name: 'Send' }).props.accessibilityState.disabled).toBe(
      false,
    );
  });

  it.each([
    ['SERVICE_WINDOW_CLOSED', 422, WINDOW_CLOSED],
    [
      'CHANNEL_DISCONNECTED',
      409,
      'This channel is disconnected. Reconnect it on the web, then try again.',
    ],
    ['PLAN_LIMIT_REACHED', 402, "Your plan's message limit has been reached."],
  ])('says why a send is refused with %s and gives the text back', async (code, status, words) => {
    arrange();
    sendCall.mockRejectedValue(new ApiError(status, code, 'refused'));
    show();
    await loaded();
    type('Hello again');
    fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(words)).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText('Message').props.value).toBe('Hello again'));
    expect(screen.queryByLabelText(/^Sent by you: Hello again/)).toBeNull();
  });

  it('keeps the bubble with a retry when the connection drops, and resends the same message once', async () => {
    arrange();
    sendCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    show();
    await loaded();
    type('Are you there?');
    fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(
      await screen.findByText("Can't reach the server. Check your connection and try again."),
    ).toBeTruthy();
    const firstId = sendCall.mock.calls[0]?.[1];
    sendCall.mockResolvedValueOnce(
      outgoing(4, { body: 'Are you there?', clientMessageId: firstId }),
    );
    fireEvent.press(await screen.findByRole('button', { name: 'Retry sending' }));
    await waitFor(() => expect(sendCall).toHaveBeenCalledTimes(2));
    expect(sendCall.mock.calls[1]?.[1]).toBe(firstId);
    expect(await screen.findByTestId('message-4')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry sending' })).toBeNull();
  });

  it('warns that the reply window is closed and switches typing off', async () => {
    arrange({ detail: detail({ window: { open: false, expiresAt: null } }) });
    show();
    await loaded();
    expect(await screen.findByText(WINDOW_CLOSED)).toBeTruthy();
    expect(screen.getByLabelText('Message').props.editable).toBe(false);
    expect(screen.getByRole('button', { name: 'Send' }).props.accessibilityState.disabled).toBe(
      true,
    );
  });

  it('has no box to answer in for a person who may only read', async () => {
    sessionCall.mockResolvedValue(withPermissions(['inbox.conversation.read']));
    arrange();
    show();
    await loaded();
    expect(screen.queryByLabelText('Message')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
  });

  it('asks the API for nothing without the read permission', async () => {
    sessionCall.mockResolvedValue(withPermissions(['dash.dashboard.read']));
    arrange();
    show();
    expect(await screen.findByText('No access to this conversation')).toBeTruthy();
    expect(detailCall).not.toHaveBeenCalled();
    expect(messagesCall).not.toHaveBeenCalled();
  });

  it('resolves an open conversation with the row version it read', async () => {
    arrange();
    statusCall.mockResolvedValue(summary({ status: 'resolved', rowVersion: 5 }));
    show();
    await loaded();
    detailCall.mockResolvedValue(detail({ status: 'resolved', rowVersion: 5 }));
    fireEvent.press(screen.getByRole('button', { name: 'Resolve' }));
    await waitFor(() =>
      expect(statusCall).toHaveBeenCalledWith(CONVERSATION_ID, {
        rowVersion: 4,
        status: 'resolved',
      }),
    );
    // The header now offers to reopen it.
    expect(await screen.findByRole('button', { name: 'Reopen' })).toBeTruthy();
    expect(screen.getByText('Resolved')).toBeTruthy();
  });

  it('reopens a resolved conversation', async () => {
    arrange({ detail: detail({ status: 'resolved' }) });
    statusCall.mockResolvedValue(summary({ status: 'open', rowVersion: 5 }));
    show();
    await loaded();
    fireEvent.press(await screen.findByRole('button', { name: 'Reopen' }));
    await waitFor(() =>
      expect(statusCall).toHaveBeenCalledWith(CONVERSATION_ID, { rowVersion: 4, status: 'open' }),
    );
  });

  it('tells the person about a row version conflict and reads the conversation again', async () => {
    arrange();
    statusCall.mockRejectedValue(new ApiError(409, 'ROW_VERSION_CONFLICT', 'stale'));
    show();
    await loaded();
    expect(detailCall).toHaveBeenCalledTimes(1);
    detailCall.mockResolvedValue(detail({ rowVersion: 9 }));
    fireEvent.press(screen.getByRole('button', { name: 'Resolve' }));
    expect(
      await screen.findByText(
        'Someone else changed this conversation. The latest version is loaded, please try again.',
      ),
    ).toBeTruthy();
    await waitFor(() => expect(detailCall).toHaveBeenCalledTimes(2));
    // The next press carries the new version.
    statusCall.mockResolvedValue(summary({ status: 'resolved', rowVersion: 10 }));
    fireEvent.press(screen.getByRole('button', { name: 'Resolve' }));
    await waitFor(() =>
      expect(statusCall).toHaveBeenLastCalledWith(CONVERSATION_ID, {
        rowVersion: 9,
        status: 'resolved',
      }),
    );
  });

  it('loads earlier messages before the oldest one it has', async () => {
    arrange({ messages: [message(31), message(32, { body: 'Newest here' })], hasMoreBefore: true });
    show();
    await screen.findByText('Newest here');
    messagesCall.mockResolvedValueOnce(thread([message(30, { body: 'Older one' })], false));
    act(() => {
      screen.UNSAFE_getByType(FlatList).props.onEndReached();
    });
    expect(await screen.findByText('Older one')).toBeTruthy();
    expect(messagesCall).toHaveBeenLastCalledWith(CONVERSATION_ID, 31, expect.anything());
  });

  it('puts a failed message back in the queue from its retry button', async () => {
    const failed = outgoing(3, {
      body: 'Did not go',
      status: 'failed',
      failure: { code: '131047', reason: 'x' },
    });
    arrange({ messages: [message(1), failed] });
    retryCall.mockResolvedValue({ ...failed, status: 'queued' });
    show();
    await screen.findByText('Did not go');
    fireEvent.press(screen.getByRole('button', { name: 'Retry sending' }));
    await waitFor(() => expect(retryCall).toHaveBeenCalledWith(failed.id));
  });

  it('says so when the conversation cannot be loaded, and loads it on retry', async () => {
    arrange();
    detailCall.mockRejectedValueOnce(new ApiError(404, 'CONVERSATION_NOT_FOUND', 'gone'));
    show();
    expect(await screen.findByText('This conversation is no longer available.')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await loaded();
  });
});
