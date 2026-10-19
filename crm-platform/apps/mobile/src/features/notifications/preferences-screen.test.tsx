import { act, fireEvent, screen, waitFor } from '@testing-library/react-native';
import { useRouter } from 'expo-router';
import { ApiError } from '@/lib/api';
import { fetchSession } from '@/lib/session/api';
import { session } from '@/test/dashboard-fixtures';
import { bellOff, popupOff, prefItem, prefsOf, workspaceOff } from '@/test/preferences-fixtures';
import { renderApp } from '@/test/render';
import * as api from './preferences-api';
import { PreferencesScreen } from './preferences-screen';

jest.mock('./preferences-api');
jest.mock('@/lib/session/api');
jest.mock('expo-router', () => ({ useRouter: jest.fn() }));

const readCall = jest.mocked(api.fetchPreferences);
const saveCall = jest.mocked(api.savePreferences);
const pushCall = jest.mocked(api.fetchPushDeployment);
const router = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: jest.fn() };

const press = async (name: string | RegExp) =>
  await fireEvent.press(await screen.findByRole('button', { name }));
const toggle = (event: string, channel: string) =>
  screen.getByRole('switch', { name: `${event}: ${channel}` });

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(useRouter).mockReturnValue(router as unknown as ReturnType<typeof useRouter>);
  router.canGoBack.mockReturnValue(true);
  jest.mocked(fetchSession).mockResolvedValue(session);
  pushCall.mockResolvedValue({ enabled: false, publicKey: null });
  readCall.mockResolvedValue(
    prefsOf(prefItem('new_message'), prefItem('task_completed'), prefItem('new_lead')),
  );
  saveCall.mockResolvedValue(prefsOf());
});

describe('PreferencesScreen', () => {
  it('lists the kinds of notification by section with a switch for each way they can arrive', async () => {
    await renderApp(<PreferencesScreen />);
    expect(await screen.findByText('Chats')).toBeTruthy();
    expect(screen.getByText('Tasks')).toBeTruthy();
    expect(screen.getByText('Leads and forms')).toBeTruthy();
    expect(screen.getByText('A customer writes on a chat assigned to you.')).toBeTruthy();
    expect(toggle('New message on my chat', 'bell').props.accessibilityState.checked).toBe(true);
    expect(toggle('New message on my chat', 'pop-up').props.accessibilityState.checked).toBe(true);
    expect(screen.getAllByText('Default: bell on, pop-up on, sound on').length).toBeGreaterThan(0);
  });

  it('shows the Push switch only where the deployment sends browser notifications', async () => {
    await renderApp(<PreferencesScreen />);
    await screen.findByText('Chats');
    expect(screen.queryByRole('switch', { name: 'New message on my chat: push' })).toBeNull();
    jest.resetAllMocks();
  });

  it('shows the Push switch when the deployment has push', async () => {
    pushCall.mockResolvedValue({ enabled: true, publicKey: 'abc' });
    await renderApp(<PreferencesScreen />);
    expect(
      await screen.findByRole('switch', { name: 'New message on my chat: push' }),
    ).toBeTruthy();
    expect(
      screen.getAllByText(/Default: bell on, pop-up on, sound on, push on/).length,
    ).toBeGreaterThan(0);
  });

  it('says a kind of notification has no pop-up at all', async () => {
    await renderApp(<PreferencesScreen />);
    await screen.findByText('Tasks');
    expect(screen.getByLabelText('Task completed: pop-up: Not available')).toBeTruthy();
  });

  it('changes the switch at once, then saves only that choice', async () => {
    let finish: (v: unknown) => void = () => undefined;
    saveCall.mockReturnValue(new Promise((resolve) => (finish = resolve)) as never);
    await renderApp(<PreferencesScreen />);
    await screen.findByText('Chats');
    await fireEvent.press(toggle('New message on my chat', 'pop-up'));
    expect(toggle('New message on my chat', 'pop-up').props.accessibilityState.checked).toBe(false);
    expect(screen.getByText('Changed')).toBeTruthy();
    expect(saveCall).toHaveBeenCalledWith({ items: [{ type: 'new_message', toast: false }] });
    await act(async () => finish(prefsOf()));
  });

  it('puts the switch back and says so when saving fails', async () => {
    saveCall.mockRejectedValue(new ApiError(500, 'INTERNAL', 'x'));
    await renderApp(<PreferencesScreen />);
    await screen.findByText('Chats');
    await fireEvent.press(toggle('New message on my chat', 'sound'));
    expect(await screen.findByText('Could not save that change. It was undone.')).toBeTruthy();
    await waitFor(() =>
      expect(toggle('New message on my chat', 'sound').props.accessibilityState.checked).toBe(true),
    );
    await press('Dismiss');
    expect(screen.queryByText('Could not save that change. It was undone.')).toBeNull();
  });

  it('keeps the pop-up, sound and push off limits while the bell is off, and says why', async () => {
    readCall.mockResolvedValue(prefsOf(bellOff));
    await renderApp(<PreferencesScreen />);
    await screen.findByText('Tasks');
    expect(toggle('Task due', 'pop-up').props.accessibilityState.disabled).toBe(true);
    expect(screen.getByText('Turn the bell on to choose a pop-up, sound or push.')).toBeTruthy();
    expect(toggle('Task due', 'bell').props.accessibilityState.checked).toBe(false);
  });

  it("says the workspace has an event off, while the person's own switches still work", async () => {
    readCall.mockResolvedValue(prefsOf(workspaceOff));
    await renderApp(<PreferencesScreen />);
    expect(await screen.findByText('Turned off by your workspace')).toBeTruthy();
    expect(
      screen.getByText('Your workspace has this off; your choice still applies to you.'),
    ).toBeTruthy();
    expect(toggle('New chat', 'bell').props.accessibilityState.disabled).toBe(false);
  });

  it('resets one kind to the defaults', async () => {
    // After the save the screen reads again: the server now answers with the defaults.
    readCall
      .mockResolvedValueOnce(prefsOf(popupOff))
      .mockResolvedValue(prefsOf(prefItem('new_message')));
    await renderApp(<PreferencesScreen />);
    await press('Reset New message on my chat to default');
    expect(saveCall).toHaveBeenCalledWith({
      items: [{ type: 'new_message', bell: null, toast: null, sound: null, push: null }],
    });
    expect(toggle('New message on my chat', 'pop-up').props.accessibilityState.checked).toBe(true);
    expect(screen.queryByText('Changed')).toBeNull();
  });

  it('resets everything the person changed, and is disabled when nothing was', async () => {
    readCall
      .mockResolvedValueOnce(prefsOf(popupOff, bellOff, prefItem('new_chat')))
      .mockResolvedValue(
        prefsOf(prefItem('new_message'), prefItem('task_due'), prefItem('new_chat')),
      );
    await renderApp(<PreferencesScreen />);
    await press('Reset everything to default');
    expect(saveCall).toHaveBeenCalledWith({
      items: [
        { type: 'new_message', bell: null, toast: null, sound: null, push: null },
        { type: 'task_due', bell: null, toast: null, sound: null, push: null },
      ],
    });
    expect(await screen.findByText('All preferences are back to the defaults.')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId('pref-reset-all').props.accessibilityState.disabled).toBe(true),
    );
  });

  it('shows a failure to load with a way to try again', async () => {
    readCall.mockRejectedValueOnce(new ApiError(0, 'CLIENT_NETWORK', 'x'));
    await renderApp(<PreferencesScreen />);
    expect(await screen.findByText('Could not load your preferences.')).toBeTruthy();
    await press('Try again');
    expect(await screen.findByText('Chats')).toBeTruthy();
  });

  it('says when there is nothing to set up', async () => {
    readCall.mockResolvedValue(prefsOf());
    await renderApp(<PreferencesScreen />);
    expect(await screen.findByText('There are no notification types to set up yet.')).toBeTruthy();
  });

  it('goes back, or to the menu when there is nothing to go back to', async () => {
    router.canGoBack.mockReturnValue(false);
    await renderApp(<PreferencesScreen />);
    await press('Back');
    expect(router.replace).toHaveBeenCalledWith('/menu');
  });
});
