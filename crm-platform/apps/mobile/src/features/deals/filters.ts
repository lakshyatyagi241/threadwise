import { DEAL_SOURCES, type DealSource, type DealStatus } from '@crm/contracts';
import type { DealFilters } from './api';

export { DEAL_SOURCES };

export const STATUS_CHOICES: readonly DealStatus[] = ['open', 'won', 'lost'];

/** The owner choices that are not a person: everyone's deals (nothing picked), the caller's own, and deals with no owner. */
export const OWNER_MINE = 'mine';
export const OWNER_NONE = 'none';

/**
 * What the person picked in the filter sheet. A group left out filters nothing. `owner` is `mine`, `none` (no owner) or a member's
 * id; `status` applies to the list view only (the board's columns are the statuses).
 */
export interface DealChoices {
  owner?: string;
  source?: DealSource;
  status?: DealStatus;
}

export const NO_CHOICES: DealChoices = {};

/** The API's longest search text; more is cut off here instead of refused there. */
const SEARCH_MAX = 100;

/** The query the API takes for the choices and the words typed in the search box. */
export function filtersOf(choices: DealChoices, q: string, myId: string | undefined): DealFilters {
  const words = q.trim().slice(0, SEARCH_MAX);
  let owner: Pick<DealFilters, 'ownerId' | 'unassigned'> = {};
  if (choices.owner === OWNER_NONE) owner = { unassigned: true };
  else if (choices.owner === OWNER_MINE) owner = myId ? { ownerId: myId } : {};
  else if (choices.owner) owner = { ownerId: choices.owner };
  return {
    ...(words ? { q: words } : {}),
    ...owner,
    ...(choices.source ? { source: choices.source } : {}),
  };
}

/** How many groups are narrowing the deals (the dot on the filter button). `status` counts only where it applies. */
export function activeChoiceCount(choices: DealChoices, listView: boolean): number {
  return (choices.owner ? 1 : 0) + (choices.source ? 1 : 0) + (listView && choices.status ? 1 : 0);
}
