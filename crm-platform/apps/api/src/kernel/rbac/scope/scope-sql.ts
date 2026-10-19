import { sql, type SQL } from 'drizzle-orm';
import type { RecordScope } from '@crm/contracts';

/**
 * The one place that turns a record scope (`own` | `team` | `all`) into SQL (BL-380, teams-unification spec section 5.2).
 *
 * Before this file the same self-join on `team_members` was copied by hand into about seventeen repositories, and each copy
 * decided on its own whether "mine" includes the records a person created. They now all call `scopeOwnerCondition`, so the
 * meaning of a scope is written once.
 *
 * The meaning, for every module:
 *
 *   all   no condition
 *   own   a record whose owner, assignee, host or CREATOR (decision D1) is me
 *   team  `own`, plus a record whose owner, assignee, host or creator is a member of at least one team I am in
 *   none  (no signed-in person, e.g. a system actor handed a scoped permission) nothing
 *
 * A record with no person on any of the columns is never visible below `all`. A person who is in no team still sees their own
 * records at `team` scope: `team` is `own` plus the teammates, never less than `own`.
 */

/** Who is asking. `userId` null/undefined is a caller with no person behind it (a system actor), which sees nothing below `all`. */
export interface ScopeActor {
  orgId: number;
  userId: number | null | undefined;
}

/** The columns that name a person on the record: owner, assignee, host, creator. A single column or several. */
export type ScopeColumns = SQL | readonly SQL[];

const asList = (columns: ScopeColumns): readonly SQL[] =>
  Array.isArray(columns) ? (columns as readonly SQL[]) : [columns as SQL];

/**
 * The user ids that share at least one team with `userId` (`userId` included when they are in any team), as a sub-select
 * (`IN (SELECT ...)`). Written once; every `team` scope reads it.
 */
export function teamPeersSql(orgId: number, userId: number): SQL {
  return sql`(SELECT tm2.user_id FROM team_members tm1
      JOIN team_members tm2 ON tm2.org_id = tm1.org_id AND tm2.team_id = tm1.team_id
      WHERE tm1.org_id = ${orgId} AND tm1.user_id = ${userId})`;
}

/** The ids of the teams `userId` is in, as a sub-select: for things shared with a team (a segment) rather than owned by a person. */
export function memberTeamIdsSql(orgId: number, userId: number | SQL): SQL {
  return sql`(SELECT tm.team_id FROM team_members tm WHERE tm.org_id = ${orgId} AND tm.user_id = ${userId})`;
}

/**
 * The scope as a WHERE condition over the person columns of a record, or `undefined` when the scope is `all` (add nothing).
 *
 * Pass EVERY column that names a person on the record, creator columns included: `own` is "any of these is me", `team` is "any of
 * these is me or a teammate". Leaving a creator column out of the list is how modules used to disagree about `own`.
 */
export function scopeOwnerCondition(
  actor: ScopeActor,
  scope: RecordScope,
  columns: ScopeColumns,
): SQL | undefined {
  if (scope === 'all') return undefined;
  const cols = asList(columns);
  if (!actor.userId || cols.length === 0) return sql`false`;
  const me = actor.userId;
  const mine = cols.map((c) => sql`${c} = ${me}`);
  if (scope === 'own') return mine.length === 1 ? mine[0]! : sql`(${sql.join(mine, sql` OR `)})`;
  const peers = teamPeersSql(actor.orgId, me);
  const theirs = cols.map((c) => sql`${c} IN ${peers}`);
  return sql`(${sql.join([...mine, ...theirs], sql` OR `)})`;
}

/** The same condition as `scopeOwnerCondition`, as a boolean that is never NULL (a record joined in with `LEFT JOIN`). */
export function scopeOwnerPredicate(
  actor: ScopeActor,
  scope: RecordScope,
  columns: ScopeColumns,
): SQL {
  const cond = scopeOwnerCondition(actor, scope, columns);
  return cond ? sql`COALESCE(${cond}, FALSE)` : sql`TRUE`;
}
