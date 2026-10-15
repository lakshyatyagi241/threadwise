import * as Application from 'expo-application';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Linking from 'expo-linking';
import { Platform, ToastAndroid } from 'react-native';
import { i18n } from '@/lib/i18n';
import { log } from '@/lib/observability/logger';

/**
 * Opens this app's page in the phone's settings, where its permissions are switched on. Android lets an app open that page ("App
 * info") but not the "Permissions" list inside it (that screen needs a system-only permission), so on Android a short hint says
 * which row to tap. iOS's page for the app already lists the permissions.
 */
export async function openPermissionSettings(): Promise<void> {
  if (Platform.OS === 'android') {
    ToastAndroid.show(i18n.t('permissions.settingsHint'), ToastAndroid.LONG);
  }
  await Linking.openSettings();
}

/**
 * Opens the notification settings of this app, with the switch itself on screen (Android allows an app to open this one page
 * directly). Everywhere else, and when the phone has no such page, it is the app's settings page.
 */
export async function openNotificationSettings(): Promise<void> {
  if (Platform.OS === 'android' && Application.applicationId) {
    try {
      await IntentLauncher.startActivityAsync('android.settings.APP_NOTIFICATION_SETTINGS', {
        extra: { 'android.provider.extra.APP_PACKAGE': Application.applicationId },
      });
      return;
    } catch (error) {
      log.exception(error, 'device.notification_settings_unavailable');
    }
  }
  await openPermissionSettings();
}
