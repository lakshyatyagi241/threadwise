import type { SessionResponse } from '@crm/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { renderRouter, screen, waitFor } from 'expo-router/testing-library';
import { I18nextProvider } from 'react-i18next';
import { Text } from 'react-native';
import * as appLayout from '@/app/(app)/_layout';
import { i18n, initI18n } from '@/lib/i18n';
import { fetchSession } from '@/lib/session/api';
import { clearWorkspaceSuspended, noteGateError } from '@/lib/session/account-gate';
import { ApiError } from '@/lib/api/errors';
import { session } from '@/test/dashboard-fixtures';
import { fetchPasswordPolicy } from '@/features/auth/api';

jest.mock('@/lib/session/api');
jest.mock('@/features/auth/api');
jest.mock('@/features/menu/theme-sync', () => ({ ThemeSync: () => null }));
jest.mock('@/features/contacts/use-call-return', () => ({ useCallReturn: () => undefined }));
// A live connection is not what this is about, and a gated account must not open one.
const mockRealtime = jest.fn();
jest.mock('@/lib/realtime', () => ({
  RealtimeProvider: ({ children }: { children: React.ReactNode }) => {
    mockRealtime();
    return children;
  },
}));

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
function Root() {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <Stack screenOptions={{ headerShown: false }} />
      </QueryClientProvider>
    </I18nextProvider>
  );
}
const structure = {
  _layout: Root,
  '(app)/_layout': appLayout,
  '(app)/(tabs)/index': () => <Text>THE APP</Text>,
};

const flagged = (over: Partial<SessionResponse['flags']>): SessionResponse => ({
  ...session,
  flags: { ...session.flags, ...over },
});

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(() => {
  client.clear();
  clearWorkspaceSuspended();
  mockRealtime.mockClear();
  jest.mocked(fetchPasswordPolicy).mockResolvedValue({
    minLength: 8,
    requireMixedCase: false,
    requireNumber: false,
    requireSymbol: false,
  });
});

describe('the signed-in layout and the account gates', () => {
  it('opens the app, and the live connection, for an account with nothing in its way', async () => {
    jest.mocked(fetchSession).mockResolvedValue(session);
    await renderRouter(structure, { initialUrl: '/' });
    expect(await screen.findByText('THE APP')).toBeTruthy();
    expect(mockRealtime).toHaveBeenCalled();
  });

  it('shows the lock screen instead of the app, and opens no live connection, for a suspended account', async () => {
    jest.mocked(fetchSession).mockResolvedValue(flagged({ suspended: true }));
    await renderRouter(structure, { initialUrl: '/' });
    expect(await screen.findByText('Your account is suspended')).toBeTruthy();
    expect(screen.queryByText('THE APP')).toBeNull();
    expect(mockRealtime).not.toHaveBeenCalled();
  });

  it.each([
    [{ passwordChangeRequired: true }, 'Change password'],
    [{ mfaEnrolmentRequired: true }, 'Two-factor authentication'],
    [{ emailBlocked: true, emailUnverified: true }, 'Please verify your email'],
  ] as const)('shows the right lock screen for %j', async (flags, title) => {
    jest.mocked(fetchSession).mockResolvedValue(flagged(flags));
    await renderRouter(structure, { initialUrl: '/' });
    expect((await screen.findAllByText(title)).length).toBeGreaterThan(0);
    expect(screen.queryByText('THE APP')).toBeNull();
  });

  it('takes the lock screen away when the session says the gate is open', async () => {
    jest.mocked(fetchSession).mockResolvedValueOnce(flagged({ passwordChangeRequired: true }));
    await renderRouter(structure, { initialUrl: '/' });
    expect((await screen.findAllByText('Change password')).length).toBeGreaterThan(0);
    jest.mocked(fetchSession).mockResolvedValue(session);
    await client.invalidateQueries({ queryKey: ['session'] });
    expect(await screen.findByText('THE APP')).toBeTruthy();
  });

  it('puts a gate up when a call is refused because one closed while the app was open', async () => {
    jest.mocked(fetchSession).mockResolvedValueOnce(session);
    await renderRouter(structure, { initialUrl: '/' });
    expect(await screen.findByText('THE APP')).toBeTruthy();
    jest.mocked(fetchSession).mockResolvedValue(flagged({ passwordChangeRequired: true }));
    noteGateError(new ApiError(403, 'AUTH_PASSWORD_CHANGE_REQUIRED', 'x'), client);
    await waitFor(() => expect(screen.queryByText('THE APP')).toBeNull());
    expect((await screen.findAllByText('Change password')).length).toBeGreaterThan(0);
  });

  it('holds a suspended workspace at the lock screen until it is checked again', async () => {
    jest.mocked(fetchSession).mockResolvedValue(session);
    await renderRouter(structure, { initialUrl: '/' });
    expect(await screen.findByText('THE APP')).toBeTruthy();
    noteGateError(new ApiError(403, 'WSP_ORG_SUSPENDED', 'x'), client);
    expect(await screen.findByText('Your account is suspended')).toBeTruthy();
  });
});
