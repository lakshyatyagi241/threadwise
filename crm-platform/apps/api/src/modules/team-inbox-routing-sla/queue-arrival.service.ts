import { Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { HandoffTraceLine } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { AuditService } from '../../kernel/audit/audit.service';
import {
  ConversationEventsRepository,
  InboxRealtimePublisher,
  type LockedConversation,
} from '../team-inbox-conversations';
import { HandoffRepository } from './handoff.repository';

type Rows = { rows: Array<Record<string, unknown>> };

/** Why nobody took a new chat; the trace and the timeline carry it, and the card's Details list shows it. */
export type ArrivalWhy = 'no_rule_matched' | 'nobody_available' | 'team_queue';

/** What the caller announces once its transaction has committed. */
export interface ArrivalQueued {
  uuid: string;
  rowVersion: number;
  assigneeTeamId: number | null;
  channelOwnerUserId: number | null;
}

/**
 * A new chat that automatic assignment could not give to anybody enters the waiting queue (Auto-assignment page: "...then Everyone else,
 * then the waiting queue"). Before, such a chat only sat in the Unassigned tab, while the Waiting tab, the age badge and the queue timers
 * covered only chats a bot or a person handed over.
 *
 * The same state a handoff writes: `handling = 'waiting'`, `handling_since = now`, and a handoff card (source `arrival`) holding the
 * trace and the timers' progress. Differences from a handoff, on purpose:
 *  - it does NOT mute a bot (see `InboundMessageHooks.botMuted`): no one has decided that a person must answer, so a flow or an assistant
 *    that was answering the chat keeps answering until a person takes it;
 *  - it never happens when automatic assignment is off, when the plan has no routing, or for a chat somebody already holds, a personal
 *    mailbox, an archived or a spam chat; and a rule that started a flow leaves the chat to that flow.
 *
 * Idempotent: one live card per conversation (a repeat finds it), and the card's key names the message the engine looked at. Called
 * inside the routing transaction, with the conversation locked; nothing is written for a chat that is not eligible.
 */
@Injectable()
export class QueueArrivalService {
  private readonly logger = new Logger(QueueArrivalService.name);

  constructor(
    private readonly repo: HandoffRepository,
    private readonly events: ConversationEventsRepository,
    private readonly audit: AuditService,
    private readonly publisher: InboxRealtimePublisher,
  ) {}

  async enter(
    tx: Tx,
    orgId: number,
    conv: Pick<LockedConversation, 'id' | 'uuid' | 'assigneeTeamId' | 'channelOwnerUserId'>,
    messageUuid: string,
    why: ArrivalWhy,
  ): Promise<ArrivalQueued | null> {
    // Read again under the lock: the rules above may have marked the chat spam or assigned a person since the snapshot.
    const res = (await tx.execute(sql`
      SELECT status, archived, handling, assignee_user_id, assignee_agent_id
      FROM conversations WHERE org_id = ${orgId} AND id = ${conv.id}`)) as unknown as Rows;
    const c = res.rows[0];
    if (
      !c ||
      c.status !== 'open' ||
      c.archived === true ||
      c.handling !== null ||
      c.assignee_user_id !== null ||
      c.assignee_agent_id !== null ||
      conv.channelOwnerUserId !== null
    )
      return null;
    const key = `arrival:${conv.uuid}:${messageUuid}`;
    if ((await this.repo.byIdempotencyKey(tx, orgId, key)) !== null) return null;
    if ((await this.repo.liveFor(tx, orgId, conv.id)) !== null) return null;

    const card = await this.repo.insert(tx, orgId, {
      conversationId: conv.id,
      source: 'arrival',
      reason: 'other',
      reasonText: null,
      summary: null,
      answers: {},
      destinationKind: 'rules',
      destinationTeamId: conv.assigneeTeamId,
      destinationUserId: null,
      priority: null,
      idempotencyKey: key,
      flowRunId: null,
      nodeId: null,
      requestedBy: null,
    });
    const trace: HandoffTraceLine[] = [
      { step: 'arrival', result: 'info', why },
      ...(conv.assigneeTeamId !== null
        ? [{ step: 'team_queue', result: 'chosen' as const, why: 'rule_named_a_team' }]
        : []),
    ];
    await this.repo.finish(tx, orgId, card.id, {
      status: 'waiting',
      outcome: 'waiting',
      assignedUserId: null,
      assignedTeamId: conv.assigneeTeamId,
      trace,
    });
    await this.repo.setHandling(tx, orgId, conv.id, 'waiting');
    await this.events.append(tx, orgId, {
      conversationId: conv.id,
      type: 'handoff_requested',
      actorKind: 'system',
      payload: { source: 'arrival', why, handoffId: card.uuid },
    });
    await this.audit.record(tx, {
      module: 'conversations',
      recordId: conv.id,
      action: 'update',
      delta: { handling: { old: null, new: 'waiting' } },
    });
    const after = (await tx.execute(
      sql`SELECT row_version FROM conversations WHERE org_id = ${orgId} AND id = ${conv.id}`,
    )) as unknown as Rows;
    return {
      uuid: conv.uuid,
      rowVersion: Number(after.rows[0]?.row_version ?? 0),
      assigneeTeamId: conv.assigneeTeamId,
      channelOwnerUserId: conv.channelOwnerUserId,
    };
  }

  /** After the commit: open screens learn that the chat is waiting. Never throws. */
  async announce(orgId: number, q: ArrivalQueued): Promise<void> {
    try {
      await this.publisher.conversationChanged(
        orgId,
        {
          uuid: q.uuid,
          rowVersion: q.rowVersion,
          assigneeUserId: null,
          assigneeTeamId: q.assigneeTeamId,
          channelOwnerUserId: q.channelOwnerUserId,
        },
        ['handling'],
      );
    } catch (err) {
      this.logger.warn({ err, orgId }, 'could not announce an arrival in the queue');
    }
  }
}
