import { PermissionsAndroid, Platform } from 'react-native';
import {
  callMonitorAvailable,
  openOverlaySettings,
  overlayAllowed,
  phoneStateAllowed,
} from './call-monitor';
import { openPermissionSettings } from './open-settings';
import { getPermission, openSettingsFor, requestPermission } from './permissions';

jest.mock('./call-monitor');
jest.mock('./open-settings');

const available = jest.mocked(callMonitorAvailable);
const phoneState = jest.mocked(phoneStateAllowed);
const overlay = jest.mocked(overlayAllowed);
const ask = () => jest.spyOn(PermissionsAndroid, 'request');
const labels = { channelName: 'Messages' };

beforeEach(() => {
  jest.clearAllMocks();
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
  available.mockReturnValue(true);
  phoneState.mockResolvedValue(false);
  overlay.mockReturnValue(false);
});
afterEach(() => {
  jest.restoreAllMocks();
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'ios' });
});

describe('the call pop-up permission', () => {
  it('is on only when the phone state and "display over other apps" are both on', async () => {
    await expect(getPermission('callPopup')).resolves.toMatchObject({ state: 'denied' });
    phoneState.mockResolvedValue(true);
    await expect(getPermission('callPopup')).resolves.toMatchObject({ state: 'denied' });
    overlay.mockReturnValue(true);
    await expect(getPermission('callPopup')).resolves.toMatchObject({ state: 'granted' });
  });

  it('has nothing to ask for in a build without the call-monitor module', async () => {
    available.mockReturnValue(false);
    await expect(getPermission('callPopup')).resolves.toMatchObject({ state: 'granted' });
    await expect(requestPermission('callPopup', labels)).resolves.toMatchObject({
      state: 'granted',
    });
  });

  it("shows the phone's prompt for the phone state, and stays off while the overlay is off", async () => {
    const prompt = ask().mockResolvedValue('granted');
    await expect(requestPermission('callPopup', labels)).resolves.toMatchObject({
      state: 'denied',
    });
    expect(prompt).toHaveBeenCalledWith('android.permission.READ_PHONE_STATE');
  });

  it('is granted once both are on, without a second prompt', async () => {
    phoneState.mockResolvedValue(true);
    overlay.mockReturnValue(true);
    const prompt = ask();
    await expect(requestPermission('callPopup', labels)).resolves.toMatchObject({
      state: 'granted',
    });
    expect(prompt).not.toHaveBeenCalled();
  });

  it('cannot be asked again after "Don\'t ask again"', async () => {
    ask().mockResolvedValue('never_ask_again');
    await expect(requestPermission('callPopup', labels)).resolves.toEqual({
      state: 'denied',
      canAskAgain: false,
    });
  });
});

describe('openSettingsFor with the call pop-up', () => {
  it('opens the overlay page when it is the only thing off and the overlay is what is missing', async () => {
    await openSettingsFor(['callPopup']);
    expect(openOverlaySettings).toHaveBeenCalledTimes(1);
    expect(openPermissionSettings).not.toHaveBeenCalled();
  });

  it("opens the app's page when something else is off too", async () => {
    jest.mocked(openPermissionSettings).mockResolvedValue();
    await openSettingsFor(['callPopup', 'camera']);
    expect(openOverlaySettings).not.toHaveBeenCalled();
    expect(openPermissionSettings).toHaveBeenCalledTimes(1);
  });
});
