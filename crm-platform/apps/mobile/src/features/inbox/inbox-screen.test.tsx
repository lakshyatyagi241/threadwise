import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { FlatList } from 'react-native';
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
import * as api from './api';
import { InboxScreen } from './inbox-screen';

jest.mock('./api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

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

let client: QueryClient | undefined;
function show() {
  const view = renderApp(<InboxScreen />);
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
  it('lists the conversations with the unread dot, assignee, channel and status', async () => {
    show();
    const row = await screen.findByRole('button', {
      name: 'Rohan Mehta, 2 unread messages, Is my order on its way?',
    });
    expect(row).toBeTruthy();
    expect(screen.getAllByTestId('unread-dot')).toHaveLength(1);
    expect(screen.getByText('Asha Verma')).toBeTruthy();
    expect(screen.getAllByText('Support line')).toHaveLength(2);
    // The second row has no message yet and is pending.
    expect(screen.getByRole('button', { name: 'Meera Joshi, No messages yet' })).toBeTruthy();
    expect(screen.getByText('Pending')).toBeTruthy();
    expect(screen.getByText('No more conversations')).toBeTruthy();
  });

  it('shows 20 placeholder rows while the first page loads', async () => {
    let finish: (value: ReturnType<typeof list>) => void = () => undefined;
    listCall.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    show();
    expect(await screen.findAllByTestId('skeleton-row')).toHaveLength(20);
    await act(async () => finish(list([rohan])));
    expect(await screen.findByText('Rohan Mehta')).toBeTruthy();
    expect(screen.queryByTestId('skeleton-row')).toBeNull();
  });

  it('opens the thread when a row is pressed', async () => {
    show();
    fireEvent.press(await screen.findByRole('button', { name: /^Rohan Mehta/ }));
    expect(push).toHaveBeenCalledWith({
      pathname: '/conversation/[id]',
      params: { id: CONVERSATION_ID },
    });
  });

  it('asks for the tab the person picks', async () => {
    show();
    await screen.findByText('Rohan Mehta');
    expect(lastFilters()).toMatchObject({ tab: 'all', status: 'default', q: '' });
    fireEvent.press(screen.getByRole('button', { name: 'Inbox view' }));
    fireEvent.press(await screen.findByRole('menuitem', { name: 'Unread' }));
    await waitFor(() => expect(lastFilters()).toMatchObject({ tab: 'unread' }));
    expect(await screen.findByRole('button', { name: 'Inbox view' })).toBeTruthy();
  });

  it('waits for a pause in typing before searching, and shows the search as a chip', async () => {
    show();
    await screen.findByText('Rohan Mehta');
    fireEvent.press(screen.getByRole('button', { name: 'Search conversations' }));
    const box = screen.getByLabelText('Search');
    fireEvent.changeText(box, 'r');
    fireEvent.changeText(box, 'ro');
    fireEvent.changeText(box, 'rohan');
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
    show();
    await screen.findByText('Rohan Mehta');
    fireEvent.press(screen.getByRole('button', { name: 'Filter by status' }));
    fireEvent.press(await screen.findByRole('radio', { name: 'Pending' }));
    await waitFor(() => expect(lastFilters()).toMatchObject({ status: 'pending' }));
    const chip = await screen.findByRole('button', { name: 'Remove filter: Status: Pending' });
    fireEvent.press(chip);
    await waitFor(() => expect(lastFilters()).toMatchObject({ status: 'default' }));
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^Remove filter/ })).toBeNull(),
    );
    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull();
  });

  it('clears the status and the search together with Clear all', async () => {
    show();
    await screen.findByText('Rohan Mehta');
    fireEvent.press(screen.getByRole('button', { name: 'Filter by status' }));
    fireEvent.press(await screen.findByRole('radio', { name: 'Resolved' }));
    fireEvent.press(screen.getByRole('button', { name: 'Search conversations' }));
    fireEvent.changeText(screen.getByLabelText('Search'), 'meera');
    await waitFor(() => expect(lastFilters()).toMatchObject({ status: 'resolved', q: 'meera' }));
    fireEvent.press(await screen.findByRole('button', { name: 'Clear all' }));
    await waitFor(() => expect(lastFilters()).toMatchObject({ status: 'default', q: '' }));
    expect(screen.queryByRole('button', { name: 'Clear all' })).toBeNull();
  });

  it('says there are no conversations, and hints at the filters when some are on', async () => {
    listCall.mockResolvedValue(list([]));
    show();
    expect(await screen.findByText('No conversations')).toBeTruthy();
    expect(screen.getByText('Messages from your customers will show up here.')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Filter by status' }));
    fireEvent.press(await screen.findByRole('radio', { name: 'Closed' }));
    expect(
      await screen.findByText('Nothing matches these filters. Try clearing them.'),
    ).toBeTruthy();
  });

  it('shows the failure in words with a way to try again, and recovers', async () => {
    listCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    show();
    expect(
      await screen.findByText("Can't reach the server. Check your connection and try again."),
    ).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Rohan Mehta')).toBeTruthy();
  });

  it('explains a missing permission and does not ask the API for conversations', async () => {
    sessionCall.mockResolvedValue(withPermissions(['dash.dashboard.read']));
    show();
    expect(await screen.findByText('No access to the inbox')).toBeTruthy();
    expect(listCall).not.toHaveBeenCalled();
    expect(screen.queryByTestId('skeleton-row')).toBeNull();
  });

  it('loads the next page when the end of the list is reached', async () => {
    listCall
      .mockResolvedValueOnce(list([rohan], { hasMore: true, nextCursor: 'cursor-2' }))
      .mockResolvedValueOnce(list([meera]));
    show();
    await screen.findByText('Rohan Mehta');
    expect(screen.queryByText('No more conversations')).toBeNull();
    act(() => {
      screen.UNSAFE_getByType(FlatList).props.onEndReached();
    });
    expect(await screen.findByText('Meera Joshi')).toBeTruthy();
    expect(listCall).toHaveBeenLastCalledWith(expect.anything(), 'cursor-2', expect.anything());
    expect(await screen.findByText('No more conversations')).toBeTruthy();
  });

  it('asks again when the page is pulled down, and stops the spinner when done', async () => {
    show();
    await screen.findByText('Rohan Mehta');
    const control = () => screen.UNSAFE_getByType(FlatList).props.refreshControl;
    act(() => {
      control().props.onRefresh();
    });
    expect(control().props.refreshing).toBe(true);
    await waitFor(() => expect(control().props.refreshing).toBe(false));
    expect(listCall).toHaveBeenCalledTimes(2);
  });
});
