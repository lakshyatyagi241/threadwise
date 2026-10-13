import type { SessionResponse } from '@crm/contracts';
import type { QueryClient } from '@tanstack/react-query';
import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ApiError } from '@/lib/api';
import { initI18n } from '@/lib/i18n';
import { fetchSession } from '@/lib/session/api';
import { sessionKey } from '@/lib/session/use-session';
import { session } from '@/test/dashboard-fixtures';
import { renderApp } from '@/test/render';
import { AppearanceScreen } from './appearance-screen';
import { updateProfile } from './profile-api';

let mockScheme: 'light' | 'dark' = 'light';
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, replace: jest.fn(), canGoBack: () => true }),
}));
jest.mock('@/lib/theme/use-theme', () => {
  const { palette, spacing, radius } = jest.requireActual('@/lib/theme/tokens');
  return { useTheme: () => ({ scheme: mockScheme, colors: palette[mockScheme], spacing, radius }) };
});
jest.mock('@/lib/session/api');
jest.mock('./profile-api');

const sessionCall = jest.mocked(fetchSession);
const updateCall = jest.mocked(updateProfile);
const frame = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 24, left: 0, right: 0, bottom: 0 },
};

const themeInCache = (client: QueryClient) =>
  client.getQueryData<SessionResponse>(sessionKey)?.user.theme;

let client: QueryClient | undefined;
async function show(theme: SessionResponse['user']['theme'] = 'paper') {
  // The screen asks for the session itself, so the server (the mock) must hold the same account the test starts from.
  const account = { ...session, user: { ...session.user, theme } };
  sessionCall.mockResolvedValue(account);
  const view = await renderApp(
    <SafeAreaProvider initialMetrics={frame}>
      <AppearanceScreen />
    </SafeAreaProvider>,
  );
  client = view.queryClient;
  // The Menu has loaded the session before anyone gets here.
  client.setQueryData(sessionKey, account);
  return view;
}

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(() => {
  jest.resetAllMocks();
  mockScheme = 'light';
  client = undefined;
  sessionCall.mockResolvedValue(session);
});
afterEach(async () => {
  if (client) {
    const cache = client;
    await waitFor(() => expect(cache.isFetching()).toBe(0));
  }
});

const checked = (name: string) =>
  screen.getByRole('radio', { name }).props.accessibilityState.checked;

describe('AppearanceScreen', () => {
  it('offers Light mode, Dark mode and Use device settings, which is ticked for an account that never chose', async () => {
    await show();
    expect(checked('Light mode')).toBe(false);
    expect(checked('Dark mode')).toBe(false);
    expect(checked('Use device settings')).toBe(true);
    expect(screen.getByText('Saved to your account.')).toBeTruthy();
  });

  it('ticks Dark when the account is on dark', async () => {
    await show('dark');
    expect(checked('Dark mode')).toBe(true);
    expect(checked('Light mode')).toBe(false);
    expect(checked('Use device settings')).toBe(false);
  });

  it('ticks Light when the account is on bright', async () => {
    await show('bright');
    expect(checked('Light mode')).toBe(true);
    expect(checked('Use device settings')).toBe(false);
  });

  it('saves the choice to the account and switches the app at once, before the server answers', async () => {
    let answer: (profile: never) => void = () => undefined;
    updateCall.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const view = await show();
    await fireEvent.press(screen.getByRole('radio', { name: 'Dark mode' }));
    await waitFor(() =>
      expect(updateCall).toHaveBeenCalledWith({ theme: 'dark' }, expect.any(String)),
    );
    expect(themeInCache(view.queryClient)).toBe('dark');
    expect(checked('Dark mode')).toBe(true);
    await act(async () => answer({} as never));
  });

  it('saves Light as the bright theme', async () => {
    updateCall.mockResolvedValue({} as never);
    await show('dark');
    await fireEvent.press(screen.getByRole('radio', { name: 'Light mode' }));
    await waitFor(() =>
      expect(updateCall).toHaveBeenCalledWith({ theme: 'bright' }, expect.any(String)),
    );
  });

  it('saves Use device settings as the paper theme, which gives the choice back to the phone', async () => {
    let answer: (profile: never) => void = () => undefined;
    updateCall.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const view = await show('dark');
    await fireEvent.press(screen.getByRole('radio', { name: 'Use device settings' }));
    await waitFor(() =>
      expect(updateCall).toHaveBeenCalledWith({ theme: 'paper' }, expect.any(String)),
    );
    expect(themeInCache(view.queryClient)).toBe('paper');
    expect(checked('Use device settings')).toBe(true);
    await act(async () => answer({} as never));
  });

  it('does nothing when the choice already saved is pressed', async () => {
    await show();
    await fireEvent.press(screen.getByRole('radio', { name: 'Use device settings' }));
    expect(updateCall).not.toHaveBeenCalled();
  });

  it('does nothing when Light is pressed on an account already on bright', async () => {
    await show('bright');
    await fireEvent.press(screen.getByRole('radio', { name: 'Light mode' }));
    expect(updateCall).not.toHaveBeenCalled();
  });

  it('puts the old theme back and says so when the server refuses', async () => {
    updateCall.mockRejectedValue(new ApiError(0, 'CLIENT_NETWORK', 'offline'));
    const view = await show();
    await fireEvent.press(screen.getByRole('radio', { name: 'Dark mode' }));
    expect(await screen.findByText("Couldn't save your choice. Try again.")).toBeTruthy();
    await waitFor(() => expect(themeInCache(view.queryClient)).toBe('paper'));
    expect(checked('Use device settings')).toBe(true);
  });
});
