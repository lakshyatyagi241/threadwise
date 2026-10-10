import NetInfo from '@react-native-community/netinfo';
import { QueryClient, focusManager, onlineManager } from '@tanstack/react-query';
import { AppState, Platform, type AppStateStatus } from 'react-native';
import { isApiError } from '@/lib/api/errors';
import { transientRetry, transientRetryDelay } from '@/lib/api/retry';

/**
 * Server state lives here and only here (docs/adr/0024). Screens read it with `useQuery`/`useInfiniteQuery`; nothing copies it
 * into a store.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
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
}

/** Plain-language check used by screens: "is this an error the person can fix by trying again later?" */
export const isRetryable = (e: unknown): boolean =>
  isApiError(e) && (e.isConnectivity || e.status >= 500);

let wired = false;

/** Connects react-query to the phone: online/offline from the OS, "focused" from the app coming to the foreground. */
export function wireQueryEnvironment(): void {
  if (wired) return;
  wired = true;
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
