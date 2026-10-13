import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { ApiError } from '@/lib/api';
import { fetchSession } from '@/lib/session/api';
import {
  CONVERSATION_ID,
  inboxSession,
  list,
  summary,
  withPermissions,
} from '@/test/inbox-fixtures';
import { renderApp } from '@/test/render';
import { reachEnd } from '@/test/scroll';
import * as api from './api';
import { InboxScreen } from './inbox-screen';
import { INBOX_POLL_MS } from './use-inbox';

jest.mock('./api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => {
  const { useEffect: runEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    useRouter: jest.fn(),
    // The tab is in front for the whole test.
    useFocusEffect: (effect: () => void) => runEffect(effect, [effect]),
  };
});

const sessionCall = jest.mocked(fetchSession);
const listCall = jest.mocked(api.fetchConversations);
const push = jest.fn();

const rohan = summary({
  unreadCount: 2,
  assignment: { user: { id: 'u1', name: 'Asha Verma' }, team: null, aiAgent: null },
});
const meera = summary({
  id: '44444444-4444-4444-8444-444444444444',
  title: 'Meera Joshi',
  preview: null,
  status: 'pending',
  lastMessageAt: null,
});

/** The channel mark is hidden from screen readers (the row's own label speaks), so a query has to ask for it. */
const HIDDEN = { includeHiddenElements: true };

let client: QueryClient | undefined;
async function show() {
  const view = await renderApp(<InboxScreen />);
  client = view.queryClient;
  return view;
}
/** The filters the list was last asked for. */
const lastFilters = () => listCall.mock.lastCall?.[0];

beforeEach(() => {
  jest.resetAllMocks();
  client = undefined;
  jest.mocked(useRouter).mockReturnValue({ push } as unknown as ReturnType<typeof useRouter>);
  sessionCall.mockResolvedValue(inboxSession);
  listCall.mockResolvedValue(list([rohan, meera]));
});
afterEach(async () => {
  if (client) {
    const cache = client;
    await waitFor(() => expect(cache.isFetching()).toBe(0));
  }
});

describe('InboxScreen', () => {
  it('lists the conversations with the unread dot, a channel mark and the status', async () => {
    await show();
    const row = await screen.findByRole('button', {
      name: 'Rohan Mehta, 2 unread messages, Is my order on its way?',
    });
    expect(row).toBeTruthy();
    expect(screen.getAllByTestId('unread-dot')).toHaveLength(1);
    expect(screen.getAllByTestId('channel-badge', HIDDEN)).toHaveLength(2);
    // The second row has no message yet and is pending.
    expect(screen.getByRole('button', { name: 'Meera Joshi, No messages yet' })).toBeTruthy();
    expect(screen.getByText('Pending')).toBeTruthy();
    expect(screen.getByText('No more conversations')).toBeTruthy();
  });

  it('keeps the row to two lines: the assignee and the channel name are not written out', async () => {
    await show();
    await screen.findByText('Rohan Mehta');
    expect(screen.queryByText('Asha Verma')).toBeNull();
    expect(screen.queryByText('Support line')).toBeNull();
  });

  it('marks every conversation with its channel, even a kind the app does not know', async () => {
    const channel = (kind: string) => ({ id: rohan.channel.id, kind, name: kind });
    listCall.mockResolvedValue(
      list([
        summary({ id: 'a0000000-0000-4000-8000-000000000001', channel: channel('webchat') }),
        summary({ id: 'a0000000-0000-4000-8000-000000000002', channel: channel('instagram') }),
        summary({ id: 'a0000000-0000-4000-8000-000000000003', channel: channel('carrier_pigeon') }),
      ]),
    );
    await show();
    await screen.findAllByText('Rohan Mehta');
    expect(screen.getAllByTestId('channel-badge', HIDDEN)).toHaveLength(3);
  });

  it('says Media for a message with no words, and not "No messages yet"', async () => {
    listCall.mockResolvedValue(
      list([
        summary({
          id: 'b0000000-0000-4000-8000-000000000001',
          title: 'Photo sender',
          preview: null,
        }),
      ]),
    );
    await show();
    expect(await screen.findByRole('button', { name: 'Photo sender, Media' })).toBeTruthy();
    expect(screen.getByText('Media')).toBeTruthy();
    expect(screen.queryByText('No messages yet')).toBeNull();
  });

  it('shows 20 placeholder rows while the first page loads', async () => {
    let finish: (value: ReturnType<typeof list>) => void = () => undefined;
    listCall.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await show();
    expect(await screen.findAllByTestId('skeleton-row')).toHaveLength(20);
    await act(async () => finish(list([rohan])));
    expect(await screen.findByText('Rohan Mehta')).toBeTruthy();
    expect(screen.queryByTestId('skeleton-row')).toBeNull();
  });

  it('opens the thread when a row is pressed', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: /^Rohan Mehta/ }));
    expect(push).toHaveBeenCalledWith({
      pathname: '/conversation/[id]',
      params: { id: CONVERSATION_ID },
    });
  });

  it('asks for the tab the person picks', async () => {
    await show();
    await screen.findByText('Rohan Mehta');
    expect(lastFilters()).toMatchObject({ tab: 'all', status: 'default', q: '' });
    await fireEvent.press(screen.getByRole('button', { name: 'Inbox view' }));
    await fireEvent.press(await screen.findByRole('menuitem', { name: 'Unread, 1' }));
    await waitFor(() => expect(lastFilters()).toMatchObject({ tab: 'unread' }));
    expect(await screen.findByRole('button', { name: 'Inbox view' })).toBeTruthy();
  });

  it('waits for a pause in typing before searching, and shows the search as a chip', async () => {
    await show();
    await screen.findByText('Rohan Mehta');
    await fireEvent.press(screen.getByRole('button', { name: 'Search conversations' }));
    const box = screen.getByLabelText('Search');
    await fireEvent.changeText(box, 'r');
    await fireEvent.changeText(box, 'ro');
    await fireEvent.changeText(box, 'rohan');
    expect(listCall).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(lastFilters()).toMatchObject({ q: 'rohan' }));
    expect(listCall.mock.calls.some(([filters]) => filters.q === 'r' || filters.q === 'ro')).toBe(
      false,
    );
    expect(
      await screen.findByRole('button', { name: 'Remove filter: Search: rohan' }),
    ).toBeTruthy();
  });

  it('filters by status and clears the chip', async () => {
    await show();
    await screen.findByText('Rohan Mehta');
    await fireEvent.press(screen.getByRole('button', { name: 'Filter by status' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Pending' }));
    await waitFor(() => expect(lastFilters()).toMatchObject({ status: 'pending' }));
    const chip = await screen.findByRole('button', { name: 'Remove filter: Status: Pending' });
    await fireEvent.press(chip);
    await waitFor(() => expect(lastFilters()).toMatchObject({ status: 'default' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^Remove filter/ })).toBeNull(),
    );
    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull();
  });

  it('clears the status and the search together with Clear all', async () => {
    await show();
    await screen.findByText('Rohan Mehta');
    await fireEvent.press(screen.getByRole('button', { name: 'Filter by status' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Resolved' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Search conversations' }));
    await fireEvent.changeText(screen.getByLabelText('Search'), 'meera');
    await waitFor(() => expect(lastFilters()).toMatchObject({ status: 'resolved', q: 'meera' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Clear all' }));
    await waitFor(() => expect(lastFilters()).toMatchObject({ status: 'default', q: '' }));
    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull();
  });

  it('says there are no conversations, and hints at the filters when some are on', async () => {
    listCall.mockResolvedValue(list([]));
    await show();
    expect(await screen.findByText('No conversations')).toBeTruthy();
    expect(screen.getByText('Messages from your customers will show up here.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Filter by status' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Closed' }));
    expect(
      await screen.findByText('Nothing matches these filters. Try clearing them.'),
    ).toBeTruthy();
  });

  it('shows the failure in words with a way to try again, and recovers', async () => {
    listCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    await show();
    expect(
      await screen.findByText("Can't reach the server. Check your connection and try again."),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Rohan Mehta')).toBeTruthy();
  });

  it('explains a missing permission and does not ask the API for conversations', async () => {
    sessionCall.mockResolvedValue(withPermissions(['dash.dashboard.read']));
    await show();
    expect(await screen.findByText('No access to the inbox')).toBeTruthy();
    expect(listCall).not.toHaveBeenCalled();
    expect(screen.queryByTestId('skeleton-row')).toBeNull();
  });

  it('loads the next page when the end of the list is reached', async () => {
    listCall
      .mockResolvedValueOnce(list([rohan], { hasMore: true, nextCursor: 'cursor-2' }))
      .mockResolvedValueOnce(list([meera]));
    await show();
    await screen.findByText('Rohan Mehta');
    expect(screen.queryByText('No more conversations')).toBeNull();
    await reachEnd(screen.getByTestId('inbox-list'));
    expect(await screen.findByText('Meera Joshi')).toBeTruthy();
    expect(listCall).toHaveBeenLastCalledWith(expect.anything(), 'cursor-2', expect.anything());
    expect(await screen.findByText('No more conversations')).toBeTruthy();
  });

  it('asks again when the page is pulled down, and stops the spinner when done', async () => {
    await show();
    await screen.findByText('Rohan Mehta');
    const control = () => screen.getByTestId('inbox-list').props.refreshControl;
    await act(() => {
      control().props.onRefresh();
    });
    await waitFor(() => expect(control().props.refreshing).toBe(false));
    expect(listCall).toHaveBeenCalledTimes(2);
  });

  it('shows how many conversations each view holds, as the API counts them', async () => {
    await show();
    await screen.findByText('Rohan Mehta');
    await fireEvent.press(screen.getByRole('button', { name: 'Inbox view' }));
    for (const name of ['All, 5', 'Mine, 2', 'Unassigned, 3', 'Unread, 1']) {
      expect(await screen.findByRole('menuitem', { name })).toBeTruthy();
    }
  });

  describe('while the tab is in front', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('asks for news by itself, so a new message shows up without a pull', async () => {
      await show();
      await screen.findByText('Rohan Mehta');
      expect(listCall).toHaveBeenCalledTimes(1);
      listCall.mockResolvedValue(
        list([summary({ id: '55555555-5555-4555-8555-555555555555', title: 'Kabir Rao' }), rohan]),
      );
      await act(async () => {
        await jest.advanceTimersByTimeAsync(INBOX_POLL_MS);
      });
      expect(await screen.findByText('Kabir Rao')).toBeTruthy();
      expect(listCall).toHaveBeenCalledTimes(2);
    });
  });
});
