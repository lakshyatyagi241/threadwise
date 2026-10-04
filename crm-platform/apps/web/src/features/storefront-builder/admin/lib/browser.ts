'use client';

import { useSyncExternalStore } from 'react';

const noSubscription = () => () => undefined;

/** `window.location.origin` once in the browser, an empty string while rendering on the server (no hydration mismatch). */
export function useOrigin(): string {
  return useSyncExternalStore(
    noSubscription,
    () => window.location.origin,
    () => '',
  );
}

/** True when the browser has the share sheet (`navigator.share`); false on the server and on desktop browsers without it. */
export function useCanNativeShare(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => typeof navigator.share === 'function',
    () => false,
  );
}
