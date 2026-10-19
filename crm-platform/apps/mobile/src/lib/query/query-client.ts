import NetInfo from '@react-native-community/netinfo';
import {
  MutationCache,
  QueryCache,
  QueryClient,
  focusManager,
  onlineManager,
} from '@tanstack/react-query';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { env } from '@/config/env';
import { isApiError } from '@/lib/api/errors';
import { transientRetry, transientRetryDelay } from '@/lib/api/retry';
import { noteGateError } from '@/lib/session/account-gate';

/**
 * Server state lives here and only here (docs/adr/0024). Screens read it with `useQuery`/`useInfiniteQuery`; nothing copies it
 * into a store.
 */
export function createQueryClient(): QueryClient {
  // A gate that closes while the app is open (an administrator forces a password change, suspends the account) shows up as an error
  // on whatever the person was doing; the session is read again and the gate screen takes over.
  const onError = (error: unknown) => noteGateError(error, client);
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        // Fresh enough to open a screen instantly, stale enough that pull-to-refresh and focus really refetch.
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: transientRetry,
        retryDelay: transientRetryDelay,
        // 401/403 are answers, not reasons to hammer the server on every app focus.
        refetchOnReconnect: 'always',
      },
      // A mutation is never retried automatically: whether it is safe to repeat is the caller's call (same Idempotency-Key).
      mutations: { retry: false },
    },
  });
  return client;
}

/** Plain-language check used by screens: "is this an error the person can fix by trying again later?" */
export const isRetryable = (e: unknown): boolean =>
  isApiError(e) && (e.isConnectivity || e.status >= 500);

let wired = false;

/**
 * Online means "our API answers", not "Android validated this network against Google". A Wi-Fi or hotspot that reaches the API
 * but has no general internet (an office or home LAN, a captive network, an emulator) is left unvalidated by Android. NetInfo's
 * native check then reported no internet, react-query paused every request, and every screen stayed on its loading skeleton
 * without ever calling the API.
 */
function configureReachability(): void {
  NetInfo.configure({
    reachabilityUrl: `${env.apiUrl}/health`,
    reachabilityMethod: 'GET',
    reachabilityTest: async (response) => response.status === 200,
    useNativeReachability: false,
  });
}

/** Connects react-query to the phone: online/offline from the OS, "focused" from the app coming to the foreground. */
export function wireQueryEnvironment(): void {
  if (wired) return;
  wired = true;
  configureReachability();
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((s) =>
      setOnline(Boolean(s.isConnected && s.isInternetReachable !== false)),
    ),
  );
  if (Platform.OS !== 'web') {
    AppState.addEventListener('change', (status: AppStateStatus) =>
      focusManager.setFocused(status === 'active'),
    );
  }
}
