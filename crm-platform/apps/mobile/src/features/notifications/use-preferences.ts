import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { PreferenceSaver } from './preference-saver';
import { fetchPreferences, fetchPushDeployment, savePreferences } from './preferences-api';
import {
  applyChange,
  changeRequest,
  customTypes,
  preferencesKey,
  resetAll,
  resetEntry,
  resetRequest,
  stateFromResponse,
  type PrefChannel,
  type PrefsState,
} from './preferences-model';

/** Preferences change a few times a year: the screen reads them when it opens, and a few minutes of freshness is enough. */
const STALE_MS = 5 * 60_000;

export const usePreferences = () =>
  useQuery({
    queryKey: preferencesKey,
    queryFn: async ({ signal }): Promise<PrefsState> =>
      stateFromResponse(await fetchPreferences(signal)),
    staleTime: STALE_MS,
    retry: false,
  });

/** Whether this deployment has browser notifications at all. A failure leaves the Push column out, as on the web. */
export function usePushDeployment() {
  const query = useQuery({
    queryKey: ['notifications', 'push-deployment'],
    queryFn: ({ signal }) => fetchPushDeployment(signal),
    staleTime: STALE_MS,
    retry: false,
  });
  return { configured: query.data?.enabled === true };
}

export interface PreferenceActions {
  /** Turns one switch. The screen changes at once; a failed save puts it back and sets `failed`. */
  change(type: string, channel: PrefChannel, value: boolean): void;
  /** One type back to following the defaults. */
  reset(type: string): void;
  /** Every type the person changed back to the defaults. */
  resetEverything(): void;
  /** The last save failed (and was undone). */
  failed: boolean;
  clearFailed(): void;
}

export function usePreferenceActions(): PreferenceActions {
  const queryClient = useQueryClient();
  const [failed, setFailed] = useState(false);
  const saver = useMemo(
    () =>
      new PreferenceSaver(queryClient, (request) => savePreferences(request), {
        fail: () => setFailed(true),
        busy: () => undefined,
        clear: () => setFailed(false),
      }),
    [queryClient],
  );
  return useMemo(
    () => ({
      change: (type, channel, value) =>
        void saver.run((state) => {
          const next = applyChange(state, type, channel, value);
          return { next, request: changeRequest(next, type, channel) };
        }),
      reset: (type) =>
        void saver.run((state) => ({
          next: resetEntry(state, type),
          request: resetRequest([type]),
        })),
      resetEverything: () =>
        void saver.run((state) => ({
          next: resetAll(state),
          request: resetRequest(customTypes(state)),
        })),
      failed,
      clearFailed: () => setFailed(false),
    }),
    [saver, failed],
  );
}
