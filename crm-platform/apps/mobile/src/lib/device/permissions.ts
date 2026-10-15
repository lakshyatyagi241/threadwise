import * as ImagePicker from 'expo-image-picker';
import { PermissionsAndroid, Platform } from 'react-native';
import {
  ensureNotificationChannel,
  getNotificationPermission,
  readPermission,
  requestNotificationPermission,
  type NotificationPermission,
} from './notification-permission';

/** The things the app asks the phone for. Each one is asked for with a reason the person has just read (the first-open screen). */
export type DevicePermission = 'notifications' | 'calls' | 'camera';

/** Where one permission stands. `canAskAgain: false` means only the phone's settings can change it. */
export type PermissionInfo = NotificationPermission;

/**
 * The permissions the first-open screen offers on this phone, in the order shown. Calls exist only on Android: iOS has no call
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

/**
 * Gets the phone ready for the person to switch permissions on in its settings, without asking anything: Android lists an app's
 * notification permission there only once the app has a notification channel.
 */
export const preparePermissions = (labels: Labels): Promise<void> =>
  ensureNotificationChannel(labels.channelName);

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
