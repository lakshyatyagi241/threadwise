import * as ImagePicker from 'expo-image-picker';
import * as Notifications from 'expo-notifications';
import { PermissionsAndroid, Platform } from 'react-native';
import { canPlaceCalls, getPermission, offeredPermissions, requestPermission } from './permissions';

const cameraGet = jest.mocked(ImagePicker.getCameraPermissionsAsync);
const cameraAsk = jest.mocked(ImagePicker.requestCameraPermissionsAsync);
const notifyGet = jest.mocked(Notifications.getPermissionsAsync);

const onPlatform = (os: 'android' | 'ios') =>
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
const answer = (status: 'granted' | 'denied' | 'undetermined', canAskAgain: boolean) =>
  ({ status, granted: status === 'granted', canAskAgain, expires: 'never' }) as never;

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  onPlatform('ios');
});

describe('offeredPermissions', () => {
  it('offers notifications, calls and camera on Android', () => {
    onPlatform('android');
    expect(offeredPermissions()).toEqual(['notifications', 'calls', 'camera']);
  });

  it('offers no calls on iOS, which has no call permission', () => {
    onPlatform('ios');
    expect(offeredPermissions()).toEqual(['notifications', 'camera']);
  });
});

describe('getPermission', () => {
  it('reads the camera as Expo reports it', async () => {
    cameraGet.mockResolvedValueOnce(answer('undetermined', true));
    await expect(getPermission('camera')).resolves.toEqual({
      state: 'undetermined',
      canAskAgain: true,
    });
    cameraGet.mockResolvedValueOnce(answer('denied', false));
    await expect(getPermission('camera')).resolves.toEqual({ state: 'denied', canAskAgain: false });
  });

  it('reads the notifications', async () => {
    notifyGet.mockResolvedValueOnce(answer('granted', true));
    await expect(getPermission('notifications')).resolves.toEqual({
      state: 'granted',
      canAskAgain: true,
    });
  });

  it('reads calls from the Android permission, and can still ask when it is missing', async () => {
    onPlatform('android');
    const check = jest.spyOn(PermissionsAndroid, 'check');
    check.mockResolvedValueOnce(true);
    await expect(getPermission('calls')).resolves.toEqual({ state: 'granted', canAskAgain: true });
    check.mockResolvedValueOnce(false);
    await expect(getPermission('calls')).resolves.toEqual({ state: 'denied', canAskAgain: true });
  });

  it('has nothing to ask for calls on iOS', async () => {
    onPlatform('ios');
    await expect(getPermission('calls')).resolves.toEqual({ state: 'denied', canAskAgain: false });
    await expect(canPlaceCalls()).resolves.toBe(false);
  });
});

describe('requestPermission', () => {
  const labels = { channelName: 'Messages' };

  it('asks the phone for the camera and answers where it stands', async () => {
    cameraAsk.mockResolvedValueOnce(answer('granted', true));
    await expect(requestPermission('camera', labels)).resolves.toEqual({
      state: 'granted',
      canAskAgain: true,
    });
    expect(cameraAsk).toHaveBeenCalledTimes(1);
  });

  it('maps the three answers of the Android call prompt', async () => {
    onPlatform('android');
    const ask = jest.spyOn(PermissionsAndroid, 'request');
    ask.mockResolvedValueOnce('granted');
    await expect(requestPermission('calls', labels)).resolves.toEqual({
      state: 'granted',
      canAskAgain: true,
    });
    ask.mockResolvedValueOnce('denied');
    await expect(requestPermission('calls', labels)).resolves.toEqual({
      state: 'denied',
      canAskAgain: true,
    });
    ask.mockResolvedValueOnce('never_ask_again');
    await expect(requestPermission('calls', labels)).resolves.toEqual({
      state: 'denied',
      canAskAgain: false,
    });
    expect(ask).toHaveBeenCalledWith('android.permission.CALL_PHONE');
  });
});
