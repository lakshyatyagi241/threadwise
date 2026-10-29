import type { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet } from 'react-native';
import { ApiError } from '@/lib/api';
import { fetchSession } from '@/lib/session/api';
import { renderApp } from '@/test/render';
import {
  callAarav,
  doneTask,
  looseTask,
  overdueTask,
  sessionNoTasks,
  sessionTasksComplete,
  sessionTasksFull,
  sessionTasksReadOnly,
  taskActivity,
  taskOutcomes,
  INTERESTED,
} from '@/test/tasks-fixtures';
import * as api from './api';
import { formatMoment } from '@/lib/format/dates';
import { TaskDetailsScreen } from './task-details-screen';

jest.mock('./api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn(), useLocalSearchParams: jest.fn() }));

const sessionCall = jest.mocked(fetchSession);
const getCall = jest.mocked(api.getTask);
const completeCall = jest.mocked(api.completeTask);
const activityCall = jest.mocked(api.getTaskActivity);
const outcomesCall = jest.mocked(api.listTaskOutcomes);
const reopenCall = jest.mocked(api.reopenTask);
const deleteCall = jest.mocked(api.deleteTask);
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() };

const settled = (queryClient: QueryClient) =>
  waitFor(() => expect(queryClient.isFetching()).toBe(0));

let client: QueryClient | undefined;
async function show() {
  const view = await renderApp(<TaskDetailsScreen />);
  client = view.queryClient;
  return view;
}

beforeEach(() => {
  jest.resetAllMocks();
  client = undefined;
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: callAarav.id });
  router.canGoBack.mockReturnValue(true);
  sessionCall.mockResolvedValue(sessionTasksFull);
  activityCall.mockResolvedValue(taskActivity());
  outcomesCall.mockResolvedValue(taskOutcomes);
  getCall.mockResolvedValue(callAarav);
});
afterEach(async () => {
  if (client) {
    const cache = client;
    await settled(cache);
  }
});

describe('TaskDetailsScreen', () => {
  it('shows the task as the Geta app does: title, due date, then description, type, priority, outcome, contact and owner', async () => {
    await show();
    expect(await screen.findByRole('header', { name: 'Call Aarav about the quote' })).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Task details' })).toBeTruthy();
    expect(getCall).toHaveBeenCalledWith(callAarav.id, expect.anything());
    expect(screen.getByText(formatMoment(callAarav.dueAt, 'en'))).toBeTruthy();
    expect(screen.getByText('Ask whether the quote for 40 seats is approved.')).toBeTruthy();
    expect(screen.getByText('Medium')).toBeTruthy();
    for (const label of [
      'Description',
      'Task type',
      'Priority',
      'Outcome',
      'Related to',
      'Contact Owner',
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    // A task that is neither done nor late carries no status pill.
    expect(screen.queryByText('Open')).toBeNull();
    expect(screen.queryByText('Done')).toBeNull();
    expect(screen.getByText('Asha Verma')).toBeTruthy();
    expect(screen.getByText('Aarav Sharma')).toBeTruthy();
    expect(screen.queryByText('Overdue')).toBeNull();
  });

  it('opens the contact the task is related to', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('link', { name: 'Open Aarav Sharma' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/contact/[id]',
      params: { id: callAarav.contact?.id },
    });
  });

  it('shows the contact as plain text to a person who may not read contacts', async () => {
    sessionCall.mockResolvedValue(sessionTasksComplete);
    await show();
    expect(await screen.findByText('Aarav Sharma')).toBeTruthy();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('says plainly what a task does not have', async () => {
    getCall.mockResolvedValue(looseTask);
    await show();
    expect(await screen.findByText('No description')).toBeTruthy();
    expect(screen.getByText('No due date')).toBeTruthy();
    expect(screen.getByText('Unassigned')).toBeTruthy();
    // The type, the outcome and the contact each show --, as the Geta app does.
    expect(screen.getAllByText('--')).toHaveLength(3);
  });

  it('shows the type and the outcome the task has', async () => {
    getCall.mockResolvedValue({
      ...callAarav,
      taskType: {
        id: '77777777-7777-4777-8777-777777777771',
        key: 'follow_up',
        name: null,
        isSystem: true,
        activityKey: 'task',
        removed: false,
      },
      outcome: { id: INTERESTED, name: 'Interested', isActive: true },
    });
    await show();
    expect(await screen.findByText('Follow up')).toBeTruthy();
    expect(screen.getByText('Interested')).toBeTruthy();
  });

  it('draws the title of the bar in the middle', async () => {
    await show();
    const bar = await screen.findByRole('header', { name: 'Task details' });
    expect(StyleSheet.flatten(bar.props.style).textAlign).toBe('center');
  });

  it('marks a task that is past due, in words as well as colour', async () => {
    getCall.mockResolvedValue(overdueTask);
    await show();
    expect(await screen.findByText('Overdue')).toBeTruthy();
    expect(screen.getByText('High')).toBeTruthy();
  });

  it('strikes through a done task, and offers no edit for it', async () => {
    getCall.mockResolvedValue(doneTask);
    await show();
    const title = await screen.findByRole('header', { name: 'Book the demo' });
    expect(StyleSheet.flatten(title.props.style).textDecorationLine).toBe('line-through');
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit task' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeTruthy();
  });

  describe('the button at the bottom', () => {
    it('marks the task complete with the version it read, and turns into Reopen', async () => {
      completeCall.mockResolvedValue({ ...callAarav, status: 'done', rowVersion: 3 });
      await show();
      await fireEvent.press(await screen.findByRole('button', { name: 'Mark as Complete' }));
      await waitFor(() =>
        expect(completeCall).toHaveBeenCalledWith(callAarav.id, 2, expect.any(String), undefined),
      );
      expect(await screen.findByRole('button', { name: 'Reopen' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Edit task' })).toBeNull();
    });

    describe('when the workspace has task outcomes', () => {
      beforeEach(() => {
        activityCall.mockResolvedValue(taskActivity({ outcomesEnabled: true }));
        completeCall.mockResolvedValue({
          ...callAarav,
          status: 'done',
          rowVersion: 3,
          outcome: { id: INTERESTED, name: 'Interested', isActive: true },
        });
      });

      it('asks for the outcome first, and completes the task with the one picked', async () => {
        await show();
        await fireEvent.press(await screen.findByRole('button', { name: 'Mark as Complete' }));
        expect(completeCall).not.toHaveBeenCalled();
        expect(await screen.findByRole('radio', { name: 'Left message' })).toBeTruthy();
        expect(screen.getByRole('radio', { name: 'No outcome' })).toBeTruthy();
        await fireEvent.press(screen.getByRole('radio', { name: 'Interested' }));
        await fireEvent.press(screen.getByRole('button', { name: 'Complete task' }));
        await waitFor(() =>
          expect(completeCall).toHaveBeenCalledWith(
            callAarav.id,
            2,
            expect.any(String),
            INTERESTED,
          ),
        );
        expect(await screen.findByText('Interested')).toBeTruthy();
      });

      it('completes with no outcome when none is picked', async () => {
        await show();
        await fireEvent.press(await screen.findByRole('button', { name: 'Mark as Complete' }));
        await fireEvent.press(await screen.findByRole('button', { name: 'Complete task' }));
        await waitFor(() =>
          expect(completeCall).toHaveBeenCalledWith(callAarav.id, 2, expect.any(String), null),
        );
      });

      it('sends nothing when the sheet is cancelled', async () => {
        await show();
        await fireEvent.press(await screen.findByRole('button', { name: 'Mark as Complete' }));
        await screen.findByRole('radio', { name: 'Interested' });
        // The scrim and the Cancel button both close the sheet; the button is the last of them.
        await fireEvent.press(screen.getAllByRole('button', { name: 'Cancel' }).at(-1)!);
        expect(completeCall).not.toHaveBeenCalled();
      });

      it('reopens without asking for an outcome', async () => {
        getCall.mockResolvedValue(doneTask);
        reopenCall.mockResolvedValue(callAarav);
        await show();
        await fireEvent.press(await screen.findByRole('button', { name: 'Reopen' }));
        await waitFor(() => expect(reopenCall).toHaveBeenCalled());
        expect(screen.queryByRole('radio', { name: 'Interested' })).toBeNull();
      });
    });

    it('offers no complete button when the workspace does not allow marking tasks done', async () => {
      activityCall.mockResolvedValue(taskActivity({ allowComplete: false }));
      await show();
      await screen.findByRole('header', { name: 'Call Aarav about the quote' });
      await waitFor(() =>
        expect(screen.queryByRole('button', { name: 'Mark as Complete' })).toBeNull(),
      );
    });

    it('reopens a done task', async () => {
      jest.mocked(useLocalSearchParams).mockReturnValue({ id: doneTask.id });
      getCall.mockResolvedValue(doneTask);
      reopenCall.mockResolvedValue({ ...doneTask, status: 'open', rowVersion: 8 });
      await show();
      await fireEvent.press(await screen.findByRole('button', { name: 'Reopen' }));
      await waitFor(() =>
        expect(reopenCall).toHaveBeenCalledWith(doneTask.id, 7, expect.any(String)),
      );
      expect(await screen.findByRole('button', { name: 'Mark as Complete' })).toBeTruthy();
    });

    it('says so, and reloads the task, when someone else changed it first', async () => {
      completeCall.mockRejectedValue(new ApiError(409, 'ROW_VERSION_CONFLICT', 'Conflict'));
      await show();
      await fireEvent.press(await screen.findByRole('button', { name: 'Mark as Complete' }));
      expect(
        await screen.findByText('This task was changed by someone else. It has been reloaded.'),
      ).toBeTruthy();
      await waitFor(() => expect(getCall).toHaveBeenCalledTimes(2));
    });

    it('says in words why another failure changed nothing', async () => {
      completeCall.mockRejectedValue(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
      await show();
      await fireEvent.press(await screen.findByRole('button', { name: 'Mark as Complete' }));
      expect(
        await screen.findByText("Can't reach the server. Check your connection and try again."),
      ).toBeTruthy();
    });

    it('is not there for a person who may not update tasks', async () => {
      sessionCall.mockResolvedValue(sessionTasksReadOnly);
      await show();
      await screen.findByRole('header', { name: 'Call Aarav about the quote' });
      expect(screen.queryByRole('button', { name: 'Mark as Complete' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Edit task' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'Delete task' })).toBeNull();
    });
  });

  it('opens the edit form', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Edit task' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/task-form',
      params: { taskId: callAarav.id },
    });
  });

  describe('deleting', () => {
    const askToDelete = async () => {
      await fireEvent.press(await screen.findByRole('button', { name: 'Delete task' }));
    };

    it('asks first, and does nothing when the person says no', async () => {
      await show();
      await askToDelete();
      expect(screen.getByText('Are you sure you want to delete this task?')).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByText('Are you sure you want to delete this task?')).toBeNull();
      expect(deleteCall).not.toHaveBeenCalled();
    });

    it('deletes once confirmed and goes back', async () => {
      deleteCall.mockResolvedValue(undefined);
      await show();
      await askToDelete();
      await fireEvent.press(
        within(
          screen.getByText('Are you sure you want to delete this task?').parent!.parent!,
        ).getByRole('button', { name: 'Delete' }),
      );
      await waitFor(() =>
        expect(deleteCall).toHaveBeenCalledWith(callAarav.id, expect.any(String)),
      );
      await waitFor(() => expect(router.back).toHaveBeenCalled());
    });

    it('says in words when the delete fails, and stays', async () => {
      deleteCall.mockRejectedValue(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
      await show();
      await askToDelete();
      await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
      expect(
        await screen.findByText("Can't reach the server. Check your connection and try again."),
      ).toBeTruthy();
      expect(router.back).not.toHaveBeenCalled();
    });
  });

  describe('states', () => {
    it('shows a spinner while the task loads', async () => {
      getCall.mockReturnValue(new Promise(() => undefined));
      await show();
      expect(await screen.findByLabelText('Loading…')).toBeTruthy();
    });

    it('says when the task no longer exists, with nothing to retry', async () => {
      getCall.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'Gone'));
      await show();
      expect(await screen.findByText('This task no longer exists.')).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    });

    it('shows the failure in words with a way to try again, and recovers', async () => {
      getCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
      await show();
      expect(
        await screen.findByText("Can't reach the server. Check your connection and try again."),
      ).toBeTruthy();
      await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
      expect(
        await screen.findByRole('header', { name: 'Call Aarav about the quote' }),
      ).toBeTruthy();
    });

    it('says when the plan has no tasks', async () => {
      getCall.mockRejectedValue(new ApiError(422, 'PLAN_FEATURE_LOCKED', 'Locked'));
      await show();
      expect(await screen.findByText('Tasks are not included in this plan.')).toBeTruthy();
    });

    it('tells a person without the permission, and asks the API for nothing', async () => {
      sessionCall.mockResolvedValue(sessionNoTasks);
      const { queryClient } = await show();
      expect(await screen.findByText("You can't see tasks")).toBeTruthy();
      await settled(queryClient);
      expect(getCall).not.toHaveBeenCalled();
    });

    it('goes back, to the list when there is nowhere to go back to', async () => {
      await show();
      await fireEvent.press(await screen.findByRole('button', { name: 'Back' }));
      expect(router.back).toHaveBeenCalled();
      router.canGoBack.mockReturnValue(false);
      await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
      expect(router.replace).toHaveBeenCalledWith('/tasks');
    });
  });
});
