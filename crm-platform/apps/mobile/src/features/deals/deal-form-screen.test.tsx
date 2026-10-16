import type { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ApiError } from '@/lib/api';
import { fetchSession } from '@/lib/session/api';
import {
  PIPELINE_ID,
  acmeDeal,
  board,
  contactChoices,
  lateDeal,
  sessionDealsFull,
  sessionDealsReadOnly,
  sessionDealsUpdateOnly,
  sessionNoDeals,
  stageNew,
  stageProposal,
  team,
} from '@/test/deals-fixtures';
import { renderApp } from '@/test/render';
import * as api from './api';
import { DealFormScreen } from './deal-form-screen';

jest.mock('./api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn(), useLocalSearchParams: jest.fn() }));

const sessionCall = jest.mocked(fetchSession);
const boardCall = jest.mocked(api.getBoard);
const getCall = jest.mocked(api.getDeal);
const createCall = jest.mocked(api.createDeal);
const updateCall = jest.mocked(api.updateDeal);
const teamCall = jest.mocked(api.listAssignees);
const searchCall = jest.mocked(api.searchContacts);
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() };

const DEV = team[1]!;

const settled = (queryClient: QueryClient) =>
  waitFor(() => expect(queryClient.isFetching()).toBe(0));

let client: QueryClient | undefined;
async function show() {
  const view = await renderApp(<DealFormScreen />);
  client = view.queryClient;
  return view;
}

const save = async () => await fireEvent.press(screen.getByRole('button', { name: 'Save deal' }));
const typeTitle = async (text: string) =>
  await fireEvent.changeText(await screen.findByLabelText('Deal name'), text);

beforeEach(() => {
  jest.resetAllMocks();
  client = undefined;
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  jest.mocked(useLocalSearchParams).mockReturnValue({ pipelineId: PIPELINE_ID });
  router.canGoBack.mockReturnValue(true);
  sessionCall.mockResolvedValue(sessionDealsFull);
  boardCall.mockResolvedValue(board);
  getCall.mockResolvedValue(acmeDeal);
  createCall.mockResolvedValue(acmeDeal);
  updateCall.mockResolvedValue(acmeDeal);
  teamCall.mockResolvedValue(team);
  searchCall.mockResolvedValue(contactChoices);
});
afterEach(async () => {
  if (client) {
    const cache = client;
    await settled(cache);
  }
});

describe('adding a deal', () => {
  it("shows the fields in order under the New deal header, in the pipeline's currency and for me", async () => {
    await show();
    expect(await screen.findByRole('header', { name: 'New deal' })).toBeTruthy();
    const order = [
      screen.getByLabelText('Deal name'),
      screen.getByLabelText('Value'),
      screen.getByRole('button', { name: 'Currency' }),
      screen.getByRole('button', { name: 'Starting stage' }),
      screen.getByRole('button', { name: 'Owner' }),
      screen.getByRole('button', { name: 'Customer' }),
      screen.getByLabelText('Expected close day'),
    ];
    expect(order).toHaveLength(7);
    expect(screen.getByRole('button', { name: 'Currency' }).props.accessibilityValue.text).toBe(
      'USD',
    );
    expect(screen.getByRole('button', { name: 'Owner' }).props.accessibilityValue.text).toBe('Me');
    expect(
      screen.getByRole('button', { name: 'Starting stage' }).props.accessibilityValue.text,
    ).toBe('New Lead');
    expect(boardCall).toHaveBeenCalledWith(
      { pipelineId: PIPELINE_ID, limit: 1 },
      expect.anything(),
    );
  });

  it('starts in the column the round button was pressed in', async () => {
    jest
      .mocked(useLocalSearchParams)
      .mockReturnValue({ pipelineId: PIPELINE_ID, stageId: stageProposal.id });
    await show();
    expect(
      (await screen.findByRole('button', { name: 'Starting stage' })).props.accessibilityValue.text,
    ).toBe('Proposal');
  });

  it('creates the deal with just a name, in that column, and opens it', async () => {
    jest
      .mocked(useLocalSearchParams)
      .mockReturnValue({ pipelineId: PIPELINE_ID, stageId: stageProposal.id });
    await show();
    await typeTitle('  40 seats  ');
    await save();
    await waitFor(() =>
      expect(createCall).toHaveBeenCalledWith(
        { title: '40 seats', pipelineId: PIPELINE_ID, stageId: stageProposal.id, currency: 'USD' },
        expect.any(String),
      ),
    );
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith({
        pathname: '/deal/[id]',
        params: { id: acmeDeal.id },
      }),
    );
  });

  it('sends every field that is filled', async () => {
    await show();
    await typeTitle('Big deal');
    await fireEvent.changeText(screen.getByLabelText('Value'), '1,250.5');
    await fireEvent.press(screen.getByRole('button', { name: 'Currency' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'EUR' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Owner' }));
    await fireEvent.press(
      await screen.findByRole('radio', { name: `${DEV.fullName}, ${DEV.email}` }),
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Customer' }));
    await fireEvent.press(await screen.findByRole('radio', { name: /Aarav Sharma/ }));
    await fireEvent.changeText(screen.getByLabelText('Expected close day'), '2026-10-31');
    await save();
    await waitFor(() =>
      expect(createCall).toHaveBeenCalledWith(
        {
          title: 'Big deal',
          pipelineId: PIPELINE_ID,
          stageId: stageNew.id,
          value: '1250.50',
          currency: 'EUR',
          ownerId: DEV.id,
          contactId: contactChoices[0]!.id,
          expectedCloseDate: '2026-10-31',
        },
        expect.any(String),
      ),
    );
  });

  it('offers only the people the caller may hand deals to', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Owner' }));
    expect(
      await screen.findByRole('radio', { name: `${DEV.fullName}, ${DEV.email}` }),
    ).toBeTruthy();
    expect(screen.queryByText('Out Of Scope')).toBeNull();
  });

  it('can leave the deal with nobody', async () => {
    await show();
    await typeTitle('No owner yet');
    await fireEvent.press(screen.getByRole('button', { name: 'Owner' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'Unassigned' }));
    await save();
    await waitFor(() =>
      expect(createCall).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'No owner yet', ownerId: null }),
        expect.any(String),
      ),
    );
  });

  it('asks for a name before sending anything', async () => {
    await show();
    await typeTitle('   ');
    await save();
    expect(await screen.findByText('Enter a name for the deal.')).toBeTruthy();
    expect(createCall).not.toHaveBeenCalled();
  });

  it('refuses an amount or a day that is not real, with the message under the field', async () => {
    await show();
    await typeTitle('Deal');
    await fireEvent.changeText(screen.getByLabelText('Value'), '12.345');
    await fireEvent.changeText(screen.getByLabelText('Expected close day'), '2026-02-31');
    await save();
    expect(
      await screen.findByText(
        'Enter an amount like 1250.50, with no more decimals than the currency has.',
      ),
    ).toBeTruthy();
    expect(screen.getByText('Enter a real day like 2026-10-31.')).toBeTruthy();
    expect(createCall).not.toHaveBeenCalled();
  });

  it('puts what the server refuses under the field it names, and keeps what was typed', async () => {
    createCall.mockRejectedValue(
      new ApiError(422, 'VALIDATION_FAILED', 'bad', undefined, [
        { path: 'title', message: 'required' },
      ]),
    );
    await show();
    await typeTitle('Deal');
    await save();
    expect(await screen.findByText('Enter a name for the deal.')).toBeTruthy();
    expect(screen.getByLabelText('Deal name').props.value).toBe('Deal');
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('says it about the whole form when no field is to blame', async () => {
    createCall.mockRejectedValue(new ApiError(422, 'DEAL_OWNER_INVALID', 'owner'));
    await show();
    await typeTitle('Deal');
    await save();
    expect(await screen.findByText("That person can't own this deal.")).toBeTruthy();
  });

  it('sends a repeated save once when the first answer was lost', async () => {
    createCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    await show();
    await typeTitle('Deal');
    await save();
    await screen.findByRole('alert');
    await save();
    await waitFor(() => expect(createCall).toHaveBeenCalledTimes(2));
    expect(createCall.mock.calls[1]![1]).toBe(createCall.mock.calls[0]![1]);
  });
});

describe('editing a deal', () => {
  beforeEach(() => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ dealId: acmeDeal.id });
  });

  it('shows the deal as it is, without a starting stage', async () => {
    await show();
    expect(await screen.findByRole('header', { name: 'Edit deal' })).toBeTruthy();
    expect(screen.getByLabelText('Deal name').props.value).toBe('40 seats for Acme');
    expect(screen.getByLabelText('Value').props.value).toBe('12500.00');
    expect(screen.getByLabelText('Expected close day').props.value).toBe('2099-12-31');
    expect(screen.queryByRole('button', { name: 'Starting stage' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Owner' }).props.accessibilityValue.text).toBe('Me');
    expect(screen.getByRole('button', { name: 'Customer' }).props.accessibilityValue.text).toBe(
      'Aarav Sharma',
    );
    expect(boardCall).toHaveBeenCalledWith(
      { pipelineId: acmeDeal.pipeline.id, limit: 1 },
      expect.anything(),
    );
  });

  it('sends only what changed, with the version that was read', async () => {
    await show();
    await fireEvent.changeText(await screen.findByLabelText('Deal name'), 'Renamed');
    await fireEvent.changeText(screen.getByLabelText('Value'), '13000');
    await save();
    await waitFor(() =>
      expect(updateCall).toHaveBeenCalledWith(
        acmeDeal.id,
        { title: 'Renamed', value: '13000.00', rowVersion: 3 },
        expect.any(String),
      ),
    );
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('sends the amount with a new currency', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Currency' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'EUR' }));
    await save();
    await waitFor(() =>
      expect(updateCall).toHaveBeenCalledWith(
        acmeDeal.id,
        { currency: 'EUR', value: '12500.00', rowVersion: 3 },
        expect.any(String),
      ),
    );
  });

  it('clears the customer and the close day', async () => {
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Customer' }));
    await fireEvent.press(await screen.findByRole('radio', { name: 'No customer' }));
    await fireEvent.changeText(screen.getByLabelText('Expected close day'), '');
    await save();
    await waitFor(() =>
      expect(updateCall).toHaveBeenCalledWith(
        acmeDeal.id,
        { contactId: null, expectedCloseDate: null, rowVersion: 3 },
        expect.any(String),
      ),
    );
  });

  it('goes back without asking the server when nothing changed', async () => {
    await show();
    await screen.findByLabelText('Deal name');
    await save();
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(updateCall).not.toHaveBeenCalled();
  });

  it('reloads the deal and asks the person to look again when someone else saved first', async () => {
    updateCall.mockRejectedValue(new ApiError(409, 'ROW_VERSION_CONFLICT', 'stale'));
    getCall.mockResolvedValueOnce(acmeDeal).mockResolvedValueOnce({
      ...acmeDeal,
      title: 'Changed elsewhere',
      rowVersion: 4,
    });
    await show();
    await fireEvent.changeText(await screen.findByLabelText('Deal name'), 'Mine');
    await save();
    expect(
      await screen.findByText(
        'This deal was changed by someone else. It has been reloaded: look it over and save again.',
      ),
    ).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByLabelText('Deal name').props.value).toBe('Changed elsewhere'),
    );
    expect(router.back).not.toHaveBeenCalled();
  });

  it('shows a deal without an owner as Unassigned', async () => {
    getCall.mockResolvedValue(lateDeal);
    await show();
    expect(
      (await screen.findByRole('button', { name: 'Owner' })).props.accessibilityValue.text,
    ).toBe('Unassigned');
  });

  it('says the deal is gone when it no longer exists', async () => {
    getCall.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'gone'));
    await show();
    expect(await screen.findByText('This deal no longer exists.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('shows a failed load with a way to try again', async () => {
    getCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Deal name')).toBeTruthy();
  });
});

describe('permissions', () => {
  it('says so, and asks for nothing, when the person may not add deals', async () => {
    sessionCall.mockResolvedValue(sessionDealsReadOnly);
    await show();
    expect(await screen.findByText("You can't add deals")).toBeTruthy();
    expect(boardCall).not.toHaveBeenCalled();
  });

  it('says so when the person may not edit deals', async () => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ dealId: acmeDeal.id });
    sessionCall.mockResolvedValue(sessionDealsReadOnly);
    await show();
    expect(await screen.findByText("You can't edit deals")).toBeTruthy();
    expect(getCall).not.toHaveBeenCalled();
  });

  it('says so to a person who may not read deals at all', async () => {
    sessionCall.mockResolvedValue(sessionNoDeals);
    await show();
    expect(await screen.findByText("You can't add deals")).toBeTruthy();
  });

  it('offers only "Me" and "Unassigned" and no customer list to a person who may not read contacts', async () => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ dealId: acmeDeal.id });
    sessionCall.mockResolvedValue(sessionDealsUpdateOnly);
    await show();
    await screen.findByLabelText('Deal name');
    expect(screen.queryByRole('button', { name: 'Customer' })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Owner' }));
    expect(await screen.findByRole('radio', { name: 'Unassigned' })).toBeTruthy();
    expect(teamCall).not.toHaveBeenCalled();
  });

  it('says the plan has no deals when the API says so', async () => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ dealId: acmeDeal.id });
    getCall.mockRejectedValue(new ApiError(422, 'PLAN_FEATURE_LOCKED', 'locked'));
    await show();
    expect(await screen.findByText('Deals are not included in this plan.')).toBeTruthy();
  });
});
