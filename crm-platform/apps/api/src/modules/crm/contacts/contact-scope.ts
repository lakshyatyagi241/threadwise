import type { RecordScope } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AppError } from '../../../common/errors/app-error';
import type { ContactsRepository } from './contacts.repository';

/**
 * Enforces a granted record scope ('all' | 'own' | 'team') against a
 * contact's owner. Used both by ContactsController's own single-record
 * routes and by every contact detail-tab sub-resource (notes/files/
 * activities/meetings) that reuses record.contacts.read/update — none of
 * those apply scope on their own, so without this an 'own'-scoped grant
 * would let the caller reach any contact's data by uuid, not just their own.
 *
 * A scope failure throws AppError.notFound, not forbidden — matching how
 * RLS treats a tenant-scope miss: never reveal that a record exists to a
 * caller whose grant doesn't cover it.
 */
/** The people on a contact that record scope looks at: who owns it and who created it (BL-380, decision D1). */
export interface ContactPeople {
  ownerId: number | null;
  createdBy: number | null;
}

export async function assertContactScope(
  tx: Tx,
  contactsRepo: ContactsRepository,
  orgId: number,
  scope: RecordScope,
  actorUserId: number,
  contact: ContactPeople,
): Promise<void> {
  // The same rule `contactScopeCondition` applies to a list (D1: the creator counts like the owner), so a row that is in the
  // list can always be opened and a row that is not cannot.
  for (const person of [contact.ownerId, contact.createdBy]) {
    if (person === null) continue;
    if (scope === 'all' || person === actorUserId) return;
    if (
      scope === 'team' &&
      (await contactsRepo.isOwnerInActorTeam(tx, orgId, actorUserId, person))
    ) {
      return;
    }
  }
  if (scope === 'all') return;
  throw AppError.notFound('Contact');
}
