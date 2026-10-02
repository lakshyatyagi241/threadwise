import type { WspAssignmentStrategy, WspTeam } from '@crm/contracts';
import { toPresence } from './members.mapper';
import type { TeamMemberRow, TeamRow } from './teams.repository';

/** The only place a team row becomes a response: uuids out, internal ids never. */
export function toTeamResponse(row: TeamRow, members: TeamMemberRow[]): WspTeam {
  return {
    id: row.uuid,
    name: row.name,
    color: row.color,
    description: row.description,
    assignmentStrategy: row.assignmentStrategy as WspAssignmentStrategy,
    isDefault: row.isDefault,
    sort: row.sort,
    deviceIds: row.deviceIds,
    members: members.map((m) => ({
      id: m.userUuid,
      fullName: m.fullName,
      presence: toPresence(m.presence),
      isLead: m.isLead,
      capacity: m.capacity,
    })),
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
  };
}
