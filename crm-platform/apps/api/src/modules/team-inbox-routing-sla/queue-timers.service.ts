import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  CONVERSATION_QUEUE_REMINDER,
  HANDOFF_GATES,
  type HandoffTraceLine,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { DatabaseService } from '../../infra/db/database.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { CONVERSATIONS_FACADE, type ConversationsFacade } from '../chat-conversations';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import {
  ConversationEventsRepository,
  ConversationsRepository,
  type LockedConversation,
} from '../team-inbox-conversations';
import { AssignmentService, type AssignmentChange } from './assignment.service';
import { HandoffRepository } from './handoff.repository';
import { HandoffService } from './handoff.service';
import {
  dueSteps,
  longestPending,
  renderQueueMessage,
  waitedOpenMinutes,
  type QueueStep,
  type TimerConfig,
  type TimerProgress,
} from './queue-timers';

type Rows = { rows: Array<Record<string, unknown>> };
const rowsOf = (r: unknown): Array<Record<string, unknown>> => (r as Rows).rows;
const dateOf = (v: unknown): Date | null => (v === null || v === undefined ? null : new Date(v as string));

const uuidFrom = (seed: string): string => {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

/** What one run did to one chat (tests read it). */
export interface QueueTimerRun {
  steps: QueueStep[];
  /** Why nothing ran: the plan lacks the feature, the chat is no longer waiting, or no step is due yet. */
  skipped?: 'plan' | 'not_waiting' | 'nothing_due';
}

/**
 * The waiting queue's timers (Auto-assignment > Waiting queue, docs/specs/conversation-handoff-and-assignment.md). A chat that waits in the
 * queue gets, in this order and each at most once per wait: a reminder to the people who can take it, an offer to the overflow team (one
 * hop, never a chain), and a last step (a message to the customer, or the chat given back to the bot). Every step is off by default.
 *
 * Safety, all of it by construction:
 *  - **Plan**: the whole thing is part of automatic assignment (`inbox_routing`, the Smart routing add-on). Without it nothing runs and
 *    nothing is cleared: the saved settings come back when the feature does. Only workspaces that configured a timer are even looked at.
 *  - **Idempotent**: each step is claimed by one conditional UPDATE (`reminded_at IS NULL`, ...) inside the chat's own transaction, so two
 *    worker pods, a retry after a crash and a repeated tick do a step once. Side effects that leave the transaction (the customer message)
 *    carry a deterministic client id.
 *  - **Tenant-safe**: the cross-tenant part only lists workspace ids that configured a timer (privileged, no chat data); everything about a
 *    chat runs under its own tenant (`txAs`, RLS applies).
 *  - **Cancelled by the chat's own state**: a claim, a resolve, an archive, a Return to bot or any assignment changes `handling` or the card's
 *    status, and the run re-reads both under the chat's row lock before it does anything. There is no separate timer row to forget.
 *  - **Business hours**: minutes count only while the chat's team is open (`waitedOpenMinutes`); the clock starts when the chat entered the
 *    queue and is not restarted by the offer.
 */
@Injectable()
export class QueueTimersService {
  private readonly logger = new Logger(QueueTimersService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: HandoffRepository,
    private readonly handoff: HandoffService,
    private readonly assignment: AssignmentService,
    private readonly conversations: ConversationsRepository,
    private readonly events: ConversationEventsRepository,
    private readonly outbox: OutboxService,
    private readonly entitlements: PlanEntitlementService,
    @Inject(CONVERSATIONS_FACADE) private readonly facade: ConversationsFacade,
  ) {}

  /** One pass over every workspace that configured a timer. Returns how many chats had a step run. */
  async sweep(now: Date = new Date(), perWorkspace = 100): Promise<number> {
    const orgs = await this.db.privileged(async (tx) =>
      rowsOf(
        await tx.execute(sql`
          SELECT org_id FROM workspace_settings
          WHERE handoff_wq_remind_minutes IS NOT NULL
             OR (handoff_wq_overflow_minutes IS NOT NULL AND handoff_wq_overflow_team_id IS NOT NULL)
             OR (handoff_wq_unclaimed_minutes IS NOT NULL AND handoff_wq_unclaimed_action <> 'keep')`),
      ).map((r) => Number(r.org_id)),
    );
    let acted = 0;
    for (const orgId of orgs) {
      try {
        if (!(await this.entitled(orgId))) continue;
        const uuids = await this.db.txAs({ orgId }, (tx) => this.candidates(tx, orgId, perWorkspace));
        for (const uuid of uuids) {
          try {
            const ran = await RequestContextStore.run(
              {
                requestId: `queue-timer-${uuid}`,
                orgId,
                actorType: 'system',
                actorId: null,
                userId: null,
              },
              () => this.runFor(orgId, uuid, now),
            );
            if (ran.steps.length > 0) acted += 1;
          } catch (err) {
            this.logger.error({ err, orgId }, 'queue timer failed for a conversation');
          }
        }
      } catch (err) {
        this.logger.error({ err, orgId }, 'queue timers failed for a workspace');
      }
    }
    return acted;
  }

  private async entitled(orgId: number): Promise<boolean> {
    return (
      (await this.entitlements.featureEnabled(orgId, 'inbox_routing')) &&
      (await this.entitlements.featureEnabled(orgId, HANDOFF_GATES.queueTimers))
    );
  }

  /** Chats of this workspace that wait and still have a step to run (oldest first). */
  private async candidates(tx: Tx, orgId: number, limit: number): Promise<string[]> {
    const res = await tx.execute(sql`
      SELECT cv.uuid
      FROM conversation_handoffs h
      JOIN conversations cv ON cv.org_id = h.org_id AND cv.id = h.conversation_id
      JOIN workspace_settings s ON s.org_id = h.org_id
      WHERE h.org_id = ${orgId} AND h.status = 'waiting'
        AND cv.status = 'open' AND NOT cv.archived AND cv.handling = 'waiting' AND cv.assignee_user_id IS NULL
        AND (
          (s.handoff_wq_remind_minutes IS NOT NULL AND h.reminded_at IS NULL)
          OR (s.handoff_wq_overflow_minutes IS NOT NULL AND s.handoff_wq_overflow_team_id IS NOT NULL AND h.offered_at IS NULL)
          OR (s.handoff_wq_unclaimed_minutes IS NOT NULL AND s.handoff_wq_unclaimed_action <> 'keep' AND h.final_at IS NULL)
        )
      ORDER BY cv.handling_since NULLS LAST
      LIMIT ${limit}`);
    return rowsOf(res).map((r) => String(r.uuid));
  }

  /** Runs whatever is due for one waiting chat. Safe to call any number of times. */
  async runFor(orgId: number, conversationUuid: string, now: Date = new Date()): Promise<QueueTimerRun> {
    if (!(await this.entitled(orgId))) return { steps: [], skipped: 'plan' };

    let change: AssignmentChange | null = null;
    let giveBack: Awaited<ReturnType<HandoffService['giveBackInTx']>> | null = null;
    let message: { handoffId: string; text: string } | null = null;

    const steps = await this.db.txAs({ orgId }, async (tx) => {
      let locked = await this.conversations.lockByUuid(tx, orgId, conversationUuid);
      if (!locked || locked.status !== 'open' || locked.handling !== 'waiting' || locked.assigneeUserId !== null)
        return null;
      const card = await this.card(tx, orgId, locked.id);
      if (!card) return null;
      const cfg = await this.config(tx, orgId);
      const progress: TimerProgress = {
        remindedAt: card.remindedAt,
        offeredAt: card.offeredAt,
        finalAt: card.finalAt,
      };
      const need = longestPending(cfg, progress);
      if (need === 0 || card.since === null) return [] as QueueStep[];
      const team = locked.assigneeTeamId !== null ? await this.teamOpening(tx, orgId, locked.assigneeTeamId) : null;
      const waited = waitedOpenMinutes(card.since, now, team, need);
      const due = dueSteps(cfg, progress, waited);
      if (due.length === 0) return [] as QueueStep[];

      const done: QueueStep[] = [];
      for (const step of due) {
        if (step === 'remind') {
          if (!(await this.claimStep(tx, orgId, card.id, 'reminded_at'))) continue;
          const teamUuid = team?.uuid ?? null;
          await this.events.append(tx, orgId, {
            conversationId: locked.id,
            type: 'queue_reminded',
            actorKind: 'system',
            payload: { minutes: cfg.remindMinutes },
          });
          await this.repo.appendTrace(tx, orgId, card.id, [
            { step: 'queue_timer', result: 'info', why: 'reminded' },
          ]);
          await this.outbox.emit(tx, {
            aggregateModule: 'conversations',
            aggregateId: locked.id,
            orgId,
            eventType: CONVERSATION_QUEUE_REMINDER,
            payload: {
              conversationId: locked.uuid,
              handoffId: card.uuid,
              teamId: teamUuid,
              minutes: cfg.remindMinutes,
            },
          });
          done.push('remind');
        } else if (step === 'offer') {
          const to = cfg.overflowTeamId !== null ? await this.repo.teamFactsById(tx, orgId, cfg.overflowTeamId) : null;
          if (!(await this.claimStep(tx, orgId, card.id, 'offered_at'))) continue;
          if (!to || !to.receives) {
            await this.repo.appendTrace(tx, orgId, card.id, [
              { step: 'queue_timer', result: 'skipped', why: 'overflow_team_cannot_receive' },
            ]);
            continue;
          }
          await tx.execute(sql`
            UPDATE conversation_handoffs SET offered_from_team_id = ${locked.assigneeTeamId},
              destination_team_id = ${to.id}, assigned_team_id = ${to.id}
            WHERE org_id = ${orgId} AND id = ${card.id}`);
          change = await this.assignment.assignInTx(
            tx,
            orgId,
            locked,
            { userId: null, teamId: to.id, userUuid: null, teamUuid: to.uuid },
            { kind: 'system' },
            'handoff',
            { queueOffer: true },
            { handling: 'waiting' },
          );
          await this.events.append(tx, orgId, {
            conversationId: locked.id,
            type: 'queue_offered',
            actorKind: 'system',
            payload: { toTeamId: to.uuid, minutes: cfg.overflowMinutes },
          });
          await this.repo.appendTrace(tx, orgId, card.id, [
            { step: 'queue_timer', who: to.uuid, result: 'chosen', why: 'offered_to_team' } as HandoffTraceLine,
          ]);
          // The chat is now in the overflow team's queue: read it again so what follows sees the new team and row version.
          locked = (await this.conversations.lockByUuid(tx, orgId, conversationUuid)) as LockedConversation;
          done.push('offer');
        } else {
          if (!(await this.claimFinal(tx, orgId, card.id, cfg.unclaimedAction))) continue;
          if (cfg.unclaimedAction === 'message') {
            const name = await this.contactName(tx, orgId, locked.contactId);
            const text = renderQueueMessage(cfg.unclaimedMessage, {
              name: name ?? '',
              first_name: (name ?? '').split(/\s+/)[0] ?? '',
            });
            await this.events.append(tx, orgId, {
              conversationId: locked.id,
              type: 'queue_customer_message',
              actorKind: 'system',
              payload: { minutes: cfg.unclaimedMinutes },
            });
            await this.repo.appendTrace(tx, orgId, card.id, [
              { step: 'queue_timer', result: 'info', why: 'customer_message_sent' },
            ]);
            if (text !== '') message = { handoffId: card.uuid, text };
          } else {
            giveBack = await this.handoff.giveBackInTx(
              tx,
              orgId,
              locked,
              { kind: 'system', reason: 'queue_timeout' },
              undefined,
            );
          }
          done.push('final');
        }
      }
      return done;
    });

    if (steps === null) return { steps: [], skipped: 'not_waiting' };
    if (change) await this.assignment.afterCommit(orgId, change);
    if (giveBack) await this.handoff.afterGiveBack(orgId, giveBack);
    if (message) await this.say(orgId, conversationUuid, message);
    return steps.length === 0 ? { steps, skipped: 'nothing_due' } : { steps };
  }

  // --- reads -----------------------------------------------------------------------------------------------------------------

  private async config(tx: Tx, orgId: number): Promise<TimerConfig & { unclaimedMessage: string }> {
    const t = (await this.repo.settings(tx, orgId)).queueTimers;
    return {
      remindMinutes: t.remindMinutes,
      overflowMinutes: t.overflowMinutes,
      overflowTeamId: t.overflowTeamId,
      unclaimedMinutes: t.unclaimedMinutes,
      unclaimedAction: t.unclaimedAction,
      unclaimedMessage: t.unclaimedMessage,
    };
  }

  private async card(tx: Tx, orgId: number, conversationId: number) {
    const res = await tx.execute(sql`
      SELECT h.id, h.uuid, h.reminded_at, h.offered_at, h.final_at, cv.handling_since
      FROM conversation_handoffs h JOIN conversations cv ON cv.org_id = h.org_id AND cv.id = h.conversation_id
      WHERE h.org_id = ${orgId} AND h.conversation_id = ${conversationId} AND h.status = 'waiting'`);
    const r = rowsOf(res)[0];
    return r
      ? {
          id: Number(r.id),
          uuid: String(r.uuid),
          remindedAt: dateOf(r.reminded_at),
          offeredAt: dateOf(r.offered_at),
          finalAt: dateOf(r.final_at),
          since: dateOf(r.handling_since),
        }
      : null;
  }

  private async teamOpening(tx: Tx, orgId: number, teamId: number) {
    const res = await tx.execute(
      sql`SELECT uuid, business_hours, timezone FROM teams WHERE org_id = ${orgId} AND id = ${teamId}`,
    );
    const r = rowsOf(res)[0];
    return r
      ? { uuid: String(r.uuid), hours: r.business_hours ?? null, timezone: (r.timezone as string | null) ?? null }
      : null;
  }

  private async contactName(tx: Tx, orgId: number, contactId: number | null): Promise<string | null> {
    if (contactId === null) return null;
    const res = await tx.execute(
      sql`SELECT name FROM contacts WHERE org_id = ${orgId} AND id = ${contactId}`,
    );
    const n = rowsOf(res)[0]?.name;
    return typeof n === 'string' && n.trim() !== '' ? n.trim() : null;
  }

  // --- writes ----------------------------------------------------------------------------------------------------------------

  /** Claims a step for this wait: true only for the one caller whose UPDATE found it not yet done. */
  private async claimStep(
    tx: Tx,
    orgId: number,
    cardId: number,
    column: 'reminded_at' | 'offered_at',
  ): Promise<boolean> {
    const res = await tx.execute(
      column === 'reminded_at'
        ? sql`UPDATE conversation_handoffs SET reminded_at = now()
              WHERE org_id = ${orgId} AND id = ${cardId} AND status = 'waiting' AND reminded_at IS NULL RETURNING id`
        : sql`UPDATE conversation_handoffs SET offered_at = now()
              WHERE org_id = ${orgId} AND id = ${cardId} AND status = 'waiting' AND offered_at IS NULL RETURNING id`,
    );
    return rowsOf(res).length > 0;
  }

  private async claimFinal(tx: Tx, orgId: number, cardId: number, action: string): Promise<boolean> {
    const res = await tx.execute(sql`
      UPDATE conversation_handoffs SET final_at = now(), final_action = ${action}
      WHERE org_id = ${orgId} AND id = ${cardId} AND status = 'waiting' AND final_at IS NULL RETURNING id`);
    return rowsOf(res).length > 0;
  }

  /** The message to the customer, after the commit: a deterministic client id, so a retry never sends it twice. */
  private async say(orgId: number, conversationUuid: string, m: { handoffId: string; text: string }) {
    try {
      await this.facade.enqueueOutbound({
        conversationId: conversationUuid,
        clientMessageId: uuidFrom(`queue-final:${m.handoffId}`),
        content: { kind: 'text', body: m.text },
        sender: { kind: 'bot' },
      });
    } catch (err) {
      this.logger.warn({ err, orgId, conversation: conversationUuid }, 'queue message not sent');
    }
  }
}
