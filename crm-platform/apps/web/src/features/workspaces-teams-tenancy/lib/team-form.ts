import {
  WSP_TEAM_DEFAULT_COLOR,
  WSP_TEAM_NAME_MAX,
  type CreateWspTeamInput,
  type UpdateWspTeamInput,
  type WspAssignmentStrategy,
  type WspTeam,
  type WspTeamMemberRole,
} from '@crm/contracts';

/** The six swatches of Reference's colour picker, first one is the default. */
export const TEAM_SWATCHES = [
  WSP_TEAM_DEFAULT_COLOR,
  '#13478A',
  '#5B3D8A',
  '#7B5A14',
  '#A1431F',
  '#0C7A65',
] as const;

export interface TeamForm {
  name: string;
  color: string;
  description: string;
  /** Kept as the team has it and sent unchanged: routing does not read it yet, so the screen only shows it. */
  assignmentStrategy: WspAssignmentStrategy;
  /** The parent team's id; null = a top-level team. */
  parentId: string | null;
  /** The manager's member id; null = none. A manager is always on the team and a lead. */
  leadId: string | null;
  receivesConversations: boolean;
  receivesRecords: boolean;
  memberIds: string[];
  /** Role per member id (those not listed are plain members). */
  memberRoles: Record<string, WspTeamMemberRole>;
  /** Primary choices made in this dialog: true = make this their primary team, false = no longer. Untouched members are absent. */
  primaryChoice: Record<string, boolean>;
  deviceIds: string[];
}

export const emptyTeamForm = (): TeamForm => ({
  name: '',
  color: WSP_TEAM_DEFAULT_COLOR,
  description: '',
  assignmentStrategy: 'manual',
  parentId: null,
  leadId: null,
  receivesConversations: true,
  receivesRecords: true,
  memberIds: [],
  memberRoles: {},
  primaryChoice: {},
  deviceIds: [],
});

export function formFromTeam(team: WspTeam): TeamForm {
  return {
    name: team.name,
    color: team.color,
    description: team.description ?? '',
    assignmentStrategy: team.assignmentStrategy,
    parentId: team.parentId,
    leadId: team.lead?.id ?? null,
    receivesConversations: team.receivesConversations,
    receivesRecords: team.receivesRecords,
    memberIds: team.members.map((m) => m.id),
    memberRoles: Object.fromEntries(team.members.map((m) => [m.id, m.role])),
    primaryChoice: {},
    deviceIds: [...team.deviceIds],
  };
}

/** Colours are compared without the `#` and case, so `#075e54` is the same swatch as `#075E54`. */
export const sameColor = (a: string, b: string): boolean =>
  a.replace(/^#/, '').toLowerCase() === b.replace(/^#/, '').toLowerCase();

/** The picker's swatches, plus the team's own colour when it was set to something else (an import, the API). */
export function swatchesFor(color: string): string[] {
  return TEAM_SWATCHES.some((s) => sameColor(s, color))
    ? [...TEAM_SWATCHES]
    : [...TEAM_SWATCHES, color];
}

export type NameProblem = 'required' | 'tooLong';

export function nameProblem(name: string): NameProblem | null {
  const n = name.trim();
  if (n.length === 0) return 'required';
  return n.length > WSP_TEAM_NAME_MAX ? 'tooLong' : null;
}

export function toggle(list: readonly string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/** Choosing a manager puts them on the team (the server does the same); un-ticking the manager clears the choice. */
export function withLead(form: TeamForm, leadId: string | null): TeamForm {
  if (leadId === null) return { ...form, leadId: null };
  return {
    ...form,
    leadId,
    memberIds: form.memberIds.includes(leadId) ? form.memberIds : [...form.memberIds, leadId],
    memberRoles: { ...form.memberRoles, [leadId]: 'lead' },
  };
}

const without = <T>(rec: Record<string, T>, id: string): Record<string, T> =>
  Object.fromEntries(Object.entries(rec).filter(([key]) => key !== id));

export function withMemberToggled(form: TeamForm, id: string): TeamForm {
  const memberIds = toggle(form.memberIds, id);
  const on = memberIds.includes(id);
  return {
    ...form,
    memberIds,
    memberRoles: without(form.memberRoles, id),
    primaryChoice: without(form.primaryChoice, id),
    leadId: !on && form.leadId === id ? null : form.leadId,
  };
}

export function withMemberRole(form: TeamForm, id: string, role: WspTeamMemberRole): TeamForm {
  return {
    ...form,
    memberRoles: { ...form.memberRoles, [id]: role },
    // A manager demoted to a plain member is no longer the manager.
    leadId: role === 'member' && form.leadId === id ? null : form.leadId,
  };
}

const descriptionOf = (form: TeamForm): string | null => form.description.trim() || null;

export function toCreateInput(form: TeamForm): CreateWspTeamInput {
  return {
    name: form.name.trim(),
    color: form.color,
    description: descriptionOf(form),
    assignmentStrategy: form.assignmentStrategy,
    memberIds: form.memberIds,
    deviceIds: form.deviceIds,
    parentId: form.parentId,
    leadId: form.leadId,
    receivesConversations: form.receivesConversations,
    receivesRecords: form.receivesRecords,
  };
}

/**
 * The save of an existing team. `deviceIds` is only sent when the picker was on screen: without it the person never saw
 * the list, and sending the stale one would be a silent change.
 */
export function toUpdateInput(
  form: TeamForm,
  team: WspTeam,
  devicesShown: boolean,
): UpdateWspTeamInput {
  return {
    name: form.name.trim(),
    color: form.color,
    description: descriptionOf(form),
    assignmentStrategy: form.assignmentStrategy,
    memberIds: form.memberIds,
    ...(devicesShown ? { deviceIds: form.deviceIds } : {}),
    parentId: form.parentId,
    leadId: form.leadId,
    receivesConversations: form.receivesConversations,
    receivesRecords: form.receivesRecords,
    rowVersion: team.rowVersion,
  };
}

export interface MemberChange {
  userId: string;
  role?: WspTeamMemberRole;
  isPrimary?: boolean;
}

/**
 * The per-person changes to send after the team itself is saved: a different role from what the server has (the manager's lead role
 * was already set by the save) and the primary choices made in the dialog. `saved` is the team as the server returned it.
 */
export function memberChanges(form: TeamForm, saved: WspTeam): MemberChange[] {
  const out: MemberChange[] = [];
  for (const m of saved.members) {
    const wantRole = m.id === form.leadId ? 'lead' : (form.memberRoles[m.id] ?? 'member');
    const change: MemberChange = { userId: m.id };
    if (wantRole !== m.role) change.role = wantRole;
    const choice = form.primaryChoice[m.id];
    if (choice !== undefined && choice !== m.isPrimary) change.isPrimary = choice;
    if (change.role !== undefined || change.isPrimary !== undefined) out.push(change);
  }
  return out;
}
