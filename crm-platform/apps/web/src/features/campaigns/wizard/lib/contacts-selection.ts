import { WIZARD_CONTACTS_MAX, type SegmentGroup, type WizardAudience } from '@crm/contracts';

/**
 * The contacts table's selection, as pure functions over the draft's audience. The selection is two things that add up on the
 * server: contacts ticked one by one (`contactIds`), and "all N matching" (`allMatching`: the search and conditions frozen when it was
 * chosen) minus the contacts un-ticked after it (`excludedContactIds`).
 *
 * "All matching" only governs the rows the table shows while the table shows the same search and conditions it was chosen with;
 * under a different view the rows reflect the ticked contacts alone (the frozen selection is still part of the audience, and a banner
 * says so), so a checkbox never claims a contact is selected that the server would not message.
 */

export interface TableView {
  search: string;
  rules: SegmentGroup | null;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The frozen "all matching" is what the table is showing now. */
export function coversView(a: WizardAudience, view: TableView): boolean {
  return (
    a.allMatching !== null &&
    (a.allMatching.search ?? '') === view.search.trim() &&
    same(a.allMatching.rules, view.rules)
  );
}

export function contactSelected(a: WizardAudience, id: string, view: TableView): boolean {
  if (a.contactIds.includes(id)) return true;
  return coversView(a, view) && !a.excludedContactIds.includes(id);
}

type Patch = Pick<WizardAudience, 'contactIds' | 'excludedContactIds'>;

const without = (xs: readonly string[], drop: ReadonlySet<string>) =>
  xs.filter((x) => !drop.has(x));

/** Ticks or un-ticks some rows (the whole page, or one row). Ticking past the limit stops at the limit. */
export function setContacts(
  a: WizardAudience,
  ids: readonly string[],
  select: boolean,
  view: TableView,
): { patch: Patch; limited: boolean } {
  const set = new Set(ids);
  const covers = coversView(a, view);
  if (!select) {
    return {
      patch: {
        contactIds: without(a.contactIds, set),
        excludedContactIds: covers
          ? [...a.excludedContactIds, ...ids.filter((id) => !a.excludedContactIds.includes(id))]
          : a.excludedContactIds,
      },
      limited: false,
    };
  }
  const excluded = without(a.excludedContactIds, set);
  // A row all-matching covers is selected again by no longer being excluded; every other row is ticked.
  const covered = (id: string) => covers && a.excludedContactIds.includes(id);
  const have = new Set(a.contactIds);
  const toAdd = ids.filter((id) => !have.has(id) && !covered(id));
  const room = Math.max(0, WIZARD_CONTACTS_MAX - a.contactIds.length);
  return {
    patch: { contactIds: [...a.contactIds, ...toAdd.slice(0, room)], excludedContactIds: excluded },
    limited: toAdd.length > room,
  };
}

/** "Select all N matching": freezes the table's search and conditions as the selection. The ticks it covers are dropped. */
export function selectAllMatching(
  view: TableView,
): Pick<WizardAudience, 'allMatching' | 'contactIds' | 'excludedContactIds'> {
  return {
    allMatching: { search: view.search.trim() || null, rules: view.rules },
    contactIds: [],
    excludedContactIds: [],
  };
}

export const clearContacts = (): Pick<
  WizardAudience,
  'allMatching' | 'contactIds' | 'excludedContactIds'
> => ({ allMatching: null, contactIds: [], excludedContactIds: [] });

/** Every row of the page (the ones that can be selected) is ticked. */
export function pageAllSelected(
  a: WizardAudience,
  ids: readonly string[],
  view: TableView,
): boolean {
  return ids.length > 0 && ids.every((id) => contactSelected(a, id, view));
}

export const hasContactSelection = (a: WizardAudience): boolean =>
  a.contactIds.length > 0 || a.allMatching !== null;
