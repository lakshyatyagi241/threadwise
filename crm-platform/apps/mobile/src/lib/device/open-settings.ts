import * as Application from 'expo-application';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import { log } from '@/lib/observability/logger';

/**
 * Opens the page where the person switches this app's permissions on or off. On Android that is the phone's "App permissions" page
 * for this app (Camera, Notifications, Phone, each with its switch), one step from the toggle instead of the general "App info"
 * page. Some phones' settings apps do not offer that page; then, and on iOS (whose app page already lists the permissions), the
 * app's own settings page is opened.
 */
export async function openPermissionSettings(): Promise<void> {
  if (Platform.OS === 'android' && Application.applicationId) {
    try {
      await IntentLauncher.startActivityAsync('android.intent.action.MANAGE_APP_PERMISSIONS', {
        extra: { 'android.intent.extra.PACKAGE_NAME': Application.applicationId },
      });
      return;
    } catch (error) {
      log.exception(error, 'device.permission_page_unavailable');
    }
  }
  await Linking.openSettings();
}
