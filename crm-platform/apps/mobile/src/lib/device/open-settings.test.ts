import * as Application from 'expo-application';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import { openPermissionSettings } from './open-settings';

jest.mock('expo-linking', () => ({ openSettings: jest.fn(async () => undefined) }));
jest.mock('expo-application', () => ({ applicationId: 'ai.geta.crm.dev' }));

const launch = jest.mocked(IntentLauncher.startActivityAsync);
const fallback = jest.mocked(Linking.openSettings);
const onPlatform = (os: 'android' | 'ios') =>
  Object.defineProperty(Platform, 'OS', { configurable: true, get: () => os });

beforeEach(() => jest.clearAllMocks());
afterEach(() => onPlatform('ios'));

describe('openPermissionSettings', () => {
  it("opens the phone's App permissions page for this app on Android", async () => {
    onPlatform('android');
    await openPermissionSettings();
    expect(launch).toHaveBeenCalledWith('android.intent.action.MANAGE_APP_PERMISSIONS', {
      extra: { 'android.intent.extra.PACKAGE_NAME': 'ai.geta.crm.dev' },
    });
    expect(fallback).not.toHaveBeenCalled();
  });

  it("falls back to the app's settings page when the phone has no permissions page", async () => {
    onPlatform('android');
    launch.mockRejectedValueOnce(new Error('No Activity found to handle Intent'));
    await openPermissionSettings();
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("opens the app's settings page on iOS, which lists the permissions there", async () => {
    onPlatform('ios');
    await openPermissionSettings();
    expect(launch).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it('falls back when the app id is unknown', async () => {
    onPlatform('android');
    const id = Object.getOwnPropertyDescriptor(Application, 'applicationId');
    Object.defineProperty(Application, 'applicationId', { configurable: true, value: null });
    await openPermissionSettings();
    expect(launch).not.toHaveBeenCalled();
    expect(fallback).toHaveBeenCalledTimes(1);
    if (id) Object.defineProperty(Application, 'applicationId', id);
  });
});
