'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { HelpIndexEntry } from './types';

const HelpContext = createContext<readonly HelpIndexEntry[]>([]);

/**
 * Hands the docs this person may see (gates applied on the server, no bodies) to the page-level tip and to every `HelpTip`.
 * A tip whose doc is not in the list renders nothing, which is how tips disappear with their doc.
 */
export function HelpProvider({
  entries,
  children,
}: {
  entries: readonly HelpIndexEntry[];
  children: ReactNode;
}) {
  return <HelpContext.Provider value={entries}>{children}</HelpContext.Provider>;
}

export function useHelpEntries(): readonly HelpIndexEntry[] {
  return useContext(HelpContext);
}

export function useHelpEntry(id: string): HelpIndexEntry | undefined {
  return useContext(HelpContext).find((entry) => entry.id === id);
}
