import {
  WSP_TEAM_DEFAULT_COLOR,
  WSP_TEAM_NAME_MAX,
  type CreateWspTeamInput,
  type UpdateWspTeamInput,
  type WspAssignmentStrategy,
  type WspTeam,
} from '@crm/contracts';
import { TEAM_COLORS } from '@/lib/theme/tokens';

/** What the team form holds, ported from the web's `team-form.ts`. */
export interface TeamDraft {
  name: string;
  color: string;
  assignmentStrategy: WspAssignmentStrategy;
  memberIds: string[];
}

export const emptyTeamDraft = (): TeamDraft => ({
  name: '',
  color: WSP_TEAM_DEFAULT_COLOR,
  assignmentStrategy: 'manual',
  memberIds: [],
});

export const draftOfTeam = (team: WspTeam): TeamDraft => ({
  name: team.name,
  color: team.color,
  assignmentStrategy: team.assignmentStrategy,
  memberIds: team.members.map((m) => m.id),
});

/** Colours are compared without the `#` and case, so `#075e54` is the same swatch as `#075E54`. */
export const sameColor = (a: string, b: string): boolean =>
  a.replace(/^#/, '').toLowerCase() === b.replace(/^#/, '').toLowerCase();

/** The picker's colours, plus the team's own when it was set to something else (an import, the API). */
export const swatchesFor = (color: string): string[] =>
  TEAM_COLORS.some((s) => sameColor(s, color)) ? [...TEAM_COLORS] : [...TEAM_COLORS, color];

export type TeamNameProblem = 'required' | 'tooLong';

export function nameProblem(name: string): TeamNameProblem | null {
  const n = name.trim();
  if (n.length === 0) return 'required';
  return n.length > WSP_TEAM_NAME_MAX ? 'tooLong' : null;
}

export const toggleId = (list: readonly string[], id: string): string[] =>
  list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

export const toCreateInput = (draft: TeamDraft): CreateWspTeamInput => ({
  name: draft.name.trim(),
  color: draft.color,
  assignmentStrategy: draft.assignmentStrategy,
  memberIds: draft.memberIds,
  deviceIds: [],
});

/**
 * The save of an existing team. `deviceIds` is never sent: the app has no device picker (neither has the web, until the channels domain
 * lists devices), and sending a stale list would silently change what the team handles.
 */
export const toUpdateInput = (draft: TeamDraft, team: WspTeam): UpdateWspTeamInput => ({
  name: draft.name.trim(),
  color: draft.color,
  assignmentStrategy: draft.assignmentStrategy,
  memberIds: draft.memberIds,
  rowVersion: team.rowVersion,
});

export const onlineCount = (team: Pick<WspTeam, 'members'>): number =>
  team.members.filter((m) => m.presence === 'online').length;
