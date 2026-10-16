import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ApiError } from '@/lib/api';
import { fetchSession } from '@/lib/session/api';
import {
  PIPELINE_ID,
  acmeDeal,
  board,
  dealPage,
  lateDeal,
  lostDeal,
  lostReasons,
  sessionDealsFull,
  sessionDealsReadOnly,
  sessionDealsUpdateOnly,
  sessionNoDeals,
  settingsOptional,
  settingsRequired,
  stageLost,
  stageNew,
  stageProposal,
  team,
  wonDeal,
} from '@/test/deals-fixtures';
import { renderApp } from '@/test/render';
import { reachEnd } from '@/test/scroll';
import * as api from './api';
import { DealsScreen } from './deals-screen';

jest.mock('./api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn(), useLocalSearchParams: jest.fn() }));

const sessionCall = jest.mocked(fetchSession);
const boardCall = jest.mocked(api.getBoard);
const columnCall = jest.mocked(api.listStageDeals);
const listCall = jest.mocked(api.listDeals);
const pipelinesCall = jest.mocked(api.listPipelines);
const reasonsCall = jest.mocked(api.listLostReasons);
const settingsCall = jest.mocked(api.getDealSettings);
const teamCall = jest.mocked(api.listAssignees);
const moveCall = jest.mocked(api.moveDealStage);
const wonCall = jest.mocked(api.markDealWon);
const lostCall = jest.mocked(api.markDealLost);
const reopenCall = jest.mocked(api.reopenDeal);
const deleteCall = jest.mocked(api.deleteDeal);
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() };

let client: QueryClient | undefined;
async function show() {
  const view = await renderApp(<DealsScreen />);
  client = view.queryClient;
  return view;
}

/** Waits until every request has finished, so no update lands after the test. */
const settled = (queryClient: QueryClient) =>
  waitFor(() => expect(queryClient.isFetching()).toBe(0));

const pressMore = async (title: string) =>
  await fireEvent.press(await screen.findByRole('button', { name: `More actions for ${title}` }));
const pressAction = async (label: string) =>
  await fireEvent.press(await screen.findByRole('menuitem', { name: label }));

beforeEach(() => {
  jest.resetAllMocks();
  client = undefined;
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  jest.mocked(useLocalSearchParams).mockReturnValue({});
  router.canGoBack.mockReturnValue(true);
  sessionCall.mockResolvedValue(sessionDealsFull);
  boardCall.mockResolvedValue(board);
  columnCall.mockResolvedValue(dealPage([acmeDeal, lateDeal]));
  listCall.mockResolvedValue(dealPage([acmeDeal, wonDeal, lostDeal]));
  pipelinesCall.mockResolvedValue([]);
  reasonsCall.mockResolvedValue([]);
  settingsCall.mockResolvedValue(settingsOptional);
  teamCall.mockResolvedValue(team);
  moveCall.mockResolvedValue({ ...acmeDeal, stage: stageProposal });
  wonCall.mockResolvedValue({ ...acmeDeal, status: 'won' });
  lostCall.mockResolvedValue({ ...acmeDeal, status: 'lost' });
  reopenCall.mockResolvedValue({ ...wonDeal, status: 'open', stage: stageNew });
  deleteCall.mockResolvedValue(undefined as never);
});
afterEach(async () => {
  if (client) {
    const cache = client;
    await settled(cache);
  }
});

describe('DealsScreen board', () => {
  it('shows the KPIs, the stages with their counts and the deals of the first open stage', async () => {
    await show();
    expect(await screen.findByRole('button', { name: '40 seats for Acme' })).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Deals' })).toBeTruthy();
    expect(screen.getByText('Open pipeline')).toBeTruthy();
    expect(screen.getByText('$13.3K')).toBeTruthy();
    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'New Lead, 2' }).props.accessibilityState.selected).toBe(
      true,
    );
    expect(screen.getByRole('tab', { name: 'Proposal, 0' }).props.accessibilityState.selected).toBe(
      false,
    );
    expect(screen.getByText('Deals: 2 · $13,300.00 · Weighted $1,330.00')).toBeTruthy();
    expect(boardCall).toHaveBeenCalledWith({ limit: 1, pipelineId: undefined }, expect.anything());
    expect(columnCall).toHaveBeenCalledWith(
      stageNew.id,
      { limit: 25, cursor: undefined },
      expect.anything(),
    );
  });

  it('shows the customer, the company, the value and the owner on a card, and says when a deal is past due', async () => {
    await show();
    const card = await screen.findByRole('button', { name: '40 seats for Acme' });
    expect(card.props.accessibilityHint).toBe('$12,500.00, Aarav Sharma');
    expect(within(card).getByText('Aarav Sharma · Acme Ltd')).toBeTruthy();
    expect(within(card).getByText('$12,500.00')).toBeTruthy();
    expect(within(card).getByText('Asha Verma')).toBeTruthy();
    const late = screen.getByRole('button', { name: 'Renewal for Globex' });
    expect(within(late).getByText('Overdue · Jan 15, 2020')).toBeTruthy();
    expect(within(late).getByText('No customer')).toBeTruthy();
    expect(within(late).getByText('Unassigned')).toBeTruthy();
  });

  it('shows placeholder cards while the first answer is on its way', async () => {
    let finish: (value: typeof board) => void = () => undefined;
    boardCall.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    await show();
    expect(await screen.findAllByTestId('deal-skeleton-row')).toHaveLength(6);
    await act(async () => finish(board));
    expect(await screen.findByRole('button', { name: '40 seats for Acme' })).toBeTruthy();
    expect(screen.queryAllByTestId('deal-skeleton-row')).toHaveLength(0);
  });

  it("shows another stage's deals when its tab is pressed, and says when it is empty", async () => {
    columnCall.mockImplementation(async (stageId) =>
      stageId === stageProposal.id ? dealPage([]) : dealPage([acmeDeal]),
    );
    await show();
    await screen.findByRole('button', { name: '40 seats for Acme' });
    await fireEvent.press(screen.getByRole('tab', { name: 'Proposal, 0' }));
    expect(await screen.findByText('No deals found.')).toBeTruthy();
    expect(screen.getByText('Deals you add show up here.')).toBeTruthy();
    expect(columnCall).toHaveBeenLastCalledWith(
      stageProposal.id,
      { limit: 25, cursor: undefined },
      expect.anything(),
    );
    expect(screen.getByRole('tab', { name: 'Proposal, 0' }).props.accessibilityState.selected).toBe(
      true,
    );
  });

  it('opens a deal when its card is pressed', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Renewal for Globex' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/deal/[id]',
      params: { id: lateDeal.id },
    });
  });

  it('asks for the next page of the column when the end is reached, and stops when there is none', async () => {
    columnCall.mockResolvedValueOnce(dealPage([acmeDeal], 'cursor-2'));
    columnCall.mockResolvedValueOnce(dealPage([lateDeal]));
    const { queryClient } = await show();
    await screen.findByRole('button', { name: '40 seats for Acme' });
    // The list was on screen (empty) before its first deals arrived, so it takes the first scroll to learn its new size and the
    // second to ask for more: a thumb sends many scroll events, the test sends two.
    await reachEnd(screen.getByTestId('deals-list'));
    await reachEnd(screen.getByTestId('deals-list'));
    expect(await screen.findByRole('button', { name: 'Renewal for Globex' })).toBeTruthy();
    expect(columnCall).toHaveBeenLastCalledWith(
      stageNew.id,
      { limit: 25, cursor: 'cursor-2' },
      expect.anything(),
    );
    await settled(queryClient);
    await reachEnd(screen.getByTestId('deals-list'));
    await reachEnd(screen.getByTestId('deals-list'));
    expect(columnCall).toHaveBeenCalledTimes(2);
  });

  it('asks again when the page is pulled down', async () => {
    await show();
    await screen.findByRole('button', { name: '40 seats for Acme' });
    const list = screen.getByTestId('deals-list');
    await act(async () => {
      await list.props.refreshControl.props.onRefresh();
    });
    await waitFor(() => expect(boardCall.mock.calls.length).toBeGreaterThan(1));
  });

  it('offers the round button for a new deal in the open stage, with the pipeline', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'New deal' }));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/deal-form',
      params: { pipelineId: PIPELINE_ID, stageId: stageNew.id },
    });
  });

  it('narrows the board by the words typed in the search box', async () => {
    await show();
    await screen.findByRole('button', { name: '40 seats for Acme' });
    await fireEvent.press(screen.getByRole('button', { name: 'Search deals' }));
    await fireEvent.changeText(screen.getByLabelText('Search'), ' acme ');
    await waitFor(() =>
      expect(boardCall).toHaveBeenLastCalledWith(
        { q: 'acme', limit: 1, pipelineId: undefined },
        expect.anything(),
      ),
    );
    expect(columnCall).toHaveBeenLastCalledWith(
      stageNew.id,
      { q: 'acme', limit: 25, cursor: undefined },
      expect.anything(),
    );
  });
});

describe('DealsScreen states', () => {
  it('says so and asks for nothing when the person may not read deals', async () => {
    sessionCall.mockResolvedValue(sessionNoDeals);
    await show();
    expect(await screen.findByText("You can't see deals")).toBeTruthy();
    expect(boardCall).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'New deal' })).toBeNull();
  });

  it('says the plan has no deals when the API says so', async () => {
    boardCall.mockRejectedValue(new ApiError(422, 'PLAN_FEATURE_LOCKED', 'locked'));
    await show();
    expect(await screen.findByText('Deals are not included in this plan.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New deal' })).toBeNull();
  });

  it('shows a failed load with a way to try again', async () => {
    boardCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    await show();
    expect(await screen.findByRole('alert')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('button', { name: '40 seats for Acme' })).toBeTruthy();
  });

  it('says there is no pipeline when the workspace has no stages', async () => {
    boardCall.mockResolvedValue({ ...board, stages: [] });
    await show();
    expect(await screen.findByText('No pipeline yet')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New deal' })).toBeNull();
  });

  it('offers no actions or round button to a person who may only read', async () => {
    sessionCall.mockResolvedValue(sessionDealsReadOnly);
    await show();
    await screen.findByRole('button', { name: '40 seats for Acme' });
    expect(screen.queryByRole('button', { name: 'New deal' })).toBeNull();
    expect(screen.queryByRole('button', { name: /More actions for/ })).toBeNull();
  });
});

describe('DealsScreen actions', () => {
  it('moves a deal to another stage with the version that was read, and says so', async () => {
    await show();
    await pressMore('40 seats for Acme');
    await pressAction('Move to stage');
    await fireEvent.press(await screen.findByRole('radio', { name: 'Proposal' }));
    await waitFor(() =>
      expect(moveCall).toHaveBeenCalledWith(
        acmeDeal.id,
        { stageId: stageProposal.id, rowVersion: 3 },
        expect.any(String),
      ),
    );
    expect(await screen.findByText('Moved to Proposal.')).toBeTruthy();
  });

  it('marks a deal won', async () => {
    await show();
    await pressMore('40 seats for Acme');
    await pressAction('Mark as won');
    await waitFor(() => expect(wonCall).toHaveBeenCalledWith(acmeDeal.id, 3, expect.any(String)));
    expect(await screen.findByText('Marked as won.')).toBeTruthy();
  });

  it('marks a deal lost with no reason when the workspace does not require one', async () => {
    await show();
    await pressMore('40 seats for Acme');
    await pressAction('Mark as lost');
    await fireEvent.press(await screen.findByRole('button', { name: 'Mark as lost' }));
    await waitFor(() =>
      expect(lostCall).toHaveBeenCalledWith(acmeDeal.id, { rowVersion: 3 }, expect.any(String)),
    );
    expect(await screen.findByText('Marked as lost.')).toBeTruthy();
  });

  it('insists on a reason when the workspace requires one, and sends the catalogue reason chosen', async () => {
    settingsCall.mockResolvedValue(settingsRequired);
    reasonsCall.mockResolvedValue(lostReasons);
    await show();
    await pressMore('40 seats for Acme');
    await pressAction('Mark as lost');
    expect(
      await screen.findByText('Your workspace needs a reason for every lost deal.'),
    ).toBeTruthy();
    const confirm = await screen.findByRole('button', { name: 'Mark as lost' });
    await fireEvent.press(confirm);
    expect(await screen.findByText('Add a reason to continue.')).toBeTruthy();
    expect(lostCall).not.toHaveBeenCalled();
    await fireEvent.press(await screen.findByRole('radio', { name: 'Budget cut' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Mark as lost' }));
    await waitFor(() =>
      expect(lostCall).toHaveBeenCalledWith(
        acmeDeal.id,
        { lostReasonId: lostReasons[0]!.id, rowVersion: 3 },
        expect.any(String),
      ),
    );
  });

  it('offers the presets, and free words for "other", when the workspace has no reasons of its own', async () => {
    await show();
    await pressMore('40 seats for Acme');
    await pressAction('Mark as lost');
    await fireEvent.press(await screen.findByRole('radio', { name: 'Other' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Mark as lost' }));
    expect(await screen.findByText('Add a reason to continue.')).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Reason'), ' Went quiet ');
    await fireEvent.press(screen.getByRole('button', { name: 'Mark as lost' }));
    await waitFor(() =>
      expect(lostCall).toHaveBeenCalledWith(
        acmeDeal.id,
        { reason: 'Went quiet', rowVersion: 3 },
        expect.any(String),
      ),
    );
  });

  it('asks for a reason when a deal is moved into the lost stage, and moves it with that reason', async () => {
    await show();
    await pressMore('40 seats for Acme');
    await pressAction('Move to stage');
    await fireEvent.press(await screen.findByRole('radio', { name: 'Lost' }));
    expect(moveCall).not.toHaveBeenCalled();
    await fireEvent.press(await screen.findByRole('radio', { name: 'Price too high' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Mark as lost' }));
    await waitFor(() =>
      expect(moveCall).toHaveBeenCalledWith(
        acmeDeal.id,
        { stageId: stageLost.id, lostReason: 'Price too high', rowVersion: 3 },
        expect.any(String),
      ),
    );
  });

  it('keeps the sheet open and says why when the server still wants a reason', async () => {
    lostCall.mockRejectedValue(new ApiError(422, 'DEAL_LOST_REASON_REQUIRED', 'reason'));
    await show();
    await pressMore('40 seats for Acme');
    await pressAction('Mark as lost');
    await fireEvent.press(await screen.findByRole('button', { name: 'Mark as lost' }));
    expect(await screen.findByText('Choose or write a reason for losing this deal.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mark as lost' })).toBeTruthy();
  });

  it('reopens a closed deal', async () => {
    columnCall.mockResolvedValue(dealPage([wonDeal]));
    await show();
    await pressMore('Onboarding for Initech');
    await pressAction('Reopen');
    await waitFor(() =>
      expect(reopenCall).toHaveBeenCalledWith(wonDeal.id, { rowVersion: 7 }, expect.any(String)),
    );
    expect(await screen.findByText('Deal reopened.')).toBeTruthy();
  });

  it('deletes a deal only after a confirmation', async () => {
    await show();
    await pressMore('40 seats for Acme');
    await pressAction('Delete deal');
    expect(deleteCall).not.toHaveBeenCalled();
    expect(await screen.findByText(/Delete "40 seats for Acme" and its timeline/)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteCall).toHaveBeenCalledWith(acmeDeal.id, expect.any(String)));
  });

  it('opens the form to edit a deal', async () => {
    await show();
    await pressMore('40 seats for Acme');
    await pressAction('Edit deal');
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/deal-form',
      params: { dealId: acmeDeal.id },
    });
  });

  it('says a deal was changed by someone else and refreshes when its version is stale', async () => {
    moveCall.mockRejectedValue(new ApiError(409, 'ROW_VERSION_CONFLICT', 'stale'));
    await show();
    await pressMore('40 seats for Acme');
    await pressAction('Move to stage');
    await fireEvent.press(await screen.findByRole('radio', { name: 'Proposal' }));
    expect(
      await screen.findByText(
        'This deal was changed by someone else. The list has been refreshed.',
      ),
    ).toBeTruthy();
    await waitFor(() => expect(boardCall.mock.calls.length).toBeGreaterThan(1));
  });

  it('says the deal is gone when it no longer exists', async () => {
    wonCall.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'gone'));
    await show();
    await pressMore('40 seats for Acme');
    await pressAction('Mark as won');
    expect(await screen.findByText('This deal no longer exists.')).toBeTruthy();
  });

  it('leaves out what a person without the permission could not do', async () => {
    sessionCall.mockResolvedValue(sessionDealsUpdateOnly);
    await show();
    await pressMore('40 seats for Acme');
    expect(await screen.findByRole('menuitem', { name: 'Edit deal' })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: 'Delete deal' })).toBeNull();
  });
});

describe('DealsScreen list view', () => {
  it('shows every deal of the pipeline with its stage, newest first', async () => {
    await show();
    await screen.findByRole('button', { name: '40 seats for Acme' });
    await fireEvent.press(screen.getByRole('radio', { name: 'List' }));
    expect(await screen.findByRole('button', { name: 'Onboarding for Initech' })).toBeTruthy();
    expect(listCall).toHaveBeenCalledWith(
      { limit: 50, pipelineId: PIPELINE_ID, cursor: undefined },
      expect.anything(),
    );
    const won = screen.getByRole('button', { name: 'Onboarding for Initech' });
    expect(within(won).getAllByText('Won').length).toBeGreaterThan(0);
    expect(screen.queryByRole('tab', { name: 'New Lead, 2' })).toBeNull();
  });
});
