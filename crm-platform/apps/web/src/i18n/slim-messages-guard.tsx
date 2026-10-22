'use client';

import { usePathname } from 'next/navigation';
import { useMessages } from 'next-intl';
import { useEffect } from 'react';
import { SLIM_MARKER, profileFor } from './message-profiles';

const RELOADED_KEY = 'crm.slim-messages.reloaded';

/**
 * The safety net for the reduced message set (see message-profiles.ts). The root layout is not rendered again on a client-side
 * navigation, so a visitor who arrived on a public page and then navigates into the app keeps the public set, and the app would show
 * message keys instead of text. When the set is the reduced one and the page is not a public page, reload once: the full page load
 * brings the whole catalogue. Nothing changes for anyone who arrived on a page that needs the whole catalogue.
 */
export function SlimMessagesGuard({
  reload = () => window.location.reload(),
}: {
  reload?: () => void;
}) {
  const messages = useMessages() as Record<string, unknown>;
  const path = usePathname();
  const slim = messages[SLIM_MARKER] !== undefined;
  useEffect(() => {
    if (!slim || profileFor(path) !== null) return;
    try {
      // one try per page: if the reload somehow comes back reduced again, stop rather than loop
      if (sessionStorage.getItem(RELOADED_KEY) === path) return;
      sessionStorage.setItem(RELOADED_KEY, path);
    } catch {
      /* storage blocked: reload anyway, once per mount */
    }
    reload();
  }, [slim, path, reload]);
  return null;
}
