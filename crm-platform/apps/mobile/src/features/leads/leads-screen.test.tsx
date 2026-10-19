import type { QueryClient } from '@tanstack/react-query';
import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { ApiError } from '@/lib/api';
import { initI18n } from '@/lib/i18n';
import { fetchSession } from '@/lib/session/api';
import {
  SOURCE_ID,
  facebookForm,
  pausedLanding,
  sessionLeadsManager,
  sessionLeadsReadOnly,
  sessionNoLeads,
} from '@/test/leads-fixtures';
import { renderApp } from '@/test/render';
import * as api from './api';
import { LeadsScreen } from './leads-screen';

jest.mock('./api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

const sessionCall = jest.mocked(fetchSession);
const listCall = jest.mocked(api.listLeadSources);
const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn() };

let client: QueryClient | undefined;
async function show() {
  const view = await renderApp(<LeadsScreen />);
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
  router.canGoBack.mockReturnValue(true);
  sessionCall.mockResolvedValue(sessionLeadsManager);
  listCall.mockResolvedValue({ data: [facebookForm, pausedLanding] });
});
afterEach(async () => {
  if (client) {
    const cache = client;
    await waitFor(() => expect(cache.isFetching()).toBe(0));
  }
});

describe('LeadsScreen', () => {
  it('lists the lead sources with their status, last lead and what waits', async () => {
    await show();
    expect(await screen.findByText('Facebook lead form')).toBeTruthy();
    expect(screen.getByText('Landing page')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('Paused')).toBeTruthy();
    expect(screen.getByText('2 leads')).toBeTruthy();
    expect(screen.getByText('No leads yet')).toBeTruthy();
    expect(screen.getByText('2 leads need attention')).toBeTruthy();
  });

  it('opens a source', async () => {
    await show();
    await fireEvent.press(await screen.findByLabelText('Facebook lead form'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/lead-source/[id]',
      params: { id: SOURCE_ID },
    });
  });

  it('says so when there are no sources, and points a manager to create one', async () => {
    listCall.mockResolvedValue({ data: [] });
    await show();
    expect(await screen.findByText('No sources yet')).toBeTruthy();
    expect(screen.getByText(/Create a webhook source/)).toBeTruthy();
  });

  it('tells a person who cannot manage to ask someone who can', async () => {
    sessionCall.mockResolvedValue(sessionLeadsReadOnly);
    listCall.mockResolvedValue({ data: [] });
    await show();
    expect(await screen.findByText(/Ask someone who can manage lead sources/)).toBeTruthy();
  });

  it('asks for nothing and explains when the person may not read lead sources', async () => {
    sessionCall.mockResolvedValue(sessionNoLeads);
    await show();
    expect(await screen.findByText('You do not have access to Social leads')).toBeTruthy();
    expect(listCall).not.toHaveBeenCalled();
  });

  it('explains a plan without lead sources', async () => {
    listCall.mockRejectedValue(new ApiError(422, 'PLAN_FEATURE_LOCKED', 'locked'));
    await show();
    expect(await screen.findByText('Social leads is not part of your plan')).toBeTruthy();
  });

  it('shows a failure with a retry', async () => {
    listCall.mockRejectedValueOnce(new ApiError(500, 'INTERNAL', 'boom'));
    await show();
    expect(await screen.findByRole('alert')).toBeTruthy();
    listCall.mockResolvedValue({ data: [facebookForm] });
    await fireEvent.press(screen.getByText('Try again'));
    expect(await screen.findByText('Facebook lead form')).toBeTruthy();
  });

  it('goes back to where it was opened from, or to the Account tab', async () => {
    await show();
    await fireEvent.press(await screen.findByLabelText('Back'));
    expect(router.back).toHaveBeenCalled();
    router.canGoBack.mockReturnValue(false);
    await fireEvent.press(screen.getByLabelText('Back'));
    expect(router.replace).toHaveBeenCalledWith('/menu');
  });
});
