import { fireEvent, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';
import {
  getPermission,
  offeredPermissions,
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

  it('asks for one permission from its own Allow, and shows it as allowed', async () => {
    await renderApp(<PermissionsScreen onDone={onDone} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Allow Camera' }));
    expect(askCall).toHaveBeenCalledTimes(1);
    expect(askCall).toHaveBeenCalledWith('camera', { channelName: 'Messages and updates' });
    expect(await screen.findByLabelText('Camera allowed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Allow Camera' })).toBeNull();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('asks for the rest, one after another, on Allow all, and then goes on', async () => {
    standing({ notifications: GRANTED });
    await renderApp(<PermissionsScreen onDone={onDone} />);
    await screen.findByLabelText('Notifications allowed');
    await fireEvent.press(screen.getByRole('button', { name: 'Allow all' }));
    await screen.findByLabelText('Camera allowed');
    expect(askCall.mock.calls.map(([kind]) => kind)).toEqual(['calls', 'camera']);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('goes on after the person refuses in the phone prompt', async () => {
    askCall.mockResolvedValue(BLOCKED);
    await renderApp(<PermissionsScreen onDone={onDone} />);
    await screen.findByText('Camera');
    await fireEvent.press(await screen.findByRole('button', { name: 'Allow all' }));
    await screen.findByRole('button', { name: 'Open settings to allow Camera' });
    expect(askCall).toHaveBeenCalledTimes(3);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('goes on even when the phone fails to answer', async () => {
    askCall.mockRejectedValue(new Error('no channel'));
    await renderApp(<PermissionsScreen onDone={onDone} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Allow all' }));
    await screen.findByRole('button', { name: 'Not now' });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('asks the phone nothing on Not now', async () => {
    await renderApp(<PermissionsScreen onDone={onDone} />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Not now' }));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(askCall).not.toHaveBeenCalled();
  });

  it('offers the phone settings for a permission that was refused for good', async () => {
    standing({ camera: BLOCKED });
    const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    await renderApp(<PermissionsScreen onDone={onDone} />);
    await fireEvent.press(
      await screen.findByRole('button', { name: 'Open settings to allow Camera' }),
    );
    expect(openSettings).toHaveBeenCalledTimes(1);
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
