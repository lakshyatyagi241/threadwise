import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';
import { ApiError } from '@/lib/api';
import { i18n, initI18n } from '@/lib/i18n';
import { getSnapshot, resetSessionForTests, startSession } from '@/lib/auth/session-manager';
import { identifyUser } from '@/lib/observability/sentry';
import { jsonResponse, mockFetch, TOKEN_PAIR } from '@/test/fetch-mock';
import * as api from './api';
import { HomeScreen } from './home-screen';

jest.mock('./api');
jest.mock('@/lib/observability/sentry', () => ({ identifyUser: jest.fn() }));
const fetchSession = jest.mocked(api.fetchSession);

const session = {
  user: {
    id: '6f1c3f0e-6f5c-4d3a-9a4e-2f6f1b0d9a11',
    email: 'person@example.com',
    fullName: 'Pat Person',
    displayName: null,
    phone: null,
    locale: null,
    theme: 'paper' as const,
    avatarUrl: null,
    emailVerified: true,
    mfaEnabled: false,
  },
  org: {
    id: '0b0f8d62-3f1a-4b8e-8f2e-7d1c2a9e5b10',
    slug: 'acme',
    name: 'Acme Ltd',
    plan: 'pro',
    timezone: null,
    currency: null,
    messageFooter: null,
    onboardingStep: 'done' as const,
  },
  roles: [],
  permissions: {},
  landing: 'dashboard' as const,
  flags: {
    suspended: false,
    emailUnverified: false,
    emailBlocked: false,
    mfaEnrolmentRequired: false,
    passwordChangeRequired: false,
  },
  sessionId: '3a7d1c9e-2b4f-4c6d-8e0a-5f1b2c3d4e5f',
};

const renderScreen = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <HomeScreen />
      </QueryClientProvider>
    </I18nextProvider>,
  );
  return queryClient;
};

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(async () => {
  jest.resetAllMocks();
  resetSessionForTests();
  await startSession(TOKEN_PAIR(1));
});

describe('HomeScreen', () => {
  it('greets the person and names the workspace, and tags error reports with the opaque user id only', async () => {
    fetchSession.mockResolvedValue(session);
    renderScreen();
    expect(await screen.findByText('Hello, Pat Person')).toBeTruthy();
    expect(screen.getByText('Workspace: Acme Ltd')).toBeTruthy();
    expect(identifyUser).toHaveBeenCalledWith(session.user.id);
  });

  it('prefers the display name', async () => {
    fetchSession.mockResolvedValue({ ...session, user: { ...session.user, displayName: 'Pat' } });
    renderScreen();
    expect(await screen.findByText('Hello, Pat')).toBeTruthy();
  });

  it('shows the error and retries on request', async () => {
    fetchSession
      .mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'x'))
      .mockResolvedValueOnce(session);
    renderScreen();
    expect(await screen.findByText(/Can't reach the server/)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Hello, Pat Person')).toBeTruthy();
  });

  it('signs out and empties the cache', async () => {
    fetchSession.mockResolvedValue(session);
    mockFetch(jsonResponse(200, { ok: true }));
    const queryClient = renderScreen();
    await screen.findByText('Hello, Pat Person');
    fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(getSnapshot().status).toBe('signedOut'));
    expect(queryClient.getQueryData(['session'])).toBeUndefined();
  });
});
