import type { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ApiError } from '@/lib/api';
import { formatMoment, toDueAt } from '@/lib/format/dates';
import { fetchSession } from '@/lib/session/api';
import {
  acmeDeal,
  activityPage,
  board,
  doneTaskEntry,
  lateDeal,
  lostDeal,
  lostReasons,
  noteEntry,
  placedEntry,
  sessionDealsFull,
  sessionDealsReadOnly,
  sessionNoDeals,
  settingsOptional,
  stageEntry,
  stageProposal,
  taskEntry,
  wonDeal,
} from '@/test/deals-fixtures';
import { renderApp } from '@/test/render';
import * as api from './api';
import { DealDetailsScreen } from './deal-details-screen';

jest.mock('./api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn(), useLocalSearchParams: jest.fn() }));
jest.mock('expo-linking', () => ({ openURL: jest.fn() }));

const sessionCall = jest.mocked(fetchSession);
const getCall = jest.mocked(api.getDeal);
const boardCall = jest.mocked(api.getBoard);
const activitiesCall = jest.mocked(api.listActivities);
const addCall = jest.mocked(api.addActivity);
const toggleCall = jest.mocked(api.setActivityDone);
const moveCall = jest.mocked(api.moveDealStage);
const wonCall = jest.mocked(api.markDealWon);
const lostCall = jest.mocked(api.markDealLost);
const reopenCall = jest.mocked(api.reopenDeal);
const deleteCall = jest.mocked(api.deleteDeal);
const reasonsCall = jest.mocked(api.listLostReasons);
const settingsCall = jest.mocked(api.getDealSettings);
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() };

const settled = (queryClient: QueryClient) =>
  waitFor(() => expect(queryClient.isFetching()).toBe(0));

let client: QueryClient | undefined;
async function show() {
  const view = await renderApp(<DealDetailsScreen />);
  client = view.queryClient;
  return view;
}

const entries = [noteEntry, taskEntry, stageEntry, placedEntry, doneTaskEntry];

beforeEach(() => {
  jest.resetAllMocks();
  client = undefined;
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: acmeDeal.id });
  router.canGoBack.mockReturnValue(true);
  sessionCall.mockResolvedValue(sessionDealsFull);
  getCall.mockResolvedValue(acmeDeal);
  boardCall.mockResolvedValue(board);
  activitiesCall.mockResolvedValue(activityPage(entries));
  reasonsCall.mockResolvedValue([]);
  settingsCall.mockResolvedValue(settingsOptional);
  addCall.mockResolvedValue(noteEntry);
  toggleCall.mockResolvedValue(taskEntry);
  moveCall.mockResolvedValue({ ...acmeDeal, stage: stageProposal });
  wonCall.mockResolvedValue({ ...acmeDeal, status: 'won' });
  lostCall.mockResolvedValue({ ...acmeDeal, status: 'lost' });
  reopenCall.mockResolvedValue({ ...wonDeal, status: 'open' });
  deleteCall.mockResolvedValue(undefined as never);
});
afterEach(async () => {
  if (client) {
    const cache = client;
    await settled(cache);
  }
});

describe('DealDetailsScreen', () => {
  it('shows the deal: name, value, status, stage, customer, company and details', async () => {
    await show();
    expect(await screen.findByRole('header', { name: '40 seats for Acme' })).toBeTruthy();
    expect(screen.getByText('$12,500.00')).toBeTruthy();
    expect(screen.getByText('Open')).toBeTruthy();
    expect(screen.getByText('New Lead')).toBeTruthy();
    expect(screen.getByText('Aarav Sharma')).toBeTruthy();
    expect(screen.getByText('+919812345678')).toBeTruthy();
    expect(screen.getByText('Company: Acme Ltd')).toBeTruthy();
    expect(screen.getByText('Dec 31, 2099')).toBeTruthy();
    expect(screen.getByText('Added by hand')).toBeTruthy();
    expect(screen.getByText(formatMoment(acmeDeal.createdAt, 'en'))).toBeTruthy();
  });

  it('shows a deal without a customer, owner or close day plainly, and the close day in red when past', async () => {
    getCall.mockResolvedValue(lateDeal);
    await show();
    await screen.findByRole('header', { name: 'Renewal for Globex' });
    expect(screen.getByText('No customer linked.')).toBeTruthy();
    expect(screen.getByText('Unassigned')).toBeTruthy();
    expect(screen.getByText('Jan 15, 2020')).toBeTruthy();
  });

  it("shows the timeline: notes, tasks with their due date, and the system's own stage changes", async () => {
    await show();
    expect(await screen.findByText('Sent the quote for 40 seats.')).toBeTruthy();
    expect(screen.getByText('Follow up on the quote')).toBeTruthy();
    expect(screen.getByText(`Due ${formatMoment(taskEntry.dueAt, 'en')}`)).toBeTruthy();
    expect(screen.getByText('Moved from New Lead to Proposal')).toBeTruthy();
    expect(screen.getByText('Placed in New Lead')).toBeTruthy();
    expect(screen.getByText('Book the demo')).toBeTruthy();
  });

  it('says so when nothing has happened yet', async () => {
    activitiesCall.mockResolvedValue(activityPage([]));
    await show();
    expect(await screen.findByText('Nothing has happened on this deal yet.')).toBeTruthy();
  });

  it('shows the reason a lost deal was lost, and offers to reopen it instead of won and lost', async () => {
    getCall.mockResolvedValue(lostDeal);
    await show();
    expect(await screen.findByText('Lost: Price too high')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark as won' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark as lost' })).toBeNull();
  });

  it('opens the customer, and starts a WhatsApp chat with them', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Open contact' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/contact/[id]',
      params: { id: acmeDeal.contact!.id },
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Message on WhatsApp' }));
    expect(Linking.openURL).toHaveBeenCalledWith('https://wa.me/919812345678');
  });

  it('opens the form to edit, and goes back when Back is pressed', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Edit deal' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/deal-form',
      params: { dealId: acmeDeal.id },
    });
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(router.back).toHaveBeenCalled();
  });
});

describe('DealDetailsScreen states', () => {
  it('says so and asks for nothing when the person may not read deals', async () => {
    sessionCall.mockResolvedValue(sessionNoDeals);
    await show();
    expect(await screen.findByText("You can't see deals")).toBeTruthy();
    expect(getCall).not.toHaveBeenCalled();
  });

  it('says the deal is gone when it no longer exists, with no retry button', async () => {
    getCall.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'gone'));
    await show();
    expect(await screen.findByText('This deal no longer exists.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('says the plan has no deals when the API says so', async () => {
    getCall.mockRejectedValue(new ApiError(422, 'PLAN_FEATURE_LOCKED', 'locked'));
    await show();
    expect(await screen.findByText('Deals are not included in this plan.')).toBeTruthy();
  });

  it('shows a failed load with a way to try again', async () => {
    getCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    await show();
    expect(await screen.findByRole('alert')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('header', { name: '40 seats for Acme' })).toBeTruthy();
  });

  it('shows a failed timeline with a way to try again, and keeps the deal', async () => {
    activitiesCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    await show();
    expect(await screen.findByRole('header', { name: '40 seats for Acme' })).toBeTruthy();
    expect(await screen.findByRole('alert')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Sent the quote for 40 seats.')).toBeTruthy();
  });

  it('offers no buttons, no composer and no edit or delete to a person who may only read', async () => {
    sessionCall.mockResolvedValue(sessionDealsReadOnly);
    await show();
    await screen.findByRole('header', { name: '40 seats for Acme' });
    for (const name of ['Mark as won', 'Mark as lost', 'Move to stage', 'Add to timeline']) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
    expect(screen.queryByRole('button', { name: 'Edit deal' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete deal' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'Mark done' })).toBeNull();
  });
});

describe('DealDetailsScreen actions', () => {
  it('marks the deal won with the version that was read', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Mark as won' }));
    await waitFor(() => expect(wonCall).toHaveBeenCalledWith(acmeDeal.id, 3, expect.any(String)));
  });

  it('marks the deal lost with the reason chosen', async () => {
    reasonsCall.mockResolvedValue(lostReasons);
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Mark as lost' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Budget cut' }));
    await fireEvent.press(screen.getAllByRole('button', { name: 'Mark as lost' }).at(-1)!);
    await waitFor(() =>
      expect(lostCall).toHaveBeenCalledWith(
        acmeDeal.id,
        { lostReasonId: lostReasons[0]!.id, rowVersion: 3 },
        expect.any(String),
      ),
    );
  });

  it('moves the deal to another stage from the sheet', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Move to stage' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Proposal' }));
    await waitFor(() =>
      expect(moveCall).toHaveBeenCalledWith(
        acmeDeal.id,
        { stageId: stageProposal.id, rowVersion: 3 },
        expect.any(String),
      ),
    );
  });

  it('reopens a won deal', async () => {
    getCall.mockResolvedValue(wonDeal);
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Reopen' }));
    await waitFor(() =>
      expect(reopenCall).toHaveBeenCalledWith(wonDeal.id, { rowVersion: 7 }, expect.any(String)),
    );
  });

  it('says it was changed by someone else when the version is stale, and reloads the deal', async () => {
    wonCall.mockRejectedValue(new ApiError(409, 'ROW_VERSION_CONFLICT', 'stale'));
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Mark as won' }));
    expect(
      await screen.findByText('This deal was changed by someone else. It has been reloaded.'),
    ).toBeTruthy();
    await waitFor(() => expect(getCall.mock.calls.length).toBeGreaterThan(1));
  });

  it('deletes the deal after a confirmation, and goes back', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Delete deal' }));
    expect(deleteCall).not.toHaveBeenCalled();
    await fireEvent.press(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteCall).toHaveBeenCalledWith(acmeDeal.id, expect.any(String)));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('does not delete when the confirmation is cancelled', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Delete deal' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Cancel' }));
    expect(deleteCall).not.toHaveBeenCalled();
  });
});

describe('DealDetailsScreen timeline', () => {
  it('adds a note and empties the box', async () => {
    await show();
    const box = await screen.findByLabelText('Write a note, a call summary or a task');
    await fireEvent.changeText(box, '  Spoke to Aarav  ');
    await fireEvent.press(screen.getByRole('button', { name: 'Add to timeline' }));
    await waitFor(() =>
      expect(addCall).toHaveBeenCalledWith(
        acmeDeal.id,
        { type: 'note', body: 'Spoke to Aarav' },
        expect.any(String),
      ),
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Write a note, a call summary or a task').props.value).toBe(''),
    );
  });

  it('will not add an empty entry', async () => {
    await show();
    const add = await screen.findByRole('button', { name: 'Add to timeline' });
    expect(add.props.accessibilityState.disabled).toBe(true);
    await fireEvent.press(add);
    expect(addCall).not.toHaveBeenCalled();
  });

  it('adds a logged call', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('radio', { name: 'Call' }));
    await fireEvent.changeText(
      screen.getByLabelText('Write a note, a call summary or a task'),
      'Called, no answer',
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Add to timeline' }));
    await waitFor(() =>
      expect(addCall).toHaveBeenCalledWith(
        acmeDeal.id,
        { type: 'call', body: 'Called, no answer' },
        expect.any(String),
      ),
    );
  });

  it("adds a task due on a day and time, as an instant with the phone's offset", async () => {
    await show();
    await fireEvent.press(await screen.findByRole('radio', { name: 'Task' }));
    await fireEvent.changeText(
      screen.getByLabelText('Write a note, a call summary or a task'),
      'Send the contract',
    );
    await fireEvent.changeText(screen.getByLabelText('Due day'), '2026-10-31');
    await fireEvent.changeText(screen.getByLabelText('Due time'), '14:30');
    await fireEvent.press(screen.getByRole('button', { name: 'Add to timeline' }));
    await waitFor(() =>
      expect(addCall).toHaveBeenCalledWith(
        acmeDeal.id,
        { type: 'task', body: 'Send the contract', dueAt: toDueAt('2026-10-31', '14:30') },
        expect.any(String),
      ),
    );
  });

  it('makes a task without a time due at 09:00, and a task without a day has no due date', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('radio', { name: 'Task' }));
    const box = screen.getByLabelText('Write a note, a call summary or a task');
    await fireEvent.changeText(box, 'Morning call');
    await fireEvent.changeText(screen.getByLabelText('Due day'), '2026-10-31');
    await fireEvent.press(screen.getByRole('button', { name: 'Add to timeline' }));
    await waitFor(() =>
      expect(addCall).toHaveBeenLastCalledWith(
        acmeDeal.id,
        { type: 'task', body: 'Morning call', dueAt: toDueAt('2026-10-31', '09:00') },
        expect.any(String),
      ),
    );
  });

  it('refuses a day or a time that is not real, and sends nothing', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('radio', { name: 'Task' }));
    await fireEvent.changeText(
      screen.getByLabelText('Write a note, a call summary or a task'),
      'Follow up',
    );
    await fireEvent.changeText(screen.getByLabelText('Due day'), '2026-02-31');
    await fireEvent.press(screen.getByRole('button', { name: 'Add to timeline' }));
    expect(await screen.findByText('Enter a real day like 2026-10-31.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Due day'), '2026-10-31');
    await fireEvent.changeText(screen.getByLabelText('Due time'), '25:99');
    await fireEvent.press(screen.getByRole('button', { name: 'Add to timeline' }));
    expect(await screen.findByText('Enter a time like 14:30.')).toBeTruthy();
    expect(addCall).not.toHaveBeenCalled();
  });

  it('says why an entry could not be added, and keeps what was typed', async () => {
    addCall.mockRejectedValue(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    await show();
    const box = await screen.findByLabelText('Write a note, a call summary or a task');
    await fireEvent.changeText(box, 'Spoke to Aarav');
    await fireEvent.press(screen.getByRole('button', { name: 'Add to timeline' }));
    expect(await screen.findByText(/connection/i)).toBeTruthy();
    expect(screen.getByLabelText('Write a note, a call summary or a task').props.value).toBe(
      'Spoke to Aarav',
    );
  });

  it('completes a task, and opens a done one again', async () => {
    await show();
    const open = await screen.findByRole('checkbox', { name: 'Mark done' });
    await fireEvent.press(open);
    await waitFor(() =>
      expect(toggleCall).toHaveBeenCalledWith(acmeDeal.id, taskEntry.id, true, expect.any(String)),
    );
    const done = screen.getByRole('checkbox', { name: 'Reopen task' });
    expect(within(done).getByText('Done')).toBeTruthy();
    await fireEvent.press(done);
    await waitFor(() =>
      expect(toggleCall).toHaveBeenCalledWith(
        acmeDeal.id,
        doneTaskEntry.id,
        false,
        expect.any(String),
      ),
    );
  });
});
