import type { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ApiError } from '@/lib/api';
import { fetchSession } from '@/lib/session/api';
import {
  contactId,
  meetingA,
  meetingB,
  meetings,
  pageOf,
  sessionFull,
  sessionNoContacts,
} from '@/test/contact-notes-fixtures';
import { renderApp } from '@/test/render';
import { reachEnd } from '@/test/scroll';
import { formatMoment } from './contact-display';
import * as api from './meetings-api';
import { ContactMeetingsScreen } from './meetings-screen';

jest.mock('./meetings-api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn(), useLocalSearchParams: jest.fn() }));

const sessionCall = jest.mocked(fetchSession);
const listCall = jest.mocked(api.listContactMeetings);
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() };

let client: QueryClient | undefined;
async function show() {
  const view = await renderApp(<ContactMeetingsScreen />);
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
  sessionCall.mockResolvedValue(sessionFull);
  listCall.mockResolvedValue(pageOf(meetings));
});
afterEach(async () => {
  if (client) await settled(client);
});

describe('ContactMeetingsScreen', () => {
  it('lists the meetings with when they are and where, and says so when a meeting has neither', async () => {
    await show();
    expect(await screen.findByText(meetingA.title)).toBeTruthy();
    expect(screen.getByText(meetingB.title)).toBeTruthy();
    expect(screen.getByRole('header', { name: 'Meetings' })).toBeTruthy();
    expect(
      screen.getByText(`${formatMoment(meetingA.startsAt, 'en')} · ${meetingA.location}`),
    ).toBeTruthy();
    expect(screen.getByText('No date set')).toBeTruthy();
    expect(listCall).toHaveBeenCalledWith(
      contactId,
      { limit: 20, cursor: undefined },
      expect.anything(),
    );
  });

  it('says there are no meetings', async () => {
    listCall.mockResolvedValue(pageOf([]));
    await show();
    expect(await screen.findByText('No meetings logged.')).toBeTruthy();
  });

  it('shows the failure with a way to try again', async () => {
    listCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_TIMEOUT', 'slow'));
    await show();
    expect(
      await screen.findByText('The server took too long to answer. Please try again.'),
    ).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText(meetingA.title)).toBeTruthy();
  });

  it('says so when the contact no longer exists', async () => {
    listCall.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'gone'));
    await show();
    expect(await screen.findByText('This contact no longer exists.')).toBeTruthy();
  });

  it('tells a person the API refuses (403) instead of showing a retry', async () => {
    listCall.mockRejectedValue(new ApiError(403, 'FORBIDDEN', 'no'));
    await show();
    expect(await screen.findByText("You can't view meetings")).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('tells a person without the permission, and asks for nothing', async () => {
    sessionCall.mockResolvedValue(sessionNoContacts);
    const { queryClient } = await show();
    expect(await screen.findByText("You can't view meetings")).toBeTruthy();
    await settled(queryClient);
    expect(listCall).not.toHaveBeenCalled();
  });

  it('asks for the next page when the end is reached, and stops when there is none', async () => {
    listCall.mockResolvedValueOnce(pageOf([meetingA], 'cursor-2'));
    listCall.mockResolvedValueOnce(pageOf([meetingB]));
    const { queryClient } = await show();
    await screen.findByText(meetingA.title);
    await reachEnd(screen.getByTestId('meetings-list'));
    expect(await screen.findByText(meetingB.title)).toBeTruthy();
    expect(listCall).toHaveBeenLastCalledWith(
      contactId,
      { limit: 20, cursor: 'cursor-2' },
      expect.anything(),
    );
    await settled(queryClient);
    await reachEnd(screen.getByTestId('meetings-list'));
    expect(listCall).toHaveBeenCalledTimes(2);
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
