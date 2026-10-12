import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { signOut } from '@/lib/auth/sign-out';
import { initI18n } from '@/lib/i18n';
import { fetchSession } from '@/lib/session/api';
import { session } from '@/test/dashboard-fixtures';
import { renderApp } from '@/test/render';
import { MenuScreen } from './menu-screen';

const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ navigate: mockNavigate }) }));
jest.mock('@/lib/session/api');
jest.mock('@/lib/auth/sign-out', () => ({ signOut: jest.fn() }));

const sessionCall = jest.mocked(fetchSession);
const frame = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 24, left: 0, right: 0, bottom: 0 },
};

async function show(permissions: Record<string, 'all' | 'team' | 'own'> = session.permissions) {
  sessionCall.mockResolvedValue({ ...session, permissions });
  const view = await renderApp(
    <SafeAreaProvider initialMetrics={frame}>
      <MenuScreen />
    </SafeAreaProvider>,
  );
  await screen.findByText('Asha Verma');
  await waitFor(() => expect(view.queryClient.isFetching()).toBe(0));
  return view;
}

beforeAll(async () => {
  await initI18n('en');
});
beforeEach(() => {
  jest.resetAllMocks();
});

describe('MenuScreen', () => {
  it('shows who is signed in, the workspace and the version', async () => {
    await show();
    expect(screen.getByText('asha@example.test')).toBeTruthy();
    expect(screen.getByText(/Acme Ltd · Owner/)).toBeTruthy();
    expect(screen.getByText(/Version 1\.2\.3/)).toBeTruthy();
  });

  it('opens a module the person can read', async () => {
    await show({ ...session.permissions, 'inbox.conversation.read': 'all' });
    await fireEvent.press(screen.getByRole('button', { name: 'Inbox' }));
    expect(mockNavigate).toHaveBeenCalledWith('/inbox');
  });

  it('opens the task list and the new-task form for a person who may', async () => {
    await show({
      ...session.permissions,
      'record.tasks.read': 'all',
      'record.tasks.create': 'all',
    });
    await fireEvent.press(screen.getByRole('button', { name: 'My tasks' }));
    expect(mockNavigate).toHaveBeenCalledWith('/tasks');
    await fireEvent.press(screen.getByRole('button', { name: 'Add task' }));
    expect(mockNavigate).toHaveBeenCalledWith('/task-form');
  });

  it('opens the summary at the root', async () => {
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Summary' }));
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('explains instead of opening a module the person cannot read', async () => {
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Contacts' }));
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(await screen.findByText(/You don't have access to this/)).toBeTruthy();
  });

  it('asks before signing out, and does not sign out on No', async () => {
    await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('Are you sure you want to sign out?')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'No' }));
    expect(signOut).not.toHaveBeenCalled();
  });

  it('signs out on Yes', async () => {
    const view = await show();
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    await act(async () => {
      await fireEvent.press(await screen.findByRole('button', { name: 'Yes, sign out' }));
    });
    expect(signOut).toHaveBeenCalledWith(view.queryClient);
  });
});
