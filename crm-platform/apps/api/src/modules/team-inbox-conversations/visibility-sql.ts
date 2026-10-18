import { sql, type SQL } from 'drizzle-orm';
import { channelOwnerSql, type ConversationViewer } from '../../realtime';
import { rawIdentifier } from '../../common/sql/identifier';

/**
 * `conversationVisible` (apps/api/src/realtime/audience) as a SQL condition on `conversations`, so a list, a count and a search can
 * only ever return what the single-record rule would let the same person open. The two are kept in step by a test that runs every
 * viewer against every assignment and channel-owner shape through both.
 *
 * The assignment part (`byScope`):
 *   all   no condition
 *   team  assigned to me or to one of my teams, or not assigned to a person or a team at all
 *   own   assigned to me
 *   none  nothing
 *
 * The personal-mailbox part (TW-MAIL-035), in front of it: the channel owner (`channelOwnerSql`) is NULL for a shared channel (only
 * `byScope` applies), the viewer for their own mailbox (always visible), anyone else's (visible only when `readsPersonalMail`, then by scope).
 */
export function visibleToSql(viewer: ConversationViewer, alias = 'c'): SQL {
  if (viewer.scope === null) return sql`FALSE`;
  const byScope = byScopeSql(viewer, alias);
  const owner = channelOwnerSql(alias);
  const mine = sql`COALESCE(${owner} = ${viewer.userId}, FALSE)`;
  // Others' personal mail, then governed by scope as usual; shared channels (NULL owner) always are.
  if (viewer.readsPersonalMail === true) return sql`(${mine} OR ${byScope})`;
  return sql`(${mine} OR (${owner} IS NULL AND ${byScope}))`;
}

function byScopeSql(viewer: ConversationViewer, alias: string): SQL {
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
