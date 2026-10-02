import {
  WSP_TIER_RANK,
  type WspMember,
  type WspMembersSummary,
  type WspPresence,
  type WspRoleRef,
  type WspRoleTier,
} from '@crm/contracts';

/** The filter pills, in WaDesk's order. `custom` (an organization's own role) is only offered when someone holds one. */
export const FILTER_TIERS = [
  'all',
  'owner',
  'admin',
  'manager',
  'agent',
  'viewer',
  'custom',
] as const;
export type FilterTier = (typeof FILTER_TIERS)[number];

/** The role dots of the filter pills and the role legend: one colour per tier, from the status palette. */
export const TIER_DOT: Record<WspRoleTier, string> = {
  owner: 'bg-primary',
  admin: 'bg-sky-600',
  manager: 'bg-violet-600',
  agent: 'bg-warning',
  viewer: 'bg-muted-foreground/50',
  custom: 'bg-foreground/50',
};

export const PRESENCE_DOT: Record<WspPresence, string> = {
  online: 'bg-success',
  away: 'bg-warning',
  busy: 'bg-danger',
  offline: 'bg-muted-foreground/40',
};

/** The pills to show: every tier WaDesk had, plus `custom` only when the workspace has such a role in use. */
export function visibleTiers(summary: WspMembersSummary | undefined): FilterTier[] {
  return FILTER_TIERS.filter((t) => t !== 'custom' || (summary?.counts.custom ?? 0) > 0);
}

/** `all` is not a tier, so it sends no filter. */
export function tierQuery(filter: FilterTier): WspRoleTier | undefined {
  return filter === 'all' ? undefined : filter;
}

/** The role the row shows: the one whose tier is the member's display tier, else the first. */
export function primaryRole(member: Pick<WspMember, 'roles' | 'tier'>): WspRoleRef | undefined {
  return member.roles.find((r) => r.tier === member.tier) ?? member.roles[0];
}

type Me = WspMembersSummary['me'];

function outranks(member: Pick<WspMember, 'tier'>, me: Me): boolean {
  return WSP_TIER_RANK[member.tier] > WSP_TIER_RANK[me.tier];
}

/** Who the caller may act on: never themselves, never someone of a higher tier. The server enforces the same. */
function isActionable(member: Pick<WspMember, 'id' | 'tier'>, me: Me): boolean {
  return member.id !== me.id && !outranks(member, me);
}

/** Role select (otherwise a read-only badge): needs the assign permission, and the owner's role is never changed here. */
export function canChangeRole(member: WspMember, me: Me): boolean {
  return me.canAssignRoles && !member.isOwner && isActionable(member, me);
}

export function canRemove(member: WspMember, me: Me): boolean {
  return me.canInvite && !member.isOwner && isActionable(member, me);
}

/** Reset password for someone who has an account; a pending invite is re-sent instead. */
export function canReset(member: WspMember, me: Me): boolean {
  return me.canInvite && member.status !== 'pending' && isActionable(member, me);
}

export function canResend(member: WspMember, me: Me): boolean {
  return me.canInvite && member.status === 'pending' && isActionable(member, me);
}

/** The options of a row's role select: what the caller may grant, plus the current role so the select still shows it. */
export function roleOptions(
  roles: WspMembersSummary['roles'],
  current: WspRoleRef | undefined,
): Array<WspRoleRef & { disabled: boolean }> {
  const out = roles
    .filter((r) => r.grantable)
    .map((r) => ({ id: r.id, name: r.name, tier: r.tier, disabled: false }));
  if (current && !out.some((r) => r.id === current.id)) out.unshift({ ...current, disabled: true });
  return out;
}

/** First letters of the first two words, upper-cased ("riya shah" -> "RS"); "?" for an empty name. */
export function initials(name: string): string {
  const letters = name
    .trim()
    .split(/\s+/)
    .map((w) => w[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return letters || '?';
}

/** The seats line next to the Invite button, or null when the plan has no cap. */
export function seatsLine(
  seats: WspMembersSummary['seats'] | undefined,
): { used: number; limit: number; full: boolean } | null {
  if (!seats || seats.limit === null) return null;
  return { used: seats.used, limit: seats.limit, full: seats.used >= seats.limit };
}
