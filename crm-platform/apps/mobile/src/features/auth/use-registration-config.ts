import { useQuery } from '@tanstack/react-query';
import { fetchPasswordPolicy, fetchRegistrationConfig } from './api';

export const registrationConfigKey = ['auth', 'registration-config'] as const;
export const passwordPolicyKey = ['auth', 'password-policy'] as const;

const FIVE_MINUTES = 5 * 60_000;

/**
 * The public settings that shape the guest screens. They change when an administrator edits the platform settings, not between
 * two taps, so five minutes of cache is plenty. One retry only: a person at the sign-up form should see "try again" in a couple
 * of seconds, not after the long backoff meant for background reads.
 */
export function useRegistrationConfig() {
  return useQuery({
    queryKey: registrationConfigKey,
    queryFn: ({ signal }) => fetchRegistrationConfig(signal),
    staleTime: FIVE_MINUTES,
    retry: 1,
  });
}

/** The live password rules, for the hint and the checklist. Without them the form still works: the server enforces its own. */
export function usePasswordPolicy() {
  return useQuery({
    queryKey: passwordPolicyKey,
    queryFn: ({ signal }) => fetchPasswordPolicy(signal),
    staleTime: FIVE_MINUTES,
    retry: 1,
  });
}
