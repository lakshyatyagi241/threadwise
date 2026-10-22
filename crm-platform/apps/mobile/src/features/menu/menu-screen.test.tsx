import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as Linking from 'expo-linking';
import * as Updates from 'expo-updates';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { signOut } from '@/lib/auth/sign-out';
import { openPermissionSettings } from '@/lib/device/open-settings';
import { initI18n } from '@/lib/i18n';
import { fetchSession } from '@/lib/session/api';
import { session } from '@/test/dashboard-fixtures';
import { renderApp } from '@/test/render';
import { fetchLegalLinks } from './links-api';
import { MenuScreen } from './menu-screen';

const mockNavigate = jest.fn();
let mockUpdatesEnabled = false;
jest.mock('expo-router', () => ({ useRouter: () => ({ navigate: mockNavigate }) }));
jest.mock('expo-linking', () => ({ openURL: jest.fn(), openSettings: jest.fn() }));
jest.mock('@/lib/device/open-settings');
jest.mock('expo-updates', () => ({
  get isEnabled() {
    return mockUpdatesEnabled;
  },
  checkForUpdateAsync: jest.fn(),
  fetchUpdateAsync: jest.fn(),
  reloadAsync: jest.fn(),
}));
jest.mock('@/lib/session/api');
jest.mock('@/config/env', () => ({
  env: { ...jest.requireActual('@/config/env').env, webUrl: 'https://app.example.test' },
}));
jest.mock('./links-api');
jest.mock('@/lib/auth/sign-out', () => ({ signOut: jest.fn() }));

const sessionCall = jest.mocked(fetchSession);
const linksCall = jest.mocked(fetchLegalLinks);
const frame = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 24, left: 0, right: 0, bottom: 0 },
};
const links = (privacy: string) =>
  ({ links: { terms: '/legal/terms', privacy, cookies: null } }) as Awaited<
    ReturnType<typeof fetchLegalLinks>
  >;

async function show(
  permissions: Record<string, 'all' | 'team' | 'team_and_below' | 'own'> = session.permissions,
  theme: (typeof session)['user']['theme'] = 'paper',
) {
  sessionCall.mockResolvedValue({ ...session, permissions, user: { ...session.user, theme } });
  const view = await renderApp(
    <SafeAreaProvider initialMetrics={frame}>
      <MenuScreen />
    </SafeAreaProvider>,
  );
  await screen.findByText('Asha Verma');
  await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));
  return view;
}
const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(() => {
  jest.resetAllMocks();
  mockUpdatesEnabled = false;
  // A site path with no web address configured cannot be opened, so by default the row is not there.
  linksCall.mockResolvedValue(links('/legal/privacy'));
});

describe('MenuScreen', () => {
  it('shows who is signed in, the workspace and the version', async () => {
    await show();
    expect(screen.getByText('asha@example.test')).toBeTruthy();
    expect(screen.getByText(/Acme Ltd · Owner/)).toBeTruthy();
    expect(screen.getByText(/Version 1\.2\.3/)).toBeTruthy();
  });

  it('groups the rows into Workspace, Account, Preferences and About', async () => {
    await show();
    for (const title of ['Workspace', 'Account', 'Preferences', 'About']) {
      expect(screen.getAllByRole('header', { name: title }).length).toBeGreaterThan(0);
    }
    for (const row of [
      'Dashboard',
      'Inbox',
      'Contacts',
      'Notifications',
      'Tasks',
      'Deals',
      'Manage profile',
      'Appearance',
      'Device permissions',
      'Help Center',
      'Data & Security',
      'Check for updates',
      'Sign out',
    ]) {
      expect(screen.getByRole('button', { name: row })).toBeTruthy();
    }
  });

  describe('Workspace', () => {
    it('opens the inbox and the tasks for a person who may read them', async () => {
      await show({
        ...session.permissions,
        'inbox.conversation.read': 'all',
        'record.tasks.read': 'all',
      });
      await press('Inbox');
      expect(mockNavigate).toHaveBeenCalledWith('/inbox');
      await press('Tasks');
      expect(mockNavigate).toHaveBeenCalledWith('/tasks');
    });

    it('opens the notifications for everyone: a person always has their own feed', async () => {
      await show({ ...session.permissions });
      await press('Notifications');
      expect(mockNavigate).toHaveBeenCalledWith('/notifications');
    });

    it('does not list Social leads, even for a person who may read the lead sources', async () => {
      await show({ ...session.permissions, 'leads.sources.read': 'all' });
      expect(screen.queryByRole('button', { name: 'Social leads' })).toBeNull();
    });

    it('opens the deals for a person who may read them, and explains when they may not', async () => {
      await show({ ...session.permissions, 'record.deals.read': 'all' });
      await press('Deals');
      expect(mockNavigate).toHaveBeenCalledWith('/deals');
    });

    it('fades the Deals row for a person who may not read deals, and does not open them', async () => {
      await show();
      const row = screen.getByRole('button', { name: 'Deals' });
      await fireEvent.press(row);
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(await screen.findByText(/You don't have access to this/)).toBeTruthy();
    });

    it('opens a list under Dashboard and sends the dashboard to the view that was chosen', async () => {
      await show({ ...session.permissions, 'dash.analytics.read': 'all' });
      expect(screen.queryByRole('button', { name: 'Agent' })).toBeNull();
      await press('Dashboard');
      expect(
        screen.getByRole('button', { name: 'Dashboard' }).props.accessibilityState.expanded,
      ).toBe(true);
      for (const view of ['Summary', 'Agent', 'Bot']) {
        expect(screen.getByRole('button', { name: view })).toBeTruthy();
      }
      await press('Agent');
      expect(mockNavigate).toHaveBeenCalledWith({
        pathname: '/',
        params: { view: 'agent', at: expect.any(String) },
      });
      await press('Dashboard');
      expect(screen.queryByRole('button', { name: 'Agent' })).toBeNull();
    });

    it('fades the Agent line for a person without analytics, and explains when it is pressed', async () => {
      await show();
      await press('Dashboard');
      const agent = screen.getByRole('button', { name: 'Agent' });
      expect(agent.props.accessibilityState.disabled).toBe(true);
      await fireEvent.press(agent);
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(await screen.findByText(/You don't have access to this/)).toBeTruthy();
    });

    it('opens a list under Contacts with all contacts and a new one', async () => {
      await show({
        ...session.permissions,
        'record.contacts.read': 'all',
        'record.contacts.create': 'all',
      });
      await press('Contacts');
      await press('All contacts');
      expect(mockNavigate).toHaveBeenCalledWith('/contacts');
      await press('New contact');
      expect(mockNavigate).toHaveBeenCalledWith('/contact/new');
    });

    it('opens the Settings page, not a list under the row', async () => {
      await show({ ...session.permissions, 'inbox.savedreply.manage': 'all' });
      await press('Settings');
      expect(mockNavigate).toHaveBeenCalledWith('/settings');
      expect(screen.queryByRole('button', { name: 'Saved replies' })).toBeNull();
    });

    it('explains instead of opening a module the person cannot read', async () => {
      await show();
      await press('Contacts');
      expect(mockNavigate).not.toHaveBeenCalled();
      expect(screen.queryByRole('button', { name: 'All contacts' })).toBeNull();
      expect(await screen.findByText(/You don't have access to this/)).toBeTruthy();
    });
  });

  describe('Account and Preferences', () => {
    it('opens the notification preferences', async () => {
      await show();
      await press('Notification preferences');
      expect(mockNavigate).toHaveBeenCalledWith('/notification-preferences');
    });

    it('opens the profile', async () => {
      await show();
      await press('Manage profile');
      expect(mockNavigate).toHaveBeenCalledWith('/profile');
    });

    it('opens Appearance, and says what is chosen: the phone, for an account that never chose', async () => {
      await show();
      expect(screen.getByText('Use device settings')).toBeTruthy();
      await press('Appearance');
      expect(mockNavigate).toHaveBeenCalledWith('/appearance');
    });

    it.each([
      ['bright', 'Light mode'],
      ['dark', 'Dark mode'],
    ] as const)('says "%s" accounts are in %s', async (theme, label) => {
      await show(session.permissions, theme);
      expect(screen.getByText(label)).toBeTruthy();
    });

    it("opens this app's permissions page on the phone for the device permissions", async () => {
      await show();
      await press('Device permissions');
      expect(openPermissionSettings).toHaveBeenCalledTimes(1);
    });
  });

  describe('About', () => {
    it('opens the Data & Security page from its row', async () => {
      await show();
      await press('Data & Security');
      expect(mockNavigate).toHaveBeenCalledWith('/data-security');
    });

    it('opens the web Help Center in the browser, from the address of the web app', async () => {
      await show();
      await press('Help Center');
      expect(Linking.openURL).toHaveBeenCalledWith('https://app.example.test/help');
    });

    it('says a build without updates does not receive them, without pretending to look', async () => {
      await show();
      await press('Check for updates');
      expect(await screen.findByText(/doesn't receive updates on its own/)).toBeTruthy();
      expect(Updates.checkForUpdateAsync).not.toHaveBeenCalled();
    });

    it('says when the app is up to date', async () => {
      mockUpdatesEnabled = true;
      jest.mocked(Updates.checkForUpdateAsync).mockResolvedValue({ isAvailable: false } as never);
      await show();
      await press('Check for updates');
      expect(await screen.findByText('You have the latest version.')).toBeTruthy();
      expect(Updates.fetchUpdateAsync).not.toHaveBeenCalled();
    });

    it('downloads an update, and restarts only when the person taps again', async () => {
      mockUpdatesEnabled = true;
      jest.mocked(Updates.checkForUpdateAsync).mockResolvedValue({ isAvailable: true } as never);
      jest.mocked(Updates.fetchUpdateAsync).mockResolvedValue({ isNew: true } as never);
      await show();
      await press('Check for updates');
      expect(await screen.findByText(/An update is ready/)).toBeTruthy();
      expect(Updates.reloadAsync).not.toHaveBeenCalled();
      await press('Check for updates');
      expect(Updates.reloadAsync).toHaveBeenCalledTimes(1);
    });

    it('says when the check failed', async () => {
      mockUpdatesEnabled = true;
      jest.mocked(Updates.checkForUpdateAsync).mockRejectedValue(new Error('offline'));
      await show();
      await press('Check for updates');
      expect(await screen.findByText(/Couldn't check for updates/)).toBeTruthy();
    });
  });

  it('asks before signing out, and does not sign out on No', async () => {
    await show();
    await press('Sign out');
    expect(await screen.findByText('Are you sure you want to sign out?')).toBeTruthy();
    await press('No');
    expect(signOut).not.toHaveBeenCalled();
  });

  it('signs out on Yes', async () => {
    const view = await show();
    await press('Sign out');
    await act(async () => {
      await fireEvent.press(await screen.findByRole('button', { name: 'Yes, sign out' }));
    });
    expect(signOut).toHaveBeenCalledWith(view.queryClient);
  });
});
