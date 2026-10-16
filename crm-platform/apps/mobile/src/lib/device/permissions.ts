import * as ImagePicker from 'expo-image-picker';
import { PermissionsAndroid, Platform } from 'react-native';
import { log } from '@/lib/observability/logger';
import {
  callMonitorAvailable,
  openOverlaySettings,
  overlayAllowed,
  phoneStateAllowed,
} from './call-monitor';
import { openNotificationSettings, openPermissionSettings } from './open-settings';
import {
  getNotificationPermission,
  readPermission,
  requestNotificationPermission,
  type NotificationPermission,
} from './notification-permission';

/** The things the app asks the phone for, each with the phone's own "Allow" prompt. */
export type DevicePermission = 'notifications' | 'calls' | 'camera' | 'callPopup';

/** Where one permission stands. `canAskAgain: false` means only the phone's settings can change it. */
export type PermissionInfo = NotificationPermission;

/**
 * The permissions the app asks for on this phone, in the order shown. Calls and the call pop-up exist only on Android: iOS has no
 * call permission (it asks the person to confirm each call itself) and lets no app draw over the phone's call screen. The pop-up
 * comes last because its second half is a settings page, which takes the person out of the app.
 */
export const offeredPermissions = (): DevicePermission[] =>
  Platform.OS === 'android'
    ? ['notifications', 'calls', 'camera', 'callPopup']
    : ['notifications', 'camera'];

const CALL_PHONE = PermissionsAndroid.PERMISSIONS.CALL_PHONE;

/** Whether the app may place a call itself (Android's CALL_PHONE), rather than hand the number to the dialer. */
export const canPlaceCalls = async (): Promise<boolean> =>
  Platform.OS === 'android' && (await PermissionsAndroid.check(CALL_PHONE));

/**
 * Whether the call pop-up can work: the phone-state permission (to hear the call start and end) and "display over other apps" (to
 * show the contact over the call screen and bring the app back). A build without the call-monitor module has nothing to switch on.
 */
const callPopupReady = async (): Promise<boolean> =>
  !callMonitorAvailable() || ((await phoneStateAllowed()) && overlayAllowed());

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
    case 'callPopup':
      return (await callPopupReady())
        ? { state: 'granted', canAskAgain: true }
        : { state: 'denied', canAskAgain: true };
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
    case 'callPopup': {
      if (!callMonitorAvailable()) return { state: 'granted', canAskAgain: true };
      // The phone shows its prompt for the phone state; "display over other apps" has no prompt, only a settings page, which the
      // guide opens (`openSettingsFor`) when this answers "denied".
      const answer = (await phoneStateAllowed())
        ? PermissionsAndroid.RESULTS.GRANTED
        : await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE);
      const stateOn = answer === PermissionsAndroid.RESULTS.GRANTED;
      return stateOn && overlayAllowed()
        ? { state: 'granted', canAskAgain: true }
        : {
            state: 'denied',
            canAskAgain: !stateOn && answer !== PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN,
          };
    }
  }
}

/**
 * The first-open flow: the phone's own "Allow" prompt for each permission, one after the other, with no screen of the app in
 * between. Answers with the permissions still off afterwards (refused, or refused for good here or in an earlier install, when the
 * phone would not even show the prompt): only the phone's settings can switch those on, and the app tells the person where first
 * (the app never opens a settings page on its own) before `openSettingsFor` takes them there.
 */
export async function askForPermissions(labels: Labels): Promise<DevicePermission[]> {
  const off: DevicePermission[] = [];
  for (const kind of offeredPermissions()) {
    try {
      // A permission that is already on is answered at once, without a prompt.
      const answer = await requestPermission(kind, labels);
      if (answer.state !== 'granted') off.push(kind);
    } catch (error) {
      log.exception(error, 'device.permission_request_failed');
    }
  }
  return off;
}

/**
 * Takes the person to where the given permissions are switched on. Notifications have a settings page of their own, with the
 * switch on it; the rest are found under "Permissions" in the app's page.
 */
export async function openSettingsFor(kinds: DevicePermission[]): Promise<void> {
  // The pop-up's "display over other apps" switch has a page of its own, with the switch on it. When it is the only thing left off,
  // that page is where to go; with others, the app's page is (and the pop-up still works without it: a notification brings the app back).
  if (kinds.length > 0 && kinds.every((kind) => kind === 'callPopup') && !overlayAllowed()) {
    openOverlaySettings();
    return;
  }
  if (kinds.every((kind) => kind === 'notifications')) await openNotificationSettings();
  else await openPermissionSettings();
}
