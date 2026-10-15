import * as ImagePicker from 'expo-image-picker';
import { PermissionsAndroid, Platform } from 'react-native';
import { log } from '@/lib/observability/logger';
import { openNotificationSettings, openPermissionSettings } from './open-settings';
import {
  getNotificationPermission,
  readPermission,
  requestNotificationPermission,
  type NotificationPermission,
} from './notification-permission';

/** The things the app asks the phone for, each with the phone's own "Allow" prompt. */
export type DevicePermission = 'notifications' | 'calls' | 'camera';

/** Where one permission stands. `canAskAgain: false` means only the phone's settings can change it. */
export type PermissionInfo = NotificationPermission;

/**
 * The permissions the app asks for on this phone, in the order shown. Calls exist only on Android: iOS has no call
 * permission, it asks the person to confirm each call itself.
 */
export const offeredPermissions = (): DevicePermission[] =>
  Platform.OS === 'android' ? ['notifications', 'calls', 'camera'] : ['notifications', 'camera'];

const CALL_PHONE = PermissionsAndroid.PERMISSIONS.CALL_PHONE;

/** Whether the app may place a call itself (Android's CALL_PHONE), rather than hand the number to the dialer. */
export const canPlaceCalls = async (): Promise<boolean> =>
  Platform.OS === 'android' && (await PermissionsAndroid.check(CALL_PHONE));

/** One permission as it is now, without asking the person anything. */
export async function getPermission(kind: DevicePermission): Promise<PermissionInfo> {
  switch (kind) {
    case 'notifications':
      return getNotificationPermission();
    case 'camera':
      return readPermission(await ImagePicker.getCameraPermissionsAsync());
    case 'calls':
      // Android cannot tell "never asked" from "refused" before asking, so a missing grant is "can still ask".
      return (await canPlaceCalls())
        ? { state: 'granted', canAskAgain: true }
        : { state: 'denied', canAskAgain: Platform.OS === 'android' };
  }
}

interface Labels {
  /** What the phone's settings list the notification channel as (Android). */
  channelName: string;
}

/** Shows the phone's own prompt for one permission, and answers with where it stands after the person has chosen. */
export async function requestPermission(
  kind: DevicePermission,
  labels: Labels,
): Promise<PermissionInfo> {
  switch (kind) {
    case 'notifications':
      return requestNotificationPermission(labels.channelName);
    case 'camera':
      return readPermission(await ImagePicker.requestCameraPermissionsAsync());
    case 'calls': {
      const answer = await PermissionsAndroid.request(CALL_PHONE);
      return answer === PermissionsAndroid.RESULTS.GRANTED
        ? { state: 'granted', canAskAgain: true }
        : { state: 'denied', canAskAgain: answer !== PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN };
    }
  }
}

/**
 * The first-open flow: the phone's own "Allow" prompt for each permission, one after the other, with no screen of the app in
 * between. A permission the phone will not ask about again (refused for good, here or in an earlier install) cannot be turned on
 * by a prompt, so the app's page in the phone's settings is opened once, at the end, for the person to switch it on there (the notification page itself when that is the only one). A
 * single "Don't allow" is respected: the phone would still ask next time, so nothing more happens.
 */
export async function askForPermissions(labels: Labels): Promise<void> {
  const blocked: DevicePermission[] = [];
  for (const kind of offeredPermissions()) {
    try {
      // A permission that is already on is answered at once, without a prompt.
      const answer = await requestPermission(kind, labels);
      if (answer.state !== 'granted' && !answer.canAskAgain) blocked.push(kind);
    } catch (error) {
      log.exception(error, 'device.permission_request_failed');
    }
  }
  if (blocked.length === 0) return;
  // Notifications have a settings page of their own, with the switch on it; the rest are found under "Permissions" in the app's page.
  if (blocked.every((kind) => kind === 'notifications')) await openNotificationSettings();
  else await openPermissionSettings();
}
