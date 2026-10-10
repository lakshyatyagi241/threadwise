'use client';

import {
  passkeyItemSchema,
  passkeyListResponseSchema,
  webauthnOptionsResponseSchema,
} from '@crm/contracts';
import type { PasskeyApi } from '../../shared/passkeys/passkey-api';
import { PasskeysPanel } from '../../shared/passkeys/passkeys-panel';
import { operatorFetch } from '../operator-fetch';
import { OPERATOR_ACCOUNT_PATH } from '../operator-nav';

const operatorPasskeyApi: PasskeyApi = {
  list: () => operatorFetch('/auth/passkeys', { schema: passkeyListResponseSchema }),
  options: (password) =>
    operatorFetch('/auth/passkeys/options', {
      method: 'POST',
      body: password ? { password } : {},
      schema: webauthnOptionsResponseSchema,
    }),
  register: (body) =>
    operatorFetch('/auth/passkeys', { method: 'POST', body, schema: passkeyItemSchema }),
  remove: async (id, password) => {
    await operatorFetch(`/auth/passkeys/${encodeURIComponent(id)}/remove`, {
      method: 'POST',
      body: { password },
    });
  },
};

/**
 * The operator's passkeys, on the same security screen as the authenticator app. Shown once two-factor is on (a
 * passkey is a second factor beside the app, so the app comes first); the console proxy attaches the session.
 */
export function OperatorPasskeys() {
  return (
    <PasskeysPanel
      api={operatorPasskeyApi}
      queryKey={['operator', 'passkeys']}
      mfaEnabled
      twoFactorHref={OPERATOR_ACCOUNT_PATH}
    />
  );
}
