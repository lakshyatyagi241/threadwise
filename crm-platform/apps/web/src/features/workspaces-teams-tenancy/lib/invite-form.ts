import {
  WSP_MEMBER_NAME_MAX,
  inviteWspMemberSchema,
  type InviteWspMemberInput,
  type WspMembersSummary,
  type WspRoleTier,
} from '@crm/contracts';

export interface InviteForm {
  fullName: string;
  email: string;
  roleId: string;
}

export type InviteErrors = Partial<
  Record<'fullName' | 'email', 'required' | 'tooLong' | 'invalid'>
>;

/** WaDesk's dropdown order: Agent first (the default), then Manager, Admin, Viewer, Owner. Custom roles last. */
const OPTION_ORDER: readonly WspRoleTier[] = [
  'agent',
  'manager',
  'admin',
  'viewer',
  'owner',
  'custom',
];

/** The roles the caller may hand out, in dropdown order. */
export function grantableRoles(roles: WspMembersSummary['roles']): WspMembersSummary['roles'] {
  return roles
    .filter((r) => r.grantable)
    .sort((a, b) => OPTION_ORDER.indexOf(a.tier) - OPTION_ORDER.indexOf(b.tier));
}

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
