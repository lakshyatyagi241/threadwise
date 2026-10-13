import type { ProfileResponse, UpdateProfileRequest } from '@crm/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { useRef } from 'react';
import { isApiError } from '@/lib/api';
import { sessionKey } from '@/lib/session/use-session';
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
