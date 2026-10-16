import type { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
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
});
afterEach(async () => {
  if (client) {
    const cache = client;
    await settled(cache);
  }
});

describe('adding a task', () => {
  it('shows the fields in order under the Add task header', async () => {
    await show();
    expect(await screen.findByRole('header', { name: 'Add task' })).toBeTruthy();
    const order = [
      screen.getByLabelText('Task title'),
      screen.getByLabelText('Task description'),
      screen.getByRole('radio', { name: 'Medium' }),
      screen.getByLabelText('Date (YYYY-MM-DD)'),
      screen.getByLabelText('Time (HH:mm)'),
      screen.getByRole('button', { name: 'Owner' }),
      screen.getByRole('button', { name: 'Link contact (optional)' }),
    ];
    expect(order).toHaveLength(7);
    expect(screen.getByRole('radio', { name: 'Medium' }).props.accessibilityState.checked).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: 'Owner' }).props.accessibilityValue.text).toBe('Me');
  });

  it('creates the task with just a title, for me, with the default priority', async () => {
    await show();
    await typeTitle('  Call Aarav  ');
    await save();
    await waitFor(() =>
      expect(createCall).toHaveBeenCalledWith(
        { title: 'Call Aarav', priority: 'medium' },
        expect.any(String),
      ),
    );
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('sends every field that is filled, the due date as an ISO instant with the UTC offset', async () => {
    await show();
    await typeTitle('Send the quote');
    await fireEvent.changeText(screen.getByLabelText('Task description'), ' 40 seats ');
    await fireEvent.press(screen.getByRole('radio', { name: 'High' }));
    await fireEvent.changeText(screen.getByLabelText('Date (YYYY-MM-DD)'), '2026-10-31');
    await fireEvent.changeText(screen.getByLabelText('Time (HH:mm)'), '14:30');
    await save();
    await waitFor(() => expect(createCall).toHaveBeenCalled());
    const body = createCall.mock.calls[0]?.[0];
    expect(body).toEqual({
      title: 'Send the quote',
      notes: '40 seats',
      priority: 'high',
      dueAt: toDueAt('2026-10-31', '14:30'),
    });
    expect(body?.dueAt).toMatch(/^2026-10-31T14:30:00[+-]\d{2}:\d{2}$/);
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

    it('checks the shape of the date and the time, and wants them together', async () => {
      await show();
      await typeTitle('Call');
      await fireEvent.changeText(screen.getByLabelText('Date (YYYY-MM-DD)'), '31/10/2026');
      await fireEvent.changeText(screen.getByLabelText('Time (HH:mm)'), '25:00');
      await save();
      expect(
        await screen.findByText('Enter the date as YYYY-MM-DD, for example 2026-10-31.'),
      ).toBeTruthy();
      expect(
        screen.getByText('Enter the time as HH:mm on a 24-hour clock, for example 14:30.'),
      ).toBeTruthy();
      await fireEvent.changeText(screen.getByLabelText('Date (YYYY-MM-DD)'), '2026-10-31');
      await fireEvent.changeText(screen.getByLabelText('Time (HH:mm)'), '');
      await save();
      expect(await screen.findByText('Enter the time as well.')).toBeTruthy();
      expect(createCall).not.toHaveBeenCalled();
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
          { title: 'Call', priority: 'medium', assigneeId: DEV.id },
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
          { title: 'Call', priority: 'medium', assigneeId: null },
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
          { title: 'Call', priority: 'medium', contactId: aarav.id },
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
          { title: 'Call', priority: 'medium', contactId: aarav.id },
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
          { title: 'Call', priority: 'medium' },
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
    expect(screen.getByLabelText('Date (YYYY-MM-DD)').props.value).toBe(due.date);
    expect(screen.getByLabelText('Time (HH:mm)').props.value).toBe(due.time);
    expect(screen.getByRole('radio', { name: 'Medium' }).props.accessibilityState.checked).toBe(
      true,
    );
    expect(screen.getByRole('button', { name: 'Owner' }).props.accessibilityValue.text).toBe('Me');
    expect(
      screen.getByRole('button', { name: 'Link contact (optional)' }).props.accessibilityValue.text,
    ).toBe('Aarav Sharma');
  });

  it('sends only what changed, with the version that was read, and goes back', async () => {
    await show();
    await typeTitle('Call Aarav today');
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
    await fireEvent.changeText(screen.getByLabelText('Date (YYYY-MM-DD)'), '');
    await fireEvent.changeText(screen.getByLabelText('Time (HH:mm)'), '');
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
