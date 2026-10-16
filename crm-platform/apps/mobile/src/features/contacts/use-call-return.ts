import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { takeEndedCall } from '@/lib/device/call-monitor';
import { markAppLeft, takeReturnedCall } from '@/lib/device/pending-call';

/** How long the "log this call" screen the call-monitor service opens by itself is given to appear before the app opens it. */
const SERVICE_GRACE_MS = 1000;

/**
 * How many more times, one grace apart, the app asks the service whether a call has ended. The phone can bring the app back to the
 * front a moment before the service hears the call go idle, so a single look right after the return can find nothing.
 */
const SERVICE_RETRIES = 5;

/** The query of the address the service builds (`<scheme>:///call-summary?contactId=…&name=…&startedAt=…&durationSec=…`). */
function summaryParams(url: string): Record<string, string> | null {
  const [location = '', query = ''] = url.split('#')[0]?.split('?') ?? [];
  if (!location.endsWith('/call-summary')) return null;
  const params: Record<string, string> = {};
  for (const pair of query.split('&')) {
    const [key = '', value = ''] = pair.split('=');
    if (key) params[decodeURIComponent(key)] = decodeURIComponent(value.replace(/\+/g, ' '));
  }
  return params;
}

/** Opens the sheet for a call the service saw end and could not open the screen for (no "display over other apps"). */
function openEndedCall(router: ReturnType<typeof useRouter>): boolean {
  const url = takeEndedCall();
  const params = url ? summaryParams(url) : null;
  if (!params) return false;
  router.push({ pathname: '/call-summary', params });
  return true;
}

/**
 * Where nothing hears the call end (iOS, or Android without the phone-state permission), the call placed from the app is
 * offered for logging when the person comes back to the app. Where the call-monitor service heard it end but could not open the
 * screen from the background, the same happens (after a moment, so a screen the service did open is not opened twice: that screen
 * takes the call away when it appears). Mount it once, in the signed-in layout.
 */
export function useCallReturn(): void {
  const router = useRouter();
  useEffect(() => {
    let grace: ReturnType<typeof setTimeout> | undefined;
    // Looks for an ended call now, and again a moment later while none is found (up to `SERVICE_RETRIES` more times).
    const look = (retries: number) => {
      if (openEndedCall(router) || retries <= 0) return;
      grace = setTimeout(() => look(retries - 1), SERVICE_GRACE_MS);
    };
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        clearTimeout(grace);
        markAppLeft();
        return;
      }
      const call = takeReturnedCall();
      if (!call?.party.contactId) {
        clearTimeout(grace);
        grace = setTimeout(() => look(SERVICE_RETRIES), SERVICE_GRACE_MS);
        return;
      }
      router.push({
        pathname: '/call-summary',
        params: {
          contactId: call.party.contactId,
          name: call.party.name,
          startedAt: String(call.startedAt),
          durationSec: String(call.durationSec),
        },
      });
    });
    return () => {
      clearTimeout(grace);
      subscription.remove();
    };
  }, [router]);
}
