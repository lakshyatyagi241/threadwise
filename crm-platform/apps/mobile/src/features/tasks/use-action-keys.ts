import * as Crypto from 'expo-crypto';
import { useRef } from 'react';
import { isApiError } from '@/lib/api';

/**
 * Idempotency keys, one per user action. An action is named by a signature ("complete:<task>:<version>"): the same tap repeated
 * after a lost connection is the same request and reuses its key, while a different task or a corrected form is a new request.
 * Any answer from the server ends the action and its key is forgotten.
 */
export function useActionKeys() {
  const keys = useRef(new Map<string, string>());
  return {
    keyFor: (signature: string): string => {
      const known = keys.current.get(signature);
      if (known) return known;
      const fresh = Crypto.randomUUID();
      keys.current.set(signature, fresh);
      return fresh;
    },
    done: (signature: string) => void keys.current.delete(signature),
    failed: (signature: string, error: unknown) => {
      if (!(isApiError(error) && error.isConnectivity)) keys.current.delete(signature);
    },
  };
}
