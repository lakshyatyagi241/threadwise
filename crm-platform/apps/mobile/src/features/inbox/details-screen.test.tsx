import type { ConversationEvent, ConversationNote } from '@crm/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ApiError } from '@/lib/api';
import { fetchSession } from '@/lib/session/api';
import {
  CONVERSATION_ID,
  detail,
  inboxSession,
  summary,
  withPermissions,
} from '@/test/inbox-fixtures';
import { renderApp } from '@/test/render';
import * as api from './api';
import { ConversationDetailsScreen } from './details-screen';
import * as labels from './labels-api';
import * as notesApi from './notes-api';

jest.mock('./api');
jest.mock('./notes-api');
jest.mock('./labels-api');
jest.mock('@/lib/session/api');
jest.mock('expo-linking', () => ({ openURL: jest.fn() }));
jest.mock('expo-router', () => ({ useRouter: jest.fn(), useLocalSearchParams: jest.fn() }));

const sessionCall = jest.mocked(fetchSession);
const detailCall = jest.mocked(api.fetchConversation);
const statusCall = jest.mocked(api.setConversationStatus);
const assignCall = jest.mocked(api.assignConversation);
const assigneesCall = jest.mocked(api.fetchAssignees);
const priorityCall = jest.mocked(api.setConversationPriority);
const snoozeCall = jest.mocked(api.snoozeConversation);
const notesCall = jest.mocked(notesApi.fetchNotes);
const addNoteCall = jest.mocked(notesApi.addNote);
const deleteNoteCall = jest.mocked(notesApi.deleteNote);
const eventsCall = jest.mocked(notesApi.fetchEvents);
const libraryCall = jest.mocked(labels.fetchLabelLibrary);
const back = jest.fn();
const push = jest.fn();

const ME = inboxSession.user.id;
const OTHER = '22222222-2222-4222-8222-222222222222';
const CONTACT_ID = '88888888-8888-4888-8888-888888888888';
const PAST_ID = '99999999-9999-4999-8999-999999999999';
const NOTE_MINE = 'bbbbbbbb-0000-4000-8000-000000000001';
const NOTE_THEIRS = 'bbbbbbbb-0000-4000-8000-000000000002';

const contactSummary = {
  id: CONTACT_ID,
  displayId: 'CON-0001',
  name: 'Rohan Mehta',
  email: 'rohan@example.test',
  phone: '+919800000001',
  lifecycleStage: 'Customer',
  status: 'Open',
  ownerName: 'Asha Verma',
  source: 'WhatsApp',
  isUnsubscribed: false,
  whatsappSubscriptionStatus: null,
  leadScore: 72,
  leadScoreSource: 'manual' as const,
  leadScoreReasons: null,
  leadScoredAt: null,
  leadScoreModel: null,
  createdAt: '2026-09-01T08:00:00.000Z',
};
const past = {
  id: PAST_ID,
  channel: {
    id: '22222222-2222-4222-8222-222222222222',
    kind: 'whatsapp_cloud',
    name: 'Support line',
  },
  title: 'Rohan Mehta',
  preview: 'Thanks, the refund came through',
  status: 'resolved' as const,
  lastMessageAt: '2026-09-20T09:30:00.000Z',
};
const note = (
  id: string,
  userId: string | null,
  name: string | null,
  body: string,
): ConversationNote => ({
  id,
  conversationId: CONVERSATION_ID,
  author: { userId, name },
  body,
  mentions: [],
  isPinned: false,
  editedAt: null,
  createdAt: '2026-10-11T09:30:00.000Z',
  rowVersion: 1,
});
const event = (
  id: string,
  type: string,
  name: string | null,
  kind: 'user' | 'system' = 'user',
): ConversationEvent => ({
  id,
  conversationId: CONVERSATION_ID,
  type,
  actor: { kind, userId: null, name },
  payload: {},
  createdAt: '2026-10-11T09:30:00.000Z',
});
const page = <T,>(data: T[]) => ({ data, page: { nextCursor: null, hasMore: false, limit: 100 } });

let client: QueryClient | undefined;
async function show() {
  const view = await renderApp(<ConversationDetailsScreen />);
  client = view.queryClient;
  client.setDefaultOptions({ ...client.getDefaultOptions(), mutations: { gcTime: 0 } });
  return view;
}
const as = (...extra: string[]) =>
  sessionCall.mockResolvedValue(withPermissions(['inbox.conversation.read', ...extra]));

function arrange(over: Parameters<typeof detail>[0] = {}) {
  detailCall.mockResolvedValue(detail({ contactSummary, pastConversations: [past], ...over }));
  notesCall.mockResolvedValue(
    page([
      note(NOTE_MINE, ME, 'Asha Verma', 'Customer prefers calls after 5'),
      note(NOTE_THEIRS, OTHER, 'Kabir Rao', 'Refund approved'),
    ]),
  );
  eventsCall.mockResolvedValue(
    page([
      event('cccccccc-0000-4000-8000-000000000001', 'assigned', 'Asha Verma'),
      event('cccccccc-0000-4000-8000-000000000002', 'routing_rule_matched', null, 'system'),
    ]),
  );
  libraryCall.mockResolvedValue([]);
}

beforeEach(() => {
  jest.resetAllMocks();
  client = undefined;
  jest.mocked(useRouter).mockReturnValue({ back, push } as unknown as ReturnType<typeof useRouter>);
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: CONVERSATION_ID });
  as();
});
afterEach(async () => {
  if (client) {
    const cache = client;
    await waitFor(() => expect(cache.isFetching()).toBe(0));
  }
});

describe('ConversationDetailsScreen: the customer', () => {
  it('shows who the customer is, and opens their record or calls them', async () => {
    arrange();
    await show();
    expect(await screen.findByRole('header', { name: 'Rohan Mehta' })).toBeTruthy();
    for (const text of ['rohan@example.test', 'Customer', 'Asha Verma', 'WhatsApp', '72']) {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    }
    await fireEvent.press(screen.getByRole('button', { name: 'Open contact' }));
    expect(push).toHaveBeenCalledWith({ pathname: '/contact/[id]', params: { id: CONTACT_ID } });
    await fireEvent.press(screen.getByRole('button', { name: 'Call' }));
    expect(Linking.openURL).toHaveBeenCalledWith('tel:+919800000001');
  });

  it('says there is no contact record yet, and offers neither call nor open', async () => {
    arrange({ contactSummary: null });
    await show();
    expect(await screen.findByText('This conversation has no contact record yet.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open contact' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Call' })).toBeNull();
  });

  it('says when the contact opted out of messages', async () => {
    arrange({ contactSummary: { ...contactSummary, isUnsubscribed: true } });
    await show();
    expect(await screen.findByText('Opted out of messages')).toBeTruthy();
  });

  it('goes back', async () => {
    arrange();
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Back' }));
    expect(back).toHaveBeenCalled();
  });
});

describe('ConversationDetailsScreen: access and failures', () => {
  it('explains a missing permission and asks for nothing', async () => {
    sessionCall.mockResolvedValue(withPermissions([]));
    arrange();
    await show();
    expect(await screen.findByText('No access to this conversation')).toBeTruthy();
    expect(detailCall).not.toHaveBeenCalled();
  });

  it('says why the conversation could not be loaded, and loads it on retry', async () => {
    arrange();
    detailCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    await show();
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('header', { name: 'Rohan Mehta' })).toBeTruthy();
  });
});

describe('ConversationDetailsScreen: actions', () => {
  it('shows what the status, priority, labels and agent are now, as plain lines without the rights', async () => {
    arrange({ labels: [{ id: 'aaaaaaaa-0000-4000-8000-000000000001', name: 'VIP', color: null }] });
    await show();
    await screen.findByRole('header', { name: 'Rohan Mehta' });
    expect(screen.getByLabelText('Status: Open')).toBeTruthy();
    expect(screen.getByLabelText('Priority: Normal')).toBeTruthy();
    expect(screen.getByLabelText('Labels: VIP')).toBeTruthy();
    expect(screen.getByLabelText('Assigned agent: Unassigned')).toBeTruthy();
    // No right to change them: none of the rows is a button.
    expect(screen.queryByRole('button', { name: 'Status' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Assigned agent' })).toBeNull();
  });

  it('says "You" when the person has it', async () => {
    arrange({ assignment: { user: { id: ME, name: 'Asha Verma' }, team: null, aiAgent: null } });
    await show();
    expect(await screen.findByLabelText('Assigned agent: You')).toBeTruthy();
  });

  it('names a colleague who has it', async () => {
    arrange({ assignment: { user: { id: OTHER, name: 'Kabir Rao' }, team: null, aiAgent: null } });
    await show();
    expect(await screen.findByLabelText('Assigned agent: Kabir Rao')).toBeTruthy();
  });

  it('names the bot when an AI agent has it', async () => {
    arrange({ assignment: { user: null, team: null, aiAgent: { id: OTHER, name: 'Sales bot' } } });
    await show();
    expect(await screen.findByLabelText('Assigned agent: Sales bot')).toBeTruthy();
  });

  it('changes the status from the legal ones, with the row version it read', async () => {
    as('inbox.conversation.resolve');
    arrange();
    statusCall.mockResolvedValue(summary({ status: 'resolved', rowVersion: 5 }));
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Status' }));
    expect(
      (await screen.findByRole('radio', { name: 'Open' })).props.accessibilityState.checked,
    ).toBe(true);
    expect(screen.getByRole('radio', { name: 'Pending' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'Resolved' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(statusCall).toHaveBeenCalledWith(CONVERSATION_ID, {
        rowVersion: 4,
        status: 'resolved',
      }),
    );
  });

  it('offers only the moves the status allows: a snoozed conversation cannot become pending', async () => {
    as('inbox.conversation.resolve');
    arrange({ status: 'snoozed' });
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Status' }));
    await screen.findByRole('radio', { name: 'Open' });
    expect(screen.queryByRole('radio', { name: 'Pending' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'Resolved' })).toBeTruthy();
  });

  it('puts the person as the agent with "Assign to me"', async () => {
    as('inbox.conversation.assign_self');
    arrange();
    assignCall.mockResolvedValue(summary({ rowVersion: 5 }));
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Assign to me' }));
    await waitFor(() =>
      expect(assignCall).toHaveBeenCalledWith(
        CONVERSATION_ID,
        { rowVersion: 4, userId: ME },
        expect.any(String),
      ),
    );
  });

  it('says so under the actions when a change failed', async () => {
    as('inbox.conversation.assign_self');
    arrange();
    assignCall.mockRejectedValue(new ApiError(409, 'ROW_VERSION_CONFLICT', 'stale'));
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Assign to me' }));
    expect(await screen.findByText(/Someone else changed this conversation/)).toBeTruthy();
  });

  it('opens the agent picker for a person who may assign', async () => {
    as('inbox.conversation.assign');
    arrange();
    assigneesCall.mockResolvedValue({
      users: [
        {
          id: OTHER,
          name: 'Kabir Rao',
          email: 'kabir@example.test',
          availability: 'online',
          openConversations: 2,
          isMe: false,
        },
      ],
      teams: [],
    });
    assignCall.mockResolvedValue(summary({ rowVersion: 5 }));
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Assigned agent' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Kabir Rao, Online · 2 open' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(assignCall).toHaveBeenCalledWith(
        CONVERSATION_ID,
        { rowVersion: 4, userId: OTHER },
        expect.any(String),
      ),
    );
  });
});

describe('ConversationDetailsScreen: priority, snooze and waking up', () => {
  it('sets the priority, from what it is now', async () => {
    as('inbox.conversation.priority');
    arrange();
    priorityCall.mockResolvedValue(summary({ priority: 'urgent', rowVersion: 5 }));
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Priority' }));
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

  it('snoozes for an hour, to a time that is ahead of now', async () => {
    as('inbox.conversation.snooze');
    arrange();
    snoozeCall.mockResolvedValue(summary({ status: 'snoozed', rowVersion: 5 }));
    await show();
    const before = Date.now();
    await fireEvent.press(await screen.findByRole('button', { name: 'Snooze' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'In 1 hour' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(snoozeCall).toHaveBeenCalledTimes(1));
    const input = snoozeCall.mock.calls[0]?.[1];
    expect(input?.rowVersion).toBe(4);
    const gap = Date.parse(input?.until ?? '') - before;
    expect(gap).toBeGreaterThan(59 * 60_000);
    expect(gap).toBeLessThan(61 * 60_000);
  });

  it('offers no snooze for a conversation that is already finished, or without the right', async () => {
    as('inbox.conversation.snooze');
    arrange({ status: 'resolved' });
    await show();
    await screen.findByLabelText('Status: Resolved');
    expect(screen.queryByRole('button', { name: 'Snooze' })).toBeNull();
  });

  it('offers no snooze to a person without the right', async () => {
    arrange();
    await show();
    await screen.findByLabelText('Status: Open');
    expect(screen.queryByRole('button', { name: 'Snooze' })).toBeNull();
  });

  it('wakes a snoozed conversation by moving it to open', async () => {
    as('inbox.conversation.resolve');
    arrange({ status: 'snoozed' });
    statusCall.mockResolvedValue(summary({ status: 'open', rowVersion: 5 }));
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Wake up now' }));
    await waitFor(() =>
      expect(statusCall).toHaveBeenCalledWith(CONVERSATION_ID, { rowVersion: 4, status: 'open' }),
    );
  });

  it('has no wake-up for a person who may not move statuses', async () => {
    arrange({ status: 'snoozed' });
    await show();
    await screen.findByLabelText('Status: Snoozed');
    expect(screen.queryByRole('button', { name: 'Wake up now' })).toBeNull();
  });

  it('has no wake-up for a conversation that is not snoozed', async () => {
    as('inbox.conversation.resolve');
    arrange();
    await show();
    // With the right to move statuses the status line is a button, so it is found by its name.
    await screen.findByRole('button', { name: 'Status' });
    expect(screen.queryByRole('button', { name: 'Wake up now' })).toBeNull();
  });
});

describe('ConversationDetailsScreen: the reply window and the channel', () => {
  const until = new Date(2026, 9, 14, 15, 30).toISOString();

  it('says when the window is open until, and names the channel', async () => {
    arrange({ window: { open: true, expiresAt: until } });
    await show();
    expect(await screen.findByLabelText('Reply window: Open until 14/10/26, 3:30 PM')).toBeTruthy();
    expect(screen.getByLabelText('Channel: Support line')).toBeTruthy();
  });

  it('says when the window is closed', async () => {
    arrange({ window: { open: false, expiresAt: until } });
    await show();
    expect(await screen.findByLabelText('Reply window: Closed')).toBeTruthy();
  });

  it('says when there is no time limit', async () => {
    arrange({ window: { open: true, expiresAt: null } });
    await show();
    expect(await screen.findByLabelText('Reply window: No time limit')).toBeTruthy();
  });
});

describe('ConversationDetailsScreen: internal notes', () => {
  it('lists the notes with who wrote them', async () => {
    arrange();
    await show();
    expect(await screen.findByText('Customer prefers calls after 5')).toBeTruthy();
    expect(screen.getByText('Refund approved')).toBeTruthy();
    expect(screen.getByText(/Kabir Rao · 11\/10\/26/)).toBeTruthy();
  });

  it('writes a note, and clears the box when it was saved', async () => {
    as('inbox.conversation.note');
    arrange();
    addNoteCall.mockResolvedValue(note(NOTE_MINE, ME, 'Asha Verma', 'Call back tomorrow'));
    await show();
    await screen.findByText('Refund approved');
    const add = screen.getByRole('button', { name: 'Add note' });
    expect(add.props.accessibilityState.disabled).toBe(true);
    await fireEvent.changeText(screen.getByLabelText('Write a note'), '  Call back tomorrow ');
    await fireEvent.press(screen.getByRole('button', { name: 'Add note' }));
    await waitFor(() =>
      expect(addNoteCall).toHaveBeenCalledWith(
        CONVERSATION_ID,
        { body: 'Call back tomorrow', mentions: [] },
        expect.any(String),
      ),
    );
    await waitFor(() => expect(screen.getByLabelText('Write a note').props.value).toBe(''));
  });

  it('has no box to write in for a person who may not write notes', async () => {
    arrange();
    await show();
    await screen.findByText('Refund approved');
    expect(screen.queryByLabelText('Write a note')).toBeNull();
  });

  it('says so when a note could not be saved, and keeps what was typed', async () => {
    as('inbox.conversation.note');
    arrange();
    addNoteCall.mockRejectedValue(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    await show();
    await screen.findByText('Refund approved');
    await fireEvent.changeText(screen.getByLabelText('Write a note'), 'Call back');
    await fireEvent.press(screen.getByRole('button', { name: 'Add note' }));
    expect(await screen.findByText("Couldn't save the note. Try again.")).toBeTruthy();
    expect(screen.getByLabelText('Write a note').props.value).toBe('Call back');
  });

  it('lets the author delete a note after asking, and no one else', async () => {
    arrange();
    deleteNoteCall.mockResolvedValue(undefined as never);
    await show();
    await screen.findByText('Refund approved');
    expect(screen.getByRole('button', { name: 'Delete note by Asha Verma' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Delete note by Kabir Rao' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete note by Asha Verma' }));
    expect(deleteNoteCall).not.toHaveBeenCalled();
    const confirm = await screen.findAllByRole('button', { name: 'Delete' });
    await fireEvent.press(confirm[confirm.length - 1]!);
    await waitFor(() => expect(deleteNoteCall).toHaveBeenCalledWith(CONVERSATION_ID, NOTE_MINE));
  });

  it("lets a person who manages assignments delete anyone's note", async () => {
    as('inbox.conversation.assign');
    arrange();
    await show();
    await screen.findByText('Refund approved');
    expect(screen.getByRole('button', { name: 'Delete note by Kabir Rao' })).toBeTruthy();
  });

  it('says when there are no notes', async () => {
    arrange();
    notesCall.mockResolvedValue(page([]));
    await show();
    expect(await screen.findByText('No notes yet. Only your team sees notes.')).toBeTruthy();
  });

  it('says why the notes could not be loaded, and tries again', async () => {
    arrange();
    notesCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    await show();
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
    await fireEvent.press(screen.getAllByRole('button', { name: 'Try again' })[0]!);
    expect(await screen.findByText('Refund approved')).toBeTruthy();
  });
});

describe('ConversationDetailsScreen: the timeline', () => {
  it('names each event in words and says who did it; a system event says System', async () => {
    arrange();
    await show();
    const assigned = await screen.findByTestId('event-cccccccc-0000-4000-8000-000000000001');
    expect(within(assigned).getByText('Assigned')).toBeTruthy();
    expect(within(assigned).getByText(/^Asha Verma · 11\/10\/26/)).toBeTruthy();
    // A type the app has no words for is shown with its underscores turned into spaces.
    const routed = screen.getByTestId('event-cccccccc-0000-4000-8000-000000000002');
    expect(within(routed).getByText('Routing rule matched')).toBeTruthy();
    expect(within(routed).getByText(/^System · 11\/10\/26/)).toBeTruthy();
  });

  it('says when nothing has happened yet', async () => {
    arrange();
    eventsCall.mockResolvedValue(page([]));
    await show();
    expect(await screen.findByText('Nothing has happened yet.')).toBeTruthy();
  });
});

describe('ConversationDetailsScreen: previous conversations', () => {
  it("lists the customer's other conversations and opens one", async () => {
    arrange();
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Rohan Mehta' }));
    expect(push).toHaveBeenCalledWith({ pathname: '/conversation/[id]', params: { id: PAST_ID } });
  });

  it('says when there are none', async () => {
    arrange({ pastConversations: [] });
    await show();
    expect(await screen.findByText('No other conversations with this contact.')).toBeTruthy();
  });
});
