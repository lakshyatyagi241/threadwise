import { sql, type SQL } from 'drizzle-orm';
import type { RecordScope } from '@crm/contracts';
import { rawIdentifier } from '../../../common/sql/identifier';

/**
 * The 'conversation' mode of the scope resolver (BL-380, BL-382).
 *
 * Conversations keep their own meaning of `team`, on purpose: the inbox is a shared queue, so a conversation nobody has taken yet can
 * stay visible to a team-scoped agent. Since BL-382 (decision D2) that is an explicit permission, `inbox.conversation.read_unassigned`
 * (`readsUnassigned`), instead of a side effect of the scope word. Records (`scopeOwnerCondition`) do not have that rule. Both modes
 * live in this folder and are read by every list, thread and socket delivery.
 *
 *   all             every conversation, assigned or not
 *   team            assigned to me or to one of my teams, plus the unassigned ones when `readsUnassigned`
 *   team_and_below  the same, with my teams AND every team below them (`teamIds` already holds them all)
 *   own             assigned to me (`readsUnassigned` adds nothing: the permission widens the team scopes only)
 *   null            (no allow grant) nothing
 *
 * "Unassigned" = assigned to no person and to no team. A conversation assigned to a team outside the viewer's reach is not unassigned.
 * The migration that adds the permission grants it to every role that read at scope `team`, so nobody's view changes on the day it ships.
 */
export interface ConversationScopeViewer {
  userId: number;
  scope: RecordScope | null;
  /** The viewer's teams; for `team_and_below` also every team below them. Empty for `own` and `all`. */
  teamIds: readonly number[];
  /** Holds `inbox.conversation.read_unassigned` (used by `team` and `team_and_below` only). Required on purpose: a caller that builds a viewer by hand cannot forget it. */
  readsUnassigned: boolean;
}

/** Who a conversation is assigned to. */
export interface ConversationAssignment {
  assigneeUserId: number | null;
  assigneeTeamId: number | null;
}

const isUnassigned = (record: ConversationAssignment): boolean =>
  record.assigneeUserId === null && record.assigneeTeamId === null;

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
    case 'team_and_below':
      if (record.assigneeUserId === viewer.userId) return true;
      if (record.assigneeTeamId !== null && viewer.teamIds.includes(record.assigneeTeamId))
        return true;
      return viewer.readsUnassigned && isUnassigned(record);
    case 'own':
      return record.assigneeUserId === viewer.userId;
  }
}

/** The same rule as a SQL condition on the conversations table known as `alias`. */
export function conversationScopeCondition(viewer: ConversationScopeViewer, alias = 'c'): SQL {
  const c = rawIdentifier(alias);
  const mine = sql`${c}.assignee_user_id = ${viewer.userId}`;
  const unassigned = sql`(${c}.assignee_user_id IS NULL AND ${c}.assignee_team_id IS NULL)`;
  switch (viewer.scope) {
    case null:
      return sql`FALSE`;
    case 'all':
      return sql`TRUE`;
    case 'own':
      return mine;
    case 'team':
    case 'team_and_below': {
      const parts: SQL[] = [mine];
      if (viewer.teamIds.length > 0) {
        const teams = sql.join(
          viewer.teamIds.map((id) => sql`${id}`),
          sql`, `,
        );
        parts.push(sql`${c}.assignee_team_id IN (${teams})`);
      }
      if (viewer.readsUnassigned) parts.push(unassigned);
      return sql`(${sql.join(parts, sql` OR `)})`;
    }
  }
}
