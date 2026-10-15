import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import {
  getNotificationPermission,
  requestNotificationPermission,
} from './notification-permission';

const getCall = jest.mocked(Notifications.getPermissionsAsync);
const requestCall = jest.mocked(Notifications.requestPermissionsAsync);
const channelCall = jest.mocked(Notifications.setNotificationChannelAsync);

const answer = (status: 'granted' | 'denied' | 'undetermined', canAskAgain: boolean) =>
  ({
    status,
    granted: status === 'granted',
    canAskAgain,
    expires: 'never',
  }) as Notifications.NotificationPermissionsStatus;

const onPlatform = (os: 'android' | 'ios') => {
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
};

afterEach(() => {
  jest.clearAllMocks();
  onPlatform('ios');
});

describe('getNotificationPermission', () => {
  it('says granted, denied and undecided, and whether the phone would ask again', async () => {
    getCall.mockResolvedValueOnce(answer('granted', true));
    await expect(getNotificationPermission()).resolves.toEqual({
      state: 'granted',
      canAskAgain: true,
    });
    getCall.mockResolvedValueOnce(answer('denied', false));
    await expect(getNotificationPermission()).resolves.toEqual({
      state: 'denied',
      canAskAgain: false,
    });
    getCall.mockResolvedValueOnce(answer('undetermined', true));
    await expect(getNotificationPermission()).resolves.toEqual({
      state: 'undetermined',
      canAskAgain: true,
    });
  });

  it('never shows a prompt', async () => {
    getCall.mockResolvedValueOnce(answer('undetermined', true));
    await getNotificationPermission();
    expect(requestCall).not.toHaveBeenCalled();
  });
});

describe('requestNotificationPermission', () => {
  it('makes the default channel first on Android, so Android 13 and newer will show the prompt', async () => {
    onPlatform('android');
    const order: string[] = [];
    channelCall.mockImplementationOnce(async () => {
      order.push('channel');
      return null;
    });
    requestCall.mockImplementationOnce(async () => {
      order.push('request');
      return answer('granted', true);
    });
    await expect(requestNotificationPermission('Messages')).resolves.toEqual({
      state: 'granted',
      canAskAgain: true,
    });
    expect(order).toEqual(['channel', 'request']);
    expect(channelCall).toHaveBeenCalledWith('default', { name: 'Messages', importance: 3 });
  });

  it('makes no channel on iOS, which has none', async () => {
    onPlatform('ios');
    requestCall.mockResolvedValueOnce(answer('denied', false));
    await expect(requestNotificationPermission('Messages')).resolves.toEqual({
      state: 'denied',
      canAskAgain: false,
    });
    expect(channelCall).not.toHaveBeenCalled();
  });
});
