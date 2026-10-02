import { HttpStatus } from '@nestjs/common';
import { ERROR_CODES, WSP_TIER_RANK, type WspRoleTier } from '@crm/contracts';
import { AppError } from '../../common/errors/app-error';

/**
 * WaDesk's five workspace roles as a rank model on top of RBAC v3 (WD-WSP-020 rule 4, WD-WSP-046).
 *
 * RBAC decides what a person may DO; these rules decide who may act on WHOM and which role may be handed out. A member's
 * tier is `owner` when they are the organization's owner (`organizations.settings.ownerUserId`), otherwise the highest of
 * their roles: the Admin, Manager and Viewer presets by `system_key` (`admin`, `manager`, `readonly`), the Agent preset by
 * its name (it carries no system key), and any role an organization made itself reads as `custom` and ranks like an agent.
 */
export interface RoleFacts {
  systemKey: string | null;
  name: string;
}

/** Display order of tiers that share a rank: the named preset reads before a custom role. */
const TIER_ORDER: WspRoleTier[] = ['owner', 'admin', 'manager', 'agent', 'custom', 'viewer'];

export function tierOfRole(role: RoleFacts): WspRoleTier {
  switch (role.systemKey) {
    case 'admin':
      return 'admin';
    case 'manager':
      return 'manager';
    case 'readonly':
      return 'viewer';
    case 'agent':
      return 'agent';
    default:
      return role.systemKey === null && role.name.trim().toLowerCase() === 'agent'
        ? 'agent'
        : 'custom';
  }
}

/** The tier a member ranks as: the owner, else their highest role. No role at all reads `custom`. */
export function memberTier(isOwner: boolean, roles: RoleFacts[]): WspRoleTier {
  if (isOwner) return 'owner';
  if (roles.length === 0) return 'custom';
  let best: WspRoleTier = 'viewer';
  let bestRank = -1;
  for (const role of roles) {
    const tier = tierOfRole(role);
    const rank = WSP_TIER_RANK[tier];
    if (
      rank > bestRank ||
      (rank === bestRank && TIER_ORDER.indexOf(tier) < TIER_ORDER.indexOf(best))
    ) {
      best = tier;
      bestRank = rank;
    }
  }
  return best;
}

export const rankOf = (tier: WspRoleTier): number => WSP_TIER_RANK[tier];

export interface Actor {
  tier: WspRoleTier;
}

/**
 * May `actor` hand out a role of `roleTier`? Only the owner grants Admin (no admin to admin chains), nobody grants above
 * their own rank, and Owner is never grantable (ownership is a property of the organization, not a role).
 */
export function canGrantRole(actor: Actor, roleTier: WspRoleTier): boolean {
  if (roleTier === 'owner') return false;
  if (roleTier === 'admin') return actor.tier === 'owner';
  return rankOf(actor.tier) >= rankOf(roleTier);
}

export function assertCanGrantRole(actor: Actor, roleTier: WspRoleTier, roleName: string): void {
  if (canGrantRole(actor, roleTier)) return;
  throw new AppError(
    ERROR_CODES.WSP_CANNOT_GRANT_ROLE,
    `You don't have permission to grant the ${roleName} role.`,
    HttpStatus.FORBIDDEN,
  );
}

/** Nobody acts on a member who outranks them (WaDesk's missing check, WD-WSP-017 rule 4). Equal rank is allowed. */
export function assertCanActOn(actor: Actor, target: { tier: WspRoleTier }): void {
  if (rankOf(target.tier) <= rankOf(actor.tier)) return;
  throw new AppError(
    ERROR_CODES.WSP_CANNOT_ACT_ON_HIGHER_RANK,
    "You can't change a member who has a higher role than yours.",
    HttpStatus.FORBIDDEN,
  );
}

/** The roles a caller may hand out, for the invite and role pickers (`grantableRolesFor`). */
export const grantableTiers = (actor: Actor): WspRoleTier[] =>
  TIER_ORDER.filter((tier) => canGrantRole(actor, tier));
