'use client';

import { useSyncExternalStore } from 'react';

const noopSubscribe = () => () => undefined;

/** False while rendering on the server and during hydration, true afterwards (browser-only data such as ICU names). */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
