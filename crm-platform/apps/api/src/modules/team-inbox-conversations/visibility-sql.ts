import { sql, type SQL } from 'drizzle-orm';
import { PERSONAL_OWNER_GONE, channelOwnerSql, type ConversationViewer } from '../../realtime';
import { rawIdentifier } from '../../common/sql/identifier';
import { conversationScopeCondition } from '../../kernel/rbac/scope';

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

/**
 * `visibleToSql` for a statement that scans MANY rows of a table joined to `conversations` (the message feed's counts and charts), as the
 * same condition with the same meaning but without the correlated sub-select `channelOwnerSql` uses. Postgres runs a correlated sub-select
 * only in the leader, so one in the WHERE of a scan over a million messages turns a parallel scan (140 ms) into a serial one (600 ms).
 *
 * `joins` goes right after `JOIN conversations <alias>` and brings the channel (`vch`) and its mailbox (`vmb`) into the row; `where` is
 * the condition. The join is at most one row each (a channel is unique by (org_id, id), a mailbox by (org_id, uuid), the same
 * guarantees the sub-select relied on to return a single row), so no row is duplicated. The three answers of the owner are the same: NULL
 * for a shared channel or a mailbox that is not personal, the owner for a personal mailbox, PERSONAL_OWNER_GONE for an email channel
 * whose mailbox row is missing. Kept equal to `visibleToSql` by the parity test in inbox-schema.spec.ts.
 */
export function visibleToJoinedSql(
  viewer: ConversationViewer,
  alias = 'c',
): { joins: SQL; where: SQL } {
  const c = rawIdentifier(alias);
  const joins = sql`
    LEFT JOIN channels vch ON vch.org_id = ${c}.org_id AND vch.id = ${c}.channel_id AND vch.kind = 'email'
    LEFT JOIN mail_mailboxes vmb ON vmb.org_id = vch.org_id AND vmb.uuid::text = vch.external_id`;
  if (viewer.scope === null) return { joins, where: sql`FALSE` };
  const byScope = byScopeSql(viewer, alias);
  const owner = sql`(CASE WHEN vch.id IS NULL THEN NULL
                          WHEN vmb.id IS NULL THEN ${PERSONAL_OWNER_GONE}::bigint
                          WHEN vmb.scope = 'personal' THEN vmb.owner_user_id END)`;
  const mine = sql`COALESCE(${owner} = ${viewer.userId}, FALSE)`;
  const where =
    viewer.readsPersonalMail === true
      ? sql`(${mine} OR ${byScope})`
      : sql`(${mine} OR (${owner} IS NULL AND ${byScope}))`;
  return { joins, where };
}

const byScopeSql = (viewer: ConversationViewer, alias: string): SQL =>
  conversationScopeCondition(viewer, alias);
