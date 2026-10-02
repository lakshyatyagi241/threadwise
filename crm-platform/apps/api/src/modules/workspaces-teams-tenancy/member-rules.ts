import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES, WSP_TIER_RANK, type WspRoleTier } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';

/**
 * Reference's five workspace tiers, read from the RBAC domain's presets (TW-WSP-020 rule 4, TW-WSP-046).
 *
 * There is one role model: the five preset roles of `provision_workspace_presets` (system_key `admin` shown as "Owner",
 * `workspace_admin`, `manager`, `agent`, `viewer`) plus whatever custom roles an organization made. WHO may hand out WHICH
 * role (the ladder, owner-only grants, no self change, keeping an Owner) is `WorkspaceRoleRulesService`'s; this file only
 * names a role's tier for display and holds the two member-lifecycle rules WSP adds on top: nobody removes, resets or
 * re-invites a member who outranks them, and only an Owner resets an Owner's password.
 */
export interface RoleFacts {
  systemKey: string | null;
}

/** The tier of one role: its preset by `system_key`, or `custom` for a role without one (or with a key this domain does not know). */
export function tierOfRole(role: RoleFacts): WspRoleTier {
  switch (role.systemKey) {
    case 'admin':
      return 'owner';
    case 'workspace_admin':
      return 'admin';
    case 'manager':
      return 'manager';
    case 'agent':
      return 'agent';
    case 'viewer':
      return 'viewer';
    default:
      return 'custom';
  }
}

export const rankOf = (tier: WspRoleTier): number => WSP_TIER_RANK[tier];

export interface Actor {
  tier: WspRoleTier;
}

/** Nobody acts on a member who outranks them (Reference's missing check, TW-WSP-017 rule 4). Equal rank is allowed. */
export function assertCanActOn(actor: Actor, target: { tier: WspRoleTier }): void {
  if (rankOf(target.tier) <= rankOf(actor.tier)) return;
  throw new AppError(
    ERROR_CODES.WSP_CANNOT_ACT_ON_HIGHER_RANK,
    "You can't change a member who has a higher role than yours.",
    HttpStatus.FORBIDDEN,
  );
}
