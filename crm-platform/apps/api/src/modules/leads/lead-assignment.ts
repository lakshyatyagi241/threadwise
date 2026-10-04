import type { LeadOwnerRule } from '@crm/contracts';

export interface OwnerPick<T> {
  /** The user the lead goes to; null when nobody can take it. */
  pick: T | null;
  /** The cursor to store for the next lead (unchanged unless the rule is round robin). */
  nextCursor: number;
}

/**
 * Who a lead is assigned to (spec L-07). Contacts and deals had no auto-assignment before this, so this is the minimum, not an engine:
 *  - unassigned: nobody;
 *  - fixed: the one user, when they are still an active member;
 *  - round robin: the active listed users in turn. The cursor only ever increases; it is taken modulo the number of users who can take
 *    the lead right now, so a user who leaves or is deactivated just drops out of the rotation and nobody is skipped twice in a row.
 *
 * `active` is the rule's `userIds` that are active members of the workspace, in the rule's order (the caller resolves them).
 */
export function pickOwner<T>(
  rule: Pick<LeadOwnerRule, 'mode'>,
  active: readonly T[],
  cursor: number,
): OwnerPick<T> {
  if (rule.mode === 'unassigned' || active.length === 0) return { pick: null, nextCursor: cursor };
  if (rule.mode === 'fixed') return { pick: active[0] ?? null, nextCursor: cursor };
  const index = ((cursor % active.length) + active.length) % active.length;
  return { pick: active[index] ?? null, nextCursor: cursor + 1 };
}
