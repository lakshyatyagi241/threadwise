import {
  WSP_TIER_RANK,
  inviteWspMemberSchema,
  WSP_MEMBER_NAME_MAX,
  type InviteWspMemberInput,
  type WspMember,
  type WspMembersSummary,
  type WspRoleRef,
  type WspRoleTier,
} from '@crm/contracts';

/** The filter chips, in the web's order. `custom` (an organization's own role) is offered only when someone holds one. */
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

export function visibleTiers(summary: WspMembersSummary | undefined): FilterTier[] {
  return FILTER_TIERS.filter((t) => t !== 'custom' || (summary?.counts.custom ?? 0) > 0);
}

/** `all` is not a tier, so it sends no filter. */
export const tierQuery = (filter: FilterTier): WspRoleTier | undefined =>
  filter === 'all' ? undefined : filter;

/** The role the row shows: the one whose tier is the member's display tier, else the first. */
export function primaryRole(member: Pick<WspMember, 'roles' | 'tier'>): WspRoleRef | undefined {
  return member.roles.find((r) => r.tier === member.tier) ?? member.roles[0];
}

type Me = WspMembersSummary['me'];

const outranks = (member: Pick<WspMember, 'tier'>, me: Me): boolean =>
  WSP_TIER_RANK[member.tier] > WSP_TIER_RANK[me.tier];

/** Who the caller may act on: never themselves, never someone of a higher tier (the role ladder). The server enforces the same. */
const isActionable = (member: Pick<WspMember, 'id' | 'tier'>, me: Me): boolean =>
  member.id !== me.id && !outranks(member, me);

/** Changing a role needs the assign right; an Owner's role is changed by another Owner only (the server keeps at least one). */
export const canChangeRole = (member: WspMember, me: Me): boolean =>
  me.canAssignRoles && (!member.isOwner || me.tier === 'owner') && isActionable(member, me);

export const canRemove = (member: WspMember, me: Me): boolean =>
  me.canInvite && !member.isOwner && isActionable(member, me);

/** A password reset is for someone who has an account; a pending invite is sent again instead. */
export const canReset = (member: WspMember, me: Me): boolean =>
  me.canInvite && member.status !== 'pending' && isActionable(member, me);

export const canResend = (member: WspMember, me: Me): boolean =>
  me.canInvite && member.status === 'pending' && isActionable(member, me);

/** Whether any action at all is open for this row (the dots are shown only then). */
export const hasActions = (member: WspMember, me: Me): boolean =>
  canChangeRole(member, me) ||
  canRemove(member, me) ||
  canReset(member, me) ||
  canResend(member, me);

/** The options of the role choice: what the caller may grant, plus the current role so it still shows (but cannot be picked again). */
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

const OPTION_ORDER: readonly WspRoleTier[] = [
  'agent',
  'manager',
  'admin',
  'viewer',
  'owner',
  'custom',
];

/** The roles an invitation may give, in the order the invite form lists them. */
export const grantableRoles = (roles: WspMembersSummary['roles']): WspMembersSummary['roles'] =>
  roles
    .filter((r) => r.grantable)
    .sort((a, b) => OPTION_ORDER.indexOf(a.tier) - OPTION_ORDER.indexOf(b.tier));

/** The seats line next to the invite button, or null when the plan has no cap. */
export function seatsLine(
  seats: WspMembersSummary['seats'] | undefined,
): { used: number; limit: number; full: boolean } | null {
  if (!seats || seats.limit === null) return null;
  return { used: seats.used, limit: seats.limit, full: seats.used >= seats.limit };
}

export interface InviteForm {
  fullName: string;
  email: string;
  roleId: string;
}

export interface InviteErrors {
  fullName?: 'required' | 'tooLong';
  email?: 'required' | 'invalid';
}

/** The invite as the server will read it, or what is wrong, field by field (the contract's own rules). */
export function validateInvite(
  form: InviteForm,
): { input: InviteWspMemberInput } | { errors: InviteErrors } {
  const parsed = inviteWspMemberSchema.safeParse({
    fullName: form.fullName,
    email: form.email.trim(),
    roleId: form.roleId,
  });
  if (parsed.success) return { input: parsed.data };
  const errors: InviteErrors = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if (field !== 'fullName' && field !== 'email') continue;
    if (errors[field]) continue;
    if (field === 'email') errors.email = form.email.trim() === '' ? 'required' : 'invalid';
    else
      errors.fullName = form.fullName.trim().length > WSP_MEMBER_NAME_MAX ? 'tooLong' : 'required';
  }
  return { errors };
}
