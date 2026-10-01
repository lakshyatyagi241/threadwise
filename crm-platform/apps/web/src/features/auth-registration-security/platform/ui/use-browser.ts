'use client';

import { useSyncExternalStore } from 'react';

/** The console theme lives on <html data-theme>; this follows it without copying it into component state. */
function subscribeTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}
const readTheme = (): 'light' | 'dark' =>
  document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

export function useDocumentTheme(): 'light' | 'dark' {
  return useSyncExternalStore(subscribeTheme, readTheme, () => 'light');
}

const noopSubscribe = () => () => undefined;

/** The page origin ("https://crm.example.com"), empty on the server. */
export function useOrigin(): string {
  return useSyncExternalStore(
    noopSubscribe,
    () => window.location.origin,
    () => '',
  );
}
