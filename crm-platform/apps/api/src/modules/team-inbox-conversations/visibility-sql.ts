import { sql, type SQL } from 'drizzle-orm';
import type { ConversationViewer } from '../../realtime';

/**
 * `conversationVisible` (apps/api/src/realtime/audience) as a SQL condition on `conversations`, so a list, a count and a search can
 * only ever return what the single-record rule would let the same person open. The two are kept in step by a test that runs every
 * viewer against every assignment shape through both.
 *
 *   all   no condition
 *   team  assigned to me or to one of my teams, or not assigned to a person or a team at all
 *   own   assigned to me
 *   none  nothing
 */
export function visibleToSql(viewer: ConversationViewer, alias = 'c'): SQL {
  const c = sql.raw(alias);
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
