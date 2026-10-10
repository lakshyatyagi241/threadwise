import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';

/**
 * Sent on every request, including the token refresh. The server logs them and, per docs/adr/0026, can answer an app older
 * than the minimum supported version with a "please update" code instead of a confusing failure.
 */
export function clientHeaders(): Record<string, string> {
  return {
    Accept: 'application/json',
    'X-Request-Id': Crypto.randomUUID(),
    'X-App-Platform': Platform.OS,
    'X-App-Version': Application.nativeApplicationVersion ?? 'unknown',
    'X-App-Build': Application.nativeBuildVersion ?? 'unknown',
  };
}
