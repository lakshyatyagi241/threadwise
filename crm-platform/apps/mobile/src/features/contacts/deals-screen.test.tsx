import type { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ApiError } from '@/lib/api';
import { fetchSession } from '@/lib/session/api';
import { contactDeals, contactId, dealA, sessionFull } from '@/test/contact-notes-fixtures';
import { renderApp } from '@/test/render';
import * as api from './deals-api';
import { ContactDealsScreen } from './deals-screen';

jest.mock('./deals-api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn(), useLocalSearchParams: jest.fn() }));

const sessionCall = jest.mocked(fetchSession);
const listCall = jest.mocked(api.listContactDeals);
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() };
const sessionDeals = {
  ...sessionFull,
  permissions: { ...sessionFull.permissions, 'record.deals.read': 'all' },
} as typeof sessionFull;

let client: QueryClient | undefined;
async function show() {
  const view = await renderApp(<ContactDealsScreen />);
  client = view.queryClient;
  return view;
}
const settled = (queryClient: QueryClient) =>
  waitFor(() => expect(queryClient.isFetching()).toBe(0));

beforeEach(() => {
  jest.resetAllMocks();
  client = undefined;
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  jest.mocked(useLocalSearchParams).mockReturnValue({ contactId });
  router.canGoBack.mockReturnValue(true);
  sessionCall.mockResolvedValue(sessionDeals);
  listCall.mockResolvedValue(contactDeals);
});
afterEach(async () => {
  if (client) await settled(client);
});

describe('ContactDealsScreen', () => {
  it('lists the deals with their stage and value', async () => {
    await show();
    expect(await screen.findByText(dealA.title)).toBeTruthy();
    expect(screen.getByText('Proposal · 1200.00 INR')).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Deals' })).toBeTruthy();
    expect(listCall).toHaveBeenCalledWith(contactId, expect.anything());
  });

  it('says there are no deals', async () => {
    listCall.mockResolvedValue({ ...contactDeals, deals: [] });
    await show();
    expect(await screen.findByText('No deals yet.')).toBeTruthy();
  });

  it('shows the failure with a way to try again', async () => {
    listCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_TIMEOUT', 'slow'));
    await show();
    expect(
      await screen.findByText('The server took too long to answer. Please try again.'),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(dealA.title)).toBeTruthy();
  });

  it('says so when the contact no longer exists', async () => {
    listCall.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'gone'));
    await show();
    expect(await screen.findByText('This contact no longer exists.')).toBeTruthy();
  });

  it('tells a person the API refuses (403) instead of showing a retry', async () => {
    listCall.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'no'));
    await show();
    expect(await screen.findByText("You can't view deals")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('asks for nothing from a person who may not read deals', async () => {
    sessionCall.mockResolvedValue(sessionFull);
    const { queryClient } = await show();
    expect(await screen.findByText("You can't view deals")).toBeTruthy();
    await settled(queryClient);
    expect(listCall).not.toHaveBeenCalled();
  });

  it('goes back, to the contact when there is nowhere to go back to', async () => {
    router.canGoBack.mockReturnValue(false);
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Back' }));
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/contact/[id]',
      params: { id: contactId },
    });
  });
});
