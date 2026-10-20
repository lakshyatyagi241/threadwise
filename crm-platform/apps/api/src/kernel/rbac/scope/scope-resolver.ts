import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { RecordScope } from '@crm/contracts';
import type { Tx } from '@crm/db';
import {
  conversationScopeAllows,
  conversationScopeCondition,
  type ConversationAssignment,
  type ConversationScopeViewer,
} from './conversation-scope';
import {
  scopeOwnerCondition,
  teamPeersBelowSql,
  teamTreeIdsSql,
  type ScopeActor,
  type ScopeColumns,
} from './scope-sql';

/** One request's answers, so a list that asks "who are my teammates" twice asks the database once. Keyed by the transaction. */
const peersCache = new WeakMap<object, Map<string, Promise<ReadonlySet<number>>>>();
const teamsCache = new WeakMap<object, Map<string, Promise<readonly number[]>>>();
const peersBelowCache = new WeakMap<object, Map<string, Promise<ReadonlySet<number>>>>();
const teamTreeCache = new WeakMap<object, Map<string, Promise<readonly number[]>>>();

function memo<T>(
  store: WeakMap<object, Map<string, Promise<T>>>,
  tx: Tx,
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  let perTx = store.get(tx);
  if (!perTx) {
    perTx = new Map();
    store.set(tx, perTx);
  }
  const cache = perTx;
  let hit = cache.get(key);
  if (!hit) {
    hit = load();
    cache.set(key, hit);
    // A failed read must not be remembered.
    hit.catch(() => cache.delete(key));
  }
  return hit;
}

/**
 * Do `userId` and `actorUserId` share at least one team? The single-record form of the `team` scope, for a repository that has one
 * owner in hand and no list to filter. (Not cached: one indexed lookup.)
 */
export async function isTeamPeer(
  tx: Tx,
  orgId: number,
  actorUserId: number,
  userId: number,
  /** `team_and_below`: a person in a team below the actor's teams counts too. */
  below = false,
): Promise<boolean> {
  if (below) {
    const res = await tx.execute(sql`
      SELECT 1 FROM team_members tm
      WHERE tm.org_id = ${orgId} AND tm.user_id = ${userId}
        AND tm.team_id IN ${teamTreeIdsSql(orgId, actorUserId)}
      LIMIT 1`);
    return res.rows.length > 0;
  }
  const res = await tx.execute(sql`
    SELECT 1 FROM team_members tm1
    JOIN team_members tm2 ON tm2.org_id = tm1.org_id AND tm2.team_id = tm1.team_id
    WHERE tm1.org_id = ${orgId} AND tm1.user_id = ${actorUserId} AND tm2.user_id = ${userId}
    LIMIT 1`);
  return res.rows.length > 0;
}

/** The users who share a team with `actor` (the actor included when they are in a team). Cached for the life of the transaction. */
export function teamPeers(
  tx: Tx,
  actor: { orgId: number; userId: number },
): Promise<ReadonlySet<number>> {
  return memo(peersCache, tx, `${actor.orgId}:${actor.userId}`, async () => {
    const res = await tx.execute(sql`
      SELECT DISTINCT tm2.user_id
      FROM team_members tm1
      JOIN team_members tm2 ON tm2.org_id = tm1.org_id AND tm2.team_id = tm1.team_id
      WHERE tm1.org_id = ${actor.orgId} AND tm1.user_id = ${actor.userId}`);
    return new Set((res.rows as Array<{ user_id: string | number }>).map((r) => Number(r.user_id)));
  });
}

/**
 * The users in a team of `actor` or in a team below one (`team_and_below`; the actor included when they are in a team). Cached for the
 * life of the transaction.
 */
export function teamPeersBelow(
  tx: Tx,
  actor: { orgId: number; userId: number },
): Promise<ReadonlySet<number>> {
  return memo(peersBelowCache, tx, `${actor.orgId}:${actor.userId}`, async () => {
    const res = await tx.execute(sql`SELECT DISTINCT p.user_id FROM ${teamPeersBelowSql(actor.orgId, actor.userId)} p`);
    return new Set((res.rows as Array<{ user_id: string | number }>).map((r) => Number(r.user_id)));
  });
}

/**
 * The ids of the teams `actor` is in plus every team below them (cycle-safe, depth-bounded). Cached for the life of the transaction.
 */
export function teamTreeIdsOf(
  tx: Tx,
  actor: { orgId: number; userId: number },
): Promise<readonly number[]> {
  return memo(teamTreeCache, tx, `${actor.orgId}:${actor.userId}`, async () => {
    const res = await tx.execute(sql`SELECT t.team_id FROM ${teamTreeIdsSql(actor.orgId, actor.userId)} t`);
    return (res.rows as Array<{ team_id: string | number }>).map((r) => Number(r.team_id));
  });
}

/**
 * The team ids a conversation viewer's scope reaches: the actor's teams for `team`, those plus every team below for
 * `team_and_below`, none for `own` and `all` (they do not look at teams).
 */
export async function teamIdsForScope(
  tx: Tx,
  actor: { orgId: number; userId: number },
  scope: RecordScope | null,
): Promise<readonly number[]> {
  if (scope === 'team') return teamIdsOf(tx, actor);
  if (scope === 'team_and_below') return teamTreeIdsOf(tx, actor);
  return [];
}

/** The ids of the teams `actor` is in. Cached for the life of the transaction. */
export function teamIdsOf(
  tx: Tx,
  actor: { orgId: number; userId: number },
): Promise<readonly number[]> {
  return memo(teamsCache, tx, `${actor.orgId}:${actor.userId}`, async () => {
    const res = await tx.execute(
      sql`SELECT team_id FROM team_members WHERE org_id = ${actor.orgId} AND user_id = ${actor.userId}`,
    );
    return (res.rows as Array<{ team_id: string | number }>).map((r) => Number(r.team_id));
  });
}

/**
 * May `actor` act on a record whose person columns hold `people` (owner, assignee, host, creator; null entries are ignored)?
 * The answer `scopeOwnerCondition` gives for a list, for one record already in hand.
 */
export async function canActOn(
  tx: Tx,
  actor: ScopeActor,
  scope: RecordScope,
  people: ReadonlyArray<number | null | undefined>,
): Promise<boolean> {
  if (scope === 'all') return true;
  const me = actor.userId;
  if (!me) return false;
  const ids = people.filter((p): p is number => typeof p === 'number');
  if (ids.length === 0) return false;
  if (ids.includes(me)) return true;
  if (scope === 'own') return false;
  const peers =
    scope === 'team_and_below'
      ? await teamPeersBelow(tx, { orgId: actor.orgId, userId: me })
      : await teamPeers(tx, { orgId: actor.orgId, userId: me });
  return ids.some((id) => peers.has(id));
}

/**
 * ONE resolver for "which people's records may this person see or act on" (BL-380, spec section 5.2).
 *
 * Record mode: `ownerCondition` (a WHERE fragment for a list), `canActOn` (one record already loaded), `teamPeers`, and for
 * `team_and_below` (BL-382) `teamPeersBelow` / `teamTreeIds`.
 * Conversation mode: `conversationCondition` and `conversationAllows`, the inbox's own rule (an unassigned conversation is visible to a
 * team-scoped viewer only with the permission `inbox.conversation.read_unassigned`).
 *
 * Teammates are cached per transaction (so per request), never across requests: a person added to or removed from a team must change
 * what they can open at once, on every API instance, and a shared cache would need an invalidation hook this phase does not add.
 *
 * Code that builds SQL imports the plain functions (`scopeOwnerCondition`, `conversationScopeCondition`, `canActOn`), so it needs no
 * injection; this class is the same thing for a service that prefers a provider (and for a test that wants to replace it).
 */
@Injectable()
export class ScopeResolver {
  /** See `scopeOwnerCondition`. */
  ownerCondition(actor: ScopeActor, scope: RecordScope, columns: ScopeColumns): SQL | undefined {
    return scopeOwnerCondition(actor, scope, columns);
  }

  /** See `teamPeers`. */
  teamPeers(tx: Tx, actor: { orgId: number; userId: number }): Promise<ReadonlySet<number>> {
    return teamPeers(tx, actor);
  }

  /** See `teamPeersBelow`. */
  teamPeersBelow(tx: Tx, actor: { orgId: number; userId: number }): Promise<ReadonlySet<number>> {
    return teamPeersBelow(tx, actor);
  }

  /** See `teamTreeIdsOf`. */
  teamTreeIds(tx: Tx, actor: { orgId: number; userId: number }): Promise<readonly number[]> {
    return teamTreeIdsOf(tx, actor);
  }

  /** See `teamIdsForScope`. */
  teamIdsForScope(
    tx: Tx,
    actor: { orgId: number; userId: number },
    scope: RecordScope | null,
  ): Promise<readonly number[]> {
    return teamIdsForScope(tx, actor, scope);
  }

  /** See `teamIdsOf`. */
  teamIds(tx: Tx, actor: { orgId: number; userId: number }): Promise<readonly number[]> {
    return teamIdsOf(tx, actor);
  }

  /** See `canActOn`. */
  canActOn(
    tx: Tx,
    actor: ScopeActor,
    scope: RecordScope,
    people: ReadonlyArray<number | null | undefined>,
  ): Promise<boolean> {
    return canActOn(tx, actor, scope, people);
  }

  /** The inbox rule as a WHERE fragment over the conversations table known as `alias`. */
  conversationCondition(viewer: ConversationScopeViewer, alias = 'c'): SQL {
    return conversationScopeCondition(viewer, alias);
  }

  /** The inbox rule for one conversation already in hand. */
  conversationAllows(viewer: ConversationScopeViewer, record: ConversationAssignment): boolean {
    return conversationScopeAllows(viewer, record);
  }
}
