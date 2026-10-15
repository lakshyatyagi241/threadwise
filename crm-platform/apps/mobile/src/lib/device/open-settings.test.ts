import * as IntentLauncher from 'expo-intent-launcher';
import * as Linking from 'expo-linking';
import { Platform, ToastAndroid } from 'react-native';
import { openNotificationSettings, openPermissionSettings } from './open-settings';

jest.mock('expo-linking', () => ({ openSettings: jest.fn(async () => undefined) }));
jest.mock('expo-application', () => ({ applicationId: 'ai.geta.crm.dev' }));

const launch = jest.mocked(IntentLauncher.startActivityAsync);
const appPage = jest.mocked(Linking.openSettings);
const onPlatform = (os: 'android' | 'ios') =>
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });
let toast: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  toast = jest.spyOn(ToastAndroid, 'show').mockImplementation(() => undefined);
});
afterEach(() => onPlatform('ios'));

describe('openPermissionSettings', () => {
  it("opens the app's settings page and says which row to tap, on Android", async () => {
    onPlatform('android');
    await openPermissionSettings();
    expect(appPage).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith(expect.any(String), ToastAndroid.LONG);
    // Android refuses an app the Permissions list itself, so none is tried.
    expect(launch).not.toHaveBeenCalled();
  });

  it("opens the app's settings page on iOS without a hint", async () => {
    onPlatform('ios');
    await openPermissionSettings();
    expect(appPage).toHaveBeenCalledTimes(1);
    expect(toast).not.toHaveBeenCalled();
  });
});

describe('openNotificationSettings', () => {
  it("opens this app's notification page, with the switch, on Android", async () => {
    onPlatform('android');
    await openNotificationSettings();
    expect(launch).toHaveBeenCalledWith('android.settings.APP_NOTIFICATION_SETTINGS', {
      extra: { 'android.provider.extra.APP_PACKAGE': 'ai.geta.crm.dev' },
    });
    expect(appPage).not.toHaveBeenCalled();
  });

  it("falls back to the app's settings page when the phone has no such page", async () => {
    onPlatform('android');
    launch.mockRejectedValueOnce(new Error('No Activity found to handle Intent'));
    await openNotificationSettings();
    expect(appPage).toHaveBeenCalledTimes(1);
  });

  it("opens the app's settings page on iOS", async () => {
    onPlatform('ios');
    await openNotificationSettings();
    expect(launch).not.toHaveBeenCalled();
    expect(appPage).toHaveBeenCalledTimes(1);
  });
});
