'use client';

import { useSyncExternalStore } from 'react';

const noop = () => () => undefined;

/** The origin the page is served from (a custom domain keeps its own); empty on the server render, so hydration matches. */
export function useOrigin(): string {
  return useSyncExternalStore(
    noop,
    () => window.location.origin,
    () => '',
  );
}
