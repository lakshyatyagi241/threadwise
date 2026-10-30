import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Redis } from 'ioredis';
import {
  AGENT_STATUS_AUTOMATION_FEATURE,
  HANDOFF_GATES,
  MEMBER_AVAILABILITY_CHANGED,
  type HandoffTraceLine,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import {
  loadAgentStatuses,
  manualUntil,
  readAvailabilityPrefs,
  readStatusRow,
  writeAvailability,
} from '../../common/agent-status';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { REDIS_CLIENT } from '../../infra/redis/redis.module';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { channelOwnerSql } from '../../realtime';
import { AuthKeys } from '../auth';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import {
  ConversationEventsRepository,
  ConversationsRepository,
  InboxRealtimePublisher,
} from '../team-inbox-conversations';
import { AssignmentService, type AssignmentChange } from './assignment.service';
import { HandoffRepository } from './handoff.repository';

type Rows = { rows: Array<Record<string, unknown>> };
const rowsOf = (r: unknown): Array<Record<string, unknown>> => (r as Rows).rows;
const ms = (v: unknown): number => (v ? new Date(v as string).getTime() : 0);

/** Why a person's chats are being returned (the trace and the logs carry it). */
export type AwayReason = 'offline' | 'inactive' | 'leave' | 'timeout';

const BATCH = 100;

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
 *  - **Chat idle rules** (legacy #15590, #15593): `unansweredReturnMinutes` puts an open chat whose customer has waited that long with no
 *    human reply back in the team's queue; `idleCloseMinutes` resolves an agent-held open chat with no message for that long. Both off by
 *    default; each chat is re-read under its row lock before it is touched, so a reply that lands meanwhile wins.
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
    private readonly events: ConversationEventsRepository,
    private readonly publisher: InboxRealtimePublisher,
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
    const automation = await this.entitlements.featureEnabled(
      orgId,
      AGENT_STATUS_AUTOMATION_FEATURE,
    );
    const target = await this.db.txAs({ orgId }, async (tx) => {
      if (!(await this.repo.settings(tx, orgId)).away.returnUnanswered) return [];
      // A stale event must not take chats from somebody who is back: the person must still be away (the effective status: Away by their own
      // choice or working hours) or, for a leave, on an active leave.
      const stillAway =
        reason === 'leave'
          ? await this.onLeave(tx, orgId, userId)
          : await this.isAway(tx, orgId, userId, automation);
      if (!stillAway) return [];
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

  /** A leave is `active` from its start until it ends or is cancelled (leave.service); a stale leave event finds none once it is over. */
  private async onLeave(tx: Tx, orgId: number, userId: number): Promise<boolean> {
    const res = await tx.execute(
      sql`SELECT 1 FROM member_leaves WHERE org_id = ${orgId} AND user_id = ${userId} AND status = 'active' LIMIT 1`,
    );
    return rowsOf(res).length > 0;
  }

  private async isAway(
    tx: Tx,
    orgId: number,
    userId: number,
    automation: boolean,
  ): Promise<boolean> {
    const st = (
      await loadAgentStatuses(tx, orgId, [userId], { automationAllowed: automation })
    ).get(userId);
    return st !== undefined && !st.routable;
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

  // --- chat idle rules -------------------------------------------------------------------------------------------------------

  /** One pass over the workspaces that chose an idle rule. Returns how many chats went back to the queue and how many were resolved. */
  async sweepIdle(now: Date = new Date()): Promise<{ returned: number; closed: number }> {
    const orgs = await this.db.privileged(async (tx) =>
      rowsOf(
        await tx.execute(sql`
          SELECT org_id, handoff_unanswered_return_min AS r, handoff_idle_close_min AS c FROM workspace_settings
          WHERE handoff_unanswered_return_min IS NOT NULL OR handoff_idle_close_min IS NOT NULL`),
      ).map((r) => ({
        orgId: Number(r.org_id),
        returnMin: r.r === null ? null : Number(r.r),
        closeMin: r.c === null ? null : Number(r.c),
      })),
    );
    let returned = 0;
    let closed = 0;
    for (const { orgId, returnMin, closeMin } of orgs) {
      try {
        if (!(await this.entitled(orgId))) continue;
        if (returnMin !== null) returned += await this.returnTimedOut(orgId, returnMin, now);
        if (closeMin !== null) closed += await this.closeIdle(orgId, closeMin, now);
      } catch (err) {
        this.logger.error({ err, orgId }, 'chat idle rules failed for a workspace');
      }
    }
    return { returned, closed };
  }

  private async returnTimedOut(orgId: number, minutes: number, now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - minutes * 60_000).toISOString();
    const rows = await this.db.txAs({ orgId }, async (tx) =>
      rowsOf(
        await tx.execute(sql`
          SELECT c.uuid, c.assignee_user_id FROM conversations c
          WHERE c.org_id = ${orgId} AND c.status = 'open' AND NOT c.archived AND c.assignee_user_id IS NOT NULL
            AND c.waiting_since < ${cutoff}::timestamptz AND c.peer_key NOT LIKE 'g:%' AND ${channelOwnerSql('c')} IS NULL
          ORDER BY c.waiting_since LIMIT ${BATCH}`),
      ),
    );
    let returned = 0;
    for (const r of rows) {
      try {
        const done = await RequestContextStore.run(
          {
            requestId: `idle-return-${r.uuid}`,
            orgId,
            actorType: 'system',
            actorId: null,
            userId: null,
          },
          () => this.returnOne(orgId, Number(r.assignee_user_id), String(r.uuid), 'timeout'),
        );
        if (done) returned += 1;
      } catch (err) {
        this.logger.error({ err, orgId }, 'returning a timed-out chat failed');
      }
    }
    return returned;
  }

  private async closeIdle(orgId: number, minutes: number, now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - minutes * 60_000).toISOString();
    const uuids = await this.db.txAs({ orgId }, async (tx) =>
      rowsOf(
        await tx.execute(sql`
          SELECT c.uuid FROM conversations c
          WHERE c.org_id = ${orgId} AND c.status = 'open' AND NOT c.archived AND c.assignee_user_id IS NOT NULL
            AND c.last_message_at < ${cutoff}::timestamptz AND c.peer_key NOT LIKE 'g:%' AND ${channelOwnerSql('c')} IS NULL
          ORDER BY c.last_message_at LIMIT ${BATCH}`),
      ).map((r) => String(r.uuid)),
    );
    let closed = 0;
    for (const uuid of uuids) {
      try {
        const done = await RequestContextStore.run(
          {
            requestId: `idle-close-${uuid}`,
            orgId,
            actorType: 'system',
            actorId: null,
            userId: null,
          },
          () => this.closeOne(orgId, uuid, cutoff),
        );
        if (done) closed += 1;
      } catch (err) {
        this.logger.error({ err, orgId }, 'resolving an idle chat failed');
      }
    }
    return closed;
  }

  /** Resolves one idle chat. Re-reads it under its row lock: a message that arrived since the list was read keeps the chat open. */
  private async closeOne(orgId: number, uuid: string, cutoff: string): Promise<boolean> {
    const row = await this.db.txAs({ orgId }, async (tx) => {
      const locked = await this.conversations.lockByUuid(tx, orgId, uuid);
      if (!locked || locked.status !== 'open' || locked.assigneeUserId === null) return null;
      const idle = await tx.execute(
        sql`SELECT 1 FROM conversations WHERE org_id = ${orgId} AND id = ${locked.id} AND last_message_at < ${cutoff}::timestamptz`,
      );
      if (rowsOf(idle).length === 0) return null;
      await this.conversations.setStatus(tx, orgId, locked.id, {
        status: 'resolved',
        resolvedAt: 'now',
        resolvedBy: null,
        clearSnooze: false,
      });
      await this.events.append(tx, orgId, {
        conversationId: locked.id,
        type: 'resolved',
        actorKind: 'system',
        payload: { from: 'open', to: 'resolved', reason: 'idle_timeout' },
      });
      await this.outbox.emit(tx, {
        aggregateModule: 'conversations',
        aggregateId: locked.id,
        orgId,
        eventType: 'conversation.resolved',
        payload: { conversationId: uuid, status: 'resolved', from: 'open', resolvedBy: null },
      });
      await tx.execute(sql`
        INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta)
        VALUES (${orgId}, NULL, 'system', 'conversations', ${locked.id}, 'update',
          ${JSON.stringify({ status: { old: 'open', new: 'resolved' }, reason: { old: null, new: 'idle_timeout' } })}::jsonb)`);
      return await this.conversations.byUuid(tx, orgId, uuid);
    });
    if (!row) return false;
    await this.publisher.conversationChanged(
      orgId,
      {
        uuid,
        rowVersion: row.rowVersion,
        assigneeUserId: row.assigneeUserId,
        assigneeTeamId: row.assigneeTeamId,
        channelOwnerUserId: row.channelOwnerUserId,
      },
      ['status'],
    );
    return true;
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
    const automation = await this.entitlements.featureEnabled(
      orgId,
      AGENT_STATUS_AUTOMATION_FEATURE,
    );
    const people = await this.db.retry.txAs({ orgId }, async (tx) => {
      const online = rowsOf(
        await tx.execute(sql`
          SELECT u.id FROM users u LEFT JOIN agent_statuses s ON s.org_id = u.org_id AND s.user_id = u.id
          WHERE u.org_id = ${orgId} AND u.status = 'active' AND COALESCE(s.status, 'online') = 'online'`),
      ).map((r) => Number(r.id));
      // Only people who are Available now: somebody already Away (on leave, outside their working hours) has nothing to switch off.
      const statuses = await loadAgentStatuses(tx, orgId, online, {
        automationAllowed: automation,
        now,
      });
      online.splice(0, online.length, ...online.filter((id) => statuses.get(id)?.routable));
      if (online.length === 0) return [];
      const sessions = rowsOf(
        await tx.execute(sql`
          SELECT user_id, uuid, last_used_at, (revoked_at IS NULL AND expires_at > now()) AS live
          FROM auth_sessions WHERE org_id = ${orgId} AND user_id IN (${sql.join(
            online.map((i) => sql`${i}`),
            sql`, `,
          )})`),
      );
      // The live sessions' activity marks in one round trip (MGET), not one GET per session. A failed read counts as no mark.
      const live = sessions.filter((s) => s.live === true);
      const marks = live.length
        ? await this.redis
            .mget(...live.map((s) => AuthKeys.activity(String(s.uuid))))
            .catch(() => null)
        : null;
      const markOf = new Map(live.map((s, i) => [String(s.uuid), marks?.[i] ?? null]));
      const last = new Map<number, number>();
      for (const s of sessions) {
        const uid = Number(s.user_id);
        let at = ms(s.last_used_at);
        const raw = markOf.get(String(s.uuid));
        if (raw) at = Math.max(at, Number(raw));
        last.set(uid, Math.max(last.get(uid) ?? 0, at));
      }
      const cutoff = now.getTime() - minutes * 60_000;
      return online.filter((id) => (last.get(id) ?? 0) < cutoff);
    });
    let set = 0;
    for (const userId of people) {
      const changed = await this.db.txAs({ orgId }, async (tx) => {
        const row = await readStatusRow(tx, orgId, userId, true);
        if (row.status === 'offline') return false;
        // Recorded as the person's own (manual) Away: while they automate it ends at the next schedule boundary, so the next morning the
        // schedule decides; without automation it stays until they switch back (as it always did).
        const prefs = readAvailabilityPrefs(row.preferences);
        await writeAvailability(tx, orgId, userId, {
          status: 'offline',
          availability: {
            manual: {
              status: 'offline',
              setAt: now.toISOString(),
              until: manualUntil(prefs.hours, automation, now),
            },
            ...(prefs.hours ? { hours: prefs.hours } : {}),
          },
        });
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
