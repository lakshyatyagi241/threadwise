import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * Where the phone's notification permission stands. `canAskAgain: false` means only the phone's settings can change it. Android 13
 * and newer report an app that was never asked as `denied` with `canAskAgain: true`; iOS reports it as `undetermined`.
 */
export interface NotificationPermission {
  state: 'granted' | 'denied' | 'undetermined';
  canAskAgain: boolean;
}

/** What every Expo permission answer (notifications, camera) has in common. */
interface ExpoAnswer {
  status: string;
  granted: boolean;
  canAskAgain: boolean;
}

/** An Expo permission answer as the app reads it. */
export const readPermission = (result: ExpoAnswer): NotificationPermission => ({
  state: result.granted ? 'granted' : result.status === 'undetermined' ? 'undetermined' : 'denied',
  canAskAgain: result.canAskAgain,
});

/** The permission as it is now, without asking the person anything. */
export const getNotificationPermission = async (): Promise<NotificationPermission> =>
  readPermission(await Notifications.getPermissionsAsync());

/**
 * Asks the phone to show its notification prompt. Android 13 and newer show no prompt until the app has at least one notification
 * channel, so the app's default channel is made first (`channelName` is what the phone's settings list it as). The answer is the
 * permission after the person has chosen; a prompt that was already answered is not shown again and the answer is the same.
 */
export async function requestNotificationPermission(
  channelName: string,
): Promise<NotificationPermission> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: channelName,
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  return readPermission(await Notifications.requestPermissionsAsync());
}
