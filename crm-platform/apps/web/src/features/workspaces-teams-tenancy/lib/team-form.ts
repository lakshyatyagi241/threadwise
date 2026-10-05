import {
  WSP_TEAM_DEFAULT_COLOR,
  WSP_TEAM_NAME_MAX,
  type CreateWspTeamInput,
  type UpdateWspTeamInput,
  type WspAssignmentStrategy,
  type WspTeam,
} from '@crm/contracts';

/** The six swatches of WaDesk's colour picker, first one is the default. */
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
  assignmentStrategy: WspAssignmentStrategy;
  memberIds: string[];
  deviceIds: string[];
}

export const emptyTeamForm = (): TeamForm => ({
  name: '',
  color: WSP_TEAM_DEFAULT_COLOR,
  assignmentStrategy: 'manual',
  memberIds: [],
  deviceIds: [],
});

export function formFromTeam(team: WspTeam): TeamForm {
  return {
    name: team.name,
    color: team.color,
    assignmentStrategy: team.assignmentStrategy,
    memberIds: team.members.map((m) => m.id),
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

export function toCreateInput(form: TeamForm): CreateWspTeamInput {
  return {
    name: form.name.trim(),
    color: form.color,
    assignmentStrategy: form.assignmentStrategy,
    memberIds: form.memberIds,
    deviceIds: form.deviceIds,
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
    assignmentStrategy: form.assignmentStrategy,
    memberIds: form.memberIds,
    ...(devicesShown ? { deviceIds: form.deviceIds } : {}),
    rowVersion: team.rowVersion,
  };
}
