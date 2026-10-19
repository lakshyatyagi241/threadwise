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
import { scopeOwnerCondition, type ScopeActor, type ScopeColumns } from './scope-sql';

/** One request's answers, so a list that asks "who are my teammates" twice asks the database once. Keyed by the transaction. */
const peersCache = new WeakMap<object, Map<string, Promise<ReadonlySet<number>>>>();
const teamsCache = new WeakMap<object, Map<string, Promise<readonly number[]>>>();

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
 * ONE resolver for "which people's records may this person see or act on" (BL-380, spec section 5.2).
 *
 * Record mode: `ownerCondition` (a WHERE fragment for a list), `canActOn` (one record already loaded), `teamPeers`.
 * Conversation mode: `conversationCondition` and `conversationAllows`, the inbox's own rule (an unassigned conversation stays visible
 * to `team`).
 *
 * Teammates are cached per transaction (so per request), never across requests: a person added to or removed from a team must change
 * what they can open at once, on every API instance, and a shared cache would need an invalidation hook this phase does not add.
 *
 * Repositories that only build SQL import the plain functions (`scopeOwnerCondition`, `conversationScopeCondition`); this class is for
 * code that already has a transaction and needs an answer, not a fragment.
 */
@Injectable()
export class ScopeResolver {
  /** See `scopeOwnerCondition`. */
  ownerCondition(actor: ScopeActor, scope: RecordScope, columns: ScopeColumns): SQL | undefined {
    return scopeOwnerCondition(actor, scope, columns);
  }

  /** The users who share a team with `actor` (the actor included when they are in a team). */
  teamPeers(tx: Tx, actor: { orgId: number; userId: number }): Promise<ReadonlySet<number>> {
    return memo(peersCache, tx, `${actor.orgId}:${actor.userId}`, async () => {
      const res = await tx.execute(sql`
        SELECT DISTINCT tm2.user_id
        FROM team_members tm1
        JOIN team_members tm2 ON tm2.org_id = tm1.org_id AND tm2.team_id = tm1.team_id
        WHERE tm1.org_id = ${actor.orgId} AND tm1.user_id = ${actor.userId}`);
      return new Set(
        (res.rows as Array<{ user_id: string | number }>).map((r) => Number(r.user_id)),
      );
    });
  }

  /** The ids of the teams `actor` is in. */
  teamIds(tx: Tx, actor: { orgId: number; userId: number }): Promise<readonly number[]> {
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
  async canActOn(
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
    const peers = await this.teamPeers(tx, { orgId: actor.orgId, userId: me });
    return ids.some((id) => peers.has(id));
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
