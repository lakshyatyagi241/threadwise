'use client';

import type { PasswordPolicyHint } from '@crm/contracts';
import { useQuery } from '@tanstack/react-query';
import { authApi, keys } from '../api';

/** The shortest password the platform can ask for; shown until the live policy has loaded. */
export const FALLBACK_MIN_LENGTH = 8;

/**
 * The password rules in force right now, for the hint, placeholder and
 * `minlength` of the new-password boxes. `policy` is null until the answer
 * arrives (or if it cannot), and `minLength` then falls back to the usual 8; the
 * server checks the real rules either way.
 */
export function usePasswordPolicy(): { policy: PasswordPolicyHint | null; minLength: number } {
  const query = useQuery({
    queryKey: keys.passwordPolicy,
    queryFn: authApi.passwordPolicy,
    staleTime: 60_000,
    retry: false,
  });
  const policy = query.data ?? null;
  return { policy, minLength: policy?.minLength ?? FALLBACK_MIN_LENGTH };
}
