import type { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ApiError } from '@/lib/api';
import { fetchSession } from '@/lib/session/api';
import { companyA, contactId, sessionFull } from '@/test/contact-notes-fixtures';
import { renderApp } from '@/test/render';
import * as api from './company-api';
import { ContactCompanyScreen } from './company-screen';

jest.mock('./company-api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn(), useLocalSearchParams: jest.fn() }));

const sessionCall = jest.mocked(fetchSession);
const getCall = jest.mocked(api.getCompany);
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() };
const sessionCompanies = {
  ...sessionFull,
  permissions: { ...sessionFull.permissions, 'record.companies.read': 'all' },
} as typeof sessionFull;

let client: QueryClient | undefined;
async function show() {
  const view = await renderApp(<ContactCompanyScreen />);
  client = view.queryClient;
  return view;
}
const settled = (queryClient: QueryClient) =>
  waitFor(() => expect(queryClient.isFetching()).toBe(0));

beforeEach(() => {
  jest.resetAllMocks();
  client = undefined;
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  jest.mocked(useLocalSearchParams).mockReturnValue({ companyId: companyA.id, contactId });
  router.canGoBack.mockReturnValue(true);
  sessionCall.mockResolvedValue(sessionCompanies);
  getCall.mockResolvedValue(companyA);
});
afterEach(async () => {
  if (client) await settled(client);
});

describe('ContactCompanyScreen', () => {
  it('shows who the company is and what is known of it, leaving out what is not', async () => {
    await show();
    expect(await screen.findByRole('header', { name: 'Apex IQ' })).toBeTruthy();
    expect(screen.getByText('Software')).toBeTruthy();
    expect(screen.getByText('+14155550100')).toBeTruthy();
    expect(screen.queryByText('Address')).toBeNull();
    expect(getCall).toHaveBeenCalledWith(companyA.id, expect.anything());
  });

  it('says so when the company no longer exists', async () => {
    getCall.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'gone'));
    await show();
    expect(await screen.findByText('This account no longer exists.')).toBeTruthy();
  });

  it('shows the failure with a way to try again', async () => {
    getCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_TIMEOUT', 'slow'));
    await show();
    expect(
      await screen.findByText('The server took too long to answer. Please try again.'),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('header', { name: 'Apex IQ' })).toBeTruthy();
  });

  it('tells a person the API refuses (403) instead of showing a retry', async () => {
    getCall.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'no'));
    await show();
    expect(await screen.findByText("You can't view accounts")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('tells a person without the permission, and asks for nothing', async () => {
    sessionCall.mockResolvedValue(sessionFull);
    const { queryClient } = await show();
    expect(await screen.findByText("You can't view accounts")).toBeTruthy();
    await settled(queryClient);
    expect(getCall).not.toHaveBeenCalled();
  });

  it('says there is no account when the link has no id, and goes back to the contact', async () => {
    jest.mocked(useLocalSearchParams).mockReturnValue({ contactId });
    router.canGoBack.mockReturnValue(false);
    await show();
    expect(await screen.findByText('This account no longer exists.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    expect(router.replace).toHaveBeenCalledWith({
      pathname: '/contact/[id]',
      params: { id: contactId },
    });
  });
});
