'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useCallback } from 'react';
import { redirectOnGateError } from '../../shared/gate-errors';
import type { PasskeyApi } from '../../shared/passkeys/passkey-api';
import { PasskeysPanel } from '../../shared/passkeys/passkeys-panel';
import { authApi, keys } from '../api';

const accountPasskeyApi: PasskeyApi = {
  list: authApi.passkeys,
  options: authApi.passkeyOptions,
  register: authApi.registerPasskey,
  remove: async (id, password) => {
    await authApi.removePasskey(id, password);
  },
};

/**
 * Passkeys on "Change password & security", under two-factor: the second factor you can use instead of typing a
 * code. The pane needs two-factor on (the API enforces it), so it reads the same status the two-factor card does
 * and explains instead of offering a button that cannot work.
 */
export function AccountPasskeys() {
  const router = useRouter();
  const status = useQuery({ queryKey: keys.mfa, queryFn: authApi.mfaStatus, staleTime: 0 });
  const onQueryError = useCallback(
    (error: unknown) => {
      redirectOnGateError(error, router.replace, '/account/security');
    },
    [router],
  );
  return (
    <PasskeysPanel
      api={accountPasskeyApi}
      queryKey={keys.passkeys}
      mfaEnabled={status.data?.enabled}
      twoFactorHref="#two-factor"
      onQueryError={onQueryError}
    />
  );
}
