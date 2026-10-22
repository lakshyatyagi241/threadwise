import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';
import { ApiError } from '@/lib/api';
import { fetchSession } from '@/lib/session/api';
import { renderApp } from '@/test/render';
import { reachEnd } from '@/test/scroll';
import {
  callAarav,
  doneTask,
  looseTask,
  overdueTask,
  sessionNoTasks,
  sessionTasksComplete,
  sessionTasksFull,
  sessionTasksReadOnly,
  taskPage,
  tasks,
} from '@/test/tasks-fixtures';
import * as api from './api';
import { formatMoment } from '@/lib/format/dates';
import { TasksScreen } from './tasks-screen';

jest.mock('./api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn(), useLocalSearchParams: jest.fn() }));

const sessionCall = jest.mocked(fetchSession);
const listCall = jest.mocked(api.listTasks);
const completeCall = jest.mocked(api.completeTask);
const reopenCall = jest.mocked(api.reopenTask);
const deleteCall = jest.mocked(api.deleteTask);
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() };

const CONTACT_ID = '11111111-1111-4111-8111-111111111111';
const MINE = { kind: 'mine' };
const OPEN = { limit: 50, cursor: undefined, status: 'open' };

let client: QueryClient | undefined;
async function show() {
  const view = await renderApp(<TasksScreen />);
  client = view.queryClient;
  return view;
}

/** Waits until every request has finished, so no update lands after the test. */
const settled = (queryClient: QueryClient) =>
  waitFor(() => expect(queryClient.isFetching()).toBe(0));

beforeEach(() => {
  jest.resetAllMocks();
  client = undefined;
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  jest.mocked(useLocalSearchParams).mockReturnValue({});
  router.canGoBack.mockReturnValue(true);
  sessionCall.mockResolvedValue(sessionTasksFull);
  listCall.mockResolvedValue(taskPage(tasks));
});
afterEach(async () => {
  if (client) {
    const cache = client;
    await settled(cache);
  }
});

describe('TasksScreen', () => {
  it('lists my open tasks with the title, the owner, the due date and the priority', async () => {
    await show();
    const row = await screen.findByRole('button', { name: 'Call Aarav about the quote' });
    const due = `Due ${formatMoment(callAarav.dueAt, 'en')}`;
    expect(row.props.accessibilityHint).toBe(due);
    expect(within(row).getByText('Asha Verma')).toBeTruthy();
    expect(within(row).getByText(due)).toBeTruthy();
    expect(within(row).getByText('Medium')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Tasks' })).toBeTruthy();
    expect(listCall).toHaveBeenCalledWith(MINE, OPEN, expect.anything());
  });

  it('marks a task that is past due, in words as well as colour', async () => {
    await show();
    const row = await screen.findByRole('button', { name: 'Send the contract' });
    expect(within(row).getByText('Overdue')).toBeTruthy();
    expect(within(row).getByText('High')).toBeTruthy();
    const dueLine = within(row).getByText(`Due ${formatMoment(overdueTask.dueAt, 'en')}`);
    expect(StyleSheet.flatten(dueLine.props.style).color).not.toBe(
      StyleSheet.flatten(within(row).getByText('Asha Verma').props.style).color,
    );
  });

  it('strikes through a done task and shows a task without an owner or a due date plainly', async () => {
    listCall.mockResolvedValue(taskPage([doneTask, looseTask]));
    await show();
    const title = await screen.findByText('Book the demo');
    expect(StyleSheet.flatten(title.props.style).textDecorationLine).toBe('line-through');
    const loose = screen.getByRole('button', { name: 'Tidy the pipeline' });
    expect(within(loose).getByText('Unassigned')).toBeTruthy();
    expect(within(loose).queryByText(/^Due /)).toBeNull();
    expect(loose.props.accessibilityHint).toBeUndefined();
  });

  it('shows placeholder rows while the first page loads', async () => {
    let finish: (value: ReturnType<typeof taskPage>) => void = () => undefined;
    listCall.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await show();
    expect(await screen.findAllByTestId('task-skeleton-row')).toHaveLength(10);
    await act(async () => finish(taskPage(tasks)));
    expect(await screen.findByRole('button', { name: 'Send the contract' })).toBeTruthy();
    expect(screen.queryAllByTestId('task-skeleton-row')).toHaveLength(0);
  });

  it('opens a task when its row is pressed', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Send the contract' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/task/[id]',
      params: { id: overdueTask.id },
    });
  });

  it('asks for the next page when the end is reached, and stops when there is none', async () => {
    listCall.mockResolvedValueOnce(taskPage([callAarav], 'cursor-2'));
    listCall.mockResolvedValueOnce(taskPage([overdueTask]));
    const { queryClient } = await show();
    await screen.findByRole('button', { name: 'Call Aarav about the quote' });
    await reachEnd(screen.getByTestId('tasks-list'));
    expect(await screen.findByRole('button', { name: 'Send the contract' })).toBeTruthy();
    expect(listCall).toHaveBeenLastCalledWith(
      MINE,
      { ...OPEN, cursor: 'cursor-2' },
      expect.anything(),
    );
    await settled(queryClient);
    await reachEnd(screen.getByTestId('tasks-list'));
    expect(listCall).toHaveBeenCalledTimes(2);
  });

  it('reloads the list when the page is pulled down, and stops the spinner when done', async () => {
    const { queryClient } = await show();
    await screen.findByRole('button', { name: 'Send the contract' });
    const control = () => screen.getByTestId('tasks-list').props.refreshControl;
    await act(() => {
      control().props.onRefresh();
    });
    await waitFor(() => expect(control().props.refreshing).toBe(false));
    await settled(queryClient);
    expect(listCall).toHaveBeenCalledTimes(2);
  });

  describe('a contact’s tasks', () => {
    beforeEach(() => {
      jest.mocked(useLocalSearchParams).mockReturnValue({ contactId: CONTACT_ID });
    });

    it('asks the contact’s route, for the tasks of every owner', async () => {
      await show();
      await screen.findByRole('button', { name: 'Send the contract' });
      expect(listCall).toHaveBeenCalledWith(
        { kind: 'contact', contactId: CONTACT_ID },
        OPEN,
        expect.anything(),
      );
    });

    it('passes the contact on to the add form', async () => {
      await show();
      await fireEvent.press(await screen.findByRole('button', { name: 'Add task' }));
      expect(router.push).toHaveBeenCalledWith({
        pathname: '/task-form',
        params: { contactId: CONTACT_ID },
      });
    });

    it('needs the permission to read contacts as well', async () => {
      sessionCall.mockResolvedValue(sessionTasksComplete);
      const { queryClient } = await show();
      expect(await screen.findByText("You can't see tasks")).toBeTruthy();
      await settled(queryClient);
      expect(listCall).not.toHaveBeenCalled();
    });
  });

  describe('completing and reopening', () => {
    it('completes an open task with the version the list showed', async () => {
      completeCall.mockResolvedValue({ ...callAarav, status: 'done', rowVersion: 3 });
      await show();
      await fireEvent.press(
        await screen.findByRole('checkbox', { name: 'Mark Call Aarav about the quote as done' }),
      );
      await waitFor(() =>
        expect(completeCall).toHaveBeenCalledWith(callAarav.id, 2, expect.any(String)),
      );
      // The list is asked again, so the open list no longer holds it.
      await waitFor(() => expect(listCall).toHaveBeenCalledTimes(2));
    });

    it('shows the circle filled the moment the answer arrives', async () => {
      completeCall.mockResolvedValue({ ...callAarav, status: 'done', rowVersion: 3 });
      listCall.mockResolvedValueOnce(taskPage([callAarav]));
      listCall.mockReturnValue(new Promise(() => undefined));
      await show();
      await fireEvent.press(
        await screen.findByRole('checkbox', { name: 'Mark Call Aarav about the quote as done' }),
      );
      expect(
        await screen.findByRole('checkbox', { name: 'Reopen Call Aarav about the quote' }),
      ).toBeTruthy();
    });

    it('reopens a done task', async () => {
      reopenCall.mockResolvedValue({ ...doneTask, status: 'open', rowVersion: 8 });
      listCall.mockResolvedValue(taskPage([doneTask]));
      await show();
      const circle = await screen.findByRole('checkbox', { name: 'Reopen Book the demo' });
      expect(circle.props.accessibilityState.checked).toBe(true);
      await fireEvent.press(circle);
      await waitFor(() =>
        expect(reopenCall).toHaveBeenCalledWith(doneTask.id, 7, expect.any(String)),
      );
    });

    it('says so, and reloads, when someone else changed the task first', async () => {
      completeCall.mockRejectedValue(new ApiError(409, 'ROW_VERSION_CONFLICT', 'Conflict'));
      await show();
      await fireEvent.press(
        await screen.findByRole('checkbox', { name: 'Mark Send the contract as done' }),
      );
      expect(
        await screen.findByText(
          'This task was changed by someone else. The list has been refreshed.',
        ),
      ).toBeTruthy();
      await waitFor(() => expect(listCall).toHaveBeenCalledTimes(2));
    });

    it('says in words why another failure changed nothing', async () => {
      completeCall.mockRejectedValue(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
      await show();
      await fireEvent.press(
        await screen.findByRole('checkbox', { name: 'Mark Send the contract as done' }),
      );
      expect(
        await screen.findByText("Can't reach the server. Check your connection and try again."),
      ).toBeTruthy();
    });

    it('cannot be pressed by a person who may only read', async () => {
      sessionCall.mockResolvedValue(sessionTasksReadOnly);
      await show();
      const circle = await screen.findByRole('checkbox', {
        name: 'Mark Send the contract as done',
      });
      expect(circle.props.accessibilityState.disabled).toBe(true);
      await fireEvent.press(circle);
      expect(completeCall).not.toHaveBeenCalled();
    });
  });

  describe('the overflow of a row', () => {
    const more = (title: string) =>
      screen.findByRole('button', { name: `More actions for ${title}` });

    it('offers Edit task and Delete task for an open task, and Edit opens the form', async () => {
      await show();
      await fireEvent.press(await more('Send the contract'));
      expect(screen.getByRole('menuitem', { name: 'Delete task' })).toBeTruthy();
      await fireEvent.press(screen.getByRole('menuitem', { name: 'Edit task' }));
      expect(router.push).toHaveBeenCalledWith({
        pathname: '/task-form',
        params: { taskId: overdueTask.id },
      });
      expect(screen.queryByRole('menuitem', { name: 'Edit task' })).toBeNull();
    });

    it('leaves Edit task out for a done task', async () => {
      listCall.mockResolvedValue(taskPage([doneTask]));
      await show();
      await fireEvent.press(await more('Book the demo'));
      expect(screen.queryByRole('menuitem', { name: 'Edit task' })).toBeNull();
      expect(screen.getByRole('menuitem', { name: 'Delete task' })).toBeTruthy();
    });

    it('closes without doing anything', async () => {
      await show();
      await fireEvent.press(await more('Send the contract'));
      await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByRole('menuitem', { name: 'Edit task' })).toBeNull();
    });

    it('is not there for a person who may neither edit nor delete', async () => {
      sessionCall.mockResolvedValue(sessionTasksReadOnly);
      await show();
      await screen.findByRole('button', { name: 'Send the contract' });
      expect(screen.queryByRole('button', { name: /^More actions/ })).toBeNull();
    });

    it('is there for a person who may only update, on an open task, and not on a done one', async () => {
      sessionCall.mockResolvedValue(sessionTasksComplete);
      await show();
      await screen.findByRole('button', { name: 'Send the contract' });
      expect(
        screen.getByRole('button', { name: 'More actions for Send the contract' }),
      ).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'More actions for Book the demo' })).toBeNull();
    });
  });

  describe('deleting', () => {
    const askToDelete = async (title: string) => {
      await fireEvent.press(
        await screen.findByRole('button', { name: `More actions for ${title}` }),
      );
      await fireEvent.press(screen.getByRole('menuitem', { name: 'Delete task' }));
    };

    it('asks first, and does nothing when the person says no', async () => {
      await show();
      await askToDelete('Send the contract');
      expect(screen.getByRole('header', { name: 'Delete task' })).toBeTruthy();
      expect(screen.getByText('Are you sure you want to delete this task?')).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByText('Are you sure you want to delete this task?')).toBeNull();
      expect(deleteCall).not.toHaveBeenCalled();
    });

    it('deletes once confirmed and loads the list again', async () => {
      deleteCall.mockResolvedValue(undefined);
      await show();
      await askToDelete('Send the contract');
      await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
      await waitFor(() =>
        expect(deleteCall).toHaveBeenCalledWith(overdueTask.id, expect.any(String)),
      );
      await waitFor(() => expect(listCall).toHaveBeenCalledTimes(2));
      expect(screen.queryByText('Are you sure you want to delete this task?')).toBeNull();
    });

    it('says in words when the delete fails', async () => {
      deleteCall.mockRejectedValue(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
      await show();
      await askToDelete('Send the contract');
      await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
      expect(
        await screen.findByText("Can't reach the server. Check your connection and try again."),
      ).toBeTruthy();
      expect(screen.queryByText('Are you sure you want to delete this task?')).toBeNull();
    });
  });

  describe('search', () => {
    it('opens a field under the header and asks the API once the person pauses typing', async () => {
      await show();
      await screen.findByRole('button', { name: 'Send the contract' });
      expect(screen.queryByLabelText('Search')).toBeNull();
      await fireEvent.press(screen.getByRole('button', { name: 'Search tasks' }));
      const field = screen.getByLabelText('Search');
      await fireEvent.changeText(field, 'q');
      await fireEvent.changeText(field, 'qu');
      await fireEvent.changeText(field, 'quote');
      // Nothing is asked while the person is still typing.
      expect(listCall).toHaveBeenCalledTimes(1);
      await waitFor(() =>
        expect(listCall).toHaveBeenLastCalledWith(MINE, { ...OPEN, q: 'quote' }, expect.anything()),
      );
      expect(listCall).toHaveBeenCalledTimes(2);
    });

    it('closing the search clears it and shows every task again', async () => {
      await show();
      await screen.findByRole('button', { name: 'Send the contract' });
      await fireEvent.press(screen.getByRole('button', { name: 'Search tasks' }));
      await fireEvent.changeText(screen.getByLabelText('Search'), 'quote');
      await waitFor(() => expect(listCall).toHaveBeenCalledTimes(2));
      await fireEvent.press(screen.getByRole('button', { name: 'Close search' }));
      expect(screen.queryByLabelText('Search')).toBeNull();
      await waitFor(() => expect(listCall).toHaveBeenLastCalledWith(MINE, OPEN, expect.anything()));
    });
  });

  describe('due tabs', () => {
    const tab = (name: string) => screen.getByRole('radio', { name });

    it('starts on All, and asks the API for what each tab means', async () => {
      await show();
      await screen.findByRole('button', { name: 'Call Aarav about the quote' });
      expect(tab('All').props.accessibilityState.checked).toBe(true);
      expect(listCall).toHaveBeenLastCalledWith(MINE, OPEN, expect.anything());

      await fireEvent.press(tab('Overdue'));
      await waitFor(() =>
        expect(listCall).toHaveBeenLastCalledWith(
          MINE,
          { ...OPEN, due: 'overdue' },
          expect.anything(),
        ),
      );
      await fireEvent.press(tab('Today'));
      await waitFor(() =>
        expect(listCall).toHaveBeenLastCalledWith(
          MINE,
          { ...OPEN, due: 'today' },
          expect.anything(),
        ),
      );
      await fireEvent.press(tab('Tomorrow'));
      await waitFor(() =>
        expect(listCall).toHaveBeenLastCalledWith(
          MINE,
          { ...OPEN, dueFrom: expect.any(String), dueTo: expect.any(String) },
          expect.anything(),
        ),
      );
      expect(tab('Tomorrow').props.accessibilityState.checked).toBe(true);
      await fireEvent.press(tab('This week'));
      await waitFor(() => expect(tab('This week').props.accessibilityState.checked).toBe(true));
      await fireEvent.press(tab('All'));
      await waitFor(() => expect(listCall).toHaveBeenLastCalledWith(MINE, OPEN, expect.anything()));
    });

    it('says a tab has no tasks, in the same words as a filter that finds none', async () => {
      await show();
      await screen.findByRole('button', { name: 'Call Aarav about the quote' });
      listCall.mockResolvedValue(taskPage([]));
      await fireEvent.press(tab('Tomorrow'));
      expect(await screen.findByText('Try a different filter or search.')).toBeTruthy();
    });
  });

  describe('filters', () => {
    const openSheet = async () =>
      await fireEvent.press(screen.getByRole('button', { name: 'Filter tasks' }));
    // The Geta layout: the categories down the left, the choices of the open one on the right.
    const category = async (name: string) =>
      await fireEvent.press(screen.getByRole('tab', { name }));
    // The due tabs behind the sheet use some of the same words (Overdue, Today, All): the sheet is the last on screen.
    const option = (name: string) => screen.getAllByRole('radio', { name }).at(-1)!;
    const choose = async (name: string) => await fireEvent.press(option(name));
    const checked = (name: string) => option(name).props.accessibilityState.checked;

    it('starts on Open and on Mine, and nothing else', async () => {
      await show();
      await screen.findByRole('button', { name: 'Send the contract' });
      await openSheet();
      expect(checked('Open')).toBe(true);
      await category('Priority');
      expect(checked('Any')).toBe(true);
      expect(checked('High')).toBe(false);
      await category('Due');
      expect(checked('Any')).toBe(true);
      expect(screen.getByRole('radio', { name: 'No date' })).toBeTruthy();
      await category('Owner');
      expect(checked('Mine')).toBe(true);
    });

    it('applies the chosen filters with the API’s names, and the owner All asks the whole list', async () => {
      await show();
      await screen.findByRole('button', { name: 'Send the contract' });
      await openSheet();
      await choose('Done');
      await category('Priority');
      await choose('High');
      await category('Due');
      await choose('Overdue');
      await category('Owner');
      await choose('All');
      await fireEvent.press(screen.getByRole('button', { name: 'Apply' }));
      await waitFor(() =>
        expect(listCall).toHaveBeenLastCalledWith(
          { kind: 'all' },
          { ...OPEN, status: 'done', priority: 'high', due: 'overdue' },
          expect.anything(),
        ),
      );
      expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
    });

    it('sends the Unassigned owner as a flag on the whole list', async () => {
      await show();
      await screen.findByRole('button', { name: 'Send the contract' });
      await openSheet();
      await category('Owner');
      await choose('Unassigned');
      await fireEvent.press(screen.getByRole('button', { name: 'Apply' }));
      await waitFor(() =>
        expect(listCall).toHaveBeenLastCalledWith(
          { kind: 'all' },
          { ...OPEN, unassigned: true },
          expect.anything(),
        ),
      );
    });

    it('takes a choice back with Any, and marks the categories that hold a choice', async () => {
      await show();
      await screen.findByRole('button', { name: 'Send the contract' });
      await openSheet();
      await category('Priority');
      await choose('Low');
      expect(checked('Low')).toBe(true);
      await choose('Any');
      expect(checked('Low')).toBe(false);
      expect(checked('Any')).toBe(true);
    });

    it('opens on what is applied, and Clear all takes every filter off at once', async () => {
      await show();
      await screen.findByRole('button', { name: 'Send the contract' });
      await openSheet();
      await category('Priority');
      await choose('High');
      await fireEvent.press(screen.getByRole('button', { name: 'Apply' }));
      await waitFor(() => expect(listCall).toHaveBeenCalledTimes(2));

      await openSheet();
      await category('Priority');
      expect(checked('High')).toBe(true);
      await fireEvent.press(screen.getByRole('button', { name: 'Clear all' }));
      await waitFor(() => expect(listCall).toHaveBeenLastCalledWith(MINE, OPEN, expect.anything()));
      expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
    });

    it('leaves the list alone when the screen is left with the back arrow', async () => {
      await show();
      await screen.findByRole('button', { name: 'Send the contract' });
      await openSheet();
      await category('Due');
      await choose('Today');
      await fireEvent.press(screen.getAllByRole('button', { name: 'Back' }).at(-1)!);
      expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
      expect(listCall).toHaveBeenCalledTimes(1);
    });

    it('starts a contact’s list on the owner All, and Mine asks for the caller’s tasks only', async () => {
      jest.mocked(useLocalSearchParams).mockReturnValue({ contactId: CONTACT_ID });
      await show();
      await screen.findByRole('button', { name: 'Send the contract' });
      await openSheet();
      await category('Owner');
      expect(checked('All')).toBe(true);
      await choose('Mine');
      await fireEvent.press(screen.getByRole('button', { name: 'Apply' }));
      await waitFor(() =>
        expect(listCall).toHaveBeenLastCalledWith(
          { kind: 'contact', contactId: CONTACT_ID },
          { ...OPEN, mine: true },
          expect.anything(),
        ),
      );
    });
  });

  describe('states', () => {
    it('says there are no tasks, and says so differently when a filter is why', async () => {
      listCall.mockResolvedValue(taskPage([]));
      await show();
      expect(await screen.findByText('No tasks found.')).toBeTruthy();
      expect(screen.getByText('Tasks you add show up here.')).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Filter tasks' }));
      await fireEvent.press(screen.getByRole('tab', { name: 'Priority' }));
      await fireEvent.press(screen.getByRole('radio', { name: 'High' }));
      await fireEvent.press(screen.getByRole('button', { name: 'Apply' }));
      expect(await screen.findByText('Try a different filter or search.')).toBeTruthy();
    });

    it('shows the failure in words with a way to try again, and recovers', async () => {
      listCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
      await show();
      expect(
        await screen.findByText("Can't reach the server. Check your connection and try again."),
      ).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
      expect(await screen.findByRole('button', { name: 'Send the contract' })).toBeTruthy();
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('tells a person without the permission, and asks the API for nothing', async () => {
      sessionCall.mockResolvedValue(sessionNoTasks);
      const { queryClient } = await show();
      expect(await screen.findByText("You can't see tasks")).toBeTruthy();
      await settled(queryClient);
      expect(listCall).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Filter tasks' })).toBeNull();
    });

    it('says when the plan has no tasks, with no way to add one', async () => {
      listCall.mockRejectedValue(new ApiError(422, 'PLAN_FEATURE_LOCKED', 'Locked'));
      await show();
      expect(await screen.findByText('Tasks are not included in this plan.')).toBeTruthy();
      expect(screen.getByText('Ask your workspace admin to upgrade the plan.')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull();
    });

    it('goes back, to the menu when there is nowhere to go back to', async () => {
      await show();
      await fireEvent.press(await screen.findByRole('button', { name: 'Back' }));
      expect(router.back).toHaveBeenCalled();
      router.canGoBack.mockReturnValue(false);
      await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
      expect(router.replace).toHaveBeenCalledWith('/menu');
    });
  });

  describe('the add button', () => {
    it('is there for a person who may add tasks, and opens the form', async () => {
      await show();
      await fireEvent.press(await screen.findByRole('button', { name: 'Add task' }));
      expect(router.push).toHaveBeenCalledWith('/task-form');
    });

    it('is not there for a person who may not add tasks', async () => {
      sessionCall.mockResolvedValue(sessionTasksReadOnly);
      await show();
      await screen.findByRole('button', { name: 'Send the contract' });
      expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull();
    });
  });
});
