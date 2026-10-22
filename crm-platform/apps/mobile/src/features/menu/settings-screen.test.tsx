import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { initI18n } from '@/lib/i18n';
import { fetchSession } from '@/lib/session/api';
import { session } from '@/test/dashboard-fixtures';
import { renderApp } from '@/test/render';
import { SettingsScreen } from './settings-screen';

const mockNavigate = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ navigate: mockNavigate, back: mockBack, canGoBack: () => true }),
}));
jest.mock('@/lib/session/api');

const sessionCall = jest.mocked(fetchSession);
const frame = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 24, left: 0, right: 0, bottom: 0 },
};

async function show(permissions: (typeof session)['permissions'] = session.permissions) {
  sessionCall.mockResolvedValue({ ...session, permissions });
  const view = await renderApp(
    <SafeAreaProvider initialMetrics={frame}>
      <SettingsScreen />
    </SafeAreaProvider>,
  );
  await screen.findByRole('header', { name: 'Settings' });
  await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));
  return view;
}
const press = (name: string) => fireEvent.press(screen.getByRole('button', { name }));

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(() => jest.resetAllMocks());

describe('SettingsScreen', () => {
  it('lists the setup screens on a page of their own', async () => {
    await show();
    for (const name of [
      'Saved replies',
      'Labels',
      'Business hours',
      'Auto-assignment',
      'Team members',
      'Teams',
    ]) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });

  it('opens a line the person may use', async () => {
    await show({ ...session.permissions, 'inbox.savedreply.manage': 'all' });
    await press('Saved replies');
    expect(mockNavigate).toHaveBeenCalledWith('/quick-replies');
  });

  it('opens Business hours and Auto-assignment for a person who may read the inbox settings', async () => {
    await show({ ...session.permissions, 'inbox.settings.read': 'all' });
    await press('Business hours');
    expect(mockNavigate).toHaveBeenLastCalledWith('/business-hours');
    await press('Auto-assignment');
    expect(mockNavigate).toHaveBeenLastCalledWith('/auto-assignment');
  });

  it('opens Team members, Teams and Labels where the right allows', async () => {
    await show({ ...session.permissions, 'inbox.tag.manage': 'all' });
    await press('Team members');
    expect(mockNavigate).toHaveBeenLastCalledWith('/members');
    await press('Teams');
    expect(mockNavigate).toHaveBeenLastCalledWith('/teams');
    await press('Labels');
    expect(mockNavigate).toHaveBeenLastCalledWith('/labels');
  });

  it('fades a line the person may not open, and explains instead of opening it', async () => {
    await show();
    expect(
      screen.getByRole('button', { name: 'Saved replies' }).props.accessibilityState.disabled,
    ).toBe(true);
    await press('Saved replies');
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(await screen.findByText(/You don't have access to this/)).toBeTruthy();
  });

  it('goes back with the arrow', async () => {
    await show();
    await press('Back');
    expect(mockBack).toHaveBeenCalled();
  });
});
