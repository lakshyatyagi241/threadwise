import { act, fireEvent, screen } from '@testing-library/react-native';
import { AppState, Linking, type AppStateStatus } from 'react-native';
import {
  getPermission,
  offeredPermissions,
  preparePermissions,
  requestPermission,
  type DevicePermission,
  type PermissionInfo,
} from '@/lib/device/permissions';
import { renderApp } from '@/test/render';
import { PermissionsScreen } from './permissions-screen';

jest.mock('@/lib/device/permissions');

const offered = jest.mocked(offeredPermissions);
const readCall = jest.mocked(getPermission);
const askCall = jest.mocked(requestPermission);
const prepareCall = jest.mocked(preparePermissions);
const onDone = jest.fn();

const ASK: PermissionInfo = { state: 'denied', canAskAgain: true };
const GRANTED: PermissionInfo = { state: 'granted', canAskAgain: true };
const BLOCKED: PermissionInfo = { state: 'denied', canAskAgain: false };

/** What the phone says about each permission when the screen opens. */
const standing = (map: Partial<Record<DevicePermission, PermissionInfo>>) =>
  readCall.mockImplementation(async (kind) => map[kind] ?? ASK);

beforeEach(() => {
  jest.clearAllMocks();
  offered.mockReturnValue(['notifications', 'calls', 'camera']);
  standing({});
  askCall.mockImplementation(async () => GRANTED);
  prepareCall.mockResolvedValue();
});

describe('PermissionsScreen', () => {
  it('explains each permission in words before the phone asks', async () => {
    await renderApp(<PermissionsScreen onDone={onDone} />);
    expect(screen.getByRole('header', { name: 'Get the most out of GetaDesk' })).toBeTruthy();
    expect(await screen.findByText('Notifications')).toBeTruthy();
    expect(screen.getByText('Calls')).toBeTruthy();
    expect(screen.getByText('Camera')).toBeTruthy();
    expect(screen.getByText(/Call contacts straight from the app/)).toBeTruthy();
    // Nothing is asked until the person presses a button.
    expect(askCall).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('shows no calls row on a phone that has none (iOS)', async () => {
    offered.mockReturnValue(['notifications', 'camera']);
    await renderApp(<PermissionsScreen onDone={onDone} />);
    await screen.findByText('Camera');
    expect(screen.queryByText('Calls')).toBeNull();
  });

  it('opens the phone settings from a permission that is off, and asks the phone nothing', async () => {
    standing({ camera: BLOCKED });
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    await renderApp(<PermissionsScreen onDone={onDone} />);
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Open settings to allow Camera' }),
    );
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(askCall).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('opens the phone settings from the main button while something is off', async () => {
    standing({ notifications: GRANTED });
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    await renderApp(<PermissionsScreen onDone={onDone} />);
    await screen.findByLabelText('Notifications allowed');
    await fireEvent.press(screen.getByRole('button', { name: 'Open settings' }));
    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(askCall).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('gets the notification channel ready before reading, without asking', async () => {
    await renderApp(<PermissionsScreen onDone={onDone} />);
    await screen.findByText('Camera');
    expect(prepareCall).toHaveBeenCalledWith({ channelName: 'Messages and updates' });
  });

  it('shows a permission as allowed when the person comes back from the settings', async () => {
    let listener: (state: AppStateStatus) => void = () => undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, handler) => {
      listener = handler;
      return { remove: jest.fn() };
    });
    await renderApp(<PermissionsScreen onDone={onDone} />);
    await screen.findByRole('button', { name: 'Open settings to allow Camera' });
    standing({ camera: GRANTED });
    await act(async () => listener('active'));
    expect(await screen.findByLabelText('Camera allowed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open settings to allow Camera' })).toBeNull();
  });

  it('still reads the permissions when the phone fails to get ready', async () => {
    prepareCall.mockRejectedValue(new Error('no channel'));
    await renderApp(<PermissionsScreen onDone={onDone} />);
    expect(
      await screen.findByRole('button', { name: 'Open settings to allow Camera' }),
    ).toBeTruthy();
  });

  it('goes on without opening anything on Not now', async () => {
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    await renderApp(<PermissionsScreen onDone={onDone} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Not now' }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(openSettings).not.toHaveBeenCalled();
    expect(askCall).not.toHaveBeenCalled();
  });

  it('shows only Continue when everything is allowed', async () => {
    standing({ notifications: GRANTED, calls: GRANTED, camera: GRANTED });
    await renderApp(<PermissionsScreen onDone={onDone} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Continue' }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Allow all' })).toBeNull();
    expect(askCall).not.toHaveBeenCalled();
  });
});
