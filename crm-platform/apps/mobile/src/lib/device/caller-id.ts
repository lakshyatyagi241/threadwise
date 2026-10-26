import { requireOptionalNativeModule } from 'expo';
import * as Linking from 'expo-linking';
import { Appearance, PermissionsAndroid, Platform } from 'react-native';
import { BRAND_NAME } from '@/config/brand';
import { i18n } from '@/lib/i18n';
import { log } from '@/lib/observability/logger';
import { palette } from '@/lib/theme/tokens';

/** One contact the phone can name when it rings: only what the card shows and what opens the contact. */
export interface CallerEntry {
  id: string;
  name: string;
  phone: string;
}

export interface CallerIdStatus {
  /** The switch: the phone shows the card for a call from one of the contacts. */
  enabled: boolean;
  /** How many contacts the phone can name. */
  count: number;
  /** When the contacts were last updated (milliseconds since 1970); 0 when never. */
  updatedAt: number;
}

interface NativeCallerId {
  configureCallerId?(enabled: boolean, display: Record<string, string>): void;
  setCallerDirectory?(json: string): number;
  clearCallerId?(): void;
  callerIdStatus?(): CallerIdStatus;
}

/** The Android module in `modules/call-monitor`. Absent on iOS, in tests, and in a build made before caller ID was added to it. */
const nativeModule = (): NativeCallerId | null =>
  Platform.OS === 'android' ? requireOptionalNativeModule<NativeCallerId>('CallMonitor') : null;

const PHONE_STATE = PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE;
const CALL_LOG = PermissionsAndroid.PERMISSIONS.READ_CALL_LOG;

/** Whether this build can name a caller (Android, and a build that has the caller-ID part of the module). */
export const callerIdAvailable = (): boolean =>
  typeof nativeModule()?.callerIdStatus === 'function';

const NONE: CallerIdStatus = { enabled: false, count: 0, updatedAt: 0 };

export function callerIdStatus(): CallerIdStatus {
  try {
    return nativeModule()?.callerIdStatus?.() ?? NONE;
  } catch (error) {
    log.exception(error, 'device.caller_id_status_failed');
    return NONE;
  }
}

/** The two permissions the phone gives only to an app that is allowed to know about calls: their state, and the caller's number. */
export async function callerIdPermissions(): Promise<{ phoneState: boolean; callLog: boolean }> {
  if (Platform.OS !== 'android') return { phoneState: false, callLog: false };
  const [phoneState, callLog] = await Promise.all([
    PermissionsAndroid.check(PHONE_STATE),
    PermissionsAndroid.check(CALL_LOG),
  ]);
  return { phoneState, callLog };
}

/** Asks for both permissions at once (the phone shows its own prompt); true when both were given. */
export async function requestCallerIdPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const answers = await PermissionsAndroid.requestMultiple([PHONE_STATE, CALL_LOG]);
  return (
    answers[PHONE_STATE] === PermissionsAndroid.RESULTS.GRANTED &&
    answers[CALL_LOG] === PermissionsAndroid.RESULTS.GRANTED
  );
}

/**
 * The card's words and colours, written here (so they are translated and follow the theme) and kept by the phone, because the
 * phone shows the card when the app may be closed. `__ID__` in the address is replaced by the contact's id when the card is pressed.
 */
export function callerDisplay(): Record<string, string> {
  const t = i18n.t.bind(i18n);
  const colors = palette[Appearance.getColorScheme() === 'dark' ? 'dark' : 'light'];
  return {
    appName: BRAND_NAME,
    subtitle: t('calls.monitor.contact'),
    closeLabel: t('calls.monitor.close'),
    openUrl: Linking.createURL('/contact/__ID__'),
    // The phone adds the contact, when the call started, how long it lasted and whether it was answered.
    summaryUrl: Linking.createURL('/call-summary', { queryParams: { direction: 'incoming' } }),
    surfaceColor: colors.surface,
    textColor: colors.text,
    mutedColor: colors.textMuted,
    primaryColor: colors.action,
    onPrimaryColor: colors.onAction,
  };
}

/** The list as the phone takes it: no empty rows, and no contact twice for one number (the last one wins, as the phone does). */
export function callerEntriesJson(entries: readonly CallerEntry[]): string {
  return JSON.stringify(
    entries
      .filter(
        (entry) => entry.id && entry.name.trim() && entry.phone.replace(/\D/g, '').length >= 6,
      )
      .map((entry) => ({ id: entry.id, name: entry.name.trim(), phone: entry.phone.trim() })),
  );
}

/** Switches caller ID on with these contacts; answers how many the phone can name. */
export function enableCallerId(entries: readonly CallerEntry[]): number {
  const native = nativeModule();
  if (!native?.configureCallerId || !native.setCallerDirectory) return 0;
  native.configureCallerId(true, callerDisplay());
  return native.setCallerDirectory(callerEntriesJson(entries));
}

/** Gives the phone a fresh list of contacts and a fresh card (a language or theme change), leaving the switch as it is. */
export function updateCallerId(entries: readonly CallerEntry[]): number {
  const native = nativeModule();
  if (!native?.configureCallerId || !native.setCallerDirectory) return 0;
  native.configureCallerId(callerIdStatus().enabled, callerDisplay());
  return native.setCallerDirectory(callerEntriesJson(entries));
}

/** Switches caller ID off and makes the phone forget every contact (also when the person signs out). */
export function disableCallerId(): void {
  try {
    nativeModule()?.clearCallerId?.();
  } catch (error) {
    log.exception(error, 'device.caller_id_clear_failed');
  }
}
