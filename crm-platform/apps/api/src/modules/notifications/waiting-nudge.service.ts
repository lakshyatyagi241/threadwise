import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import type { Tx } from '@crm/db';
import {
  notifyConfig,
  waitingConfig,
  type WaitingConfig,
} from '../../config/domains/notifications.env';
import { DatabaseService } from '../../infra/db/database.service';
import { MemberDirectory, PERM_CONVERSATION_READ, channelOwnerSql } from '../../realtime';
import { PERM_CONVERSATION_REPLY, senderName } from './conversation-notification.consumer';
import {
  capRecipients,
  recipientsForWaiting,
  waitingCopy,
  waitingKey,
  waitingSkipReason,
  type WaitingSkip,
} from './conversation-notification-rules';
import { ConversationReadState } from './conversation-read-state';
import { NotificationFanout, type PendingNotification } from './notification-fanout';

export interface WaitingSweepResult {
  /** The feature is off (its switch, or the conversation notifications switch). */
  disabled: boolean;
  /** Chats the indexed query returned (at most the sweep's cap). */
  candidates: number;
  /** Bell rows written (one per person told). */
  rows: number;
  /** Chats that got at least one row. */
  nudged: number;
  /** Chats dropped after the fresh read, by the rule that dropped them. */
  skipped: Partial<Record<WaitingSkip | 'nobody', number>>;
  durationMs: number;
}

interface FactsRow {
  id: string | number;
  uuid: string;
  status: string;
  archived: boolean;
  muted_at: string | Date | null;
  assignee_user_id: string | number | null;
  assignee_team_id: string | number | null;
  assignee_agent_id: string | number | null;
  waiting_since: string | Date | null;
  last_inbound_at: string | Date | null;
  unread_count: number;
  title: string;
  peer_name: string | null;
  peer_key: string;
  channel_kind: string;
  channel_owner_user_id: string | number | null;
  message_uuid: string | null;
  message_body: string | null;
  nudged: boolean;
}

const ms = (v: string | Date | null): number | null => (v === null ? null : new Date(v).getTime());
const num = (v: string | number | null): number | null => (v === null ? null : Number(v));

/**
 * The "waiting for a reply" nudge for unassigned chats (BL-098, docs/specs/realtime-notifications.md section 19).
 *
 * The rule "a later customer message on an unassigned chat tells nobody" stands: everyone who can answer was told at the first message.
 * Its cost is that nobody owns the chat, so it can sit unanswered. Once per minute this sweep finds the chats that are still unassigned
 * and open, whose latest customer message has gone unanswered for `NOTIFY_WAITING_MINUTES` (default 5), and tells the people who may read
 * AND reply, exactly as for a new unassigned chat, once per waiting episode.
 *
 * How it stays cheap and safe:
 *  - Step 1 is one indexed, cross-tenant query (`idx_conversations_waiting_nudge`, a partial index of exactly these chats) that returns
 *    ids only, newest message first, at most `NOTIFY_WAITING_BATCH`. A chat already nudged in its current wait is left out here, so the
 *    cap is never spent on chats that are done. Newest first so a chat nobody can be told about (no one may reply, everyone has the bell
 *    off) never starves the fresh ones: it is looked at again each minute for free, and the lookback window ages it out. It runs
 *    privileged because it spans tenants, like the outbox drain.
 *  - Step 2 is per workspace, under the tenant (RLS applies): one read of the candidates' current facts with the newest customer message
 *    in a LATERAL join (no query per chat), then `waitingSkipReason` decides, then the rows are written through `NotificationFanout`, the
 *    same tail as every other producer: bell row, live socket event and toast, browser push. A chat that was assigned, answered, read,
 *    muted or closed between step 1 and step 2 is dropped by the fresh read.
 *  - Once per episode: the dedupe key is the conversation plus the newest customer message, and a chat is skipped when a nudge already
 *    exists since its wait began (`waiting_since`, which only a human reply clears), so more customer messages in the same unanswered
 *    stretch do not nudge again. After an answer, the next unanswered message starts a new episode. Repeated sweeps and two worker pods
 *    write one row (the unique dedupe key), and only the writer announces it.
 *  - Nobody who has the chat open right now (a read in the last minute, `ConversationReadState`) is told.
 *
 * Runs only in the worker (imported by NotificationsWorkerModule). The push leg is the existing one: the title is the contact's name
 * and the body "Waiting for a reply", never the message text (`push-payload.ts`).
 */
@Injectable()
export class WaitingNudgeService {
  private readonly logger = new Logger(WaitingNudgeService.name);
  private running = false;

  constructor(
    private readonly db: DatabaseService,
    private readonly directory: MemberDirectory,
    private readonly readState: ConversationReadState,
    private readonly fanout: NotificationFanout,
  ) {}

  @Cron('0 * * * * *')
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.sweep();
    } catch (err) {
      this.logger.error({ err }, 'waiting-for-reply sweep failed');
    } finally {
      this.running = false;
    }
  }

  /** One pass. `now` and `config` are parameters so tests drive a fake clock and a small batch. */
  async sweep(
    now: Date = new Date(),
    config: WaitingConfig = waitingConfig(),
  ): Promise<WaitingSweepResult> {
    const started = Date.now();
    const result: WaitingSweepResult = {
      disabled: !config.enabled,
      candidates: 0,
      rows: 0,
      nudged: 0,
      skipped: {},
      durationMs: 0,
    };
    if (!config.enabled) return result;

    const candidates = await this.candidates(now, config);
    result.candidates = candidates.length;
    const byOrg = new Map<number, number[]>();
    for (const c of candidates) byOrg.set(c.orgId, [...(byOrg.get(c.orgId) ?? []), c.id]);

    for (const [orgId, ids] of byOrg) {
      try {
        const done = await this.nudgeWorkspace(orgId, ids, now, config, result);
        await this.fanout.publish(orgId, done);
      } catch (err) {
        // One workspace's failure must not hold back the others; the next sweep retries it (writes are idempotent).
        this.logger.error({ err, orgId }, 'waiting-for-reply sweep failed for a workspace');
      }
    }
    result.durationMs = Date.now() - started;
    if (result.rows > 0) {
      this.logger.log(
        { candidates: result.candidates, nudged: result.nudged, rows: result.rows },
        'waiting-for-reply sweep done',
      );
    }
    return result;
  }

  /** Step 1: the ids of chats that look like they are waiting, across workspaces, one indexed query. */
  private candidates(
    now: Date,
    config: WaitingConfig,
  ): Promise<Array<{ orgId: number; id: number }>> {
    const newest = new Date(now.getTime() - config.minutes * 60_000).toISOString();
    const oldest = new Date(now.getTime() - config.lookbackHours * 3_600_000).toISOString();
    return this.db.privileged(async (tx) => {
      // The predicate repeats the partial index's, which is what lets the planner use it; group threads are filtered afterwards.
      const res = await tx.execute(sql`
        SELECT c.org_id, c.id
        FROM conversations c
        WHERE c.status = 'open' AND NOT c.archived AND c.muted_at IS NULL
          AND c.assignee_user_id IS NULL AND c.assignee_team_id IS NULL AND c.assignee_agent_id IS NULL
          AND c.waiting_since IS NOT NULL AND c.unread_count > 0
          AND c.last_inbound_at <= ${newest}::timestamptz AND c.last_inbound_at >= ${oldest}::timestamptz
          AND c.peer_key NOT LIKE 'g:%'
          AND NOT EXISTS (
            SELECT 1 FROM inbox_notifications n
            WHERE n.org_id = c.org_id AND n.type = 'chat_waiting' AND n.subject_uuid = c.uuid
              AND n.created_at >= c.waiting_since
          )
        ORDER BY c.last_inbound_at DESC
        LIMIT ${config.batch}`);
      return (res.rows as Array<{ org_id: string | number; id: string | number }>).map((r) => ({
        orgId: Number(r.org_id),
        id: Number(r.id),
      }));
    });
  }

  /** Step 2 for one workspace: fresh facts, the rules, the rows. Returns what to announce after the commit. */
  private async nudgeWorkspace(
    orgId: number,
    ids: number[],
    now: Date,
    config: WaitingConfig,
    result: WaitingSweepResult,
  ): Promise<PendingNotification[]> {
    const skip = (why: WaitingSkip | 'nobody') => {
      result.skipped[why] = (result.skipped[why] ?? 0) + 1;
    };
    const [readers, repliers] = await Promise.all([
      this.directory.viewers(orgId, PERM_CONVERSATION_READ),
      this.directory.viewers(orgId, PERM_CONVERSATION_REPLY),
    ]);

    return this.db.txAs({ orgId, userId: null }, async (tx) => {
      const rows = await this.facts(tx, orgId, ids);
      const pending: PendingNotification[] = [];
      for (const r of rows) {
        const lastInboundAt = ms(r.last_inbound_at);
        const reason = waitingSkipReason(
          {
            status: r.status,
            archived: r.archived,
            muted: r.muted_at !== null,
            assigneeUserId: num(r.assignee_user_id),
            assigneeTeamId: num(r.assignee_team_id),
            assigneeAgentId: num(r.assignee_agent_id),
            group: r.peer_key.startsWith('g:'),
            waitingSince: ms(r.waiting_since),
            lastInboundAt,
            unread: r.unread_count > 0,
            latestInboundMessageUuid: r.message_uuid,
            nudgedThisEpisode: r.nudged,
          },
          now.getTime(),
          config.minutes,
          config.lookbackHours,
        );
        if (reason) {
          skip(reason);
          continue;
        }

        const capped = capRecipients(
          recipientsForWaiting(
            {
              assigneeUserId: null,
              assigneeTeamId: null,
              channelOwnerUserId: num(r.channel_owner_user_id),
            },
            readers,
            repliers,
          ),
          notifyConfig().maxRecipients,
        );
        if (capped.truncated) {
          this.logger.warn(
            { orgId, conversationId: r.uuid },
            'waiting nudge truncated to the recipient cap',
          );
        }
        // Whoever has the chat open right now is looking at it; an alert would only interrupt them.
        const looking = await this.readState.seenSince(
          orgId,
          capped.userIds,
          r.uuid,
          lastInboundAt!,
        );
        const userIds = capped.userIds.filter((id) => !looking.has(id));
        if (userIds.length === 0) {
          skip('nobody');
          continue;
        }

        const name = senderName(r);
        const preview = (r.message_body ?? '').replace(/\s+/g, ' ').trim();
        const copy = waitingCopy(name, preview);
        const written = await this.fanout.write(tx, orgId, 'chat_waiting', userIds, () => ({
          title: copy.title,
          body: copy.body,
          link: `/inbox?c=${r.uuid}`,
          data: {
            conversationId: r.uuid,
            contactName: name,
            channelKind: r.channel_kind,
            preview: copy.body,
            waitingMinutes: Math.max(1, Math.floor((now.getTime() - lastInboundAt!) / 60_000)),
          },
          dedupeKey: waitingKey(r.uuid, r.message_uuid!),
          subjectKind: 'conversation',
          subjectUuid: r.uuid,
        }));
        if (written.length > 0) {
          result.nudged += 1;
          result.rows += written.length;
          pending.push(...written);
        } else {
          skip('nobody');
        }
      }
      return pending;
    });
  }

  /**
   * The candidates as they are now, in one statement: the chat, its channel kind, its newest customer message (a LATERAL probe of
   * `idx_messages_thread`; `created_at >= waiting_since` lets the partitioned table prune), and whether a nudge exists since the wait began.
   */
  private async facts(tx: Tx, orgId: number, ids: number[]): Promise<FactsRow[]> {
    const res = await tx.execute(sql`
      SELECT c.id, c.uuid, c.status, c.archived, c.muted_at, c.assignee_user_id, c.assignee_team_id, c.assignee_agent_id,
             c.waiting_since, c.last_inbound_at, c.unread_count, c.title, c.peer_name, c.peer_key,
             ch.kind AS channel_kind, ${channelOwnerSql('c')} AS channel_owner_user_id, m.uuid AS message_uuid, m.preview AS message_body,
             EXISTS (
               SELECT 1 FROM inbox_notifications n
               WHERE n.org_id = c.org_id AND n.type = 'chat_waiting' AND n.subject_uuid = c.uuid
                 AND n.created_at >= c.waiting_since
             ) AS nudged
      FROM conversations c
      JOIN channels ch ON ch.org_id = c.org_id AND ch.id = c.channel_id
      LEFT JOIN LATERAL (
        SELECT x.uuid, CASE WHEN x.deleted_at IS NULL THEN left(x.body, 200) END AS preview
        FROM messages x
        WHERE x.org_id = c.org_id AND x.conversation_id = c.id AND x.direction = 'in'
          AND x.created_at >= c.waiting_since
        ORDER BY x.seq DESC
        LIMIT 1
      ) m ON true
      WHERE c.org_id = ${orgId}
        AND c.id IN (${sql.join(
          ids.map((i) => sql`${i}`),
          sql`, `,
        )})
      ORDER BY c.last_inbound_at DESC`);
    return res.rows as unknown as FactsRow[];
  }
}
