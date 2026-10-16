import type { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ApiError } from '@/lib/api';
import { fetchSession } from '@/lib/session/api';
import { contactId, sessionFull, sessionReadOnly } from '@/test/contact-notes-fixtures';
import { renderApp } from '@/test/render';
import * as api from './activity-api';
import { CallSummaryScreen } from './call-summary-screen';

jest.mock('./activity-api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn(), useLocalSearchParams: jest.fn() }));

const sessionCall = jest.mocked(fetchSession);
const createCall = jest.mocked(api.createContactActivity);
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() };

const STARTED = Date.UTC(2026, 9, 16, 6, 37, 0);

let client: QueryClient | undefined;
async function show(params: Record<string, string> = {}) {
  jest.mocked(useLocalSearchParams).mockReturnValue({
    contactId,
    name: 'Aarav Sharma',
    startedAt: String(STARTED),
    durationSec: '75',
    ...params,
  });
  const view = await renderApp(<CallSummaryScreen />);
  client = view.queryClient;
  return view;
}

beforeEach(() => {
  jest.resetAllMocks();
  client = undefined;
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  router.canGoBack.mockReturnValue(true);
  sessionCall.mockResolvedValue(sessionFull);
});
afterEach(async () => {
  if (client) {
    const cache = client;
    await waitFor(() => expect(cache.isFetching()).toBe(0));
  }
});

describe('CallSummaryScreen', () => {
  it('shows the call as the phone saw it, with a subject ready to save', async () => {
    await show();
    expect(await screen.findByRole('header', { name: 'Add call' })).toBeTruthy();
    expect(screen.getByText('Aarav Sharma')).toBeTruthy();
    expect(screen.getByText('Outbound')).toBeTruthy();
    expect(screen.getByLabelText('Call duration').props.value).toBe('01:15');
    expect(screen.getByLabelText('Subject').props.value).toBe('Outgoing call to Aarav Sharma');
  });

  it('saves a call on the timeline with its outcome, length, start and notes, then closes', async () => {
    createCall.mockResolvedValue({} as never);
    await show();
    await fireEvent.changeText(await screen.findByLabelText('Description'), '  Wants a demo \n');
    await fireEvent.changeText(screen.getByLabelText('Call duration'), '02:30');
    await fireEvent.changeText(screen.getByLabelText('Call result'), ' Interested ');
    await fireEvent.press(screen.getByRole('button', { name: 'Outgoing call status' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Not answered' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Call purpose' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Demo' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Save call' }));
    await waitFor(() =>
      expect(createCall).toHaveBeenCalledWith(
        contactId,
        {
          activityType: 'call',
          title: 'Outgoing call to Aarav Sharma',
          body: 'Outbound · Not answered · 02:30 · Demo\nCall result: Interested\nWants a demo',
          occurredAt: new Date(STARTED).toISOString(),
        },
        expect.any(String),
      ),
    );
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('asks for a length it can read, and a subject, before saving', async () => {
    await show();
    await fireEvent.changeText(await screen.findByLabelText('Call duration'), 'long');
    await fireEvent.changeText(screen.getByLabelText('Subject'), '   ');
    await fireEvent.press(screen.getByRole('button', { name: 'Save call' }));
    expect(
      screen.getByText('Enter the length as minutes:seconds, for example 02:30.'),
    ).toBeTruthy();
    expect(screen.getByText('Enter a subject of up to 255 characters.')).toBeTruthy();
    expect(createCall).not.toHaveBeenCalled();
  });

  it('shows the API failure and stays open so nothing typed is lost', async () => {
    createCall.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'Server error'));
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Save call' }));
    await waitFor(() => expect(createCall).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(router.back).not.toHaveBeenCalled();
  });

  it('leaves without saving on Skip, and goes home when there is nothing to go back to', async () => {
    router.canGoBack.mockReturnValue(false);
    await show();
    await fireEvent.press(await screen.findByRole('button', { name: 'Back' }));
    expect(router.replace).toHaveBeenCalledWith('/');
    expect(createCall).not.toHaveBeenCalled();
  });

  it('says so, and offers no form, to a person who may not change contacts', async () => {
    sessionCall.mockResolvedValue(sessionReadOnly);
    await show();
    expect(await screen.findByText(/can't be logged/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save call' })).toBeNull();
  });

  it('says so when the call has no contact', async () => {
    await show({ contactId: '' });
    expect(await screen.findByText('This call has no contact to log it on.')).toBeTruthy();
  });
});
