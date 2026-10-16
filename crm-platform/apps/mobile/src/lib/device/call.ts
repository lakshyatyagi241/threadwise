import * as IntentLauncher from 'expo-intent-launcher';
import * as Linking from 'expo-linking';
import { Platform } from 'react-native';
import { log } from '@/lib/observability/logger';
import { startCallMonitor, stopCallMonitor, type CallParty } from './call-monitor';
import { forgetCall, rememberCall } from './pending-call';
import { canPlaceCalls } from './permissions';

/**
 * Calls a phone number. On Android, when the person allowed calls (the permission prompt at first open), the call is placed straight away; in
 * every other case, and if that fails, the number is handed to the phone's dialer, which needs no permission and lets the person
 * confirm. iOS always goes through the dialer, which asks the person to confirm the call.
 *
 * Given who is being called, the call is followed: on Android the contact is shown over the phone's call screen and the app opens
 * its "log this call" screen when the call ends; where that cannot be heard (iOS, a refused permission) the app offers to log
 * the call when the person comes back to it (`pending-call.ts`).
 */
export async function placeCall(phone: string, party?: CallParty): Promise<void> {
  try {
    await dial(phone, party);
  } catch (error) {
    // Nothing was dialled: there is no call to follow.
    stopCallMonitor();
    forgetCall();
    throw error;
  }
}

async function dial(phone: string, party?: CallParty): Promise<void> {
  const uri = `tel:${phone}`;
  if (party) {
    const watching = await startCallMonitor(party);
    if (watching) forgetCall();
    else if (party.contactId) rememberCall(party);
  }
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
