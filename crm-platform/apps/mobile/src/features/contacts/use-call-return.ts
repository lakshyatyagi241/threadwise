import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { AppState } from 'react-native';
import { markAppLeft, takeReturnedCall } from '@/lib/device/pending-call';

/**
 * Where nothing hears the call end (iOS, or Android without the phone-state permission), the call placed from the app is
 * offered for logging when the person comes back to the app. Mount it once, in the signed-in layout.
 */
export function useCallReturn(): void {
  const router = useRouter();
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        markAppLeft();
        return;
      }
      const call = takeReturnedCall();
      if (!call?.party.contactId) return;
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
    return () => subscription.remove();
  }, [router]);
}
