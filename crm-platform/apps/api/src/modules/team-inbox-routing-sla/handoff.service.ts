import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  CONVERSATION_HANDOFF_REQUESTED,
  ERROR_CODES,
  HANDOFF_ANSWER_MAX_CHARS,
  HANDOFF_ANSWERS_MAX_KEYS,
  HANDOFF_GATES,
  HANDOFF_RETURNED_TO_BOT,
  flbHandoffReturnPlan,
  type AssignedSource,
  type ConversationPriority,
  type HandoffCard,
  type HandoffDestination,
  type HandoffOutcome,
  type HandoffReason,
  type HandoffSettings,
  type HandoffSource,
  type ReturnToBotResponse,
  type HandoffTraceLine,
  type UpdateHandoffSettingsInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { isOutsideBusinessHours } from '../../common/business-hours';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { pickDelegate } from '../../common/leave-delegate';
import { loadWorkspaceCalendar, onLeaveMap } from '../../common/workspace-calendar';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { MemberDirectory, PERM_CONVERSATION_READ } from '../../realtime';
import { CONVERSATIONS_FACADE, type ConversationsFacade } from '../chat-conversations';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import {
  ConversationEventsRepository,
  ConversationsRepository,
  INBOX_PERMISSION as PERM,
  InboxAccess,
  InboxConversationsService,
  InboxRealtimePublisher,
  conversationNotFound,
  type LockedConversation,
} from '../team-inbox-conversations';
import {
  AssignmentService,
  type AssignmentActor,
  type AssignmentChange,
  type AssignmentHow,
} from './assignment.service';
import { HandoffRepository, type StoredHandoffSettings } from './handoff.repository';
import { OwnerAlignmentService } from './owner-alignment.service';
import { RoutingEngine, type Calendar } from './routing-engine.service';
import { RoutingRulesRepository } from './routing-rules.repository';

/** Who gives a conversation back to the bot: a person, or the system (the waiting queue's timer, with the reason it acted). */
export type GiveBackActor =
  | { kind: 'user'; userId: number; name: string | null; uuid: string | null }
  | { kind: 'system'; reason: string };

/** What Return to bot will do, decided before the change is written (see `planReturn`). */
export type ReturnPlan =
  | {
      resumed: 'flow';
      handoffUuid: string;
      flowRunId: number;
      nodeId: string;
      flowUuid: string;
    }
  | {
      resumed: 'next_message';
      why: NonNullable<ReturnToBotResponse['why']>;
      handoffUuid: string | null;
      nextMessageBy: 'live_flow' | 'default_flow';
    };

/** What a caller (flow, AI agent, keyword rule, person) asks for. Uuids on the outside, never an internal id. */
export interface HandoffInput {
  orgId: number;
  conversationUuid: string;
  source: HandoffSource;
  reason?: HandoffReason;
  reasonText?: string | null;
  summary?: string | null;
  /** Flow variables the author chose to pass on; capped and stringified here. */
  answers?: Record<string, unknown>;
  destination: HandoffDestination;
  priority?: ConversationPriority | null;
  customerMessage?: string | null;
  offHoursMessage?: string | null;
  /** The last thing the customer wrote, for the rules' keyword conditions. */
  messageText?: string | null;
  idempotencyKey?: string | null;
  flow?: { runId: number | null; nodeId: string | null };
  actor: AssignmentActor;
  now?: Date;
}

export interface HandoffResultInternal {
  outcome: HandoffOutcome;
  handoffId: string;
  assigneeUserId: string | null;
  assigneeTeamId: string | null;
  trace: HandoffTraceLine[];
  /** The same request had been handled before (or the conversation was already with a person): nothing was written. */
  duplicate: boolean;
  /** Why nothing could be done (archived, personal mailbox, spam, missing conversation). */
  refused?: string;
}

interface Decision {
  userId: number | null;
  userUuid: string | null;
  teamId: number | null;
  teamUuid: string | null;
  how: AssignmentHow;
  source: AssignedSource | null;
  outcome: HandoffOutcome;
  meta: Record<string, unknown>;
  /** The team whose round robin cursor moved and the person who took the turn. */
  cursor?: { teamId: number; userId: number };
}

/** A uuid derived from a seed (SHA-1 shaped as a version 5 uuid): the same seed always gives the same id, so a retry sends nothing twice. */
const deterministicUuid = (seed: string): string => {
  const h = createHash('sha1').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const SYSTEM_ANSWER_KEYS = /^(user_message|__|_)/;

/** The answers the card carries: strings only, capped in number and length, no empty values and no system variables. */
export function cleanAnswers(raw: Record<string, unknown> | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (Object.keys(out).length >= HANDOFF_ANSWERS_MAX_KEYS) break;
    if (SYSTEM_ANSWER_KEYS.test(k) || v === null || v === undefined || typeof v === 'object')
      continue;
    const text = String(v).trim();
    if (text === '') continue;
    out[k.slice(0, 64)] = text.slice(0, HANDOFF_ANSWER_MAX_CHARS);
  }
  return out;
}

/**
 * ONE action says "a person must take this conversation" (BL-396, docs/specs/conversation-handoff-and-assignment.md): the flow's Human
 * handoff node, the AI agent, a customer's "talk to a person" keyword, a bot that failed and a person's "send to queue" all come here.
 *
 * In one transaction holding the conversation's row lock it records the handoff (the card the agent reads, and the run log), sets the
 * handling state (`waiting` or `with_person`, which mutes the bot), finds the person, and writes the assignment through
 * `AssignmentService.assignInTx`, so the timeline, audit, outbox and realtime are those of every other assignment.
 *
 * Who is found, in order (the first eligible person wins, every step leaves a line in the trace):
 *  1. a person the author NAMED (leave and delegate honoured; availability and hours are not asked: the author decided);
 *  2. the owner, then the last handler (workspace mode and plan, see `stickyStage`), before any rule or method;
 *  3. the destination team's own method (round robin or least loaded; needs the plan), else its default assignee;
 *  4. the workspace's rules (destination "rules"; needs the plan and the switch);
 *  5. the queue: the destination team's, else the workspace's. Always works, on every plan.
 * Outcome `assigned` = a person has it, `waiting` = it is in a queue people can claim, `unavailable` = out of hours or nobody could ever
 * take it (it still enters the queue so it is there when someone is).
 */
@Injectable()
export class HandoffService {
  private readonly logger = new Logger(HandoffService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: HandoffRepository,
    private readonly routingRepo: RoutingRulesRepository,
    private readonly engine: RoutingEngine,
    private readonly assignment: AssignmentService,
    private readonly conversations: ConversationsRepository,
    private readonly events: ConversationEventsRepository,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
    private readonly entitlements: PlanEntitlementService,
    private readonly directory: MemberDirectory,
    private readonly access: InboxAccess,
    private readonly inbox: InboxConversationsService,
    private readonly alignment: OwnerAlignmentService,
    private readonly publisher: InboxRealtimePublisher,
    @Inject(CONVERSATIONS_FACADE) private readonly facade: ConversationsFacade,
  ) {}

  // --- plan gates ------------------------------------------------------------------------------------------------------------

  /** Each capability reads ONE named plan feature (`HANDOFF_GATES`); the sticky ones also need routing. */
  async gates(orgId: number): Promise<HandoffSettings['available']> {
    const has = (k: string) => this.entitlements.featureEnabled(orgId, k as never);
    const routing = await has('inbox_routing');
    const sticky = routing && (await has(HANDOFF_GATES.ownerFirst));
    return {
      autoAssign: routing && (await has(HANDOFF_GATES.autoAssign)),
      ownerFirst: sticky,
      keepInSync: sticky,
      continuityWindow: sticky,
      promptOwnerOnReassign: sticky,
      queueTimers: routing && (await has(HANDOFF_GATES.queueTimers)),
    };
  }

  // --- the action ------------------------------------------------------------------------------------------------------------

  async handoff(input: HandoffInput): Promise<HandoffResultInternal> {
    const { orgId } = input;
    const now = input.now ?? new Date();
    const gates = await this.gates(orgId);
    const canOpen = await this.inboxPeople(orgId);

    const done = await this.db.txAs({ orgId }, async (tx) => {
      const locked = await this.conversations.lockByUuid(tx, orgId, input.conversationUuid);
      if (!locked) return { refused: 'conversation_not_found' as const };
      const facts = await this.repo.facts(tx, orgId, locked.id);
      if (!facts) return { refused: 'conversation_not_found' as const };

      if (input.idempotencyKey) {
        const seen = await this.repo.byIdempotencyKey(tx, orgId, input.idempotencyKey);
        if (seen) return { replay: await this.replayOf(tx, orgId, locked, seen) };
      }
      if (facts.archived) return { refused: 'archived' as const };
      if (facts.status === 'spam') return { refused: 'spam' as const };
      // A personal mailbox's mail is its owner's: a handoff never hands it to the workspace (as routing never does, TW-MAIL-035).
      if (locked.channelOwnerUserId !== null) return { refused: 'personal_mailbox' as const };

      const settings = await this.repo.settings(tx, orgId);
      const trace: HandoffTraceLine[] = [];
      const cal: Calendar = {
        today: (await loadWorkspaceCalendar(tx, orgId, now)).today,
        blocked: new Set<number>(),
      };

      // A repeat while a person already holds it changes nothing; while it only waits, the same card is retargeted.
      const live = await this.repo.liveFor(tx, orgId, locked.id);
      if (live && live.status === 'assigned' && locked.handling === 'with_person') {
        return { replay: await this.replayOf(tx, orgId, locked, live) };
      }

      const decision = await this.decide(tx, orgId, locked, facts, input, {
        settings,
        gates,
        canOpen,
        cal,
        trace,
        now,
      });

      // The card.
      const requestedBy = input.actor.kind === 'user' ? input.actor.userId : null;
      const dest = await this.destinationIds(tx, orgId, input.destination);
      let handoff = live;
      if (handoff) {
        await this.repo.retarget(tx, orgId, handoff.id, {
          reason: input.reason,
          reasonText: input.reasonText ?? undefined,
          summary: input.summary ?? undefined,
          destinationKind: input.destination.kind,
          destinationTeamId: dest.teamId,
          destinationUserId: dest.userId,
        });
      } else {
        handoff = await this.repo.insert(tx, orgId, {
          conversationId: locked.id,
          source: input.source,
          reason: input.reason ?? 'other',
          reasonText: input.reasonText?.slice(0, 500) ?? null,
          summary: input.summary?.slice(0, 2000) ?? null,
          answers: cleanAnswers(input.answers),
          destinationKind: input.destination.kind,
          destinationTeamId: dest.teamId,
          destinationUserId: dest.userId,
          priority: input.priority ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
          flowRunId: input.flow?.runId ?? null,
          nodeId: input.flow?.nodeId ?? null,
          requestedBy,
        });
      }

      // The assignment (or the queue). The handling is set by the write, and the card follows it there.
      const handling = decision.userId !== null ? 'with_person' : 'waiting';
      let change: AssignmentChange | null = null;
      const unchanged =
        decision.userId === locked.assigneeUserId && decision.teamId === locked.assigneeTeamId;
      if (!unchanged) {
        change = await this.assignment.assignInTx(
          tx,
          orgId,
          locked,
          {
            userId: decision.userId,
            teamId: decision.teamId,
            userUuid: decision.userUuid,
            teamUuid: decision.teamUuid,
          },
          input.actor,
          decision.how,
          { handoffId: handoff.uuid, ...decision.meta },
          { source: decision.source ?? undefined, handling, releaseAi: true },
        );
      } else {
        await this.repo.setHandling(tx, orgId, locked.id, handling);
        if (locked.assigneeAgentId !== null) {
          await tx.execute(
            sql`UPDATE conversations SET assignee_agent_id = NULL WHERE org_id = ${orgId} AND id = ${locked.id}`,
          );
        }
      }
      if (decision.cursor) {
        await this.repo.setTeamCursor(tx, orgId, decision.cursor.teamId, decision.cursor.userId);
      }
      if (
        decision.userId !== null &&
        gates.keepInSync &&
        settings.ownerMode === 'keep_in_sync' &&
        facts.contactId !== null
      ) {
        const touch = await this.alignment.firstTouch(
          tx,
          orgId,
          facts.contactId,
          decision.userId,
          'chat_claim',
        );
        trace.push({
          step: 'contact_owner',
          result: touch === 'set' ? 'chosen' : 'info',
          why: touch === 'set' ? 'first_touch_owner_set' : `owner_not_set_${touch}`,
        });
      }

      await this.repo.finish(tx, orgId, handoff.id, {
        status: decision.userId !== null ? 'assigned' : 'waiting',
        outcome: decision.outcome,
        assignedUserId: decision.userId,
        assignedTeamId: decision.teamId,
        trace,
      });

      if (input.priority && input.priority !== (await this.priorityOf(tx, orgId, locked.id))) {
        await this.setPriority(tx, orgId, locked.id, input.priority);
      }

      await this.events.append(tx, orgId, {
        conversationId: locked.id,
        type: 'handoff_requested',
        actorKind: this.eventActor(input),
        actorUserId: requestedBy,
        payload: {
          handoffId: handoff.uuid,
          source: input.source,
          reason: input.reason ?? 'other',
          ...(input.reasonText ? { reasonText: input.reasonText.slice(0, 200) } : {}),
          destination: input.destination.kind,
          outcome: decision.outcome,
          toUserId: decision.userUuid,
          toTeamId: decision.teamUuid,
        },
      });
      await this.outbox.emit(tx, {
        aggregateModule: 'conversations',
        aggregateId: locked.id,
        orgId,
        eventType: CONVERSATION_HANDOFF_REQUESTED,
        payload: {
          conversationId: locked.uuid,
          handoffId: handoff.uuid,
          source: input.source,
          reason: input.reason ?? 'other',
          outcome: decision.outcome,
          toUserId: decision.userUuid,
          toTeamId: decision.teamUuid,
        },
      });
      await this.audit.record(tx, {
        module: 'conversations',
        recordId: locked.id,
        action: 'update',
        delta: { handling: { old: locked.handling, new: handling } },
      });

      const message =
        decision.outcome === 'unavailable' && input.offHoursMessage
          ? input.offHoursMessage
          : input.customerMessage;
      return {
        result: {
          outcome: decision.outcome,
          handoffId: handoff.uuid,
          assigneeUserId: decision.userUuid,
          assigneeTeamId: decision.teamUuid,
          trace,
          duplicate: false,
        } satisfies HandoffResultInternal,
        change,
        message: message?.trim() ? message.trim() : null,
        conversation: {
          uuid: locked.uuid,
          rowVersion: locked.rowVersion + (change ? 1 : 0),
          after: decision,
          channelOwnerUserId: locked.channelOwnerUserId,
        },
        notify: settings.notifyQueue,
      };
    });

    if ('refused' in done && done.refused) {
      return {
        outcome: 'unavailable',
        handoffId: '',
        assigneeUserId: null,
        assigneeTeamId: null,
        trace: [{ step: 'refused', result: 'info', why: done.refused }],
        duplicate: false,
        refused: done.refused,
      };
    }
    if ('replay' in done && done.replay) return done.replay;
    const ok = done as Extract<typeof done, { result: HandoffResultInternal }>;
    if (ok.change) await this.assignment.afterCommit(orgId, ok.change);
    else {
      await this.publisher.conversationChanged(
        orgId,
        {
          uuid: ok.conversation.uuid,
          rowVersion: ok.conversation.rowVersion,
          assigneeUserId: ok.conversation.after.userId,
          assigneeTeamId: ok.conversation.after.teamId,
          channelOwnerUserId: ok.conversation.channelOwnerUserId,
        },
        ['handling'],
      );
    }
    if (ok.message) await this.say(orgId, input.conversationUuid, ok.result.handoffId, ok.message);
    return ok.result;
  }

  // --- the settings ----------------------------------------------------------------------------------------------------------

  async getSettings(): Promise<HandoffSettings> {
    const ctx = RequestContextStore.require();
    const [stored, available] = await Promise.all([
      this.db.tx((tx) => this.repo.settings(tx, ctx.orgId)),
      this.gates(ctx.orgId),
    ]);
    return this.shape(stored, available);
  }

  async updateSettings(input: UpdateHandoffSettingsInput): Promise<HandoffSettings> {
    const ctx = RequestContextStore.require();
    const available = await this.gates(ctx.orgId);
    // A capability the plan does not include is refused out loud, never stored and silently ignored.
    const locked: string[] = [];
    if (input.autoAssign !== undefined && !available.autoAssign) locked.push('autoAssign');
    if (input.ownerMode !== undefined && input.ownerMode !== 'independent') {
      if (input.ownerMode === 'owner_first' && !available.ownerFirst) locked.push('ownerMode');
      if (input.ownerMode === 'keep_in_sync' && !available.keepInSync) locked.push('ownerMode');
    }
    if (
      input.continuityDays !== undefined &&
      input.continuityDays !== null &&
      !available.continuityWindow
    )
      locked.push('continuityDays');
    if (input.promptOwnerOnReassign === true && !available.promptOwnerOnReassign)
      locked.push('promptOwnerOnReassign');
    const qt = input.queueTimers;
    if (
      qt &&
      !available.queueTimers &&
      Object.entries(qt).some(([k, v]) =>
        k === 'unclaimedAction' ? v !== 'keep' : k === 'unclaimedMessage' ? v !== '' : v !== null,
      )
    )
      locked.push('queueTimers');
    if (locked.length > 0) {
      throw new AppError(
        ERROR_CODES.PLAN_FEATURE_LOCKED,
        'Your plan does not include this setting. Upgrade your plan to use it.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        locked.map((path) => ({ path, message: 'plan_locked' })),
      );
    }
    const stored = await this.db.tx(async (tx) => {
      const { queueTimers: qIn, ...rest } = input;
      const queueTimers = qIn ? await this.queueTimersToStore(tx, ctx.orgId, qIn) : undefined;
      await this.repo.updateSettings(tx, ctx.orgId, {
        ...rest,
        ...(queueTimers ? { queueTimers } : {}),
      });
      await this.audit.record(tx, {
        module: 'workspace_settings',
        recordId: ctx.orgId,
        action: 'update',
        delta: Object.fromEntries(
          Object.entries(input).map(([k, v]) => [k, { old: undefined, new: v }]),
        ),
      });
      return this.repo.settings(tx, ctx.orgId);
    });
    return this.shape(stored, available);
  }

  /**
   * The waiting queue's timers as they will be stored, checked against what they would be after this save: a timer needs its
   * companion (a team to offer the chat to, a text to send), the team must receive conversations, and a timer that is switched off
   * clears its companion's requirement. Refused with a field path, never silently dropped.
   */
  private async queueTimersToStore(
    tx: Tx,
    orgId: number,
    input: NonNullable<UpdateHandoffSettingsInput['queueTimers']>,
  ) {
    const now = (await this.repo.settings(tx, orgId)).queueTimers;
    const next = { ...now, ...input } as typeof now & typeof input;
    const problems: Array<{ path: string; message: string }> = [];
    let teamId: number | null | undefined;
    if (input.overflowTeamId !== undefined) {
      if (input.overflowTeamId === null) teamId = null;
      else {
        const team = await this.repo.teamByUuid(tx, orgId, input.overflowTeamId);
        if (!team) problems.push({ path: 'queueTimers.overflowTeamId', message: 'team_not_found' });
        else if (!team.receives)
          problems.push({
            path: 'queueTimers.overflowTeamId',
            message: 'team_does_not_receive_conversations',
          });
        else teamId = team.id;
      }
    }
    const hasTeam = teamId !== undefined ? teamId !== null : now.overflowTeamId !== null;
    if (next.overflowMinutes !== null && !hasTeam)
      problems.push({ path: 'queueTimers.overflowTeamId', message: 'required' });
    if (next.unclaimedMinutes !== null && next.unclaimedAction === 'keep')
      problems.push({ path: 'queueTimers.unclaimedAction', message: 'required' });
    if (next.unclaimedAction === 'message' && next.unclaimedMessage.trim() === '')
      problems.push({ path: 'queueTimers.unclaimedMessage', message: 'required' });
    if (problems.length > 0)
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'The waiting queue settings are incomplete',
        HttpStatus.UNPROCESSABLE_ENTITY,
        problems,
      );
    const { overflowTeamId: _uuid, ...fields } = input;
    return { ...fields, ...(teamId !== undefined ? { overflowTeamId: teamId } : {}) };
  }

  private shape(
    s: StoredHandoffSettings,
    available: HandoffSettings['available'],
  ): HandoffSettings {
    // What is IN EFFECT, not what an earlier plan left stored: a workspace that was downgraded keeps its saved choices (they come back
    // on upgrade) but the screen must not show a locked mode as selected when the engine ignores it.
    const modeOpen =
      s.ownerMode === 'owner_first'
        ? available.ownerFirst
        : s.ownerMode === 'keep_in_sync'
          ? available.keepInSync
          : true;
    return {
      autoAssign: s.autoAssign && available.autoAssign,
      claimSetsOwner: s.claimSetsOwner,
      ownerMode: modeOpen ? s.ownerMode : 'independent',
      continuityDays: available.continuityWindow ? s.continuityDays : null,
      promptOwnerOnReassign: s.promptOwnerOnReassign && available.promptOwnerOnReassign,
      notifyQueue: s.notifyQueue,
      // What is in effect: a plan without the timers runs none (what was saved comes back on upgrade), so the screen shows them off.
      queueTimers: available.queueTimers
        ? {
            remindMinutes: s.queueTimers.remindMinutes,
            overflowMinutes: s.queueTimers.overflowMinutes,
            overflowTeamId: s.queueTimers.overflowTeamUuid,
            unclaimedMinutes: s.queueTimers.unclaimedMinutes,
            unclaimedAction: s.queueTimers.unclaimedAction,
            unclaimedMessage: s.queueTimers.unclaimedMessage,
          }
        : {
            remindMinutes: null,
            overflowMinutes: null,
            overflowTeamId: null,
            unclaimedMinutes: null,
            unclaimedAction: 'keep',
            unclaimedMessage: '',
          },
      available,
    };
  }

  // --- reads and the person's own actions ------------------------------------------------------------------------------------

  /** The conversation as the list shows it, for the caller (404 when they may not see it). */
  async summaryOf(uuid: string) {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rec = await this.conversations.recordByUuid(tx, ctx.orgId, uuid);
      if (!rec) throw conversationNotFound();
      this.access.assertVisible(await this.access.viewer(tx, ctx), rec);
      return (await this.inbox.summaryInTx(tx, ctx.orgId, uuid))!;
    });
  }

  async card(conversationUuid: string): Promise<HandoffCard | null> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rec = await this.conversations.recordByUuid(tx, ctx.orgId, conversationUuid);
      if (!rec) throw conversationNotFound();
      this.access.assertVisible(await this.access.viewer(tx, ctx), rec);
      return this.repo.cardFor(tx, ctx.orgId, rec.id);
    });
  }

  /**
   * `POST /inbox/conversations/:id/claim`. The caller takes a waiting conversation for themselves (the existing claim permission,
   * `inbox.conversation.assign_self`). It must not be held by a person already (409 with the current holder), the version must be current.
   * When the workspace says so (`claimSetsOwner`, every plan; or the keep-in-sync mode, with the plan), the claimer becomes the contact's owner
   * if the contact has none and nobody ever decided it.
   */
  async claim(
    uuid: string,
    rowVersion: number,
  ): Promise<{
    summary: Awaited<ReturnType<InboxConversationsService['summaryInTx']>>;
    ownerSet: boolean;
  }> {
    const ctx = RequestContextStore.require();
    const gates = await this.gates(ctx.orgId);
    const done = await this.db.tx(async (tx) => {
      const locked = await this.conversations.lockByUuid(tx, ctx.orgId, uuid);
      if (!locked) throw conversationNotFound();
      this.access.assertVisible(await this.access.viewer(tx, ctx), locked);
      await this.access.assertCan(tx, ctx, PERM.assignSelf, locked);
      if (locked.assigneeUserId !== null) {
        if (locked.assigneeUserId === ctx.userId) {
          return {
            change: null,
            summary: (await this.inbox.summaryInTx(tx, ctx.orgId, uuid))!,
            ownerSet: false,
          };
        }
        throw new AppError(
          ERROR_CODES.CONFLICT,
          'Somebody else has taken this conversation.',
          HttpStatus.CONFLICT,
        );
      }
      if (locked.rowVersion !== rowVersion) throw AppError.rowVersionConflict('Conversation');
      const me = await this.repo.userBrief(tx, ctx.orgId, ctx.userId!);
      const change = await this.assignment.assignInTx(
        tx,
        ctx.orgId,
        locked,
        { userId: ctx.userId!, teamId: locked.assigneeTeamId, userUuid: me!.uuid, teamUuid: null },
        { kind: 'user', userId: ctx.userId! },
        'claim',
        {},
        { source: 'claim', handling: locked.handling === null ? 'auto' : 'with_person' },
      );
      const settings = await this.repo.settings(tx, ctx.orgId);
      let ownerSet = false;
      const facts = await this.repo.facts(tx, ctx.orgId, locked.id);
      if (
        facts?.contactId != null &&
        (settings.claimSetsOwner || (gates.keepInSync && settings.ownerMode === 'keep_in_sync'))
      ) {
        ownerSet =
          (await this.alignment.firstTouch(
            tx,
            ctx.orgId,
            facts.contactId,
            ctx.userId!,
            'chat_claim',
          )) === 'set';
        const live = await this.repo.liveFor(tx, ctx.orgId, locked.id);
        if (live)
          await this.repo.appendTrace(tx, ctx.orgId, live.id, [
            { step: 'claim', who: me!.uuid, result: 'chosen' },
            {
              step: 'contact_owner',
              result: ownerSet ? 'chosen' : 'info',
              why: ownerSet ? 'first_touch_owner_set' : 'owner_already_decided',
            },
          ]);
      }
      const summary = (await this.inbox.summaryInTx(tx, ctx.orgId, uuid))!;
      return { change: { ...change, rowVersion: summary.rowVersion }, summary, ownerSet };
    });
    if (done.change) await this.assignment.afterCommit(ctx.orgId, done.change);
    return { summary: done.summary, ownerSet: done.ownerSet };
  }

  /**
   * `POST /inbox/conversations/:id/return-to-bot`: the person gives the conversation back and the bot is back at once, visibly.
   *
   * If the handoff came from a flow's Human handoff node whose `returned` exit leads somewhere, the flow continues there right away (the
   * worker starts it from the outbox event written here); otherwise the bot is simply ready for the customer's next message, as it
   * always was. The answer says which, so the screen never has to guess. A second press changes nothing and sends nothing.
   */
  async returnToBot(uuid: string, note?: string): Promise<ReturnToBotResponse> {
    const ctx = RequestContextStore.require();
    const done = await this.db.tx(async (tx) => {
      const locked = await this.conversations.lockByUuid(tx, ctx.orgId, uuid);
      if (!locked) throw conversationNotFound();
      this.access.assertVisible(await this.access.viewer(tx, ctx), locked);
      await this.access.assertCan(tx, ctx, PERM.reply, locked);
      if (locked.handling === null || locked.handling === 'with_bot') {
        return {
          again: true as const,
          summary: (await this.inbox.summaryInTx(tx, ctx.orgId, uuid))!,
          nextMessageBy: (await this.repo.hasLiveRun(tx, ctx.orgId, locked.id))
            ? ('live_flow' as const)
            : ('default_flow' as const),
        };
      }
      const who = await this.repo.userBrief(tx, ctx.orgId, ctx.userId!);
      return {
        again: false as const,
        ...(await this.giveBackInTx(
          tx,
          ctx.orgId,
          locked,
          { kind: 'user', userId: ctx.userId!, name: who?.name ?? null, uuid: who?.uuid ?? null },
          note,
        )),
      };
    });
    if (done.again) {
      return {
        conversation: done.summary,
        resumed: 'next_message',
        nextMessageBy: done.nextMessageBy,
        why: null,
        alreadyWithBot: true,
      };
    }
    await this.afterGiveBack(ctx.orgId, done);
    return {
      conversation: done.summary,
      resumed: done.plan.resumed,
      nextMessageBy: done.plan.resumed === 'next_message' ? done.plan.nextMessageBy : null,
      why: done.plan.resumed === 'next_message' ? done.plan.why : null,
      alreadyWithBot: false,
    };
  }

  /**
   * Gives a conversation back to the bot inside the caller's transaction (the conversation is locked): handling -> `with_bot`, the
   * assignee cleared, the live handoff marked returned, a timeline line, and, when a flow is to continue, the outbox event that makes
   * the worker continue it. Used by the Return to bot button and by the waiting queue's "give it back to the bot" step.
   */
  async giveBackInTx(
    tx: Tx,
    orgId: number,
    locked: LockedConversation,
    actor: GiveBackActor,
    note?: string,
  ) {
    const plan = await this.planReturn(tx, orgId, locked);
    const assignActor: AssignmentActor =
      actor.kind === 'user' ? { kind: 'user', userId: actor.userId } : { kind: 'system' };
    const change = await this.assignment.assignInTx(
      tx,
      orgId,
      locked,
      { userId: null, teamId: null, userUuid: null, teamUuid: null },
      assignActor,
      'manual',
      { returnedToBot: true },
      { handling: 'with_bot' },
    );
    await this.repo.markReturned(tx, orgId, locked.id);
    await this.events.append(tx, orgId, {
      conversationId: locked.id,
      type: 'handoff_returned',
      actorKind: actor.kind === 'user' ? 'user' : 'system',
      ...(actor.kind === 'user' ? { actorUserId: actor.userId } : {}),
      payload: {
        ...(note ? { note: note.slice(0, 500) } : {}),
        resumed: plan.resumed,
        ...(plan.resumed === 'next_message' ? { why: plan.why } : {}),
        ...(actor.kind === 'system' ? { reason: actor.reason } : {}),
      },
    });
    if (plan.resumed === 'flow') {
      await this.outbox.emit(tx, {
        aggregateModule: 'conversations',
        aggregateId: locked.id,
        orgId,
        eventType: HANDOFF_RETURNED_TO_BOT,
        payload: {
          conversationId: locked.uuid,
          handoffId: plan.handoffUuid,
          flowRunId: plan.flowRunId,
          nodeId: plan.nodeId,
          flowId: plan.flowUuid,
          by: actor.kind === 'user' ? actor.name : null,
        },
      });
    }
    const thread = await this.repo.threadKey(tx, orgId, locked.id);
    const summary = (await this.inbox.summaryInTx(tx, orgId, locked.uuid))!;
    return {
      change: { ...change, rowVersion: summary.rowVersion },
      summary,
      plan,
      thread,
      conversationUuid: locked.uuid,
      by: actor.kind === 'user' ? actor.name : null,
    };
  }

  /** After the commit: tell open screens, and write the line the staff reads in the thread ("Bot is back, ..."). Never throws. */
  async afterGiveBack(
    orgId: number,
    done: {
      change: AssignmentChange;
      plan: ReturnPlan;
      thread: { channelUuid: string; peerKey: string } | null;
      conversationUuid: string;
      by: string | null;
    },
  ): Promise<void> {
    await this.assignment.afterCommit(orgId, done.change);
    if (!done.thread) return;
    const flow = done.plan.resumed === 'flow';
    const nextBy = done.plan.resumed === 'next_message' ? done.plan.nextMessageBy : null;
    const who = done.by ?? 'the system';
    try {
      await this.facade.recordOutbound({
        channelId: done.thread.channelUuid,
        peerKey: done.thread.peerKey,
        source: 'handoff',
        kind: 'system',
        direction: 'in',
        body: flow
          ? `Bot is back, returned by ${who}. The flow continues.`
          : nextBy === 'live_flow'
            ? `Bot is back, returned by ${who}. It will answer the customer's next message.`
            : `Bot is back, returned by ${who}. It answers the next message only if a default flow is set.`,
        // One line per give-back: the handoff it ends (or, for a chat no handoff made, the row version it produced).
        providerMessageId: `bot-back:${done.plan.handoffUuid ?? `${done.conversationUuid}:${done.change.rowVersion}`}`,
        meta: {
          event: 'bot_returned',
          botStage: 'pressed',
          botBy: done.by,
          botResumed: done.plan.resumed,
          ...(nextBy ? { botNextBy: nextBy } : {}),
        },
      });
    } catch (err) {
      this.logger.warn({ err, orgId }, 'the "bot is back" line could not be written');
    }
  }

  /**
   * What giving the conversation back will do, decided from the live handoff card inside the transaction. A flow continues only when
   * the handoff came from a Human handoff node of a flow that is still published and on, whose `returned` exit leads to a step that
   * still exists. In every other case the bot waits for the next message and `why` says why (the timeline and the toast use it).
   */
  private async planReturn(tx: Tx, orgId: number, locked: LockedConversation): Promise<ReturnPlan> {
    const ref = await this.repo.liveFlowRef(tx, orgId, locked.id);
    const next = async (
      why: NonNullable<ReturnToBotResponse['why']>,
      handoffUuid: string | null,
    ): Promise<ReturnPlan> => ({
      resumed: 'next_message',
      why,
      handoffUuid,
      nextMessageBy: (await this.repo.hasLiveRun(tx, orgId, locked.id))
        ? 'live_flow'
        : 'default_flow',
    });
    if (!ref || ref.flowRunId === null || ref.nodeId === null)
      return next('no_flow_handoff', ref?.uuid ?? null);
    const found = await this.repo.flowOfRun(tx, orgId, ref.flowRunId);
    if (!found.run) return next('run_gone', ref.uuid);
    if (!found.flow) return next('flow_gone', ref.uuid);
    if (!found.flow.live) return next('flow_not_live', ref.uuid);
    const exit = flbHandoffReturnPlan(found.flow.data, ref.nodeId);
    if (!exit.ok) return next(exit.why, ref.uuid);
    return {
      resumed: 'flow',
      handoffUuid: ref.uuid,
      flowRunId: ref.flowRunId,
      nodeId: ref.nodeId,
      flowUuid: found.flow.uuid,
    };
  }

  // --- deciding --------------------------------------------------------------------------------------------------------------

  private async decide(
    tx: Tx,
    orgId: number,
    locked: LockedConversation,
    facts: { contactId: number | null; language: string | null; channelKind: string },
    input: HandoffInput,
    c: {
      settings: StoredHandoffSettings;
      gates: HandoffSettings['available'];
      canOpen: ReadonlySet<number>;
      cal: Calendar;
      trace: HandoffTraceLine[];
      now: Date;
    },
  ): Promise<Decision> {
    const { trace } = c;
    const dest = input.destination;
    let team =
      dest.kind === 'team' ? await this.repo.teamByUuid(tx, orgId, dest.teamId, true) : null;
    if (dest.kind === 'person' && dest.teamId)
      team = await this.repo.teamByUuid(tx, orgId, dest.teamId, true);
    if (
      (dest.kind === 'team' || (dest.kind === 'person' && dest.teamId)) &&
      (!team || !team.receives)
    ) {
      trace.push({
        step: 'team',
        result: 'skipped',
        why: team ? 'team_does_not_receive_conversations' : 'team_not_found',
      });
      team = null;
    }

    const queue = (outcome: HandoffOutcome): Decision => ({
      userId: null,
      userUuid: null,
      teamId: team?.id ?? null,
      teamUuid: team?.uuid ?? null,
      how: 'handoff',
      source: null,
      outcome,
      meta: {},
    });

    // 1. a named person
    if (dest.kind === 'person') {
      const user = await this.repo.activeUserUuid(tx, orgId, dest.userId);
      if (!user)
        trace.push({
          step: 'person',
          who: dest.userId,
          result: 'skipped',
          why: 'not_an_active_member',
        });
      else {
        const cover = await this.coverFor(tx, orgId, user.id, c.canOpen, c.cal);
        if (cover === null)
          trace.push({
            step: 'person',
            who: user.uuid,
            result: 'skipped',
            why: 'cannot_read_or_on_leave_without_delegate',
          });
        else {
          const who = await this.repo.userBrief(tx, orgId, cover.id);
          trace.push({
            step: 'person',
            who: who!.uuid,
            result: 'chosen',
            why: cover.delegateOf ? `delegate of ${user.uuid}` : 'named_by_the_sender',
          });
          return {
            userId: cover.id,
            userUuid: who!.uuid,
            teamId: team?.id ?? null,
            teamUuid: team?.uuid ?? null,
            how: 'handoff',
            source: 'handoff_named',
            outcome: 'assigned',
            meta: cover.delegateOf ? { delegateFor: user.uuid } : {},
          };
        }
      }
      return this.finishQueue(tx, orgId, team, c, queue);
    }

    // Team hours: a team that is closed does not get a person picked for it; the thread waits for the morning.
    if (team && team.hours && isOutsideBusinessHours(team.hours, team.timezone ?? 'UTC', c.now)) {
      trace.push({ step: 'team_hours', who: team.uuid, result: 'skipped', why: 'out_of_hours' });
      return queue('unavailable');
    }

    // 2. the owner, then the last handler
    const sticky = await this.stickyStage(tx, orgId, locked, facts.contactId, team?.id ?? null, c);
    if (sticky) return { ...sticky, teamId: team?.id ?? null, teamUuid: team?.uuid ?? null };

    // 3. the team's own method
    if (team) {
      const method =
        team.strategy === 'round_robin'
          ? 'round_robin'
          : team.strategy === 'least_loaded'
            ? 'least_busy'
            : null;
      if (method && c.gates.autoAssign && c.settings.autoAssign) {
        const pick = await this.engine.pickForHandoff(
          tx,
          orgId,
          { userIds: [], teamIds: [team.uuid], strategy: method } as never,
          team.cursor,
          c.canOpen,
          c.cal,
          trace,
        );
        if (pick && pick.userId !== null) {
          trace.push({ step: 'team_method', who: pick.userUuid, result: 'chosen', why: method });
          return {
            userId: pick.userId,
            userUuid: pick.userUuid,
            teamId: team.id,
            teamUuid: team.uuid,
            how: method,
            source: 'rule',
            outcome: 'assigned',
            meta: {
              teamMethod: method,
              ...(pick.delegateFor ? { delegateFor: pick.delegateFor } : {}),
            },
            cursor: { teamId: team.id, userId: pick.userId },
          };
        }
        trace.push({
          step: 'team_method',
          who: team.uuid,
          result: 'skipped',
          why: 'nobody_available',
        });
        if (team.defaultAssigneeId !== null) {
          const cover = await this.coverFor(tx, orgId, team.defaultAssigneeId, c.canOpen, c.cal);
          const who = cover ? await this.repo.userBrief(tx, orgId, cover.id) : null;
          if (cover && who) {
            trace.push({ step: 'default_assignee', who: who.uuid, result: 'chosen' });
            return {
              userId: cover.id,
              userUuid: who.uuid,
              teamId: team.id,
              teamUuid: team.uuid,
              how: 'handoff',
              source: 'rule',
              outcome: 'assigned',
              meta: { defaultAssignee: true },
            };
          }
          trace.push({ step: 'default_assignee', result: 'skipped', why: 'not_eligible' });
        }
      } else if (method) {
        trace.push({
          step: 'team_method',
          who: team.uuid,
          result: 'skipped',
          why: c.gates.autoAssign ? 'auto_assign_off' : 'not_in_plan',
        });
      } else
        trace.push({ step: 'team_method', who: team.uuid, result: 'info', why: 'manual_queue' });
      return this.finishQueue(tx, orgId, team, c, queue);
    }

    // 4. the workspace's rules
    if (dest.kind === 'rules') {
      if (!c.gates.autoAssign)
        trace.push({ step: 'rules', result: 'skipped', why: 'rules_not_in_plan' });
      else if (!c.settings.autoAssign)
        trace.push({ step: 'rules', result: 'skipped', why: 'auto_assign_off' });
      else {
        const hit = await this.engine.rulesForHandoff(
          tx,
          orgId,
          locked,
          { contactId: facts.contactId, channelKind: facts.channelKind, language: facts.language },
          input.messageText ?? null,
          c.canOpen,
          c.cal,
          trace,
          c.now,
        );
        if (hit) {
          return {
            userId: hit.pick.userId,
            userUuid: hit.pick.userUuid,
            teamId: hit.pick.teamId,
            teamUuid: hit.pick.teamUuid,
            how: hit.pick.how,
            source: 'rule',
            outcome: hit.pick.userId !== null ? 'assigned' : 'waiting',
            meta: {
              ruleId: hit.rule.id,
              ruleName: hit.rule.name,
              ...(hit.pick.delegateFor ? { delegateFor: hit.pick.delegateFor } : {}),
            },
          };
        }
      }
    }
    return this.finishQueue(tx, orgId, null, c, queue);
  }

  /** The queue, and whether anyone could ever take what waits there (`unavailable`) or it merely waits for a claim (`waiting`). */
  private async finishQueue(
    tx: Tx,
    orgId: number,
    team: { id: number } | null,
    c: { canOpen: ReadonlySet<number>; cal: Calendar; trace: HandoffTraceLine[] },
    queue: (o: HandoffOutcome) => Decision,
  ): Promise<Decision> {
    let claimers = c.canOpen.size;
    if (team) {
      const members = (await this.repo.memberIdsOfTeams(tx, orgId, [team.id])).filter((id) =>
        c.canOpen.has(id),
      );
      const away = await onLeaveMap(tx, orgId, members, c.cal.today);
      claimers = members.filter((id) => !away.has(id)).length;
    }
    if (claimers === 0) {
      c.trace.push({ step: 'queue', result: 'info', why: 'no_agent_could_take_it' });
      return queue('unavailable');
    }
    c.trace.push({ step: 'queue', result: 'chosen', why: team ? 'team_queue' : 'workspace_queue' });
    return queue('waiting');
  }

  /**
   * Owner first, then the last handler (spec 4.5). The legacy "keep returning contacts with their agent" switch keeps its exact meaning
   * (owner, else last handler, no window, availability not checked, plan `inbox_routing`). The new modes add: the mode itself, the continuity
   * window, and eligibility (capacity, and membership of the destination team when the sender named one), under `inbox_assignment_sticky`.
   */
  private async stickyStage(
    tx: Tx,
    orgId: number,
    locked: LockedConversation,
    contactId: number | null,
    teamId: number | null,
    c: {
      settings: StoredHandoffSettings;
      gates: HandoffSettings['available'];
      canOpen: ReadonlySet<number>;
      cal: Calendar;
      trace: HandoffTraceLine[];
    },
  ): Promise<Decision | null> {
    if (contactId === null) return null;
    const legacy = c.settings.keepContactAgent && c.gates.autoAssign;
    const modern = c.gates.ownerFirst && c.settings.ownerMode !== 'independent';
    if (!legacy && !modern) return null;
    const strict = modern;
    const candidates: Array<{
      id: number | null;
      how: AssignmentHow;
      source: AssignedSource;
      step: string;
    }> = [];
    if (legacy || modern) {
      const head = await this.repo.contactOwnerHead(tx, orgId, contactId);
      candidates.push({ id: head?.ownerId ?? null, how: 'owner', source: 'owner', step: 'owner' });
    }
    if (legacy) {
      const days = c.gates.continuityWindow ? c.settings.continuityDays : null;
      candidates.push({
        id: await this.repo.lastHandlerWithin(tx, orgId, contactId, locked.id, days),
        how: 'contact_agent',
        source: 'sticky',
        step: 'last_handler',
      });
    }
    for (const cand of candidates) {
      if (cand.id === null) {
        c.trace.push({
          step: cand.step,
          result: 'skipped',
          why: cand.step === 'owner' ? 'no_owner' : 'no_previous_handler_in_window',
        });
        continue;
      }
      const cover = await this.coverFor(tx, orgId, cand.id, c.canOpen, c.cal);
      if (!cover) {
        c.trace.push({
          step: cand.step,
          result: 'skipped',
          why: 'ineligible_or_on_leave_without_delegate',
        });
        continue;
      }
      if (
        strict &&
        teamId !== null &&
        !(await this.repo.isMemberOfTeam(tx, orgId, teamId, cover.id))
      ) {
        c.trace.push({ step: cand.step, result: 'skipped', why: 'not_in_destination_team' });
        continue;
      }
      if (strict) {
        const cap = (await this.repo.capacity(tx, orgId, [cover.id])).get(cover.id);
        if (cap && cap.limit !== null && cap.open >= cap.limit) {
          c.trace.push({ step: cand.step, result: 'skipped', why: 'over_capacity' });
          continue;
        }
      }
      const who = await this.repo.userBrief(tx, orgId, cover.id);
      c.trace.push({
        step: cand.step,
        who: who!.uuid,
        result: 'chosen',
        why: cover.delegateOf ? 'delegate' : cand.step,
      });
      return {
        userId: cover.id,
        userUuid: who!.uuid,
        teamId: null,
        teamUuid: null,
        how: cand.how,
        source: cand.source,
        outcome: 'assigned',
        meta: cover.delegateOf ? { delegateOf: true } : {},
      };
    }
    return null;
  }

  /** The person, or their delegate when they are on leave (one hop), as an eligible agent: active and able to open the inbox. */
  private async coverFor(
    tx: Tx,
    orgId: number,
    userId: number,
    canOpen: ReadonlySet<number>,
    cal: Calendar,
  ): Promise<{ id: number; delegateOf: boolean } | null> {
    let id = userId;
    let delegateOf = false;
    if ((await onLeaveMap(tx, orgId, [id], cal.today)).has(id)) {
      const d = (await this.routingRepo.delegatesOf(tx, orgId, [id])).get(id);
      const dAway = d ? await onLeaveMap(tx, orgId, [d.id], cal.today) : new Map();
      const next = pickDelegate(
        new Map(d ? [[id, d.id]] : []),
        id,
        (x) => dAway.has(x),
        (x) => canOpen.has(x),
      );
      if (next === null) {
        cal.blocked.add(id);
        return null;
      }
      id = next;
      delegateOf = true;
    }
    if (!canOpen.has(id)) return null;
    return (await this.routingRepo.activeUserById(tx, orgId, id)) ? { id, delegateOf } : null;
  }

  // --- small helpers ---------------------------------------------------------------------------------------------------------

  private async replayOf(
    tx: Tx,
    orgId: number,
    locked: LockedConversation,
    h: { id: number; uuid: string; outcome: string },
  ): Promise<HandoffResultInternal> {
    const card = await this.repo.cardFor(tx, orgId, locked.id);
    return {
      outcome: h.outcome as HandoffOutcome,
      handoffId: h.uuid,
      assigneeUserId: card?.assignedTo.user?.id ?? null,
      assigneeTeamId: card?.assignedTo.team?.id ?? null,
      trace: card?.trace ?? [],
      duplicate: true,
    };
  }

  private async destinationIds(tx: Tx, orgId: number, d: HandoffDestination) {
    const user = d.kind === 'person' ? await this.repo.activeUserUuid(tx, orgId, d.userId) : null;
    const teamUuid = d.kind === 'team' ? d.teamId : d.kind === 'person' ? (d.teamId ?? null) : null;
    const team = teamUuid ? await this.repo.teamByUuid(tx, orgId, teamUuid) : null;
    return { userId: user?.id ?? null, teamId: team?.id ?? null };
  }

  private eventActor(input: HandoffInput) {
    return input.source === 'flow'
      ? 'flow'
      : input.source === 'ai_agent'
        ? 'ai'
        : input.source === 'manual'
          ? 'user'
          : 'bot';
  }

  private async priorityOf(tx: Tx, orgId: number, id: number): Promise<string | null> {
    const res = await tx.execute(
      sql`SELECT priority FROM conversations WHERE org_id = ${orgId} AND id = ${id}`,
    );
    return (res as unknown as { rows: Array<{ priority: string }> }).rows[0]?.priority ?? null;
  }

  private async setPriority(tx: Tx, orgId: number, id: number, priority: ConversationPriority) {
    const from = await this.priorityOf(tx, orgId, id);
    await this.routingRepo.setPriority(tx, orgId, id, priority);
    await this.events.append(tx, orgId, {
      conversationId: id,
      type: 'priority_changed',
      actorKind: 'system',
      payload: { from, to: priority, by: 'handoff' },
    });
  }

  private async say(orgId: number, conversationUuid: string, handoffId: string, body: string) {
    try {
      await this.facade.enqueueOutbound({
        conversationId: conversationUuid,
        clientMessageId: deterministicUuid(`handoff:${handoffId}`),
        content: { kind: 'text', body },
        sender: { kind: 'bot' },
      });
    } catch (err) {
      this.logger.warn({ err, orgId, conversation: conversationUuid }, 'handoff message not sent');
    }
  }

  private async inboxPeople(orgId: number): Promise<Set<number>> {
    const viewers = await this.directory.viewers(orgId, PERM_CONVERSATION_READ);
    return new Set(viewers.filter((v) => v.scope !== null).map((v) => v.userId));
  }
}
