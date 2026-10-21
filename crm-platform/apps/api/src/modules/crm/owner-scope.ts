import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES, isTeamScope, type RecordScope } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';

/**
 * The record scope applies to WHO a record may be handed to, not only to which records the caller reaches (AZ-007).
 * Without it an `own`-scope member could reassign their own record to a colleague (or create one owned by a colleague) and
 * the record would vanish from their view.
 *
 *  - `all`:  anyone in the workspace (the caller has already checked the target is an active member).
 *  - `team`: the caller or a user who shares a team with them; nobody (null) would hide the record, so it is refused.
 *  - `team_and_below`: the same, and a user in a team under one of the caller's teams (`inActorTeam` gets `below = true`).
 *  - `own`:  only the caller; nobody (null) is refused for the same reason.
 *
 * Callers invoke it only when the owner/assignee CHANGES (keeping the current one is always allowed) and pass the scope
 * of the permission that governs the write. A caller without grants (a system actor) is not scoped.
 */
export async function assertOwnerWithinScope(args: {
  scope: RecordScope;
  actorUserId: number | null | undefined;
  nextOwnerId: number | null;
  inActorTeam: (userId: number, below: boolean) => Promise<boolean>;
  path: 'ownerId' | 'assigneeId';
}): Promise<void> {
  const { scope, actorUserId, nextOwnerId, inActorTeam, path } = args;
  if (scope === 'all' || !actorUserId) return;
  if (nextOwnerId === actorUserId) return;
  if (
    isTeamScope(scope) &&
    nextOwnerId !== null &&
    (await inActorTeam(nextOwnerId, scope === 'team_and_below'))
  )
    return;
  throw new AppError(
    ERROR_CODES.FORBIDDEN,
    'Your record scope does not allow assigning this record to that user.',
    HttpStatus.FORBIDDEN,
    [{ path, message: 'outside your record scope' }],
  );
}
