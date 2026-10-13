import type { InboxTemplateOption, MessageResponse } from '@crm/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';
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
import { reachEnd } from '@/test/scroll';
import * as api from './api';
import * as labels from './labels-api';
import * as notesApi from './notes-api';
import * as savedApi from './saved-replies-api';
import { ThreadScreen } from './thread-screen';

jest.mock('./api');
jest.mock('./labels-api');
jest.mock('./notes-api');
jest.mock('./saved-replies-api');
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
const templatesCall = jest.mocked(api.fetchInboxTemplates);
const sendTemplateCall = jest.mocked(api.sendTemplateMessage);
const readCall = jest.mocked(api.markConversationRead);
const statusCall = jest.mocked(api.setConversationStatus);
const retryCall = jest.mocked(api.retryMessage);
const assignCall = jest.mocked(api.assignConversation);
const assigneesCall = jest.mocked(api.fetchAssignees);
const notesCall = jest.mocked(notesApi.fetchNotes);
const addNoteCall = jest.mocked(notesApi.addNote);
const repliesCall = jest.mocked(savedApi.fetchSavedReplies);
const fillCall = jest.mocked(savedApi.fillSavedReply);
const priorityCall = jest.mocked(api.setConversationPriority);
const snoozeCall = jest.mocked(api.snoozeConversation);
const libraryCall = jest.mocked(labels.fetchLabelLibrary);
const applyCall = jest.mocked(labels.applyLabel);
const withdrawCall = jest.mocked(labels.withdrawLabel);
const back = jest.fn();

let client: QueryClient | undefined;
async function show() {
  const view = await renderApp(<ThreadScreen />);
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
  // The thread shows the private notes between the messages; most tests have none.
  notesCall.mockResolvedValue({ data: [], page: { nextCursor: null, hasMore: false, limit: 100 } });
}

async function loaded() {
  await screen.findByText('Hi Rohan');
}

const type = async (text: string) =>
  await fireEvent.changeText(screen.getByLabelText('Message'), text);

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
  it('shows who the conversation is with, its channel and the messages on the right side', async () => {
    arrange();
    await show();
    await loaded();
    expect(screen.getByRole('header', { name: 'Rohan Mehta' })).toBeTruthy();
    // The channel is named by its kind; an open conversation does not repeat "Open" (a thread in any other status says so).
    expect(screen.getByText('WhatsApp')).toBeTruthy();
    expect(screen.queryByText('Open')).toBeNull();
    expect(screen.getByText('Hello there')).toBeTruthy();
    expect(screen.getByLabelText(/^Received: Hello there/)).toBeTruthy();
    expect(screen.getByLabelText(/^Sent by you: Hi Rohan, .*, Sent$/)).toBeTruthy();
  });

  it('draws an empty conversation right way up, as a plain view and not in the inverted list', async () => {
    arrange({ messages: [] });
    await show();
    const title = await screen.findByText('No messages yet');
    expect(screen.queryByTestId('thread-list')).toBeNull();
    // An inverted list flips its empty slot with a flip that differs per platform (Android drew the text upside down), so nothing
    // above the empty state may carry a flip.
    for (let node = title.parent; node; node = node.parent) {
      const style = StyleSheet.flatten(node.props.style) as { transform?: unknown } | undefined;
      expect(style?.transform).toBeUndefined();
    }
  });

  it('goes back with the back button', async () => {
    arrange();
    await show();
    await loaded();
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(back).toHaveBeenCalled();
  });

  it('names the kind of a message it cannot show yet', async () => {
    arrange({
      messages: [
        message(1, { kind: 'image', body: null }),
        message(2, { kind: 'template', body: 'Order shipped' }),
      ],
    });
    await show();
    expect(await screen.findByText('Photo')).toBeTruthy();
    expect(screen.getByText('Template')).toBeTruthy();
    expect(screen.getByText('Order shipped')).toBeTruthy();
  });

  it('marks the thread read up to the newest message when it has unread messages', async () => {
    arrange({ detail: detail({ unreadCount: 2 }) });
    await show();
    await loaded();
    await waitFor(() => expect(readCall).toHaveBeenCalledWith(CONVERSATION_ID, 3));
    expect(readCall).toHaveBeenCalledTimes(1);
  });

  it('does not mark a read thread read again', async () => {
    arrange({ detail: detail({ unreadCount: 0 }) });
    await show();
    await loaded();
    expect(readCall).not.toHaveBeenCalled();
  });

  it('shows what was typed at once, then the stored message once the server answers', async () => {
    arrange();
    let accept: (m: MessageResponse) => void = () => undefined;
    sendCall.mockReturnValue(new Promise((resolve) => (accept = resolve)));
    await show();
    await loaded();
    expect(screen.getByRole('button', { name: 'Send' }).props.accessibilityState.disabled).toBe(
      true,
    );
    await type('See you at 5');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
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
    await show();
    await loaded();
    await type('   ');
    expect(screen.getByRole('button', { name: 'Send' }).props.accessibilityState.disabled).toBe(
      true,
    );
    await type('x'.repeat(4097));
    expect(screen.getByRole('button', { name: 'Send' }).props.accessibilityState.disabled).toBe(
      true,
    );
    expect(screen.getByText('Messages can be up to 4096 characters.')).toBeTruthy();
    await type('x'.repeat(4096));
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
    await show();
    await loaded();
    await type('Hello again');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByText(words)).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText('Message').props.value).toBe('Hello again'));
    expect(screen.queryByLabelText(/^Sent by you: Hello again/)).toBeNull();
  });

  it('keeps the bubble with a retry when the connection drops, and resends the same message once', async () => {
    arrange();
    sendCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    await show();
    await loaded();
    await type('Are you there?');
    await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
    expect(
      await screen.findByText("Can't reach the server. Check your connection and try again."),
    ).toBeTruthy();
    const firstId = sendCall.mock.calls[0]?.[1];
    sendCall.mockResolvedValueOnce(
      outgoing(4, { body: 'Are you there?', clientMessageId: firstId }),
    );
    await fireEvent.press(await screen.findByRole('button', { name: 'Retry sending' }));
    await waitFor(() => expect(sendCall).toHaveBeenCalledTimes(2));
    expect(sendCall.mock.calls[1]?.[1]).toBe(firstId);
    expect(await screen.findByTestId('message-4')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry sending' })).toBeNull();
  });

  describe('when the 24-hour reply window is closed', () => {
    const CLOSED = { window: { open: false, expiresAt: null } } as const;
    const NOTICE =
      'The customer has not spoken to you in the last 24 hours. You can only send pre-approved templates.';
    const option = (over: Partial<InboxTemplateOption> = {}): InboxTemplateOption => ({
      id: '22222222-2222-4222-8222-222222222222',
      name: 'order_update',
      language: 'en',
      category: 'UTILITY',
      header: null,
      body: 'Your order is on the way.',
      footer: null,
      buttons: [],
      slots: [],
      sendable: true,
      reason: null,
      ...over,
    });
    const offer = (data: InboxTemplateOption[], hasMore = false) =>
      templatesCall.mockResolvedValue({ data, hasMore });
    const open = async () => {
      arrange({ detail: detail(CLOSED) });
      await show();
      await loaded();
      await fireEvent.press(await screen.findByRole('button', { name: 'Send Template' }));
    };

    it('shows the reason and a Send Template button instead of the message box', async () => {
      arrange({ detail: detail(CLOSED) });
      await show();
      await loaded();
      expect(await screen.findByText(NOTICE)).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Send Template' })).toBeTruthy();
      expect(screen.queryByLabelText('Message')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    });

    it('shows the message box, not the template bar, while the window is open', async () => {
      arrange();
      await show();
      await loaded();
      expect(screen.getByLabelText('Message')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Send Template' })).toBeNull();
    });

    it('lists the templates of the number, greying out the ones the app cannot fill in with the reason', async () => {
      offer([
        option(),
        option({
          id: '33333333-3333-4333-8333-333333333333',
          name: 'photo_offer',
          sendable: false,
          reason: 'media_header',
        }),
      ]);
      await open();
      expect(await screen.findByRole('button', { name: 'order_update' })).toBeTruthy();
      const blocked = screen.getByRole('button', { name: 'photo_offer' });
      expect(blocked.props.accessibilityState.disabled).toBe(true);
      expect(
        screen.getByText("Has an image, video or document header, which the app can't send yet."),
      ).toBeTruthy();
      expect(templatesCall).toHaveBeenCalledWith(CONVERSATION_ID, '', expect.anything());
    });

    it('sends a template with no variables as soon as it is pressed, then closes the list', async () => {
      offer([option()]);
      sendTemplateCall.mockResolvedValue(outgoing(4, { body: 'Your order is on the way.' }));
      await open();
      await fireEvent.press(await screen.findByRole('button', { name: 'order_update' }));
      await waitFor(() =>
        expect(sendTemplateCall).toHaveBeenCalledWith(
          CONVERSATION_ID,
          expect.any(String),
          '22222222-2222-4222-8222-222222222222',
          {},
        ),
      );
      await waitFor(() => expect(screen.queryByText('Send a template')).toBeNull());
    });

    it('asks for each variable first, and sends them by their key once all are filled', async () => {
      offer([
        option({
          name: 'welcome',
          body: 'Hello {{1}}, your code is {{2}}.',
          slots: [
            { key: '1', label: 'Name', example: 'Rohan' },
            { key: '2', label: 'Code', example: null },
          ],
        }),
      ]);
      sendTemplateCall.mockResolvedValue(outgoing(4, { body: 'Hello Rohan, your code is 42.' }));
      await open();
      await fireEvent.press(await screen.findByRole('button', { name: 'welcome' }));
      expect(sendTemplateCall).not.toHaveBeenCalled();
      const submit = screen.getByRole('button', { name: 'Send' });
      expect(submit.props.accessibilityState.disabled).toBe(true);
      await fireEvent.changeText(screen.getByLabelText('Name'), 'Rohan');
      expect(screen.getByRole('button', { name: 'Send' }).props.accessibilityState.disabled).toBe(
        true,
      );
      await fireEvent.changeText(screen.getByLabelText('Code'), '42');
      await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
      await waitFor(() =>
        expect(sendTemplateCall).toHaveBeenCalledWith(
          CONVERSATION_ID,
          expect.any(String),
          '22222222-2222-4222-8222-222222222222',
          { '1': 'Rohan', '2': '42' },
        ),
      );
    });

    it('says why when the server refuses the template, and keeps the list open', async () => {
      offer([option()]);
      sendTemplateCall.mockRejectedValue(
        new ApiError(422, 'CHANNEL_DISCONNECTED', 'This channel is not connected'),
      );
      await open();
      await fireEvent.press(await screen.findByRole('button', { name: 'order_update' }));
      expect(
        await screen.findByText(
          'This channel is disconnected. Reconnect it on the web, then try again.',
        ),
      ).toBeTruthy();
      expect(screen.getByText('Send a template')).toBeTruthy();
    });

    it('sends the search words to the API and says when more templates exist', async () => {
      offer([option()], true);
      await open();
      expect(await screen.findByText(/There are more templates/)).toBeTruthy();
      await fireEvent.changeText(screen.getByLabelText('Search templates'), 'promo');
      await waitFor(() =>
        expect(templatesCall).toHaveBeenLastCalledWith(CONVERSATION_ID, 'promo', expect.anything()),
      );
    });

    it('says the number has no approved templates when the list is empty', async () => {
      offer([]);
      await open();
      expect(await screen.findByText('No approved templates for this number yet.')).toBeTruthy();
    });

    it('says no template matches when a search finds nothing', async () => {
      offer([option()]);
      await open();
      await screen.findByRole('button', { name: 'order_update' });
      offer([]);
      await fireEvent.changeText(screen.getByLabelText('Search templates'), 'zzz');
      expect(await screen.findByText('No templates match your search.')).toBeTruthy();
    });
  });

  it('has no box to answer in for a person who may only read', async () => {
    sessionCall.mockResolvedValue(withPermissions(['inbox.conversation.read']));
    arrange();
    await show();
    await loaded();
    expect(screen.queryByLabelText('Message')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Resolve' })).toBeNull();
  });

  it('asks the API for nothing without the read permission', async () => {
    sessionCall.mockResolvedValue(withPermissions(['dash.dashboard.read']));
    arrange();
    await show();
    expect(await screen.findByText('No access to this conversation')).toBeTruthy();
    expect(detailCall).not.toHaveBeenCalled();
    expect(messagesCall).not.toHaveBeenCalled();
  });

  it('resolves an open conversation with the row version it read', async () => {
    arrange();
    statusCall.mockResolvedValue(summary({ status: 'resolved', rowVersion: 5 }));
    await show();
    await loaded();
    detailCall.mockResolvedValue(detail({ status: 'resolved', rowVersion: 5 }));
    await fireEvent.press(screen.getByRole('button', { name: 'Resolve' }));
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
    await show();
    await loaded();
    await fireEvent.press(await screen.findByRole('button', { name: 'Reopen' }));
    await waitFor(() =>
      expect(statusCall).toHaveBeenCalledWith(CONVERSATION_ID, { rowVersion: 4, status: 'open' }),
    );
  });

  it('tells the person about a row version conflict and reads the conversation again', async () => {
    arrange();
    statusCall.mockRejectedValue(new ApiError(409, 'ROW_VERSION_CONFLICT', 'stale'));
    await show();
    await loaded();
    expect(detailCall).toHaveBeenCalledTimes(1);
    detailCall.mockResolvedValue(detail({ rowVersion: 9 }));
    await fireEvent.press(screen.getByRole('button', { name: 'Resolve' }));
    expect(
      await screen.findByText(
        'Someone else changed this conversation. The latest version is loaded, please try again.',
      ),
    ).toBeTruthy();
    await waitFor(() => expect(detailCall).toHaveBeenCalledTimes(2));
    // The next press carries the new version.
    statusCall.mockResolvedValue(summary({ status: 'resolved', rowVersion: 10 }));
    await fireEvent.press(screen.getByRole('button', { name: 'Resolve' }));
    await waitFor(() =>
      expect(statusCall).toHaveBeenLastCalledWith(CONVERSATION_ID, {
        rowVersion: 9,
        status: 'resolved',
      }),
    );
  });

  it('loads earlier messages before the oldest one it has', async () => {
    arrange({ messages: [message(31), message(32, { body: 'Newest here' })], hasMoreBefore: true });
    await show();
    await screen.findByText('Newest here');
    messagesCall.mockResolvedValueOnce(thread([message(30, { body: 'Older one' })], false));
    await reachEnd(screen.getByTestId('thread-list'));
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
    await show();
    await screen.findByText('Did not go');
    await fireEvent.press(screen.getByRole('button', { name: 'Retry sending' }));
    await waitFor(() => expect(retryCall).toHaveBeenCalledWith(failed.id));
  });

  it('says so when the conversation cannot be loaded, and loads it on retry', async () => {
    arrange();
    detailCall.mockRejectedValueOnce(new ApiError(404, 'CONVERSATION_NOT_FOUND', 'gone'));
    await show();
    expect(await screen.findByText('This conversation is no longer available.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    await loaded();
  });
});

// --- the Geta-style header, menu, bot bar and labels ---------------------------------------------------------------------------

const ME = inboxSession.user.id;
const OTHER_USER = '22222222-2222-4222-8222-222222222222';
const AI_AGENT = '77777777-7777-4777-8777-777777777777';
const BASE = ['inbox.conversation.read', 'inbox.conversation.reply', 'inbox.conversation.resolve'];
const as = (...extra: string[]) =>
  sessionCall.mockResolvedValue(withPermissions([...BASE, ...extra]));
const assigned = (id: string) => ({ user: { id, name: 'Someone' }, team: null, aiAgent: null });
const minutesAhead = (minutes: number) =>
  new Date(Date.now() + minutes * 60_000 + 30_000).toISOString();
/** A label as the conversation carries it, and as the library lists it. */
const label = (id: string, name: string) => ({ id, name, color: null });
const inLibrary = (l: ReturnType<typeof label>) => ({
  ...l,
  description: null,
  conversationCount: 1,
  rowVersion: 1,
});
const VIP = label('aaaaaaaa-0000-4000-8000-000000000001', 'VIP');
const COLD = label('aaaaaaaa-0000-4000-8000-000000000002', 'Cold');

describe('ThreadScreen: the header', () => {
  it('shows the reply window as a ring with the time left, and says it to a screen reader', async () => {
    arrange({ detail: detail({ window: { open: true, expiresAt: minutesAhead(99) } }) });
    await show();
    await loaded();
    expect(screen.getByText('1:39')).toBeTruthy();
    expect(screen.getByLabelText('Reply window: 1 h 39 min left')).toBeTruthy();
    // 99 minutes of 24 hours: a few of the 48 bars are lit.
    expect(screen.getAllByTestId('timer-tick-on')).toHaveLength(4);
  });

  it('shows an empty ring and says so when the window has closed', async () => {
    const past = new Date(Date.now() - 3_600_000).toISOString();
    arrange({ detail: detail({ window: { open: false, expiresAt: past } }) });
    await show();
    await loaded();
    expect(screen.getByText('0:00')).toBeTruthy();
    expect(screen.getByLabelText('Reply window closed')).toBeTruthy();
    expect(screen.queryAllByTestId('timer-tick-on')).toHaveLength(0);
  });

  it('draws no timer for a channel with no reply window', async () => {
    arrange({ detail: detail({ window: { open: true, expiresAt: null } }) });
    await show();
    await loaded();
    expect(screen.queryByText(/^\d+:\d\d$/)).toBeNull();
  });

  it('says so in the header when the conversation is not open', async () => {
    arrange({ detail: detail({ status: 'pending' }) });
    await show();
    await loaded();
    expect(screen.getByText('Pending')).toBeTruthy();
  });
});

describe('ThreadScreen: the three dots', () => {
  const dots = () => screen.findByRole('button', { name: 'More actions' });
  const choose = async (name: string) =>
    await fireEvent.press(await screen.findByRole('menuitem', { name }));

  it('lists what can be done with the conversation, for what the person may do', async () => {
    as('inbox.conversation.assign');
    arrange({ detail: detail({ assignment: assigned(OTHER_USER) }) });
    await show();
    await loaded();
    await fireEvent.press(await dots());
    for (const name of ['Assign to me', 'Unassign', 'Mark as pending', 'Close conversation']) {
      expect(await screen.findByRole('menuitem', { name })).toBeTruthy();
    }
  });

  it('claims the conversation for the person, with the row version it read', async () => {
    as('inbox.conversation.assign_self');
    arrange({ detail: detail({ assignment: assigned(OTHER_USER) }) });
    assignCall.mockResolvedValue(summary({ rowVersion: 5 }));
    await show();
    await loaded();
    await fireEvent.press(await dots());
    // A person who may only claim is not offered "Unassign".
    expect(screen.queryByRole('menuitem', { name: 'Unassign' })).toBeNull();
    await choose('Assign to me');
    await waitFor(() =>
      expect(assignCall).toHaveBeenCalledWith(
        CONVERSATION_ID,
        { rowVersion: 4, userId: ME },
        expect.any(String),
      ),
    );
  });

  it('takes the conversation from the person who has it', async () => {
    as('inbox.conversation.assign');
    arrange({ detail: detail({ assignment: assigned(ME) }) });
    assignCall.mockResolvedValue(summary({ rowVersion: 5 }));
    await show();
    await loaded();
    await fireEvent.press(await dots());
    expect(screen.queryByRole('menuitem', { name: 'Assign to me' })).toBeNull();
    await choose('Unassign');
    await waitFor(() =>
      expect(assignCall).toHaveBeenCalledWith(
        CONVERSATION_ID,
        { rowVersion: 4, userId: null },
        expect.any(String),
      ),
    );
  });

  it('parks the conversation as pending, and closes it', async () => {
    as();
    arrange();
    statusCall.mockResolvedValue(summary({ status: 'pending', rowVersion: 5 }));
    await show();
    await loaded();
    await fireEvent.press(await dots());
    await choose('Mark as pending');
    await waitFor(() =>
      expect(statusCall).toHaveBeenCalledWith(CONVERSATION_ID, {
        rowVersion: 4,
        status: 'pending',
      }),
    );
    await fireEvent.press(await dots());
    await choose('Close conversation');
    await waitFor(() =>
      expect(statusCall).toHaveBeenLastCalledWith(CONVERSATION_ID, {
        rowVersion: 4,
        status: 'closed',
      }),
    );
  });

  it('says why a change was refused', async () => {
    as();
    arrange();
    statusCall.mockRejectedValue(new ApiError(409, 'ROW_VERSION_CONFLICT', 'stale'));
    await show();
    await loaded();
    await fireEvent.press(await dots());
    await choose('Close conversation');
    expect(await screen.findByText(/Someone else changed this conversation/)).toBeTruthy();
  });

  it('offers only the chat details to a person who may neither assign nor resolve', async () => {
    sessionCall.mockResolvedValue(
      withPermissions(['inbox.conversation.read', 'inbox.conversation.reply']),
    );
    arrange();
    await show();
    await loaded();
    await fireEvent.press(await dots());
    expect(await screen.findByRole('menuitem', { name: 'Chat details' })).toBeTruthy();
    for (const name of ['Assign to me', 'Change agent', 'Unassign', 'Mark as pending']) {
      expect(screen.queryByRole('menuitem', { name })).toBeNull();
    }
  });
});

describe('ThreadScreen: a conversation an AI agent has', () => {
  const bot = { user: null, team: null, aiAgent: { id: AI_AGENT, name: 'Sales bot' } };

  it('says it is a bot conversation in place of the message box, and offers to take it over', async () => {
    as('inbox.conversation.assign_self');
    arrange({ detail: detail({ assignment: bot }) });
    assignCall.mockResolvedValue(summary({ rowVersion: 5 }));
    await show();
    await loaded();
    expect(await screen.findByText('This is a bot conversation.')).toBeTruthy();
    expect(screen.queryByLabelText('Message')).toBeNull();
    // Taking it over: the box comes back once a person has the conversation.
    detailCall.mockResolvedValue(
      detail({ assignment: { ...bot, user: { id: ME, name: 'Asha Verma' } }, rowVersion: 5 }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Assign to yourself' }));
    await waitFor(() =>
      expect(assignCall).toHaveBeenCalledWith(
        CONVERSATION_ID,
        { rowVersion: 4, userId: ME },
        expect.any(String),
      ),
    );
    expect(await screen.findByLabelText('Message')).toBeTruthy();
    expect(screen.queryByText('This is a bot conversation.')).toBeNull();
  });

  it('only says so, with no button, to a person who may not take conversations', async () => {
    as();
    arrange({ detail: detail({ assignment: bot }) });
    await show();
    await loaded();
    expect(await screen.findByText('This is a bot conversation.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Assign to yourself' })).toBeNull();
    expect(screen.queryByLabelText('Message')).toBeNull();
  });

  it('keeps the message box for a conversation nobody and no bot has', async () => {
    as('inbox.conversation.assign_self');
    arrange();
    await show();
    await loaded();
    expect(screen.getByLabelText('Message')).toBeTruthy();
    expect(screen.queryByText('This is a bot conversation.')).toBeNull();
  });
});

describe('ThreadScreen: labels', () => {
  const withVip = () => detail({ labels: [VIP], rowVersion: 7 });
  const open = async () =>
    await fireEvent.press(await screen.findByRole('button', { name: 'Assign labels' }));

  beforeEach(() => {
    libraryCall.mockResolvedValue([inLibrary(VIP), inLibrary(COLD)]);
  });

  it('is offered to a person who may label conversations, and shows the labels the thread has', async () => {
    as('inbox.conversation.tag');
    arrange({ detail: withVip() });
    await show();
    await loaded();
    const button = await screen.findByRole('button', { name: 'Assign labels' });
    expect(button.props.accessibilityValue).toEqual({ text: 'VIP' });
    // Nothing is asked of the API until the sheet opens.
    expect(libraryCall).not.toHaveBeenCalled();
  });

  it('is offered for a conversation that has no contact yet', async () => {
    as('inbox.conversation.tag');
    arrange();
    await show();
    await loaded();
    expect(await screen.findByRole('button', { name: 'Assign labels' })).toBeTruthy();
  });

  it('is not offered without the permission to label, whatever else the person may do', async () => {
    as('record.contacts.update', 'record.tags.read', 'record.tags.create');
    arrange();
    await show();
    await loaded();
    expect(screen.queryByRole('button', { name: 'Assign labels' })).toBeNull();
  });

  it('ticks the labels the conversation has, and puts one on or takes one off', async () => {
    as('inbox.conversation.tag');
    arrange({ detail: withVip() });
    applyCall.mockResolvedValue(summary({ labels: [VIP, COLD], rowVersion: 8 }));
    withdrawCall.mockResolvedValue(summary({ labels: [], rowVersion: 9 }));
    await show();
    await loaded();
    await open();
    const vip = await screen.findByRole('checkbox', { name: 'VIP' });
    expect(vip.props.accessibilityState.checked).toBe(true);
    expect(screen.getByRole('checkbox', { name: 'Cold' }).props.accessibilityState.checked).toBe(
      false,
    );
    // What the API answers when the thread is read again after the change.
    detailCall.mockResolvedValue(detail({ labels: [VIP, COLD], rowVersion: 8 }));
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Cold' }));
    await waitFor(() =>
      expect(applyCall).toHaveBeenCalledWith(
        CONVERSATION_ID,
        { tagId: COLD.id },
        expect.any(String),
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Cold' }).props.accessibilityState.checked).toBe(
        true,
      ),
    );
    await fireEvent.press(screen.getByRole('checkbox', { name: 'VIP' }));
    await waitFor(() => expect(withdrawCall).toHaveBeenCalledWith(CONVERSATION_ID, VIP.id));
  });

  it('asks for the labels again after a change, so the thread and the list are current', async () => {
    as('inbox.conversation.tag');
    arrange({ detail: withVip() });
    applyCall.mockResolvedValue(summary({ labels: [VIP, COLD], rowVersion: 8 }));
    await show();
    await loaded();
    await open();
    await screen.findByRole('checkbox', { name: 'Cold' });
    const reads = detailCall.mock.calls.length;
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Cold' }));
    await waitFor(() => expect(detailCall.mock.calls.length).toBeGreaterThan(reads));
  });

  it('makes a new label from a name, for a person who may manage labels', async () => {
    as('inbox.conversation.tag', 'inbox.tag.manage');
    arrange({ detail: withVip() });
    applyCall.mockResolvedValue(
      summary({ labels: [VIP, label('aaaaaaaa-0000-4000-8000-000000000003', 'Hot')] }),
    );
    await show();
    await loaded();
    await open();
    await fireEvent.changeText(await screen.findByLabelText('New label'), '  Hot ');
    await fireEvent.press(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() =>
      expect(applyCall).toHaveBeenCalledWith(CONVERSATION_ID, { name: 'Hot' }, expect.any(String)),
    );
  });

  it('has no box for a new label without the permission to manage labels', async () => {
    as('inbox.conversation.tag');
    arrange({ detail: withVip() });
    await show();
    await loaded();
    await open();
    await screen.findByRole('checkbox', { name: 'VIP' });
    expect(screen.queryByLabelText('New label')).toBeNull();
  });

  it('says so when a label could not be changed', async () => {
    as('inbox.conversation.tag');
    arrange({ detail: withVip() });
    applyCall.mockRejectedValue(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    await show();
    await loaded();
    await open();
    await fireEvent.press(await screen.findByRole('checkbox', { name: 'Cold' }));
    expect(await screen.findByText("Couldn't change the labels. Try again.")).toBeTruthy();
  });

  it('says when the labels could not be loaded, and loads them on retry', async () => {
    as('inbox.conversation.tag');
    arrange({ detail: withVip() });
    libraryCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    await show();
    await loaded();
    await open();
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('checkbox', { name: 'VIP' })).toBeTruthy();
  });
});

// --- who has the conversation: the strip, the agent picker, priority, snooze, the details ------------------------------------------

describe('ThreadScreen: who has the conversation', () => {
  const push = jest.fn();
  const dots = () => screen.findByRole('button', { name: 'More actions' });
  const choose = async (name: string) =>
    await fireEvent.press(await screen.findByRole('menuitem', { name }));
  const KABIR = '33333333-3333-4333-8333-333333333333';
  const SUPPORT = '44444444-4444-4444-8444-444444444444';
  const staff = () =>
    assigneesCall.mockResolvedValue({
      users: [
        {
          id: KABIR,
          name: 'Kabir Rao',
          email: 'kabir@example.test',
          availability: 'away',
          openConversations: 1,
          isMe: false,
        },
        {
          id: ME,
          name: 'Asha Verma',
          email: 'asha@example.test',
          availability: 'online',
          openConversations: 3,
          isMe: true,
        },
      ],
      teams: [
        { id: SUPPORT, name: 'Support', color: null, memberCount: 4, assignmentStrategy: 'manual' },
      ],
    });

  beforeEach(() => {
    push.mockReset();
    jest
      .mocked(useRouter)
      .mockReturnValue({ back, push } as unknown as ReturnType<typeof useRouter>);
  });

  describe('the line above the message box', () => {
    it('says nobody has it, and takes it for the person who may', async () => {
      as('inbox.conversation.assign_self');
      arrange();
      assignCall.mockResolvedValue(summary({ rowVersion: 5 }));
      await show();
      await loaded();
      expect(await screen.findByText('Not assigned')).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Assign to me' }));
      await waitFor(() =>
        expect(assignCall).toHaveBeenCalledWith(
          CONVERSATION_ID,
          { rowVersion: 4, userId: ME },
          expect.any(String),
        ),
      );
    });

    it('names a colleague who has it, and still offers to take it', async () => {
      as('inbox.conversation.assign_self');
      arrange({ detail: detail({ assignment: assigned(OTHER_USER) }) });
      await show();
      await loaded();
      expect(await screen.findByText('Assigned to Someone')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Assign to me' })).toBeTruthy();
      // The box is still there: the web inbox lets anyone with the right reply.
      expect(screen.getByLabelText('Message')).toBeTruthy();
    });

    it('says "you" and offers nothing when the person has it', async () => {
      as('inbox.conversation.assign_self');
      arrange({ detail: detail({ assignment: assigned(ME) }) });
      await show();
      await loaded();
      expect(await screen.findByText('Assigned to you')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Assign to me' })).toBeNull();
    });

    it('names the team when only a team has it', async () => {
      as();
      arrange({
        detail: detail({
          assignment: {
            user: null,
            team: { id: SUPPORT, name: 'Support', color: null },
            aiAgent: null,
          },
        }),
      });
      await show();
      await loaded();
      expect(await screen.findByText('Team: Support')).toBeTruthy();
    });

    it('offers no claim to a person without the right', async () => {
      as();
      arrange();
      await show();
      await loaded();
      expect(await screen.findByText('Not assigned')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Assign to me' })).toBeNull();
    });
  });

  describe('Change agent', () => {
    it('lists the staff with their availability and open conversations, and the teams', async () => {
      as('inbox.conversation.assign');
      staff();
      arrange();
      await show();
      await loaded();
      await fireEvent.press(await dots());
      await choose('Change agent');
      expect(
        await screen.findByRole('radio', { name: 'Asha Verma (you), Online · 3 open' }),
      ).toBeTruthy();
      expect(screen.getByRole('radio', { name: 'Kabir Rao, Away · 1 open' })).toBeTruthy();
      expect(
        screen.getByRole('radio', { name: 'Unassigned' }).props.accessibilityState.checked,
      ).toBe(true);
      expect(screen.getByRole('radio', { name: 'Support, 4 members' })).toBeTruthy();
      expect(screen.getByRole('radio', { name: 'No team' })).toBeTruthy();
    });

    it('saves only what was changed: the person, with the row version it read', async () => {
      as('inbox.conversation.assign');
      staff();
      arrange();
      assignCall.mockResolvedValue(summary({ rowVersion: 5 }));
      await show();
      await loaded();
      await fireEvent.press(await dots());
      await choose('Change agent');
      // Nothing to save before something is picked.
      expect(
        (await screen.findByRole('button', { name: 'Save changes' })).props.accessibilityState
          .disabled,
      ).toBe(true);
      await fireEvent.press(await screen.findByRole('radio', { name: 'Kabir Rao, Away · 1 open' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() =>
        expect(assignCall).toHaveBeenCalledWith(
          CONVERSATION_ID,
          { rowVersion: 4, userId: KABIR },
          expect.any(String),
        ),
      );
      // The sheet closes once it worked.
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull(),
      );
    });

    it('gives the conversation to a team without touching the person', async () => {
      as('inbox.conversation.assign');
      staff();
      arrange({ detail: detail({ assignment: assigned(ME) }) });
      assignCall.mockResolvedValue(summary({ rowVersion: 5 }));
      await show();
      await loaded();
      await fireEvent.press(await dots());
      await choose('Change agent');
      await fireEvent.press(await screen.findByRole('radio', { name: 'Support, 4 members' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() =>
        expect(assignCall).toHaveBeenCalledWith(
          CONVERSATION_ID,
          { rowVersion: 4, teamId: SUPPORT },
          expect.any(String),
        ),
      );
    });

    it('takes the conversation from the person with "Unassigned"', async () => {
      as('inbox.conversation.assign');
      staff();
      arrange({ detail: detail({ assignment: assigned(KABIR) }) });
      assignCall.mockResolvedValue(summary({ rowVersion: 5 }));
      await show();
      await loaded();
      await fireEvent.press(await dots());
      await choose('Change agent');
      await fireEvent.press(await screen.findByRole('radio', { name: 'Unassigned' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() =>
        expect(assignCall).toHaveBeenCalledWith(
          CONVERSATION_ID,
          { rowVersion: 4, userId: null },
          expect.any(String),
        ),
      );
    });

    it('stays open and says why when someone else changed the conversation first', async () => {
      as('inbox.conversation.assign');
      staff();
      arrange();
      assignCall.mockRejectedValue(new ApiError(409, 'ROW_VERSION_CONFLICT', 'stale'));
      await show();
      await loaded();
      await fireEvent.press(await dots());
      await choose('Change agent');
      await fireEvent.press(await screen.findByRole('radio', { name: 'Kabir Rao, Away · 1 open' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
      expect(await screen.findByText(/Someone else changed this conversation/)).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
    });

    it('says when the staff could not be loaded, and tries again', async () => {
      as('inbox.conversation.assign');
      staff();
      assigneesCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
      arrange();
      await show();
      await loaded();
      await fireEvent.press(await dots());
      await choose('Change agent');
      expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByRole('radio', { name: 'Kabir Rao, Away · 1 open' })).toBeTruthy();
    });

    it('is not offered to a person who may only claim', async () => {
      as('inbox.conversation.assign_self');
      arrange({ detail: detail({ assignment: assigned(OTHER_USER) }) });
      await show();
      await loaded();
      await fireEvent.press(await dots());
      expect(screen.queryByRole('menuitem', { name: 'Change agent' })).toBeNull();
      expect(assigneesCall).not.toHaveBeenCalled();
    });
  });

  describe('priority and snooze', () => {
    it('sets the priority, from what it is now', async () => {
      as('inbox.conversation.priority');
      arrange();
      priorityCall.mockResolvedValue(summary({ priority: 'urgent', rowVersion: 5 }));
      await show();
      await loaded();
      await fireEvent.press(await dots());
      await choose('Set priority');
      expect(
        (await screen.findByRole('radio', { name: 'Normal' })).props.accessibilityState.checked,
      ).toBe(true);
      await fireEvent.press(screen.getByRole('radio', { name: 'Urgent' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() =>
        expect(priorityCall).toHaveBeenCalledWith(CONVERSATION_ID, {
          rowVersion: 4,
          priority: 'urgent',
        }),
      );
    });

    it('snoozes for an hour, a time that is ahead of now', async () => {
      as('inbox.conversation.snooze');
      arrange();
      snoozeCall.mockResolvedValue(summary({ status: 'snoozed', rowVersion: 5 }));
      await show();
      await loaded();
      const before = Date.now();
      await fireEvent.press(await dots());
      await choose('Snooze');
      await fireEvent.press(await screen.findByRole('radio', { name: 'In 1 hour' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() => expect(snoozeCall).toHaveBeenCalledTimes(1));
      const input = snoozeCall.mock.calls[0]?.[1];
      expect(input?.rowVersion).toBe(4);
      const gap = Date.parse(input?.until ?? '') - before;
      expect(gap).toBeGreaterThan(59 * 60_000);
      expect(gap).toBeLessThan(61 * 60_000);
    });

    it('offers neither without the rights, and no snooze for a finished conversation', async () => {
      as();
      arrange();
      await show();
      await loaded();
      await fireEvent.press(await dots());
      expect(screen.queryByRole('menuitem', { name: 'Set priority' })).toBeNull();
      expect(screen.queryByRole('menuitem', { name: 'Snooze' })).toBeNull();
    });

    it('wakes a snoozed conversation by moving it to open', async () => {
      as('inbox.conversation.snooze');
      arrange({ detail: detail({ status: 'snoozed' }) });
      statusCall.mockResolvedValue(summary({ status: 'open', rowVersion: 5 }));
      await show();
      await loaded();
      await fireEvent.press(await dots());
      expect(screen.queryByRole('menuitem', { name: 'Snooze' })).toBeNull();
      await choose('Wake up now');
      await waitFor(() =>
        expect(statusCall).toHaveBeenCalledWith(CONVERSATION_ID, { rowVersion: 4, status: 'open' }),
      );
    });
  });

  describe('the chat details', () => {
    it('open from the person at the top, and from the three dots', async () => {
      as();
      arrange();
      await show();
      await loaded();
      await fireEvent.press(await screen.findByRole('button', { name: 'Chat details' }));
      expect(push).toHaveBeenCalledWith({
        pathname: '/conversation-details',
        params: { id: CONVERSATION_ID },
      });
      push.mockClear();
      await fireEvent.press(await dots());
      await choose('Chat details');
      expect(push).toHaveBeenCalledWith({
        pathname: '/conversation-details',
        params: { id: CONVERSATION_ID },
      });
    });
  });
});

// --- the message box: saved replies and private notes --------------------------------------------------------------------------

const savedReply = (id: string, title: string, shortcut: string, body: string) => ({
  id,
  shortcut,
  title,
  body,
  category: null,
  language: null,
  channelKinds: [],
  scope: 'shared' as const,
  usedCount: 0,
  lastUsedAt: null,
  createdByName: null,
  canEdit: false,
  rowVersion: 1,
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-01T08:00:00.000Z',
});
const THANKS = savedReply(
  'dddddddd-0000-4000-8000-000000000001',
  'Thanks',
  'thanks',
  'Thank you {{first_name}}!',
);
const HOURS = savedReply(
  'dddddddd-0000-4000-8000-000000000002',
  'Opening hours',
  'hours',
  'We are open 9 to 6.',
);
const repliesPage = (data: ReturnType<typeof savedReply>[]) => ({
  data,
  page: { nextCursor: null, hasMore: false, limit: 20 },
  counts: { all: data.length, shared: data.length, mine: 0 },
  categories: [],
  total: data.length,
  limit: null,
});
const aNote = (id: string, body: string, createdAt: string) => ({
  id,
  conversationId: CONVERSATION_ID,
  author: { userId: OTHER_USER, name: 'Kabir Rao' },
  body,
  mentions: [],
  isPinned: false,
  editedAt: null,
  createdAt,
  rowVersion: 1,
});

describe('ThreadScreen: saved replies', () => {
  const open = async () =>
    await fireEvent.press(await screen.findByRole('button', { name: 'Saved replies' }));

  beforeEach(() => {
    repliesCall.mockResolvedValue(repliesPage([THANKS, HOURS]));
  });

  it('opens a list of the replies, asking only for the ones this channel may use', async () => {
    arrange();
    await show();
    await loaded();
    expect(repliesCall).not.toHaveBeenCalled();
    await open();
    expect(await screen.findByRole('button', { name: 'Thanks' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Opening hours' })).toBeTruthy();
    expect(screen.getByText('/thanks')).toBeTruthy();
    expect(repliesCall.mock.calls[0]?.[0]).toBe('');
    expect(repliesCall.mock.calls[0]?.[1]).toBe('whatsapp_cloud');
  });

  it('fills the reply in for this conversation and puts it in the box without sending it', async () => {
    arrange();
    fillCall.mockResolvedValue({
      id: THANKS.id,
      text: 'Thank you Rohan!',
      issues: [],
      usedCount: 1,
    });
    await show();
    await loaded();
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Thanks' }));
    await waitFor(() => expect(fillCall).toHaveBeenCalledWith(THANKS.id, CONVERSATION_ID));
    await waitFor(() =>
      expect(screen.getByLabelText('Message').props.value).toBe('Thank you Rohan!'),
    );
    // The sheet closes, and nothing was sent.
    expect(screen.queryByRole('button', { name: 'Opening hours' })).toBeNull();
    expect(sendCall).not.toHaveBeenCalled();
  });

  it('adds a second reply on a new line after what is already typed', async () => {
    arrange();
    fillCall.mockResolvedValue({
      id: HOURS.id,
      text: 'We are open 9 to 6.',
      issues: [],
      usedCount: 1,
    });
    await show();
    await loaded();
    await type('Hello Rohan');
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Opening hours' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Message').props.value).toBe('Hello Rohan\nWe are open 9 to 6.'),
    );
  });

  it('warns about a variable that could not be filled', async () => {
    arrange();
    fillCall.mockResolvedValue({
      id: THANKS.id,
      text: 'Thank you {{first_name}}!',
      issues: [{ token: '{{first_name}}', key: 'first_name', reason: 'empty' }],
      usedCount: 1,
    });
    await show();
    await loaded();
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Thanks' }));
    expect(
      await screen.findByText("Check the message: {{first_name}} couldn't be filled in."),
    ).toBeTruthy();
  });

  it('narrows the list by what is typed', async () => {
    arrange();
    await show();
    await loaded();
    await open();
    await screen.findByRole('button', { name: 'Thanks' });
    repliesCall.mockResolvedValue(repliesPage([THANKS]));
    await fireEvent.changeText(screen.getByLabelText('Search saved replies'), ' than ');
    await waitFor(() =>
      expect(repliesCall).toHaveBeenLastCalledWith('than', 'whatsapp_cloud', expect.anything()),
    );
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Opening hours' })).toBeNull());
  });

  it('says when there are none, and when none match', async () => {
    arrange();
    repliesCall.mockResolvedValue(repliesPage([]));
    await show();
    await loaded();
    await open();
    expect(await screen.findByText('No saved replies yet.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Search saved replies'), 'zzz');
    expect(await screen.findByText('No saved replies match your search.')).toBeTruthy();
  });

  it('stays open and says so when the reply could not be used', async () => {
    arrange();
    fillCall.mockRejectedValue(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    await show();
    await loaded();
    await open();
    await fireEvent.press(await screen.findByRole('button', { name: 'Thanks' }));
    expect(await screen.findByText("Couldn't use this reply. Try again.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Opening hours' })).toBeTruthy();
  });

  it('says why the list could not be loaded, and loads it on retry', async () => {
    arrange();
    repliesCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    await show();
    await loaded();
    await open();
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: 'Thanks' })).toBeTruthy();
  });

  it('is not offered when the reply window is closed (a template is the only way) or to a person who may not reply', async () => {
    arrange({ detail: detail({ window: { open: false, expiresAt: null } }) });
    await show();
    await screen.findByText('Send Template');
    expect(screen.queryByRole('button', { name: 'Saved replies' })).toBeNull();
  });
});

describe('ThreadScreen: private notes', () => {
  it('shows the notes between the messages where they were written', async () => {
    arrange({
      messages: [
        message(1, { createdAt: '2026-10-11T09:00:00.000Z' }),
        outgoing(2, { body: 'Hi Rohan', createdAt: '2026-10-11T09:10:00.000Z' }),
        message(3, { body: 'Thanks', createdAt: '2026-10-11T09:30:00.000Z' }),
      ],
    });
    notesCall.mockResolvedValue({
      data: [
        aNote(
          'eeeeeeee-0000-4000-8000-000000000001',
          'Refund approved',
          '2026-10-11T09:20:00.000Z',
        ),
      ],
      page: { nextCursor: null, hasMore: false, limit: 100 },
    });
    await show();
    const noted = await screen.findByTestId('thread-note-eeeeeeee-0000-4000-8000-000000000001');
    expect(noted.props.accessibilityLabel).toMatch(/^Private note by Kabir Rao: Refund approved/);
    expect(screen.getByText('Private note')).toBeTruthy();
    // Between "Hi Rohan" and "Thanks": the list is drawn newest first, so the order in the tree is Thanks, note, Hi Rohan.
    const order = screen
      .getAllByTestId(/^(message-|thread-note-)/)
      .map((n) => n.props.testID as string);
    expect(order).toEqual([
      'message-3',
      'thread-note-eeeeeeee-0000-4000-8000-000000000001',
      'message-2',
      'message-1',
    ]);
  });

  it('offers the Reply and Note switch to a person who may write notes', async () => {
    as('inbox.conversation.note');
    arrange();
    await show();
    await loaded();
    expect(
      (await screen.findByRole('radio', { name: 'Reply' })).props.accessibilityState.checked,
    ).toBe(true);
    expect(screen.getByRole('radio', { name: 'Note' })).toBeTruthy();
  });

  it('has no switch for a person who may not write notes', async () => {
    arrange();
    await show();
    await loaded();
    expect(screen.queryByRole('radio', { name: 'Note' })).toBeNull();
  });

  it('writes a note, not a message, in note mode; and keeps each draft apart', async () => {
    as('inbox.conversation.note');
    arrange();
    addNoteCall.mockResolvedValue(
      aNote('eeeeeeee-0000-4000-8000-000000000002', 'Call tomorrow', '2026-10-11T10:00:00.000Z'),
    );
    await show();
    await loaded();
    await type('Hello Rohan');
    await fireEvent.press(await screen.findByRole('radio', { name: 'Note' }));
    expect(screen.getByLabelText('Private note')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Saved replies' })).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Private note'), '  Call tomorrow ');
    await fireEvent.press(screen.getByRole('button', { name: 'Add note' }));
    await waitFor(() =>
      expect(addNoteCall).toHaveBeenCalledWith(
        CONVERSATION_ID,
        { body: 'Call tomorrow', mentions: [] },
        expect.any(String),
      ),
    );
    expect(sendCall).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText('Private note').props.value).toBe(''));
    // Back to replying: the message that was being typed is still there.
    await fireEvent.press(screen.getByRole('radio', { name: 'Reply' }));
    expect(screen.getByLabelText('Message').props.value).toBe('Hello Rohan');
  });

  it('says so when the note could not be saved, and keeps what was typed', async () => {
    as('inbox.conversation.note');
    arrange();
    addNoteCall.mockRejectedValue(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    await show();
    await loaded();
    await fireEvent.press(await screen.findByRole('radio', { name: 'Note' }));
    await fireEvent.changeText(screen.getByLabelText('Private note'), 'Call tomorrow');
    await fireEvent.press(screen.getByRole('button', { name: 'Add note' }));
    expect(await screen.findByText("Couldn't save the note. Try again.")).toBeTruthy();
    expect(screen.getByLabelText('Private note').props.value).toBe('Call tomorrow');
  });

  it('still works when the reply window is closed, as the web inbox does', async () => {
    as('inbox.conversation.note');
    arrange({ detail: detail({ window: { open: false, expiresAt: null } }) });
    await show();
    await screen.findByText('Send Template');
    await fireEvent.press(screen.getByRole('radio', { name: 'Note' }));
    expect(await screen.findByLabelText('Private note')).toBeTruthy();
  });

  it('gives a person who may write notes but not reply the note box alone', async () => {
    sessionCall.mockResolvedValue(
      withPermissions(['inbox.conversation.read', 'inbox.conversation.note']),
    );
    arrange();
    await show();
    await loaded();
    expect(await screen.findByLabelText('Private note')).toBeTruthy();
    expect(screen.queryByLabelText('Message')).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Note' })).toBeNull();
  });
});
