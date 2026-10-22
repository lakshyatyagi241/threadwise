import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { HANDOFF_GATES, MEMBER_AVAILABILITY_CHANGED, type HandoffTraceLine } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { channelOwnerSql } from '../../realtime';
import { AuthKeys } from '../auth';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { ConversationsRepository } from '../team-inbox-conversations';
import { AssignmentService, type AssignmentChange } from './assignment.service';
import { HandoffRepository } from './handoff.repository';

type Rows = { rows: Array<Record<string, unknown>> };
const rowsOf = (r: unknown): Array<Record<string, unknown>> => (r as Rows).rows;
const ms = (v: unknown): number => (v ? new Date(v as string).getTime() : 0);

/** Why a person's chats are being returned (the trace and the logs carry it). */
export type AwayReason = 'offline' | 'inactive' | 'leave';

/**
 * The away rules (Auto-assignment > Waiting queue; Smart routing, both OFF by default):
 *
 *  - **Return unanswered chats**: when a person goes Offline or starts a leave, the open chats they hold whose customer is still waiting for
 *    a reply (`waiting_since` is set; only a human reply clears it) go back to the team's queue, with a card and a trace line, so someone
 *    else can take them. Chats they have answered, group threads and personal mailboxes stay as they are.
 *  - **Set inactive people Offline**: an Available person whose sessions show no activity for the chosen minutes is set Offline (audited,
 *    announced like their own switch). Activity is the latest of the session's last request (Redis) and its last use; a person with no live
 *    session counts from their last session use. Nobody is set Available again by the system: they switch back themselves.
 *
 * Gated like the rest of automatic assignment (`inbox_routing`): without it nothing runs, nothing is erased, and the saved settings come back
 * with the feature. Idempotent (a chat already back in the queue is no longer theirs), tenant-safe (each chat under its own tenant and row lock).
 */
@Injectable()
export class AwayService {
  private readonly logger = new Logger(AwayService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: HandoffRepository,
    private readonly assignment: AssignmentService,
    private readonly conversations: ConversationsRepository,
    private readonly outbox: OutboxService,
    private readonly entitlements: PlanEntitlementService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  private async entitled(orgId: number): Promise<boolean> {
    return (
      (await this.entitlements.featureEnabled(orgId, 'inbox_routing')) &&
      (await this.entitlements.featureEnabled(orgId, HANDOFF_GATES.away))
    );
  }

  /** Returns the person's unanswered chats to the queue. Returns how many went back. */
  async returnUnanswered(orgId: number, userId: number, reason: AwayReason): Promise<number> {
    if (!(await this.entitled(orgId))) return 0;
    const target = await this.db.txAs({ orgId }, async (tx) => {
      if (!(await this.repo.settings(tx, orgId)).away.returnUnanswered) return [];
      // A stale event must not take chats from somebody who is back: the person must still be away.
      if (reason !== 'leave' && !(await this.isOffline(tx, orgId, userId))) return [];
      const res = await tx.execute(sql`
        SELECT c.uuid FROM conversations c
        WHERE c.org_id = ${orgId} AND c.assignee_user_id = ${userId} AND c.status = 'open' AND NOT c.archived
          AND c.waiting_since IS NOT NULL AND c.peer_key NOT LIKE 'g:%' AND ${channelOwnerSql('c')} IS NULL
        ORDER BY c.waiting_since LIMIT 200`);
      return rowsOf(res).map((r) => String(r.uuid));
    });
    let returned = 0;
    for (const uuid of target) {
      try {
        const done = await RequestContextStore.run(
          {
            requestId: `away-${uuid}`,
            orgId,
            actorType: 'system',
            actorId: null,
            userId: null,
          },
          () => this.returnOne(orgId, userId, uuid, reason),
        );
        if (done) returned += 1;
      } catch (err) {
        this.logger.error({ err, orgId }, 'returning an unanswered chat failed');
      }
    }
    return returned;
  }

  private async isOffline(tx: Tx, orgId: number, userId: number): Promise<boolean> {
    const res = await tx.execute(
      sql`SELECT status FROM agent_statuses WHERE org_id = ${orgId} AND user_id = ${userId}`,
    );
    return rowsOf(res)[0]?.status === 'offline';
  }

  private async returnOne(
    orgId: number,
    userId: number,
    uuid: string,
    reason: AwayReason,
  ): Promise<boolean> {
    let change: AssignmentChange | null = null;
    const done = await this.db.txAs({ orgId }, async (tx) => {
      const locked = await this.conversations.lockByUuid(tx, orgId, uuid);
      if (!locked || locked.status !== 'open' || locked.assigneeUserId !== userId) return false;
      const still = await tx.execute(
        sql`SELECT 1 FROM conversations WHERE org_id = ${orgId} AND id = ${locked.id} AND waiting_since IS NOT NULL`,
      );
      if (rowsOf(still).length === 0) return false; // answered meanwhile
      const team =
        locked.assigneeTeamId !== null
          ? await this.repo.teamById(tx, orgId, locked.assigneeTeamId)
          : null;
      change = await this.assignment.assignInTx(
        tx,
        orgId,
        locked,
        {
          userId: null,
          teamId: locked.assigneeTeamId,
          userUuid: null,
          teamUuid: team?.uuid ?? null,
        },
        { kind: 'system' },
        'handoff',
        { returnedBecause: reason },
        { handling: 'waiting' },
      );
      const line: HandoffTraceLine = { step: 'away', result: 'info', why: `returned_${reason}` };
      const live = await this.repo.liveFor(tx, orgId, locked.id);
      if (live) await this.repo.appendTrace(tx, orgId, live.id, [line]);
      else {
        const card = await this.repo.insert(tx, orgId, {
          conversationId: locked.id,
          source: 'arrival',
          reason: 'other',
          reasonText: null,
          summary: null,
          answers: {},
          destinationKind: 'rules',
          destinationTeamId: locked.assigneeTeamId,
          destinationUserId: null,
          priority: null,
          idempotencyKey: `away:${locked.uuid}:${locked.rowVersion}`,
          flowRunId: null,
          nodeId: null,
          requestedBy: null,
        });
        await this.repo.finish(tx, orgId, card.id, {
          status: 'waiting',
          outcome: 'waiting',
          assignedUserId: null,
          assignedTeamId: locked.assigneeTeamId,
          trace: [line],
        });
      }
      return true;
    });
    if (change) await this.assignment.afterCommit(orgId, change);
    return done;
  }

  // --- inactivity ------------------------------------------------------------------------------------------------------------

  /** One pass over the workspaces that chose an inactivity limit. Returns how many people were set Offline. */
  async sweepInactive(now: Date = new Date()): Promise<number> {
    const orgs = await this.db.privileged(async (tx) =>
      rowsOf(
        await tx.execute(
          sql`SELECT org_id, handoff_auto_offline_min AS m FROM workspace_settings WHERE handoff_auto_offline_min IS NOT NULL`,
        ),
      ).map((r) => ({ orgId: Number(r.org_id), minutes: Number(r.m) })),
    );
    let set = 0;
    for (const { orgId, minutes } of orgs) {
      try {
        if (await this.entitled(orgId)) set += await this.offlineInactive(orgId, minutes, now);
      } catch (err) {
        this.logger.error({ err, orgId }, 'setting inactive people offline failed');
      }
    }
    return set;
  }

  async offlineInactive(orgId: number, minutes: number, now: Date = new Date()): Promise<number> {
    const people = await this.db.txAs({ orgId }, async (tx) => {
      const online = rowsOf(
        await tx.execute(sql`
          SELECT u.id FROM users u LEFT JOIN agent_statuses s ON s.org_id = u.org_id AND s.user_id = u.id
          WHERE u.org_id = ${orgId} AND u.status = 'active' AND COALESCE(s.status, 'online') = 'online'`),
      ).map((r) => Number(r.id));
      if (online.length === 0) return [];
      const sessions = rowsOf(
        await tx.execute(sql`
          SELECT user_id, uuid, last_used_at, (revoked_at IS NULL AND expires_at > now()) AS live
          FROM auth_sessions WHERE org_id = ${orgId} AND user_id IN (${sql.join(
            online.map((i) => sql`${i}`),
            sql`, `,
          )})`),
      );
      const last = new Map<number, number>();
      for (const s of sessions) {
        const uid = Number(s.user_id);
        let at = ms(s.last_used_at);
        if (s.live === true) {
          const raw = await this.redis.get(AuthKeys.activity(String(s.uuid))).catch(() => null);
          if (raw) at = Math.max(at, Number(raw));
        }
        last.set(uid, Math.max(last.get(uid) ?? 0, at));
      }
      const cutoff = now.getTime() - minutes * 60_000;
      return online.filter((id) => (last.get(id) ?? 0) < cutoff);
    });
    let set = 0;
    for (const userId of people) {
      const changed = await this.db.txAs({ orgId }, async (tx) => {
        const res = await tx.execute(sql`
          INSERT INTO agent_statuses (org_id, user_id, status, last_seen_at)
          VALUES (${orgId}, ${userId}, 'offline', now())
          ON CONFLICT (org_id, user_id) DO UPDATE SET status = 'offline', last_seen_at = now()
            WHERE agent_statuses.status <> 'offline'
          RETURNING user_id`);
        if (rowsOf(res).length === 0) return false;
        await tx.execute(sql`
          INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta)
          VALUES (${orgId}, NULL, 'system', 'members', ${userId}, 'member.availability_changed',
            ${JSON.stringify({ availability: { old: 'online', new: 'offline' }, reason: { old: null, new: 'inactive' } })}::jsonb)`);
        await this.outbox.emit(tx, {
          aggregateModule: 'members',
          aggregateId: userId,
          orgId,
          eventType: MEMBER_AVAILABILITY_CHANGED,
          payload: { userId, status: 'offline', reason: 'inactive' },
        });
        return true;
      });
      if (changed) set += 1;
    }
    return set;
  }
}
