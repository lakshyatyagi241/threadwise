import {
  WSP_CHAT_LIMIT_DEFAULT,
  WSP_MEMBER_NAME_MAX,
  inviteWspMemberSchema,
  type InviteWspMemberInput,
  type WspMembersSummary,
  type WspRoleTier,
} from '@crm/contracts';
import { parseChatLimit, parsePhone } from './details-form';

export interface InviteForm {
  fullName: string;
  email: string;
  roleId: string;
  phone: string;
  /** Digits as typed; Waboo's Add User form starts at 4, empty = no limit. */
  chatLimit: string;
}

export const blankInvite = (roleId: string): InviteForm => ({
  fullName: '',
  email: '',
  roleId,
  phone: '',
  chatLimit: String(WSP_CHAT_LIMIT_DEFAULT),
});

export type InviteErrors = Partial<
  Record<'fullName' | 'email' | 'phone' | 'chatLimit', 'required' | 'tooLong' | 'invalid'>
>;

/** Reference's dropdown order: Agent first (the default), then Manager, Admin, Viewer, Owner. Custom roles last. */
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
  const phone = parsePhone(form.phone);
  const chatLimit = parseChatLimit(form.chatLimit);
  const parsed = inviteWspMemberSchema.safeParse({
    fullName: form.fullName,
    email: form.email.trim(),
    roleId: form.roleId,
    ...(phone !== undefined ? { phone } : {}),
    ...(chatLimit !== undefined ? { chatLimit } : {}),
  });
  const errors: InviteErrors = {};
  if (phone === undefined) errors.phone = 'invalid';
  if (chatLimit === undefined) errors.chatLimit = 'invalid';
  if (parsed.success && Object.keys(errors).length === 0) return { input: parsed.data };
  for (const issue of parsed.success ? [] : parsed.error.issues) {
    const field = issue.path[0];
    if (field !== 'fullName' && field !== 'email') continue;
    if (errors[field]) continue;
    if (field === 'email') errors.email = form.email.trim() === '' ? 'required' : 'invalid';
    else
      errors.fullName = form.fullName.trim().length > WSP_MEMBER_NAME_MAX ? 'tooLong' : 'required';
  }
  return { errors };
}
