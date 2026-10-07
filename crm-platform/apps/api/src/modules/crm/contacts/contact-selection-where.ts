import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import type { ContactSelection } from '@crm/contracts';
import { contactConditions, whereOf } from './contact-conditions';
import { resolveContactFilter } from './contact-filter.resolver';

/**
 * The contacts a Contact Hub selection names (ticked ids, or the saved filter behind "select all matching" minus the rows un-ticked) as
 * a condition over `contacts`, resolved by the same function a bulk action uses. An id or filter value that points at nothing in the
 * workspace selects nobody (`false`). Record scope is not applied: the caller decides who may build the audience.
 */
export async function contactSelectionWhere(
  tx: Tx,
  orgId: number,
  selection: ContactSelection,
): Promise<SQL> {
  const idsMode = selection.ids !== undefined;
  const resolution = await resolveContactFilter(
    tx,
    orgId,
    idsMode ? { includeArchived: true } : (selection.filter ?? {}),
    { uuids: selection.ids, excludeUuids: selection.excludeIds },
  );
  if (resolution.empty) return sql`false`;
  return whereOf(contactConditions(orgId, resolution.filter, undefined));
}
