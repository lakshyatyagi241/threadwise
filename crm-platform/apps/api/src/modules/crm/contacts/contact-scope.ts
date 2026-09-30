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
export async function assertContactScope(
  tx: Tx,
  contactsRepo: ContactsRepository,
  orgId: number,
  scope: RecordScope,
  actorUserId: number,
  ownerId: number | null,
): Promise<void> {
  if (scope === 'all') return;
  if (scope === 'own') {
    if (ownerId !== actorUserId) throw AppError.notFound('Contact');
    return;
  }
  if (
    ownerId === null ||
    !(await contactsRepo.isOwnerInActorTeam(tx, orgId, actorUserId, ownerId))
  ) {
    throw AppError.notFound('Contact');
  }
}
