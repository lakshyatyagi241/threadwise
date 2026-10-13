import { act, waitFor } from '@testing-library/react-native';
import { Appearance } from 'react-native';
import { fetchSession } from '@/lib/session/api';
import { session } from '@/test/dashboard-fixtures';
import { renderApp } from '@/test/render';
import { ThemeSync } from './theme-sync';

jest.mock('@/lib/session/api');

const sessionCall = jest.mocked(fetchSession);
let setScheme: jest.SpyInstance;

const withTheme = (theme: 'paper' | 'bright' | 'dark') =>
  sessionCall.mockResolvedValue({ ...session, user: { ...session.user, theme } });

beforeEach(() => {
  jest.resetAllMocks();
  setScheme = jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => undefined);
});
afterEach(() => setScheme.mockRestore());

describe('ThemeSync', () => {
  it.each([
    ['dark', 'dark'],
    ['bright', 'light'],
    ['paper', 'unspecified'],
  ] as const)('puts the account theme %s on the app as %s', async (theme, scheme) => {
    withTheme(theme);
    await renderApp(<ThemeSync />);
    await waitFor(() => expect(setScheme).toHaveBeenLastCalledWith(scheme));
  });

  it('follows the phone until the session is known', async () => {
    withTheme('dark');
    await renderApp(<ThemeSync />);
    expect(setScheme.mock.calls[0]?.[0]).toBe('unspecified');
    await waitFor(() => expect(setScheme).toHaveBeenLastCalledWith('dark'));
  });

  it('gives the choice back to the phone when the signed-in app goes away', async () => {
    withTheme('dark');
    const view = await renderApp(<ThemeSync />);
    await waitFor(() => expect(setScheme).toHaveBeenLastCalledWith('dark'));
    await act(async () => view.unmount());
    expect(setScheme).toHaveBeenLastCalledWith('unspecified');
  });
});
