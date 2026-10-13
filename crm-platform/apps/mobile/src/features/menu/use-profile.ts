import type { ProfileResponse, SessionResponse, UpdateProfileRequest } from '@crm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useRef } from 'react';
import { isApiError } from '@/lib/api';
import { sessionKey } from '@/lib/session/use-session';
import { THEME_OF_MODE, type Mode } from './appearance';
import { fetchProfile, updateProfile } from './profile-api';

export const profileKey = ['account', 'profile'] as const;

/** The person's own profile. */
export const useProfile = () =>
  useQuery({ queryKey: profileKey, queryFn: ({ signal }) => fetchProfile(signal) });

/**
 * Saves the profile. One idempotency key per action: only a lost connection keeps it (the tap on Save is repeated as the same
 * request); any answer from the server ends the action. A save refreshes the session too, because the Menu shows the name from it.
 */
export function useUpdateProfile() {
  const queryClient = useQueryClient();
  const key = useRef(Crypto.randomUUID());
  const renew = () => void (key.current = Crypto.randomUUID());
  return useMutation({
    gcTime: 0,
    mutationFn: (body: UpdateProfileRequest) => updateProfile(body, key.current),
    onError: (error) => {
      if (!(isApiError(error) && error.isConnectivity)) renew();
    },
    onSuccess: async (profile: ProfileResponse) => {
      renew();
      queryClient.setQueryData(profileKey, profile);
      await queryClient.invalidateQueries({ queryKey: sessionKey });
    },
  });
}

/**
 * Saves the light/dark choice to the account. The session in the cache changes at once, so the screen switches the moment the row
 * is pressed; if the server refuses, the old theme comes back and the caller shows why.
 */
export function useSetMode() {
  const queryClient = useQueryClient();
  return useMutation({
    gcTime: 0,
    mutationFn: (mode: Mode) => updateProfile({ theme: THEME_OF_MODE[mode] }, Crypto.randomUUID()),
    onMutate: async (mode) => {
      await queryClient.cancelQueries({ queryKey: sessionKey });
      const previous = queryClient.getQueryData<SessionResponse>(sessionKey);
      if (previous) {
        queryClient.setQueryData<SessionResponse>(sessionKey, {
          ...previous,
          user: { ...previous.user, theme: THEME_OF_MODE[mode] },
        });
      }
      return { previous };
    },
    onError: (_error, _mode, context) => {
      if (context?.previous) queryClient.setQueryData(sessionKey, context.previous);
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sessionKey }),
        queryClient.invalidateQueries({ queryKey: profileKey }),
      ]);
    },
  });
}
