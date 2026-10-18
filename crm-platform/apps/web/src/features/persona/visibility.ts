import { hiddenModuleIds, isModuleHidden, moduleId, type PersonaView } from '@crm/contracts';

/**
 * Persona visibility, the web side (docs/specs/persona-profiles.md, sections 6 and 7.2). The session carries the workspace's resolved
 * `org.persona` (`PersonaView`: a default and the ids that differ from it). Everything in this file is pure and reads only that view,
 * so the shell, the hooks and the tests agree by construction.
 *
 * A persona decides what is DRAWN, never what is allowed: nothing here reads a permission, a plan or an add-on, and nothing closes a
 * route. Entitlement (role, channel, app, plan feature) is applied after it, unchanged, and wins.
 *
 * Unknown means "show everything": a session without `org.persona` (no row, a failed read, an older API) is `null`, and `null` hides
 * nothing. The `generic` persona is the same thing spelled out (default `show`, no entries).
 */

/** The ids of `catalog` the persona hides: what the layout puts in `Capabilities.hidden`. `null` when nothing is known. */
export function hiddenSetFor(
  view: PersonaView | null | undefined,
  catalog: Iterable<string>,
): ReadonlySet<string> | null {
  if (!view) return null;
  return hiddenModuleIds(view, catalog);
}

/** The one question every consumer asks. `null` or `undefined` view: not hidden. */
export function isHiddenBy(view: PersonaView | null | undefined, id: string): boolean {
  return isModuleHidden(view, id);
}

/** Whether the operator locked this id ("set by your account team"): a workspace cannot reveal it. */
export function isLockedBy(view: PersonaView | null | undefined, id: string): boolean {
  return view?.modules[id]?.locked === true;
}

/**
 * Typed shortcuts over the module ids, so no component spells `'section:contact.' + x` by hand. Each takes the bare registry name
 * (`'deals'`, `'meeting'`) and builds the catalog id with `moduleId`, the same function the generated catalog uses.
 */
export interface PersonaVisibility {
  /** The persona key (`generic`...), or `null` when the session carries none. */
  key: string | null;
  /** The workspace's "Show more modules" switch. */
  showAll: boolean;
  /** One-seat simplification, as resolved by the API. Carried for later phases; nothing in phase 1 reads it. */
  solo: boolean;
  /** Any module id (`nav:inbox`, `tile:booking-types`, `section:contact.meetings`, `card:dashboard.inbox`, `action:contact.meeting`). */
  isHidden: (id: string) => boolean;
  /** A menu entry by its registry id. */
  isNavHidden: (id: string) => boolean;
  /** A Settings tile by its registry id. */
  isTileHidden: (id: string) => boolean;
  /** A tab of the contact page by its section id (`SectionId`). */
  isSectionHidden: (id: string) => boolean;
  /** A Home card by its id (`home-cards.ts`). */
  isCardHidden: (id: string) => boolean;
  /** A contact action-bar button by its `AddTarget` (`note`, `task`, `meeting`, `company`, `call`, `score`). */
  isActionHidden: (id: string) => boolean;
}

/** Nothing hidden: what a missing provider, a missing view and the `generic` persona all give. */
export function personaVisibility(view: PersonaView | null | undefined): PersonaVisibility {
  const isHidden = (id: string) => isHiddenBy(view, id);
  return {
    key: view?.key ?? null,
    showAll: view?.showAll ?? false,
    solo: view?.solo ?? false,
    isHidden,
    isNavHidden: (id) => isHidden(moduleId('nav', id)),
    isTileHidden: (id) => isHidden(moduleId('tile', id)),
    isSectionHidden: (id) => isHidden(moduleId('section', id)),
    isCardHidden: (id) => isHidden(moduleId('card', id)),
    isActionHidden: (id) => isHidden(moduleId('action', id)),
  };
}
