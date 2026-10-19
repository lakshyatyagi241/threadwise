import type { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ApiError } from '@/lib/api';
import { initI18n } from '@/lib/i18n';
import { fetchSession } from '@/lib/session/api';
import {
  CONTACT_ID,
  DEAL_ID,
  SOURCE_ID,
  createdLead,
  eventPage,
  events,
  facebookForm,
  pausedLanding,
  purgedReview,
  reviewLead,
  sessionLeadsManager,
  sessionLeadsReadOnly,
  sessionNoLeads,
} from '@/test/leads-fixtures';
import { renderApp } from '@/test/render';
import * as api from './api';
import { LeadSourceScreen } from './lead-source-screen';

jest.mock('./api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn(), useLocalSearchParams: jest.fn() }));

const sessionCall = jest.mocked(fetchSession);
const sourceCall = jest.mocked(api.getLeadSource);
const eventsCall = jest.mocked(api.listLeadEvents);
const statusCall = jest.mocked(api.setLeadSourceStatus);
const retryCall = jest.mocked(api.retryLeadEvent);
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() };

let client: QueryClient | undefined;
async function show() {
  const view = await renderApp(<LeadSourceScreen />);
  client = view.queryClient;
  return view;
}

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(() => {
  jest.resetAllMocks();
  client = undefined;
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  jest.mocked(useLocalSearchParams).mockReturnValue({ id: SOURCE_ID });
  router.canGoBack.mockReturnValue(true);
  sessionCall.mockResolvedValue(sessionLeadsManager);
  sourceCall.mockResolvedValue(facebookForm);
  eventsCall.mockResolvedValue(eventPage(events));
});
afterEach(async () => {
  if (client) {
    const cache = client;
    await waitFor(() => expect(cache.isFetching()).toBe(0));
  }
});

describe('LeadSourceScreen', () => {
  it('shows the source and the leads it received with what became of each', async () => {
    await show();
    expect(await screen.findByText('Facebook lead form')).toBeTruthy();
    expect(screen.getByText('The URL token ends in 4f2a')).toBeTruthy();
    expect(screen.getByText(/shared secret is set/)).toBeTruthy();
    expect(screen.getByText('2 leads need attention')).toBeTruthy();
    expect(await screen.findByText('Contact created')).toBeTruthy();
    expect(screen.getAllByText('Needs review').length).toBeGreaterThan(0);
    expect(screen.getByText('No email or phone')).toBeTruthy();
    expect(screen.getByText('Processing error')).toBeTruthy();
    expect(screen.getByText('Test')).toBeTruthy();
    expect(eventsCall).toHaveBeenCalledWith(
      SOURCE_ID,
      { limit: 25, cursor: undefined, status: undefined },
      expect.anything(),
    );
  });

  it('asks the API for one status when a filter is chosen', async () => {
    await show();
    await screen.findByText('Contact created');
    eventsCall.mockResolvedValue(eventPage([reviewLead]));
    await fireEvent.press(screen.getByRole('radio', { name: 'Needs review' }));
    await waitFor(() =>
      expect(eventsCall).toHaveBeenLastCalledWith(
        SOURCE_ID,
        { limit: 25, cursor: undefined, status: 'needs_review' },
        expect.anything(),
      ),
    );
    await waitFor(() => expect(screen.queryByText('Contact created')).toBeNull());
  });

  it('says so when the source has received nothing, and when a filter matches nothing', async () => {
    eventsCall.mockResolvedValue(eventPage([]));
    await show();
    expect(await screen.findByText('No leads yet')).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'Failed' }));
    expect(await screen.findByText('No leads match')).toBeTruthy();
  });

  describe("a lead's details", () => {
    it('shows the advice and lets a manager retry a lead that waits', async () => {
      retryCall.mockResolvedValue({ event: { ...reviewLead, status: 'created' } });
      await show();
      await fireEvent.press(await screen.findByLabelText(/Needs review\. No email or phone/));
      expect(await screen.findByText(/neither a usable email nor a phone number/)).toBeTruthy();
      await fireEvent.press(screen.getByText('Retry this lead'));
      await waitFor(() =>
        expect(retryCall).toHaveBeenCalledWith(SOURCE_ID, reviewLead.id, expect.any(String)),
      );
      expect(await screen.findByText('Retried: now Contact created')).toBeTruthy();
    });

    it('explains a refused retry by its code', async () => {
      retryCall.mockRejectedValue(new ApiError(409, 'LEAD_SOURCE_PAUSED', 'paused'));
      await show();
      await fireEvent.press(await screen.findByLabelText(/Needs review\. No email or phone/));
      await fireEvent.press(await screen.findByText('Retry this lead'));
      expect(await screen.findByText(/This source is paused\. Resume it/)).toBeTruthy();
    });

    it('offers no retry to a person who may only look, nor for a purged lead', async () => {
      sessionCall.mockResolvedValue(sessionLeadsReadOnly);
      await show();
      await fireEvent.press(await screen.findByLabelText(/Needs review\. No email or phone/));
      await screen.findByText('Lead details');
      expect(screen.queryByText('Retry this lead')).toBeNull();
    });

    it('does not offer a retry for a lead whose stored data is gone', async () => {
      eventsCall.mockResolvedValue(eventPage([purgedReview]));
      await show();
      await fireEvent.press(await screen.findByLabelText(/Needs review\. No email or phone/));
      await screen.findByText('Lead details');
      expect(screen.queryByText('Retry this lead')).toBeNull();
    });

    it('opens the contact and the deal the lead became', async () => {
      eventsCall.mockResolvedValue(eventPage([createdLead]));
      await show();
      await fireEvent.press(await screen.findByLabelText(/Contact created/));
      await fireEvent.press(await screen.findByText('Open the contact'));
      expect(router.push).toHaveBeenCalledWith({
        pathname: '/contact/[id]',
        params: { id: CONTACT_ID },
      });
      await fireEvent.press(await screen.findByLabelText(/Contact created/));
      await fireEvent.press(await screen.findByText('Open the deal'));
      expect(router.push).toHaveBeenCalledWith({ pathname: '/deal/[id]', params: { id: DEAL_ID } });
    });
  });

  describe('pausing and resuming', () => {
    it('asks before pausing, then pauses with the version that was read', async () => {
      statusCall.mockResolvedValue({ ...facebookForm, status: 'paused', rowVersion: 4 });
      await show();
      await fireEvent.press(await screen.findByText('Pause'));
      expect(await screen.findByText('Pause this source?')).toBeTruthy();
      expect(statusCall).not.toHaveBeenCalled();
      await fireEvent.press(screen.getByText('Pause source'));
      await waitFor(() =>
        expect(statusCall).toHaveBeenCalledWith(SOURCE_ID, 3, 'paused', expect.any(String)),
      );
      expect(await screen.findByText('Source paused')).toBeTruthy();
    });

    it('resumes a paused source at once, without asking', async () => {
      sourceCall.mockResolvedValue({ ...pausedLanding, id: SOURCE_ID });
      statusCall.mockResolvedValue({ ...pausedLanding, id: SOURCE_ID, status: 'active' });
      await show();
      expect(await screen.findByText(/This source is paused/)).toBeTruthy();
      await fireEvent.press(screen.getByText('Resume'));
      await waitFor(() =>
        expect(statusCall).toHaveBeenCalledWith(SOURCE_ID, 3, 'active', expect.any(String)),
      );
    });

    it('says someone else changed the source when the version is stale', async () => {
      statusCall.mockRejectedValue(new ApiError(409, 'ROW_VERSION_CONFLICT', 'stale'));
      await show();
      await fireEvent.press(await screen.findByText('Pause'));
      await fireEvent.press(await screen.findByText('Pause source'));
      expect(await screen.findByText(/Someone else changed this source/)).toBeTruthy();
    });

    it('has no Pause button for a person who may only look', async () => {
      sessionCall.mockResolvedValue(sessionLeadsReadOnly);
      await show();
      await screen.findByText('Facebook lead form');
      expect(screen.queryByText('Pause')).toBeNull();
    });
  });

  it('asks for nothing when the person may not read lead sources', async () => {
    sessionCall.mockResolvedValue(sessionNoLeads);
    await show();
    expect(await screen.findByText('You do not have access to Social leads')).toBeTruthy();
    expect(sourceCall).not.toHaveBeenCalled();
  });

  it('says so when the source is gone', async () => {
    sourceCall.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'gone'));
    await show();
    expect(await screen.findByText('We could not find it. It may have been deleted.')).toBeTruthy();
  });
});
