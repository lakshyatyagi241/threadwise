import { sql, type SQL } from 'drizzle-orm';
import type { RecordScope } from '@crm/contracts';
import { rawIdentifier } from '../../../common/sql/identifier';

/**
 * The 'conversation' mode of the scope resolver (BL-380).
 *
 * Conversations keep their own meaning of `team`, on purpose: the inbox is a shared queue, so a conversation nobody has taken yet
 * stays visible to a team-scoped agent. Records (`scopeOwnerCondition`) do not have that rule. Both modes now live in this folder
 * and are read by every list, thread and socket delivery, so the two meanings are written down together instead of one in the
 * realtime folder and one in each repository.
 *
 *   all   every conversation, assigned or not
 *   team  assigned to me, or to one of my teams, or not assigned to a person or a team at all
 *   own   assigned to me
 *   null  (no allow grant) nothing
 */
export interface ConversationScopeViewer {
  userId: number;
  scope: RecordScope | null;
  teamIds: readonly number[];
}

/** Who a conversation is assigned to. */
export interface ConversationAssignment {
  assigneeUserId: number | null;
  assigneeTeamId: number | null;
}

/** The assignment rule for one conversation already in hand. */
export function conversationScopeAllows(
  viewer: ConversationScopeViewer,
  record: ConversationAssignment,
): boolean {
  switch (viewer.scope) {
    case null:
      return false;
    case 'all':
      return true;
    case 'team':
      if (record.assigneeUserId === viewer.userId) return true;
      if (record.assigneeTeamId !== null && viewer.teamIds.includes(record.assigneeTeamId))
        return true;
      return record.assigneeUserId === null && record.assigneeTeamId === null;
    case 'own':
      return record.assigneeUserId === viewer.userId;
  }
}

/** The same rule as a SQL condition on the conversations table known as `alias`. */
export function conversationScopeCondition(viewer: ConversationScopeViewer, alias = 'c'): SQL {
  const c = rawIdentifier(alias);
  switch (viewer.scope) {
    case null:
      return sql`FALSE`;
    case 'all':
      return sql`TRUE`;
    case 'own':
      return sql`${c}.assignee_user_id = ${viewer.userId}`;
    case 'team': {
      const mine = sql`${c}.assignee_user_id = ${viewer.userId}`;
      const unassigned = sql`(${c}.assignee_user_id IS NULL AND ${c}.assignee_team_id IS NULL)`;
      if (viewer.teamIds.length === 0) return sql`(${mine} OR ${unassigned})`;
      const teams = sql.join(
        viewer.teamIds.map((id) => sql`${id}`),
        sql`, `,
      );
      return sql`(${mine} OR ${c}.assignee_team_id IN (${teams}) OR ${unassigned})`;
    }
  }
}
