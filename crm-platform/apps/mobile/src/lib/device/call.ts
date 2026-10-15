import * as IntentLauncher from 'expo-intent-launcher';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import { log } from '@/lib/observability/logger';
import { canPlaceCalls } from './permissions';

/**
 * Calls a phone number. On Android, when the person allowed calls (the first-open screen), the call is placed straight away; in
 * every other case, and if that fails, the number is handed to the phone's dialer, which needs no permission and lets the person
 * confirm. iOS always goes through the dialer, which asks the person to confirm the call.
 */
export async function placeCall(phone: string): Promise<void> {
  const uri = `tel:${phone}`;
  if (Platform.OS === 'android') {
    try {
      if (await canPlaceCalls()) {
        await IntentLauncher.startActivityAsync('android.intent.action.CALL', { data: uri });
        return;
      }
    } catch (error) {
      // The dialer is the safe way out: the person still gets to make the call.
      log.exception(error, 'device.direct_call_failed');
    }
  }
  await Linking.openURL(uri);
}
