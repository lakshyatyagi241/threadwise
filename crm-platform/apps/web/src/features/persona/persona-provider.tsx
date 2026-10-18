'use client';

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { PersonaView } from '@crm/contracts';
import { personaVisibility, type PersonaVisibility } from './visibility';

/**
 * The workspace's persona view, read once by the workspace layout from the session (`org.persona`) and handed to client components.
 * Screens that decide what to draw inside another screen (the tabs of a contact, the cards of Home) use `usePersonaVisibility` instead
 * of reading the session or spelling module ids themselves, so there is one place to look when a module is hidden.
 *
 * Hiding is not locking: the server is untouched, no route is closed, and entitlement is still applied afterwards. With no provider
 * mounted, or no view, nothing is hidden (the same stance `PlanFeaturesProvider` takes).
 */
const PersonaContext = createContext<PersonaView | null>(null);

export function PersonaProvider({
  view,
  children,
}: {
  view: PersonaView | null | undefined;
  children: ReactNode;
}) {
  return <PersonaContext.Provider value={view ?? null}>{children}</PersonaContext.Provider>;
}

/** What the persona hides, with a typed check per kind of module. Stable between renders for the same view. */
export function usePersonaVisibility(): PersonaVisibility {
  const view = useContext(PersonaContext);
  return useMemo(() => personaVisibility(view), [view]);
}
