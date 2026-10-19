import {
  pageResponseSchema,
  wspTeamSchema,
  type CreateWspTeamInput,
  type UpdateWspTeamInput,
} from '@crm/contracts';
import { apiFetch } from '@/lib/api';

/**
 * The calls behind Settings, Teams (TW-WSP-022). Every member may read the list; creating, editing and deleting need `inbox.team.manage`
 * (the members summary says `me.canManageTeams`), and the server stays the authority.
 */

export const TEAMS_PAGE_SIZE = 50;

const teamListSchema = pageResponseSchema(wspTeamSchema);

/** One page of teams, newest first, each with its members. There is no route for a single team. */
export const fetchTeams = (cursor: string | undefined, signal?: AbortSignal) =>
  apiFetch('/v2/workspace/teams', {
    query: { limit: TEAMS_PAGE_SIZE, cursor },
    schema: teamListSchema,
    signal,
  });

export const createTeam = (body: CreateWspTeamInput) =>
  apiFetch('/v2/workspace/teams', { method: 'POST', body, schema: wspTeamSchema });

/** Edits a team with the version that was read (a stale one is 409 ROW_VERSION_CONFLICT). `memberIds` replaces the member list. */
export const updateTeam = (id: string, body: UpdateWspTeamInput) =>
  apiFetch(`/v2/workspace/teams/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body,
    schema: wspTeamSchema,
  });

/** Deletes a team; conversations assigned to it become unassigned. */
export const deleteTeam = (id: string) =>
  apiFetch(`/v2/workspace/teams/${encodeURIComponent(id)}`, { method: 'DELETE' });
