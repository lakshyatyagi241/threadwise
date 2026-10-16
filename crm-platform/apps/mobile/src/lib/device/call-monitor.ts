import { requireOptionalNativeModule } from 'expo';
import * as Linking from 'expo-linking';
import { Appearance, PermissionsAndroid, Platform } from 'react-native';
import { BRAND_NAME } from '@/config/brand';
import { i18n } from '@/lib/i18n';
import { log } from '@/lib/observability/logger';
import { palette } from '@/lib/theme/tokens';

/** The person on the other end of a call placed from the app. */
export interface CallParty {
  /** The contact the call is logged on; without one the call is placed but there is nothing to log it on. */
  contactId: string | null;
  name: string;
  phone: string;
  /** What the person is, under their name on the call screen ("Contact" when it is not said). */
  subtitle?: string;
}

interface NativeCallMonitor {
  canDrawOverlays(): boolean;
  openOverlaySettings(): void;
  start(options: Record<string, string>): void;
  stop(): void;
}

/** The Android module in `modules/call-monitor`. It is absent on iOS, in tests and in a build made before the module existed. */
const nativeModule = (): NativeCallMonitor | null =>
  Platform.OS === 'android' ? requireOptionalNativeModule<NativeCallMonitor>('CallMonitor') : null;

const PHONE_STATE = PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE;

/** Whether this build can show the contact over the call screen and bring the app back after the call (Android only). */
export const callMonitorAvailable = (): boolean => nativeModule() !== null;

/** Whether "display over other apps" is on for the app (the contact card cannot show without it). */
export const overlayAllowed = (): boolean => nativeModule()?.canDrawOverlays() ?? false;

/** Opens the phone's page with the "display over other apps" switch. */
export function openOverlaySettings(): void {
  nativeModule()?.openOverlaySettings();
}

/** Whether the phone-state permission (what tells the app a call has started and ended) is on. */
export const phoneStateAllowed = async (): Promise<boolean> =>
  Platform.OS === 'android' && (await PermissionsAndroid.check(PHONE_STATE));

/**
 * Starts watching the call that is about to be placed: the contact is shown over the phone's call screen, and when the call
 * ends the app opens its "log this call" screen. Answers whether the watch started; false (iOS, an old build, the phone-state
 * permission refused) means the call is placed all the same and the person is asked about it when they come back to the app.
 * Call it just before the call is placed, while the app is still on screen (Android only lets a foreground app start the service).
 */
export async function startCallMonitor(party: CallParty): Promise<boolean> {
  const native = nativeModule();
  if (!native) return false;
  try {
    if (!(await phoneStateAllowed())) {
      const answer = await PermissionsAndroid.request(PHONE_STATE);
      if (answer !== PermissionsAndroid.RESULTS.GRANTED) return false;
    }
    const t = i18n.t.bind(i18n);
    const colors = palette[Appearance.getColorScheme() === 'dark' ? 'dark' : 'light'];
    native.start({
      name: party.name,
      subtitle: party.subtitle ?? t('calls.monitor.contact'),
      phone: party.phone,
      // Only a call with a contact to log it on brings the app back; a bare number has nowhere to be logged.
      returnUrl: party.contactId
        ? Linking.createURL('/call-summary', {
            queryParams: { contactId: party.contactId, name: party.name },
          })
        : '',
      appName: BRAND_NAME,
      closeLabel: t('calls.monitor.close'),
      ongoingTitle: t('calls.monitor.ongoingTitle'),
      endedTitle: t('calls.monitor.endedTitle'),
      endedText: t('calls.monitor.endedText', { name: party.name }),
      channelOngoing: t('calls.monitor.channelOngoing'),
      channelEnded: t('calls.monitor.channelEnded'),
      surfaceColor: colors.surface,
      textColor: colors.text,
      mutedColor: colors.textMuted,
      primaryColor: colors.primary,
      onPrimaryColor: colors.onPrimary,
    });
    return true;
  } catch (error) {
    log.exception(error, 'device.call_monitor_failed');
    return false;
  }
}

/** Stops watching (the call could not be placed). */
export function stopCallMonitor(): void {
  try {
    nativeModule()?.stop();
  } catch (error) {
    log.exception(error, 'device.call_monitor_stop_failed');
  }
}
