import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DatabaseService } from '../../infra/db/database.service';
import { RbacService } from '../../kernel/rbac/rbac.service';
import { PERM_MAIL_SETTINGS_MANAGE, adminsCanReadPersonal } from './channel-owner';
import { withDescendants } from '../../kernel/rbac/scope';
import {
  PERM_CONVERSATION_READ_UNASSIGNED,
  viewerReadsUnassigned,
  type ConversationViewer,
} from './conversation-visibility';

/** How long a workspace's member list is reused. A grant changed inside this window reaches the live signals this much late. */
const PERM_CONVERSATION_READ_KEY = 'inbox.conversation.read';
const CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 500;

/** A viewer as cached: `mailAdmin` (holds `mail.settings.manage`) waits for the workspace policy, which is read fresh on every call. */
type CachedViewer = ConversationViewer & { mailAdmin: boolean };

interface Entry {
  at: number;
  viewers: Promise<CachedViewer[]>;
}

/**
 * Who is in a workspace, and what each person may read: the input of the audience resolver.
 *
 * The answer is cached per workspace and permission for 30 seconds, because a busy inbox emits many events a second and each
 * one would otherwise load every member. Staleness is bounded and harmless: a realtime event is only a signal (the client
 * fetches the row over REST, where the real check runs), and a person who must lose a room at once is evicted explicitly.
 * Works the same in the API and the worker: both open the tenant by `orgId`, neither needs a request.
 */
@Injectable()
export class MemberDirectory {
  private readonly cache = new Map<string, Entry>();

  constructor(
    private readonly db: DatabaseService,
    private readonly rbac: RbacService,
  ) {}

  /** Every active staff user of the workspace with their scope for `permission` (null: no allow grant) and their teams. */
  async viewers(orgId: number, permission: string): Promise<ConversationViewer[]> {
    const cached = await this.cachedViewers(orgId, permission);
    // The personal-mailbox policy is never cached: an admin switched off must stop receiving at once, in every process.
    const adminsRead = cached.some((v) => v.mailAdmin)
      ? await this.db.txAs({ orgId }, (tx) => adminsCanReadPersonal(tx, orgId))
      : false;
    return cached.map(({ mailAdmin, ...viewer }) => ({
      ...viewer,
      readsPersonalMail: mailAdmin && adminsRead,
    }));
  }

  /** The staff users who hold `mail.settings.manage` (the admins of the personal-mailbox rule), from the 30 second member cache. */
  async mailAdminIds(orgId: number): Promise<number[]> {
    const cached = await this.cachedViewers(orgId, PERM_CONVERSATION_READ_KEY);
    return cached.filter((v) => v.mailAdmin).map((v) => v.userId);
  }

  private cachedViewers(orgId: number, permission: string): Promise<CachedViewer[]> {
    const key = `${orgId}:${permission}`;
    const now = Date.now();
    const hit = this.cache.get(key);
    if (hit && now - hit.at < CACHE_TTL_MS) return hit.viewers;

    const viewers = this.load(orgId, permission);
    // A failed load must not be remembered for 30 seconds.
    viewers.catch(() => this.cache.delete(key));
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(key, { at: now, viewers });
    return viewers;
  }

  /** One user as a viewer, never from the cache: used at the moment a socket asks to join, when the answer must be current. */
  async viewer(orgId: number, userId: number, permission: string): Promise<ConversationViewer> {
    const grants = await this.rbac.grantsForUser(orgId, userId);
    const can = this.rbac.can(grants, permission);
    const teamIds = await this.teamIdsFor(orgId, userId, can.allowed ? can.scope : null);
    const readsUnassigned = viewerReadsUnassigned(
      permission,
      can.allowed ? can.scope : null,
      this.rbac.can(grants, PERM_CONVERSATION_READ_UNASSIGNED).allowed,
    );
    const mailAdmin = this.rbac.can(grants, PERM_MAIL_SETTINGS_MANAGE).allowed;
    const readsPersonalMail = mailAdmin
      ? await this.db.txAs({ orgId, userId }, (tx) => adminsCanReadPersonal(tx, orgId))
      : false;
    return {
      userId,
      scope: can.allowed ? can.scope : null,
      teamIds,
      readsUnassigned,
      readsPersonalMail,
    };
  }

  /** The internal id of a team named by uuid, and whether the user belongs to it. Null when the team is not in this workspace. */
  async teamMembership(
    orgId: number,
    userId: number,
    teamUuid: string,
  ): Promise<{ teamId: number; member: boolean } | null> {
    const res = await this.db.txAs({ orgId, userId }, async (tx) =>
      tx.execute(sql`
        SELECT t.id AS team_id,
               EXISTS (
                 SELECT 1 FROM team_members tm
                 WHERE tm.org_id = t.org_id AND tm.team_id = t.id AND tm.user_id = ${userId}
               ) AS member
        FROM teams t
        WHERE t.org_id = ${orgId} AND t.uuid = ${teamUuid}::uuid
      `),
    );
    const row = res.rows[0] as { team_id: string | number; member: boolean } | undefined;
    return row ? { teamId: Number(row.team_id), member: row.member === true } : null;
  }

  /** Forget a workspace's cached lists (after a role or team change this process knows about). */
  invalidate(orgId: number): void {
    for (const key of this.cache.keys()) if (key.startsWith(`${orgId}:`)) this.cache.delete(key);
  }

  private async load(orgId: number, permission: string): Promise<CachedViewer[]> {
    const { users, teams, parents } = await this.db.txAs({ orgId }, async (tx) => {
      const u = await tx.execute(
        sql`SELECT id FROM users WHERE org_id = ${orgId} AND status = 'active'`,
      );
      const t = await tx.execute(
        sql`SELECT user_id, team_id FROM team_members WHERE org_id = ${orgId}`,
      );
      const p = await tx.execute(sql`SELECT id, parent_team_id FROM teams WHERE org_id = ${orgId}`);
      return {
        users: u.rows as Array<{ id: string | number }>,
        teams: t.rows as Array<{ user_id: string | number; team_id: string | number }>,
        parents: p.rows as Array<{ id: string | number; parent_team_id: string | number | null }>,
      };
    });

    const teamsByUser = new Map<number, number[]>();
    for (const row of teams) {
      const list = teamsByUser.get(Number(row.user_id)) ?? [];
      list.push(Number(row.team_id));
      teamsByUser.set(Number(row.user_id), list);
    }

    const parentOf = new Map<number, number | null>(
      parents.map((r) => [Number(r.id), r.parent_team_id === null ? null : Number(r.parent_team_id)]),
    );

    return Promise.all(
      users.map(async ({ id }) => {
        const userId = Number(id);
        const grants = await this.rbac.grantsForUser(orgId, userId);
        const can = this.rbac.can(grants, permission);
        const scope = can.allowed ? can.scope : null;
        const own = teamsByUser.get(userId) ?? [];
        return {
          userId,
          scope,
          teamIds: scope === 'team_and_below' ? withDescendants(own, parentOf) : own,
          readsUnassigned: viewerReadsUnassigned(
            permission,
            scope,
            this.rbac.can(grants, PERM_CONVERSATION_READ_UNASSIGNED).allowed,
          ),
          mailAdmin: this.rbac.can(grants, PERM_MAIL_SETTINGS_MANAGE).allowed,
        };
      }),
    );
  }

  private async teamIdsFor(
    orgId: number,
    userId: number,
    scope: ConversationViewer['scope'],
  ): Promise<number[]> {
    const res = await this.db.txAs({ orgId, userId }, async (tx) =>
      tx.execute(
        sql`SELECT team_id FROM team_members WHERE org_id = ${orgId} AND user_id = ${userId}`,
      ),
    );
    const own = (res.rows as Array<{ team_id: string | number }>).map((r) => Number(r.team_id));
    if (scope !== 'team_and_below' || own.length === 0) return own;
    const all = await this.db.txAs({ orgId, userId }, async (tx) =>
      tx.execute(sql`SELECT id, parent_team_id FROM teams WHERE org_id = ${orgId}`),
    );
    const parentOf = new Map<number, number | null>(
      (all.rows as Array<{ id: string | number; parent_team_id: string | number | null }>).map(
        (r) => [Number(r.id), r.parent_team_id === null ? null : Number(r.parent_team_id)],
      ),
    );
    return withDescendants(own, parentOf);
  }
}
