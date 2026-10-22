import type { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ApiError } from '@/lib/api';
import { fetchSession } from '@/lib/session/api';
import { aarav } from '@/test/contacts-fixtures';
import { renderApp } from '@/test/render';
import {
  callAarav,
  contactChoices,
  sessionNoTasks,
  sessionTasksComplete,
  sessionTasksFull,
  sessionTasksReadOnly,
  team,
} from '@/test/tasks-fixtures';
import * as api from './api';
import { showDate, showTime } from '@/components/ui/date-time-fields';
import { longDateLabel } from '@/components/ui/calendar-range.dates';
import { fromDueAt, toDueAt } from '@/lib/format/dates';
import { TaskFormScreen } from './task-form-screen';

jest.mock('./api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn(), useLocalSearchParams: jest.fn() }));

const sessionCall = jest.mocked(fetchSession);
const createCall = jest.mocked(api.createTask);
const updateCall = jest.mocked(api.updateTask);
const getCall = jest.mocked(api.getTask);
const teamCall = jest.mocked(api.listAssignees);
const searchCall = jest.mocked(api.searchContacts);
const contactCall = jest.mocked(api.getLinkedContact);
const typesCall = jest.mocked(api.listTaskTypes);
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() };

const DEV = team[1]!;

const settled = (queryClient: QueryClient) =>
  waitFor(() => expect(queryClient.isFetching()).toBe(0));

let client: QueryClient | undefined;
async function show() {
  const view = await renderApp(<TaskFormScreen />);
  client = view.queryClient;
  return view;
}

const save = async () => await fireEvent.press(screen.getByRole('button', { name: 'Save task' }));
const typeTitle = async (text: string) =>
  await fireEvent.changeText(await screen.findByLabelText('Task title'), text);

/** A day of the month on screen, as 'YYYY-MM-DD' (the 28th exists in every month, and the calendar opens on this month). */
const thisMonth28 = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-28`;
};
const pickDate = async (day: string) => {
  await fireEvent.press(screen.getByRole('button', { name: 'Date' }));
  await fireEvent.press(
    await screen.findByRole('button', { name: new RegExp(`^${longDateLabel(day, 'en')}`) }),
  );
};
const pickTime = async (hour: string, minute: string) => {
  await fireEvent.press(screen.getByRole('button', { name: 'Time' }));
  const radio = (group: string, name: string) =>
    within(screen.getByLabelText(group)).getByRole('radio', { name });
  await fireEvent.press(radio('Hour', hour));
  await fireEvent.press(radio('Minute', minute));
  await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
};
/** The new form starts on now, so a task with nothing else filled still carries a due date. */
const NOW = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00[+-]\d{2}:\d{2}$/);
const valueOf = (name: string) =>
  screen.getByRole('button', { name }).props.accessibilityValue.text;

beforeEach(() => {
  jest.resetAllMocks();
  client = undefined;
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  jest.mocked(useLocalSearchParams).mockReturnValue({});
  router.canGoBack.mockReturnValue(true);
  sessionCall.mockResolvedValue(sessionTasksFull);
  createCall.mockResolvedValue(callAarav);
  updateCall.mockResolvedValue(callAarav);
  getCall.mockResolvedValue(callAarav);
  teamCall.mockResolvedValue(team);
  searchCall.mockResolvedValue(contactChoices);
  contactCall.mockResolvedValue(aarav);
  typesCall.mockResolvedValue([]);
});
afterEach(async () => {
  if (client) {
    const cache = client;
    await settled(cache);
  }
});

describe('adding a task', () => {
  it('shows the fields in the Geta order under the Add task header', async () => {
    await show();
    expect(await screen.findByRole('header', { name: 'Add task' })).toBeTruthy();
    const order = [
      screen.getByLabelText('Task title'),
      screen.getByLabelText('Task description'),
      screen.getByRole('button', { name: 'Link contact (optional)' }),
      screen.getByRole('button', { name: 'Priority' }),
      screen.getByRole('button', { name: 'Date' }),
      screen.getByRole('button', { name: 'Time' }),
      screen.getByRole('button', { name: 'Owner' }),
    ];
    expect(order).toHaveLength(7);
    expect(screen.getByLabelText('Task title').props.placeholder).toBe('Enter title');
    expect(valueOf('Link contact (optional)')).toBe('Type to search contact…');
    expect(valueOf('Priority')).toBe('Medium');
    // Date and Time start on now, as the Geta form's do.
    expect(valueOf('Date')).toBe(showDate(fromDueAt(new Date().toISOString()).date, 'en'));
    expect(valueOf('Time')).not.toBe('Select time');
    expect(valueOf('Owner')).toBe('Me');
    // The workspace has no task types here, so there is no dropdown for them.
    expect(screen.queryByRole('button', { name: 'Task type' })).toBeNull();
  });

  it('creates the task with just a title, for me, with the default priority', async () => {
    await show();
    await typeTitle('  Call Aarav  ');
    await save();
    await waitFor(() =>
      expect(createCall).toHaveBeenCalledWith(
        { title: 'Call Aarav', priority: 'medium', dueAt: NOW },
        expect.any(String),
      ),
    );
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('sends every field that is filled, the due date as an ISO instant with the UTC offset', async () => {
    await show();
    await typeTitle('Send the quote');
    await fireEvent.changeText(screen.getByLabelText('Task description'), ' 40 seats ');
    await fireEvent.press(screen.getByRole('button', { name: 'Priority' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'High' }));
    const day = thisMonth28();
    await pickDate(day);
    expect(valueOf('Date')).toBe(showDate(day, 'en'));
    await pickTime('14', '30');
    expect(valueOf('Time')).toBe(showTime('14:30', 'en'));
    await save();
    await waitFor(() => expect(createCall).toHaveBeenCalled());
    const body = createCall.mock.calls[0]?.[0];
    expect(body).toEqual({
      title: 'Send the quote',
      notes: '40 seats',
      priority: 'high',
      dueAt: toDueAt(day, '14:30'),
    });
    expect(body?.dueAt).toMatch(new RegExp(`^${day}T14:30:00[+-]\\d{2}:\\d{2}$`));
    expect(body).not.toHaveProperty('assigneeId');
  });

  describe('checks before sending anything', () => {
    it('needs a title', async () => {
      await show();
      await screen.findByLabelText('Task title');
      await save();
      expect(await screen.findByText('Enter a task title.')).toBeTruthy();
      expect(createCall).not.toHaveBeenCalled();
    });

    it('needs a letter in the title and at most 255 characters', async () => {
      await show();
      await typeTitle('12345 !!');
      await save();
      expect(await screen.findByText('The title must contain at least one letter.')).toBeTruthy();
      await typeTitle('a'.repeat(256));
      await save();
      expect(await screen.findByText('The title can be at most 255 characters.')).toBeTruthy();
      expect(createCall).not.toHaveBeenCalled();
    });

    it('clears a message once the field is changed', async () => {
      await show();
      await screen.findByLabelText('Task title');
      await save();
      await screen.findByText('Enter a task title.');
      await typeTitle('Call');
      expect(screen.queryByText('Enter a task title.')).toBeNull();
    });

    it('wants the date and the time together', async () => {
      await show();
      await typeTitle('Call');
      await fireEvent.press(screen.getByRole('button', { name: 'Time' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Clear' }));
      await save();
      expect(await screen.findByText('Enter the time as well.')).toBeTruthy();
      await pickTime('09', '05');
      await save();
      await waitFor(() => expect(createCall).toHaveBeenCalledTimes(1));
    });

    it('sends no due date once the day and the time are both cleared', async () => {
      await show();
      await typeTitle('Call');
      await fireEvent.press(screen.getByRole('button', { name: 'Time' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Clear' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Date' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Clear' }));
      expect(valueOf('Date')).toBe('Select date');
      expect(valueOf('Time')).toBe('Select time');
      await save();
      await waitFor(() =>
        expect(createCall).toHaveBeenCalledWith(
          { title: 'Call', priority: 'medium' },
          expect.any(String),
        ),
      );
    });
  });

  describe('the task type', () => {
    const FOLLOW_UP = '77777777-7777-4777-8777-777777777771';
    const types = [
      {
        id: FOLLOW_UP,
        kind: 'type',
        key: 'follow_up',
        name: null,
        isSystem: true,
        countsAs: null,
        position: 0,
      },
      {
        id: '77777777-7777-4777-8777-777777777772',
        kind: 'type',
        key: 'call_reminder',
        name: null,
        isSystem: true,
        countsAs: null,
        position: 1,
      },
      {
        id: '77777777-7777-4777-8777-777777777773',
        kind: 'type',
        key: 'site_visit',
        name: 'Site visit',
        isSystem: false,
        countsAs: null,
        position: 2,
      },
    ] as const;

    it('offers the workspace’s types, named in the app’s words, and sends the one chosen', async () => {
      typesCall.mockResolvedValue([...types]);
      await show();
      await typeTitle('Call');
      expect(await screen.findByRole('button', { name: 'Task type' })).toBeTruthy();
      expect(valueOf('Task type')).toBe('Select type');
      await fireEvent.press(screen.getByRole('button', { name: 'Task type' }));
      expect(screen.getByRole('radio', { name: 'Call reminder' })).toBeTruthy();
      expect(screen.getByRole('radio', { name: 'Site visit' })).toBeTruthy();
      await fireEvent.press(screen.getByRole('radio', { name: 'Follow up' }));
      expect(valueOf('Task type')).toBe('Follow up');
      await save();
      await waitFor(() =>
        expect(createCall).toHaveBeenCalledWith(
          { title: 'Call', priority: 'medium', taskTypeId: FOLLOW_UP, dueAt: NOW },
          expect.any(String),
        ),
      );
    });

    it('sends no type when none is chosen', async () => {
      typesCall.mockResolvedValue([...types]);
      await show();
      await typeTitle('Call');
      await screen.findByRole('button', { name: 'Task type' });
      await save();
      await waitFor(() =>
        expect(createCall).toHaveBeenCalledWith(
          { title: 'Call', priority: 'medium', dueAt: NOW },
          expect.any(String),
        ),
      );
    });
  });

  describe('the owner', () => {
    const openOwner = async () => {
      await fireEvent.press(await screen.findByRole('button', { name: 'Owner' }));
    };

    it('lists the team from the API, and sends the member chosen', async () => {
      await show();
      await typeTitle('Call');
      await openOwner();
      expect(
        await screen.findByRole('radio', { name: 'Dev Patel, dev@example.test' }),
      ).toBeTruthy();
      // The caller is already "Me": not listed twice.
      expect(screen.queryByRole('radio', { name: /Asha Verma/ })).toBeNull();
      await fireEvent.press(screen.getByRole('radio', { name: 'Dev Patel, dev@example.test' }));
      expect(screen.getByRole('button', { name: 'Owner' }).props.accessibilityValue.text).toBe(
        'Dev Patel',
      );
      await save();
      await waitFor(() =>
        expect(createCall).toHaveBeenCalledWith(
          { title: 'Call', priority: 'medium', assigneeId: DEV.id, dueAt: NOW },
          expect.any(String),
        ),
      );
    });

    it('sends null for Unassigned', async () => {
      await show();
      await typeTitle('Call');
      await openOwner();
      await fireEvent.press(screen.getByRole('radio', { name: 'Unassigned' }));
      await save();
      await waitFor(() =>
        expect(createCall).toHaveBeenCalledWith(
          { title: 'Call', priority: 'medium', assigneeId: null, dueAt: NOW },
          expect.any(String),
        ),
      );
    });

    it('still offers Me and Unassigned when the team cannot be loaded, and lets the person retry', async () => {
      teamCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
      await show();
      await openOwner();
      expect(await screen.findByText("Couldn't load your team.")).toBeTruthy();
      expect(screen.getByRole('radio', { name: 'Me' })).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
      expect(
        await screen.findByRole('radio', { name: 'Dev Patel, dev@example.test' }),
      ).toBeTruthy();
    });

    it('does not ask for the team of a person who may not read contacts', async () => {
      sessionCall.mockResolvedValue({
        ...sessionTasksFull,
        permissions: { 'record.tasks.create': 'all' },
      });
      await show();
      await openOwner();
      expect(screen.getByRole('radio', { name: 'Me' })).toBeTruthy();
      expect(screen.getByRole('radio', { name: 'Unassigned' })).toBeTruthy();
      expect(teamCall).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'Link contact (optional)' })).toBeNull();
    });
  });

  describe('the contact', () => {
    it('is the one the form was opened for, read only, and is sent with the task', async () => {
      jest.mocked(useLocalSearchParams).mockReturnValue({ contactId: aarav.id });
      await show();
      expect(await screen.findByText('Aarav Sharma')).toBeTruthy();
      expect(contactCall).toHaveBeenCalledWith(aarav.id, expect.anything());
      expect(screen.queryByRole('button', { name: 'Link contact (optional)' })).toBeNull();
      await typeTitle('Call');
      await save();
      await waitFor(() =>
        expect(createCall).toHaveBeenCalledWith(
          { title: 'Call', priority: 'medium', contactId: aarav.id, dueAt: NOW },
          expect.any(String),
        ),
      );
    });

    it('can be searched and linked when the form was opened without one', async () => {
      await show();
      await typeTitle('Call');
      await fireEvent.press(await screen.findByRole('button', { name: 'Link contact (optional)' }));
      expect(await screen.findByRole('radio', { name: 'No contact' })).toBeTruthy();
      await fireEvent.changeText(screen.getByLabelText('Search contacts'), 'aar');
      await waitFor(() => expect(searchCall).toHaveBeenLastCalledWith('aar', expect.anything()));
      await fireEvent.press(
        await screen.findByRole('radio', { name: 'Aarav Sharma, aarav@example.test' }),
      );
      expect(
        screen.getByRole('button', { name: 'Link contact (optional)' }).props.accessibilityValue
          .text,
      ).toBe('Aarav Sharma');
      await save();
      await waitFor(() =>
        expect(createCall).toHaveBeenCalledWith(
          { title: 'Call', priority: 'medium', contactId: aarav.id, dueAt: NOW },
          expect.any(String),
        ),
      );
    });

    it('shows a contact with only a phone by its number', async () => {
      await show();
      await fireEvent.press(await screen.findByRole('button', { name: 'Link contact (optional)' }));
      expect(await screen.findByRole('radio', { name: '+919800000002' })).toBeTruthy();
    });

    it('says when nothing matches or the search fails', async () => {
      searchCall.mockResolvedValueOnce([]);
      await show();
      await fireEvent.press(await screen.findByRole('button', { name: 'Link contact (optional)' }));
      expect(await screen.findByText('No contacts found.')).toBeTruthy();
      searchCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
      await fireEvent.changeText(screen.getByLabelText('Search contacts'), 'zzz');
      expect(await screen.findByText("Couldn't load contacts.")).toBeTruthy();
    });

    it('can be unlinked with No contact', async () => {
      await show();
      await typeTitle('Call');
      await fireEvent.press(await screen.findByRole('button', { name: 'Link contact (optional)' }));
      await fireEvent.press(
        await screen.findByRole('radio', { name: 'Aarav Sharma, aarav@example.test' }),
      );
      await fireEvent.press(screen.getByRole('button', { name: 'Link contact (optional)' }));
      await fireEvent.press(screen.getByRole('radio', { name: 'No contact' }));
      await save();
      await waitFor(() =>
        expect(createCall).toHaveBeenCalledWith(
          { title: 'Call', priority: 'medium', dueAt: NOW },
          expect.any(String),
        ),
      );
    });
  });

  describe('when the server refuses', () => {
    it('shows what it named under the field', async () => {
      createCall.mockRejectedValue(
        new ApiError(422, 'VALIDATION_FAILED', 'Invalid', undefined, [
          { path: 'dueAt', message: 'Invalid datetime' },
        ]),
      );
      await show();
      await typeTitle('Call');
      await save();
      expect(await screen.findByText("This due date and time can't be used.")).toBeTruthy();
      expect(router.back).not.toHaveBeenCalled();
    });

    it('says a refused assignee in a banner', async () => {
      createCall.mockRejectedValue(new ApiError(422, 'TASK_ASSIGNEE_INVALID', 'Bad assignee'));
      await show();
      await typeTitle('Call');
      await save();
      expect(
        await screen.findByText("That person can't be given tasks. Choose another owner."),
      ).toBeTruthy();
    });

    it('says when the plan has no tasks', async () => {
      createCall.mockRejectedValue(new ApiError(422, 'PLAN_FEATURE_LOCKED', 'Locked'));
      await show();
      await typeTitle('Call');
      await save();
      expect(await screen.findByText('Tasks are not included in this plan.')).toBeTruthy();
    });

    it('shows any other failure above the form, and a retry is the same request', async () => {
      createCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
      await show();
      await typeTitle('Call');
      await save();
      expect(
        await screen.findByText("Can't reach the server. Check your connection and try again."),
      ).toBeTruthy();
      await save();
      await waitFor(() => expect(router.back).toHaveBeenCalled());
      // A lost connection repeats the same request: the same idempotency key.
      expect(createCall.mock.calls[1]?.[1]).toBe(createCall.mock.calls[0]?.[1]);
    });

    it('uses a new key for a corrected form', async () => {
      createCall.mockRejectedValueOnce(new ApiError(422, 'VALIDATION_FAILED', 'Invalid'));
      await show();
      await typeTitle('Call');
      await save();
      await screen.findByRole('alert');
      await typeTitle('Call Aarav');
      await save();
      await waitFor(() => expect(createCall).toHaveBeenCalledTimes(2));
      expect(createCall.mock.calls[1]?.[1]).not.toBe(createCall.mock.calls[0]?.[1]);
    });
  });

  it('goes back from the header, to the list when there is nowhere to go back to', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Back' }));
    expect(router.back).toHaveBeenCalled();
    router.canGoBack.mockReturnValue(false);
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(router.replace).toHaveBeenCalledWith('/tasks');
  });

  it('is closed to a person who may not add tasks', async () => {
    sessionCall.mockResolvedValue(sessionTasksReadOnly);
    await show();
    expect(await screen.findByText("You can't add tasks")).toBeTruthy();
    expect(screen.queryByLabelText('Task title')).toBeNull();
    sessionCall.mockResolvedValue(sessionNoTasks);
  });
});

describe('editing a task', () => {
  beforeEach(() => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ taskId: callAarav.id });
  });

  it('opens with the task’s own values under the Edit task header', async () => {
    await show();
    expect(await screen.findByRole('header', { name: 'Edit task' })).toBeTruthy();
    expect(getCall).toHaveBeenCalledWith(callAarav.id, expect.anything());
    expect((await screen.findByLabelText('Task title')).props.value).toBe(
      'Call Aarav about the quote',
    );
    expect(screen.getByLabelText('Task description').props.value).toBe(
      'Ask whether the quote for 40 seats is approved.',
    );
    const due = fromDueAt(callAarav.dueAt);
    expect(valueOf('Date')).toBe(showDate(due.date, 'en'));
    expect(valueOf('Time')).toBe(showTime(due.time, 'en'));
    expect(valueOf('Priority')).toBe('Medium');
    expect(valueOf('Owner')).toBe('Me');
    expect(valueOf('Link contact (optional)')).toBe('Aarav Sharma');
  });

  it('sends only what changed, with the version that was read, and goes back', async () => {
    await show();
    await typeTitle('Call Aarav today');
    await fireEvent.press(screen.getByRole('button', { name: 'Priority' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'High' }));
    await save();
    await waitFor(() =>
      expect(updateCall).toHaveBeenCalledWith(
        callAarav.id,
        { title: 'Call Aarav today', priority: 'high', rowVersion: 2 },
        expect.any(String),
      ),
    );
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(createCall).not.toHaveBeenCalled();
  });

  it('clears what was emptied with null', async () => {
    await show();
    await screen.findByLabelText('Task title');
    await fireEvent.changeText(screen.getByLabelText('Task description'), '');
    await fireEvent.press(screen.getByRole('button', { name: 'Date' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Clear' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Time' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Clear' }));
    await save();
    await waitFor(() =>
      expect(updateCall).toHaveBeenCalledWith(
        callAarav.id,
        { notes: null, dueAt: null, rowVersion: 2 },
        expect.any(String),
      ),
    );
  });

  it('sends nothing when nothing changed, and just goes back', async () => {
    await show();
    await screen.findByLabelText('Task title');
    await save();
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(updateCall).not.toHaveBeenCalled();
  });

  it('reloads the task and asks the person to review it when someone else saved first', async () => {
    updateCall.mockRejectedValue(new ApiError(409, 'ROW_VERSION_CONFLICT', 'Conflict'));
    await show();
    await typeTitle('My title');
    getCall.mockResolvedValue({ ...callAarav, title: 'Their title', rowVersion: 3 });
    await save();
    expect(
      await screen.findByText('This task was changed by someone else. Review and save again.'),
    ).toBeTruthy();
    await waitFor(() => expect(getCall).toHaveBeenCalledTimes(2));
    // The form shows the other person's values, and saving again sends the new version.
    await waitFor(() =>
      expect(screen.getByLabelText('Task title').props.value).toBe('Their title'),
    );
    updateCall.mockResolvedValue(callAarav);
    await typeTitle('Merged title');
    await save();
    await waitFor(() =>
      expect(updateCall).toHaveBeenLastCalledWith(
        callAarav.id,
        { title: 'Merged title', rowVersion: 3 },
        expect.any(String),
      ),
    );
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('says when the task is gone', async () => {
    getCall.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Gone'));
    await show();
    expect(await screen.findByText('This task no longer exists.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save task' })).toBeNull();
  });

  it('shows the failure to load in words with a way to try again', async () => {
    getCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    await show();
    expect(
      await screen.findByText("Can't reach the server. Check your connection and try again."),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Task title')).toBeTruthy();
  });

  it('keeps the task’s contact read only for a person who may not list contacts', async () => {
    sessionCall.mockResolvedValue({
      ...sessionTasksComplete,
      permissions: { 'record.tasks.read': 'all', 'record.tasks.update': 'all' },
    });
    await show();
    await screen.findByLabelText('Task title');
    expect(screen.getByText('Aarav Sharma')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Link contact (optional)' })).toBeNull();
    await typeTitle('Call Aarav today');
    await save();
    await waitFor(() =>
      expect(updateCall).toHaveBeenCalledWith(
        callAarav.id,
        { title: 'Call Aarav today', rowVersion: 2 },
        expect.any(String),
      ),
    );
  });

  it('is closed to a person who may not update tasks', async () => {
    sessionCall.mockResolvedValue(sessionTasksReadOnly);
    await show();
    expect(await screen.findByText("You can't edit tasks")).toBeTruthy();
    expect(getCall).not.toHaveBeenCalled();
    expect(screen.getByRole('header', { name: 'Edit task' })).toBeTruthy();
  });
});
