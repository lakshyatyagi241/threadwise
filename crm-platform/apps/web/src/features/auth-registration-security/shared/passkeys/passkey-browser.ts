'use client';

import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import type { WebauthnCredentialJson, WebauthnOptionsResponse } from '@crm/contracts';
import { useSyncExternalStore } from 'react';

/**
 * The browser half of a passkey ceremony. The API owns the options and verifies the answer
 * (`@simplewebauthn/server`); this file only hands the options to `navigator.credentials` and returns the JSON.
 */

/** Ask the browser to make a passkey from the registration options the API returned. */
export async function createPasskey(
  options: WebauthnOptionsResponse,
): Promise<WebauthnCredentialJson> {
  const response = await startRegistration({
    optionsJSON: options as unknown as PublicKeyCredentialCreationOptionsJSON,
  });
  return response as unknown as WebauthnCredentialJson;
}

/** Ask the browser to prove possession of a registered passkey from the sign-in options the API returned. */
export async function assertPasskey(
  options: WebauthnOptionsResponse,
): Promise<WebauthnCredentialJson> {
  const assertion = await startAuthentication({
    optionsJSON: options as unknown as PublicKeyCredentialRequestOptionsJSON,
  });
  return assertion as unknown as WebauthnCredentialJson;
}

const noSubscription = () => () => undefined;

/**
 * Whether this browser can do WebAuthn at all. The server render assumes yes, so the first paint matches the
 * common case and the real answer replaces it after hydration (no mismatch warning).
 */
export function usePasskeySupport(): boolean {
  return useSyncExternalStore(noSubscription, browserSupportsWebAuthn, () => true);
}
