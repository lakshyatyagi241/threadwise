import type { PersonaView } from '@crm/contracts';
import { MODULE_CATALOG } from '@/features/_registry/module-catalog.generated';
import { hiddenSetFor } from './visibility';

const CATALOG_IDS: readonly string[] = MODULE_CATALOG.map((entry) => entry.id);

/**
 * `Capabilities.hidden` for a signed-in session: the ids of the generated module catalog (every menu entry, Settings tile, contact tab,
 * Home card and contact action the app has) that the workspace's persona hides. The layout and the Help pages both call this, so the
 * menu, the Settings tiles and Help can never disagree about what is hidden.
 *
 * Server side only (it pulls in the whole generated catalog; client components use `usePersonaVisibility` from the barrel).
 * `null` when the session carries no persona view (nothing is known: nothing is hidden). The `generic` persona gives an empty set.
 */
export function personaHiddenIds(view: PersonaView | null | undefined): ReadonlySet<string> | null {
  return hiddenSetFor(view, CATALOG_IDS);
}
