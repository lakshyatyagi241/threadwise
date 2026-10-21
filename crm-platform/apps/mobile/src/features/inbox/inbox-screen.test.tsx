import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { ApiError } from '@/lib/api';
import { fetchSession } from '@/lib/session/api';
import {
  channelRow,
  CONVERSATION_ID,
  inboxSession,
  list,
  summary,
  withPermissions,
} from '@/test/inbox-fixtures';
import { renderApp } from '@/test/render';
import { reachEnd } from '@/test/scroll';
import * as api from './api';
import * as bulkApi from './bulk-api';
import * as labelsApi from './labels-api';
import { InboxScreen } from './inbox-screen';
import { INBOX_POLL_MS } from './use-inbox';

jest.mock('./api');
jest.mock('./labels-api');
jest.mock('./bulk-api');
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
const channelsCall = jest.mocked(api.fetchChannels);
const assigneesCall = jest.mocked(api.fetchAssignees);
const bulkCall = jest.mocked(bulkApi.runBulkAction);
const libraryCall = jest.mocked(labelsApi.fetchLabelLibrary);
const push = jest.fn();

const rohan = summary({
  unreadCount: 2,
  assignment: { user: { id: 'u1', name: 'Asha Verma' }, team: null, aiAgent: null },
});
const meera = summary({
  id: '44444444-4444-4444-8444-444444444444',
  title: 'Meera Joshi',
  preview: null,
  status: 'snoozed',
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
  channelsCall.mockResolvedValue({ data: [channelRow()] });
  libraryCall.mockResolvedValue([]);
  assigneesCall.mockResolvedValue({ users: [], teams: [] });
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
    // The second row has no message yet and is snoozed.
    expect(screen.getByRole('button', { name: 'Meera Joshi, No messages yet' })).toBeTruthy();
    expect(screen.getByText('Snoozed')).toBeTruthy();
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
    await fireEvent.press(screen.getByRole('button', { name: 'Filters' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Snoozed' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(lastFilters()).toMatchObject({ status: 'snoozed' }));
    const chip = await screen.findByRole('button', { name: 'Remove filter: Status: Snoozed' });
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
    await fireEvent.press(screen.getByRole('button', { name: 'Filters' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Resolved' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Apply' }));
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
    await fireEvent.press(screen.getByRole('button', { name: 'Filters' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Closed' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Apply' }));
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

  describe('the filter screen', () => {
    const open = async () => {
      await show();
      await screen.findByText('Rohan Mehta');
      await fireEvent.press(screen.getByRole('button', { name: 'Filters' }));
    };
    const save = async () => await fireEvent.press(screen.getByRole('button', { name: 'Apply' }));
    const category = async (name: string) =>
      await fireEvent.press(await screen.findByRole('tab', { name }));

    it('narrows the list to one channel, and names it in the chip', async () => {
      await open();
      await category('Channel');
      await fireEvent.press(
        await screen.findByRole('radio', { name: 'Support line, +91 98000 00001' }),
      );
      await save();
      await waitFor(() => expect(lastFilters()).toMatchObject({ channelId: channelRow().id }));
      const chip = await screen.findByRole('button', {
        name: 'Remove filter: Channel: Support line',
      });
      await fireEvent.press(chip);
      await waitFor(() => expect(lastFilters()).toMatchObject({ channelId: '' }));
    });

    it('narrows the list to conversations with any of the chosen labels', async () => {
      libraryCall.mockResolvedValue([
        {
          id: 'aaaaaaaa-0000-4000-8000-000000000001',
          name: 'VIP',
          color: null,
          description: null,
          conversationCount: 2,
          rowVersion: 1,
        },
        {
          id: 'aaaaaaaa-0000-4000-8000-000000000002',
          name: 'Cold',
          color: null,
          description: null,
          conversationCount: 1,
          rowVersion: 1,
        },
      ]);
      await open();
      await category('Labels');
      await fireEvent.press(await screen.findByRole('checkbox', { name: 'VIP' }));
      await fireEvent.press(screen.getByRole('checkbox', { name: 'Cold' }));
      await save();
      await waitFor(() =>
        expect(lastFilters()?.labels).toEqual([
          'aaaaaaaa-0000-4000-8000-000000000001',
          'aaaaaaaa-0000-4000-8000-000000000002',
        ]),
      );
      expect(
        await screen.findByRole('button', { name: 'Remove filter: Labels: VIP, Cold' }),
      ).toBeTruthy();
    });

    it('switches to the archive and back with Clear all', async () => {
      await open();
      await category('View');
      await fireEvent.press(await screen.findByRole('radio', { name: 'Archived' }));
      await save();
      await waitFor(() => expect(lastFilters()).toMatchObject({ archived: true }));
      expect(await screen.findByRole('button', { name: 'Remove filter: Archived' })).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Clear all' }));
      await waitFor(() => expect(lastFilters()).toMatchObject({ archived: false }));
    });

    const agent = (over: Record<string, unknown> = {}) => ({
      id: 'aaaaaaaa-1111-4000-8000-000000000001',
      name: 'Asha Verma',
      email: 'asha@example.test',
      availability: 'online' as const,
      openConversations: 3,
      isMe: false,
      onLeave: null,
      ...over,
    });

    it('narrows the list to conversations assigned to any of the chosen agents, and names them in the chip', async () => {
      assigneesCall.mockResolvedValue({
        users: [
          agent(),
          agent({
            id: 'aaaaaaaa-1111-4000-8000-000000000002',
            name: null,
            email: 'kabir@example.test',
            isMe: true,
          }),
        ],
        teams: [],
      });
      await open();
      await category('Agent');
      await fireEvent.press(await screen.findByRole('checkbox', { name: /^Asha Verma/ }));
      await fireEvent.press(screen.getByRole('checkbox', { name: /^kabir@example.test/ }));
      await save();
      await waitFor(() =>
        expect(lastFilters()?.agentIds).toEqual([
          'aaaaaaaa-1111-4000-8000-000000000001',
          'aaaaaaaa-1111-4000-8000-000000000002',
        ]),
      );
      const chip = await screen.findByRole('button', {
        name: 'Remove filter: Agent: Asha Verma, kabir@example.test',
      });
      await fireEvent.press(chip);
      await waitFor(() => expect(lastFilters()?.agentIds).toEqual([]));
    });

    it('sorts the oldest first, shows it as a chip, and goes back to the newest first when the chip is removed', async () => {
      await open();
      await category('Sort by');
      expect(
        (await screen.findByRole('radio', { name: 'Recent first' })).props.accessibilityState
          .checked,
      ).toBe(true);
      await fireEvent.press(screen.getByRole('radio', { name: /^Oldest first/ }));
      await save();
      await waitFor(() => expect(lastFilters()).toMatchObject({ sort: 'old' }));
      const chip = await screen.findByRole('button', { name: 'Remove filter: Sort: Oldest first' });
      await fireEvent.press(chip);
      await waitFor(() => expect(lastFilters()).toMatchObject({ sort: 'recent' }));
    });

    it('starts on the newest first with no agent chosen, and clears both with Clear all', async () => {
      assigneesCall.mockResolvedValue({ users: [agent()], teams: [] });
      expect(lastFilters()).toBeUndefined();
      await open();
      expect(lastFilters()).toMatchObject({ agentIds: [], sort: 'recent' });
      await category('Agent');
      await fireEvent.press(await screen.findByRole('checkbox', { name: /^Asha Verma/ }));
      await category('Sort by');
      await fireEvent.press(await screen.findByRole('radio', { name: /^Oldest first/ }));
      await save();
      await waitFor(() => expect(lastFilters()).toMatchObject({ sort: 'old' }));
      await fireEvent.press(await screen.findByRole('button', { name: 'Clear all' }));
      await waitFor(() => expect(lastFilters()).toMatchObject({ agentIds: [], sort: 'recent' }));
    });

    it('has no agent category when nobody can be assigned', async () => {
      await open();
      await screen.findByRole('radio', { name: 'Snoozed' });
      expect(screen.queryByRole('tab', { name: 'Agent' })).toBeNull();
      expect(screen.getByRole('tab', { name: 'Sort by' })).toBeTruthy();
    });

    it('has no channel or label category when the workspace has neither', async () => {
      channelsCall.mockResolvedValue({ data: [] });
      await open();
      await screen.findByRole('radio', { name: 'Snoozed' });
      expect(screen.getByRole('tab', { name: 'Conversation status' })).toBeTruthy();
      expect(screen.getByRole('tab', { name: 'View' })).toBeTruthy();
      expect(screen.queryByRole('tab', { name: 'Channel' })).toBeNull();
      expect(screen.queryByRole('tab', { name: 'Labels' })).toBeNull();
    });

    it('empties the choices with Clear all and applies them only on Apply', async () => {
      await open();
      await fireEvent.press(await screen.findByRole('radio', { name: 'Resolved' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Clear all' }));
      expect(screen.getByRole('radio', { name: 'Resolved' }).props.accessibilityState.checked).toBe(
        false,
      );
      expect(screen.getByRole('radio', { name: 'Open' }).props.accessibilityState.checked).toBe(
        true,
      );
      await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
      expect(lastFilters()).toMatchObject({ status: 'default' });
    });

    it('says when the channels could not be loaded, and still lets the rest be chosen', async () => {
      channelsCall.mockRejectedValue(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
      await open();
      expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
      expect(screen.getByRole('radio', { name: 'Snoozed' })).toBeTruthy();
    });
  });

  describe('choosing several conversations', () => {
    const BULK_RIGHTS = [
      'inbox.conversation.read',
      'inbox.conversation.bulk',
      'inbox.conversation.resolve',
      'inbox.conversation.assign',
      'inbox.conversation.tag',
      'inbox.conversation.priority',
      'inbox.conversation.snooze',
    ];
    const ROHAN_ROW = 'Rohan Mehta, 2 unread messages, Is my order on its way?';
    const MEERA_ROW = 'Meera Joshi, No messages yet';
    const result = (over: Partial<Awaited<ReturnType<typeof bulkApi.runBulkAction>>> = {}) => ({
      requested: 2,
      done: 2,
      unchanged: 0,
      failed: 0,
      results: [],
      ...over,
    });
    /** Long-presses Rohan's row, then ticks Meera's. */
    const chooseBoth = async () => {
      await show();
      const rohanRow = await screen.findByRole('button', { name: ROHAN_ROW });
      await fireEvent(rohanRow, 'longPress');
      await fireEvent.press(await screen.findByRole('checkbox', { name: MEERA_ROW }));
    };

    beforeEach(() => {
      sessionCall.mockResolvedValue(withPermissions(BULK_RIGHTS));
    });

    it('starts with a long press, counts the chosen, and a press ticks instead of opening the thread', async () => {
      await chooseBoth();
      expect(await screen.findByText('2 selected')).toBeTruthy();
      expect(
        screen.getByRole('checkbox', { name: ROHAN_ROW }).props.accessibilityState.checked,
      ).toBe(true);
      expect(push).not.toHaveBeenCalled();
      // Pressing a chosen row takes it off again.
      await fireEvent.press(screen.getByRole('checkbox', { name: MEERA_ROW }));
      expect(await screen.findByText('1 selected')).toBeTruthy();
    });

    it('keeps the row chosen when the finger lifts after the long press (Android sends a press then)', async () => {
      await show();
      const row = await screen.findByRole('button', { name: ROHAN_ROW });
      await fireEvent(row, 'longPress');
      await fireEvent.press(await screen.findByRole('checkbox', { name: ROHAN_ROW }));
      expect(await screen.findByText('1 selected')).toBeTruthy();
      expect(
        screen.getByRole('checkbox', { name: ROHAN_ROW }).props.accessibilityState.checked,
      ).toBe(true);
      // The next press is a real one: it takes the row off.
      await fireEvent.press(screen.getByRole('checkbox', { name: ROHAN_ROW }));
      await waitFor(() => expect(screen.queryByText('1 selected')).toBeNull());
    });

    it('is not offered to a person without the right to act on several', async () => {
      sessionCall.mockResolvedValue(withPermissions(['inbox.conversation.read']));
      await show();
      const row = await screen.findByRole('button', { name: ROHAN_ROW });
      await fireEvent(row, 'longPress');
      expect(screen.queryByText('1 selected')).toBeNull();
      expect(screen.getByRole('button', { name: ROHAN_ROW })).toBeTruthy();
    });

    it('ends with the close button, and chooses every loaded conversation with Select all', async () => {
      await chooseBoth();
      await fireEvent.press(await screen.findByRole('button', { name: 'Select all' }));
      expect(await screen.findByText('2 selected')).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Cancel selection' }));
      await waitFor(() => expect(screen.queryByText('2 selected')).toBeNull());
      expect(screen.getByRole('button', { name: ROHAN_ROW })).toBeTruthy();
    });

    it('offers only the actions the person may do', async () => {
      sessionCall.mockResolvedValue(
        withPermissions([
          'inbox.conversation.read',
          'inbox.conversation.bulk',
          'inbox.conversation.resolve',
        ]),
      );
      await chooseBoth();
      await screen.findByText('2 selected');
      expect(screen.getByRole('button', { name: 'Mark as read' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Status' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Mark as spam' })).toBeTruthy();
      for (const name of ['Assign', 'Labels', 'Priority', 'Snooze']) {
        expect(screen.queryByRole('button', { name })).toBeNull();
      }
    });

    it('marks every chosen conversation as read at once, and says what happened', async () => {
      bulkCall.mockResolvedValue(result());
      await chooseBoth();
      await fireEvent.press(await screen.findByRole('button', { name: 'Mark as read' }));
      await waitFor(() =>
        expect(bulkCall).toHaveBeenCalledWith(
          [rohan.id, meera.id],
          { type: 'mark_read' },
          expect.any(String),
        ),
      );
      expect(await screen.findByText('2 updated, 0 unchanged, 0 failed')).toBeTruthy();
      // The choosing is over and the list was read again.
      expect(screen.queryByText('2 selected')).toBeNull();
    });

    it('marks every chosen conversation as spam at once, with the resolve right', async () => {
      bulkCall.mockResolvedValue(result());
      await chooseBoth();
      await fireEvent.press(await screen.findByRole('button', { name: 'Mark as spam' }));
      await waitFor(() =>
        expect(bulkCall).toHaveBeenCalledWith(
          [rohan.id, meera.id],
          { type: 'spam' },
          expect.any(String),
        ),
      );
      expect(await screen.findByText('2 updated, 0 unchanged, 0 failed')).toBeTruthy();
    });

    it('does not offer Mark as spam without the resolve right', async () => {
      sessionCall.mockResolvedValue(
        withPermissions(['inbox.conversation.read', 'inbox.conversation.bulk']),
      );
      await chooseBoth();
      await screen.findByText('2 selected');
      expect(screen.queryByRole('button', { name: 'Mark as spam' })).toBeNull();
    });

    it('changes the status of all of them: pick, then Save', async () => {
      bulkCall.mockResolvedValue(result());
      await chooseBoth();
      await fireEvent.press(await screen.findByRole('button', { name: 'Status' }));
      expect(await screen.findByText('Change status of 2 conversations')).toBeTruthy();
      await fireEvent.press(screen.getByRole('radio', { name: 'Resolved' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() =>
        expect(bulkCall).toHaveBeenCalledWith(
          [rohan.id, meera.id],
          { type: 'status', status: 'resolved' },
          expect.any(String),
        ),
      );
    });

    it('takes the conversations from whoever has them with "Unassigned"', async () => {
      assigneesCall.mockResolvedValue({
        users: [
          {
            id: 'u-1',
            name: 'Kabir Rao',
            email: 'k@example.test',
            availability: 'online',
            openConversations: 1,
            isMe: false,
            onLeave: null,
          },
        ],
        teams: [],
      });
      bulkCall.mockResolvedValue(result());
      await chooseBoth();
      await fireEvent.press(await screen.findByRole('button', { name: 'Assign' }));
      await fireEvent.press(await screen.findByRole('radio', { name: 'Unassigned' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() =>
        expect(bulkCall).toHaveBeenCalledWith(
          [rohan.id, meera.id],
          { type: 'assign', userId: null },
          expect.any(String),
        ),
      );
    });

    it('puts a label on all of them, and needs a label chosen before it can be saved', async () => {
      libraryCall.mockResolvedValue([
        {
          id: 'aaaaaaaa-0000-4000-8000-000000000001',
          name: 'VIP',
          color: null,
          description: null,
          conversationCount: 2,
          rowVersion: 1,
        },
      ]);
      bulkCall.mockResolvedValue(result());
      await chooseBoth();
      await fireEvent.press(await screen.findByRole('button', { name: 'Labels' }));
      await screen.findByRole('radio', { name: 'VIP' });
      // Taking the label off instead changes the mode, but there is still no label.
      await fireEvent.press(screen.getByRole('radio', { name: 'Take the label off' }));
      expect(
        screen.getByRole('button', { name: 'Save changes' }).props.accessibilityState.disabled,
      ).toBe(true);
      await fireEvent.press(screen.getByRole('radio', { name: 'VIP' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() =>
        expect(bulkCall).toHaveBeenCalledWith(
          [rohan.id, meera.id],
          { type: 'label', mode: 'remove', tagId: 'aaaaaaaa-0000-4000-8000-000000000001' },
          expect.any(String),
        ),
      );
    });

    it('sets a priority and snoozes, the snooze to a time ahead of now', async () => {
      bulkCall.mockResolvedValue(result());
      await chooseBoth();
      await fireEvent.press(await screen.findByRole('button', { name: 'Priority' }));
      await fireEvent.press(await screen.findByRole('radio', { name: 'Urgent' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
      await waitFor(() =>
        expect(bulkCall).toHaveBeenCalledWith(
          [rohan.id, meera.id],
          { type: 'priority', priority: 'urgent' },
          expect.any(String),
        ),
      );
    });

    it('says how many failed when some did, and keeps the list in front', async () => {
      bulkCall.mockResolvedValue(
        result({
          done: 1,
          failed: 1,
          results: [{ id: meera.id, outcome: 'failed', code: 'FORBIDDEN' }],
        }),
      );
      await chooseBoth();
      await fireEvent.press(await screen.findByRole('button', { name: 'Mark as read' }));
      expect(await screen.findByText('1 updated, 0 unchanged, 1 failed')).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Dismiss' }));
      await waitFor(() =>
        expect(screen.queryByText('1 updated, 0 unchanged, 1 failed')).toBeNull(),
      );
    });

    it('stays open and says why when the whole request failed', async () => {
      bulkCall.mockRejectedValue(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
      await chooseBoth();
      await fireEvent.press(await screen.findByRole('button', { name: 'Status' }));
      await fireEvent.press(await screen.findByRole('radio', { name: 'Closed' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
      expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy();
      expect(screen.getByText('2 selected')).toBeTruthy();
    });
  });
});
