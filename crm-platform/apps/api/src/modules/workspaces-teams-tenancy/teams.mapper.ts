import type { WspAssignmentStrategy, WspTeam } from '@crm/contracts';
import { toPresence } from './members.mapper';
import type { TeamMemberRow, TeamRow, TeamUsageRow } from './teams.repository';

const NO_USAGE = {
  routingRules: 0,
  assignmentRules: 0,
  segmentShares: 0,
  childTeams: 0,
  conversations: 0,
};

/** The only place a team row becomes a response: uuids out, internal ids never. */
export function toTeamResponse(
  row: TeamRow,
  members: TeamMemberRow[],
  usage?: TeamUsageRow,
): WspTeam {
  return {
    id: row.uuid,
    name: row.name,
    color: row.color,
    description: row.description,
    assignmentStrategy: row.assignmentStrategy as WspAssignmentStrategy,
    isDefault: row.isDefault,
    sort: row.sort,
    deviceIds: row.deviceIds,
    parentId: row.parentUuid,
    depth: row.depth,
    lead: row.leadUuid && row.leadName ? { id: row.leadUuid, fullName: row.leadName } : null,
    receivesConversations: row.receivesConversations,
    receivesRecords: row.receivesRecords,
    isScopeBoundary: row.isScopeBoundary,
    members: members.map((m) => ({
      id: m.userUuid,
      fullName: m.fullName,
      presence: toPresence(m.presence),
      isLead: m.role === 'lead',
      role: m.role,
      isPrimary: m.isPrimary,
      capacity: m.capacity,
    })),
    memberCount: members.length,
    usage: usage
      ? {
          routingRules: usage.routingRules,
          assignmentRules: usage.assignmentRules,
          segmentShares: usage.segmentShares,
          childTeams: usage.childTeams,
          conversations: usage.conversations,
        }
      : NO_USAGE,
    unusedSettings: {
      businessHours: row.businessHours,
      timezone: row.timezone,
      defaultAssignee:
        row.defaultAssigneeUuid && row.defaultAssigneeName
          ? { id: row.defaultAssigneeUuid, fullName: row.defaultAssigneeName }
          : null,
    },
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
  };
}
