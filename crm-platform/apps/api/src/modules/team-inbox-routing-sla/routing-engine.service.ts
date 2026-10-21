import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  HANDOFF_GATES,
  hasRoutingConditions,
  ROUTING_NEW_CONTACT_GRACE_MINUTES,
  ROUTING_BLOCKED_BY_LEAVE,
  ROUTING_FLOW_REQUESTED,
  type ConversationPriority,
  type RoutingAssign,
  type RoutingAutoReply,
  type RoutingConditions,
  type RoutingTag,
  type RoutingTestCondition,
  type RoutingTestRequest,
  type RoutingTestResponse,
  type RoutingTestStep,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { isOutsideBusinessHours } from '../../common/business-hours';
import { pickDelegate } from '../../common/leave-delegate';
import { loadWorkspaceCalendar, onLeaveMap } from '../../common/workspace-calendar';
import { DatabaseService } from '../../infra/db/database.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { MemberDirectory, PERM_CONVERSATION_READ } from '../../realtime';
import { collectRuleRefs, compileRules, loadRuleContext } from '../crm';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { AuditService } from '../../kernel/audit/audit.service';
import {
  ConversationEventsRepository,
  ConversationsRepository,
  type LockedConversation,
} from '../team-inbox-conversations';
import { CONVERSATIONS_FACADE, type ConversationsFacade } from '../chat-conversations';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { AppError } from '../../common/errors/app-error';
import { AssignmentService, type AssignmentChange, type AssignmentHow } from './assignment.service';
import { pickLeastBusy, pickRoundRobin } from './agent-picker';
import { explainFacts, type RoutingFacts } from './routing-matcher';
import { decodeActions, decodeConditions, encodeActions } from './routing-rules.mapper';
import { RoutingRulesRepository, type RuleRow } from './routing-rules.repository';
import type { HandoffTraceLine } from '@crm/contracts';

/** A uuid derived from a seed (a SHA-1 shaped as a version 5 uuid), so the same seed always gives the same id. */
const deterministicUuid = (seed: string): string => {
  const h = createHash('sha1').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

/** A new (or reopened) conversation, as the inbound pipeline reports it. */
export interface RoutingInput {
  orgId: number;
  conversationUuid: string;
  /** The message that made it new: the idempotency key (a second delivery of it does nothing). */
  messageUuid: string;
  /** The customer's message text, null when it had none. */
  messageText: string | null;
}

export type RoutingOutcome =
  | { outcome: 'skipped'; reason: 'plan' | 'not_found' | 'already_routed' | 'not_eligible' }
  | { outcome: 'unmatched' }
  /** A rule fired and only started a flow: nobody was available to assign (or the rule assigns, and the agents were all away). */
  | { outcome: 'triggered'; ruleIds: string[] }
  | { outcome: 'assigned'; via: 'contact_agent' | 'rule'; ruleIds: string[] };

type Done = { result: RoutingOutcome; change?: AssignmentChange | null };

export interface Pick {
  userId: number | null;
  userUuid: string | null;
  teamId: number | null;
  teamUuid: string | null;
  how: AssignmentHow;
  /** The person who took the turn (the rule's new round robin cursor). */
  cursor: number | null;
  /** Uuid of the person on leave whose delegate this is (BL-112), for the timeline. */
  delegateFor?: string | null;
}

/** What one rule does when it fires: the person it picks and every other action. Reading it changes nothing. */
export interface RuleTurn {
  pick: Pick | null;
  flowId: string | null;
  markSpam: boolean;
  priority: ConversationPriority | null;
  addTags: RoutingTag[];
  escalation: {
    minutes: number;
    priority: ConversationPriority | null;
    assign: RoutingAssign | null;
  } | null;
  autoReply: RoutingAutoReply | null;
  /** The actions as stored (with the round robin cursor), so that recording the firing can move the cursor. */
  stored: ReturnType<typeof decodeActions>;
}

/** The contact's agent and where it came from: the owner, or the person who held the last conversation. */
type ContactAgentPick = Pick & { from: 'owner' | 'last_handler' };

/** What the arrival pipeline needs to decide, read once. The same input feeds the real run and the dry run ("Try it"). */
interface ArrivalInput {
  orgId: number;
  /** Internal id of the conversation being routed; null for the dry run (none exists yet). */
  conversationId: number | null;
  contactId: number | null;
  rf: RoutingFacts;
  rules: RuleRow[];
  arrival: { keep: boolean; autoAssign: boolean; ownerMode: string; days: number | null };
  stickyPlan: boolean;
  canOpen: ReadonlySet<number>;
  cal: Calendar;
  /** The dry run reads rules without locks, explains every condition, and gives no side effect to hooks. */
  dry: boolean;
  trace: HandoffTraceLine[] | undefined;
}

/** What the real run does as the decision unfolds. The dry run passes none: it only reads. */
interface ArrivalHooks {
  onSticky(mine: ContactAgentPick, how: 'contact_agent' | 'owner'): Promise<void>;
  onRule(rule: RuleRow, turn: RuleTurn): Promise<void>;
}

interface ArrivalDecision {
  steps: RoutingTestStep[];
  sticky: ContactAgentPick | null;
  /** The rules that fired, in order. */
  fired: Array<{ rule: RuleRow; turn: RuleTurn }>;
  autoAssignOff: boolean;
}

/** What the engine knows about the calendar while it evaluates one conversation. */
export interface Calendar {
  today: string;
  /** People a rule wanted but who are on leave today (internal ids): the notice to the leads when nobody could take the conversation. */
  blocked: Set<number>;
}

/**
 * The auto-assignment engine (TW-TIB2-010, 011, 020, trimmed to the assign action): when an inbound message creates a conversation (or
 * reopens one that nobody holds), find who should take it. Runs in the worker after the message committed, never in a request, through
 * the existing `AssignmentService` so the timeline, audit, outbox, realtime and counters are exactly those of a manual assignment (the
 * actor is the system).
 *
 * Order, in ONE transaction that holds the conversation's row lock:
 *  1. Not eligible: archived, already held by a person, a team or an AI agent, or already routed for this very message (idempotency).
 *  2. "Keep returning contacts with their agent" (a workspace setting, off by default): the contact's owner, else the person who held
 *     the contact's most recent other conversation, if still an active member who can open the inbox. They are assigned whatever their
 *     availability: continuity is the point. Otherwise on to the rules.
 *  3. Active rules in priority order (`sort`, then id). A rule matches when its conditions hold (see `RoutingConditions`: contact
 *     fields through the segment rule engine, channel, keywords, language, business hours). It FIRES when it also finds somebody: the
 *     person is picked by its strategy among the agents available now; a rule whose agents are all unavailable and that lists a team
 *     hands the conversation to the team's queue; one with nobody to give it to does not fire and evaluation goes on. A fired rule
 *     counts (`fired_count`, `last_fired_at`) and stores the round robin cursor under a row lock, so two conversations arriving at once
 *     take two different turns. `stop_on_match` (default on) ends evaluation at the first firing rule; with it off a later firing rule
 *     takes over the assignment (Reference ran every matching rule's actions in order too).
 *     A rule that also names a flow writes `routing.flow_requested` in the same transaction (the flow runtime's worker starts it, see
 *     `RoutingFlowConsumer`); it fires even when nobody is available to take the conversation.
 *     People on leave today (the workspace calendar, BL-112) are never picked. When a rule names a person who is away, their delegate
 *     (if active, present and able to open the inbox) takes their place, ahead of the rule's teams; otherwise the team pool decides, and
 *     with nobody left the conversation stays unassigned and the leads are told (`routing.blocked_by_leave`). Behaviour for people who
 *     are not on leave is unchanged.
 *  4. If no primary rule fired, the fallback rule (conditions, when it has any, still apply). Otherwise the conversation stays unassigned.
 */
@Injectable()
export class RoutingEngine {
  private readonly logger = new Logger(RoutingEngine.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: RoutingRulesRepository,
    private readonly conversations: ConversationsRepository,
    private readonly events: ConversationEventsRepository,
    private readonly audit: AuditService,
    private readonly assignment: AssignmentService,
    private readonly directory: MemberDirectory,
    private readonly entitlements: PlanEntitlementService,
    private readonly outbox: OutboxService,
    @Inject(CONVERSATIONS_FACADE) private readonly facade: ConversationsFacade,
  ) {}

  async route(input: RoutingInput, now: Date = new Date()): Promise<RoutingOutcome> {
    const { orgId } = input;
    if (!(await this.entitlements.featureEnabled(orgId, 'inbox_routing'))) {
      return { outcome: 'skipped', reason: 'plan' };
    }
    const canOpen = await this.inboxPeople(orgId);

    // Automatic replies are sent once the transaction has committed (see sendReplies).
    const replies: string[] = [];
    const done = await this.db.txAs({ orgId }, async (tx): Promise<Done> => {
      const locked = await this.conversations.lockByUuid(tx, orgId, input.conversationUuid);
      if (!locked) return { result: { outcome: 'skipped', reason: 'not_found' } };
      const facts = await this.repo.conversationFacts(tx, orgId, locked.id);
      if (!facts) return { result: { outcome: 'skipped', reason: 'not_found' } };
      if (facts.routedMessage === input.messageUuid) {
        return { result: { outcome: 'skipped', reason: 'already_routed' } };
      }
      if (
        facts.archived ||
        // A personal mailbox's mail is its owner's: routing never hands it to the workspace (TW-MAIL-035).
        locked.channelOwnerUserId !== null ||
        locked.assigneeUserId !== null ||
        locked.assigneeTeamId !== null ||
        locked.assigneeAgentId !== null
      ) {
        return { result: { outcome: 'skipped', reason: 'not_eligible' } };
      }
      // Whatever happens below, this message has been looked at: a retry must not look again.
      await this.repo.stampRouted(tx, orgId, locked.id, input.messageUuid);
      const cal: Calendar = {
        today: (await loadWorkspaceCalendar(tx, orgId, now)).today,
        blocked: new Set<number>(),
      };

      let current = locked;
      let change: AssignmentChange | null = null;
      const apply = async (pick: Pick, meta: Record<string, unknown>) => {
        const c = await this.assignment.assignInTx(
          tx,
          orgId,
          current,
          {
            userId: pick.userId,
            teamId: pick.teamId,
            userUuid: pick.userUuid,
            teamUuid: pick.teamUuid,
          },
          { kind: 'system' },
          pick.how,
          meta,
        );
        current = {
          ...current,
          assigneeUserId: pick.userId,
          assigneeTeamId: pick.teamId,
          rowVersion: c.rowVersion,
        };
        change = change
          ? { ...change, after: c.after, afterUuids: c.afterUuids, rowVersion: c.rowVersion }
          : c;
      };

      // The workspace's switch (BL-404): automatic assignment off means no rule and no sticky agent at arrival either; default on = before.
      const arrival = await this.repo.arrivalSettings(tx, orgId);
      if (!arrival.autoAssign) return { result: { outcome: 'skipped', reason: 'plan' } };
      const stickyPlan = await this.entitlements.featureEnabled(orgId, HANDOFF_GATES.ownerFirst);
      const rules = await this.repo.activeRules(tx, orgId);
      const hours = await this.repo.businessHours(tx, orgId);
      const rf: RoutingFacts = {
        channelKind: facts.channelKind,
        messageText: input.messageText,
        language: facts.language,
        outsideHours: isOutsideBusinessHours(hours.hours, hours.timezone, now),
        contactKind: await this.contactKindFor(tx, orgId, rules, facts.contactId, locked.id),
      };
      const fired: string[] = [];
      const decision = await this.decideArrival(
        {
          orgId,
          conversationId: locked.id,
          contactId: facts.contactId,
          rf,
          rules,
          arrival,
          stickyPlan,
          canOpen,
          cal,
          dry: false,
          trace: undefined,
        },
        tx,
        {
          // 2. the contact's own agent
          onSticky: async (mine, how) => {
            await apply({ ...mine, teamId: null, teamUuid: null, how, cursor: null }, {});
          },
          // 3 and 4. a rule (or the fallback) fires: count it, then do what it says
          onRule: async (rule, turn) => {
            const ruleId = rule.uuid as string;
            await this.recordFire(tx, orgId, rule, turn);
            // Reference's mark_spam: the thread leaves the open list; the rule's other actions still run.
            if (turn.markSpam) await this.markSpamByRule(tx, orgId, current, ruleId);
            // Priority and tags are written before the assignment: the assignment re-reads the row, so it sees both.
            await this.decorateByRule(tx, orgId, current, ruleId, turn.priority, turn.addTags);
            if (turn.autoReply) replies.push(turn.autoReply.body);
            if (turn.escalation) {
              await this.repo.setEscalation(
                tx,
                orgId,
                locked.id,
                new Date(now.getTime() + turn.escalation.minutes * 60_000),
                {
                  ruleId,
                  ruleName: rule.name as string,
                  priority: turn.escalation.priority,
                  assign: turn.escalation.assign,
                },
              );
            }
            if (turn.pick)
              await apply(turn.pick, {
                ruleId,
                ruleName: rule.name as string,
                ...(turn.pick.delegateFor ? { delegateFor: turn.pick.delegateFor } : {}),
              });
            if (turn.flowId) {
              // The flow starts in the flow runtime's worker (the event is committed with the rule's firing, so a crash cannot lose it).
              // Reference started it on the next Baileys inbound only; here it starts on every channel.
              await this.outbox.emit(tx, {
                aggregateModule: 'conversations',
                aggregateId: locked.id,
                orgId,
                eventType: ROUTING_FLOW_REQUESTED,
                payload: {
                  conversationId: locked.uuid,
                  flowId: turn.flowId,
                  ruleId,
                  ruleName: rule.name as string,
                  messageUuid: input.messageUuid,
                },
              });
            }
            fired.push(ruleId);
          },
        },
      );
      if (decision.sticky) {
        return { result: { outcome: 'assigned', via: 'contact_agent', ruleIds: [] }, change };
      }
      // Somebody who should have had it is away and nobody took their place: the leads hear of it (once per message, with the event).
      if (change === null && cal.blocked.size > 0) {
        await this.outbox.emit(tx, {
          aggregateModule: 'conversations',
          aggregateId: locked.id,
          orgId,
          eventType: ROUTING_BLOCKED_BY_LEAVE,
          payload: {
            conversationId: locked.uuid,
            messageUuid: input.messageUuid,
            awayUserIds: [...cal.blocked],
            ruleIds: fired,
          },
        });
      }
      if (fired.length === 0) return { result: { outcome: 'unmatched' } };
      if (change === null) return { result: { outcome: 'triggered', ruleIds: fired } };
      return { result: { outcome: 'assigned', via: 'rule', ruleIds: fired }, change };
    });

    if (done.change) await this.assignment.afterCommit(orgId, done.change);
    await this.sendReplies(orgId, input.conversationUuid, input.messageUuid, replies);
    return done.result;
  }

  /**
   * A deferred action (Reference's escalation) whose time has come. Applies only if the conversation is still open with no reply from us
   * (a reply cancelled it by the same test). Runs the priority and the reassignment, writes an `escalated` event and clears the schedule.
   * Returns whether anything was applied; a conversation that changed meanwhile is left as it is.
   */
  async runDueEscalation(
    orgId: number,
    conversationUuid: string,
    now: Date = new Date(),
  ): Promise<boolean> {
    if (!(await this.entitlements.featureEnabled(orgId, 'inbox_routing'))) return false;
    const canOpen = await this.inboxPeople(orgId);
    const done = await this.db.txAs({ orgId }, async (tx) => {
      const locked = await this.conversations.lockByUuid(tx, orgId, conversationUuid);
      if (!locked) return { applied: false, change: null as AssignmentChange | null };
      const due = await this.repo.dueEscalation(tx, orgId, locked.id, now);
      if (!due) return { applied: false, change: null as AssignmentChange | null };
      const cal: Calendar = {
        today: (await loadWorkspaceCalendar(tx, orgId, now)).today,
        blocked: new Set<number>(),
      };
      await this.decorateByRule(tx, orgId, locked, due.ruleId, due.priority, []);
      let change: AssignmentChange | null = null;
      let reassigned = false;
      if (due.assign) {
        const pick = await this.choose(tx, orgId, due.assign, null, canOpen, cal);
        if (pick) {
          change = await this.assignment.assignInTx(
            tx,
            orgId,
            locked,
            {
              userId: pick.userId,
              teamId: pick.teamId,
              userUuid: pick.userUuid,
              teamUuid: pick.teamUuid,
            },
            { kind: 'system' },
            pick.how,
            { escalation: true, ruleId: due.ruleId, ruleName: due.ruleName },
          );
          reassigned = true;
        }
      }
      await this.events.append(tx, orgId, {
        conversationId: locked.id,
        type: 'escalated',
        actorKind: 'system',
        actorUserId: null,
        payload: {
          ruleId: due.ruleId,
          ruleName: due.ruleName,
          ...(due.priority ? { priority: due.priority } : {}),
          reassigned,
        },
      });
      await this.repo.clearEscalation(tx, orgId, locked.id);
      return { applied: true, change };
    });
    if (done.change) await this.assignment.afterCommit(orgId, done.change);
    return done.applied;
  }

  /**
   * A later message of a live conversation (Reference runs the per-message actions for every message: add_tag, auto_reply and
   * trigger_flow). Only rules with such an action fire, once per matching message. Priority, spam and assignment are one-shot at the start
   * of a conversation, so they are not applied here; the fallback rule does not run (it would answer every message). The rules are tried in
   * the same order as for a new conversation, and a rule that stops on match ends the pass there too.
   */
  async routeFollowUp(input: RoutingInput, now: Date = new Date()): Promise<{ ruleIds: string[] }> {
    const { orgId } = input;
    if (!(await this.entitlements.featureEnabled(orgId, 'inbox_routing'))) return { ruleIds: [] };
    const done = await this.db.txAs({ orgId }, async (tx) => {
      const locked = await this.conversations.lockByUuid(tx, orgId, input.conversationUuid);
      if (!locked) return { ruleIds: [] as string[], replies: [] as string[] };
      const facts = await this.repo.conversationFacts(tx, orgId, locked.id);
      if (
        !facts ||
        facts.archived ||
        locked.channelOwnerUserId !== null ||
        locked.status !== 'open'
      ) {
        return { ruleIds: [] as string[], replies: [] as string[] };
      }
      const rules = await this.repo.activeRules(tx, orgId);
      const hours = await this.repo.businessHours(tx, orgId);
      const rf: RoutingFacts = {
        channelKind: facts.channelKind,
        messageText: input.messageText,
        language: facts.language,
        outsideHours: isOutsideBusinessHours(hours.hours, hours.timezone, now),
        contactKind: await this.contactKindFor(tx, orgId, rules, facts.contactId, locked.id),
      };
      const fired: string[] = [];
      const replies: string[] = [];
      for (const rule of rules.filter((r) => r.is_fallback !== true)) {
        const ruleId = rule.uuid as string;
        // A rule that applies to every conversation, like the fallback, would act on every message of a live chat: it only runs at arrival.
        if (rule.applies_to_all === true) continue;
        if (!(await this.ruleMatches(tx, orgId, rule, rf, facts.contactId, false)).matched) {
          continue;
        }
        const turn = await this.firePerMessage(tx, orgId, rule);
        if (!turn) continue;
        if (turn.tags.length > 0)
          await this.decorateByRule(tx, orgId, locked, ruleId, null, turn.tags);
        if (turn.flowId) {
          await this.outbox.emit(tx, {
            aggregateModule: 'conversations',
            aggregateId: locked.id,
            orgId,
            eventType: ROUTING_FLOW_REQUESTED,
            payload: {
              conversationId: locked.uuid,
              flowId: turn.flowId,
              ruleId,
              ruleName: rule.name as string,
              messageUuid: input.messageUuid,
            },
          });
        }
        if (turn.autoReply) replies.push(turn.autoReply.body);
        fired.push(ruleId);
        // The same order and stop rule as a new conversation: a rule that stops on match ends the pass.
        if (rule.stop_on_match === true) break;
      }
      return { ruleIds: fired, replies };
    });
    await this.sendReplies(orgId, input.conversationUuid, input.messageUuid, done.replies);
    return { ruleIds: done.ruleIds };
  }

  /** A rule's per-message actions for one message: counted as fired, the cursor and the one-shot actions untouched. Null if it has none. */
  private async firePerMessage(
    tx: Tx,
    orgId: number,
    rule: RuleRow,
  ): Promise<{
    tags: RoutingTag[];
    flowId: string | null;
    autoReply: RoutingAutoReply | null;
  } | null> {
    const ruleId = Number(rule.id);
    const stored = decodeActions(await this.repo.lockActions(tx, orgId, ruleId));
    const perMessage =
      stored.addTags.length > 0 || stored.autoReply !== null || stored.triggerFlowId !== null;
    if (!perMessage) return null;
    await this.repo.markFired(tx, orgId, ruleId, encodeActions(stored));
    return { tags: stored.addTags, flowId: stored.triggerFlowId, autoReply: stored.autoReply };
  }

  /**
   * Sends the automatic replies as the business (a bot message through the normal outbound path, so the channel's rules apply). The id is
   * derived from the message and the position, so a retried message does not send its reply twice. A reply that the channel refuses
   * (outside the 24 hour window, plan limit) is logged and not sent; the rule still counts as fired.
   */
  private async sendReplies(
    orgId: number,
    conversationUuid: string,
    messageUuid: string,
    bodies: readonly string[],
  ): Promise<void> {
    for (const [i, body] of bodies.entries()) {
      try {
        await this.facade.enqueueOutbound({
          conversationId: conversationUuid,
          clientMessageId: deterministicUuid(`auto-reply:${messageUuid}:${i}`),
          content: { kind: 'text', body },
          sender: { kind: 'bot' },
        });
      } catch (err) {
        this.logger.warn(
          { err, orgId, conversation: conversationUuid },
          'automatic reply not sent',
        );
      }
    }
  }

  // --- handoff (BL-401) --------------------------------------------------------------------------------------------------------

  /** Who takes it under an assign action, with the reasons people were skipped appended to `trace`. Runs inside the caller's transaction. */
  pickForHandoff(
    tx: Tx,
    orgId: number,
    a: RoutingAssign,
    cursor: number | null,
    canOpen: ReadonlySet<number>,
    cal: Calendar,
    trace: HandoffTraceLine[],
  ): Promise<Pick | null> {
    return this.choose(tx, orgId, a, cursor, canOpen, cal, trace);
  }

  /**
   * The workspace's rules evaluated for a conversation that is handed to a person (the arrival rules, at handoff time): the first rule that
   * matches AND finds somebody wins, then the fallback rule. Only the assignment is taken from a rule here, plus its priority and tags; a
   * rule that starts a flow, answers, marks spam or escalates is skipped with a trace line (a handoff can never start a bot).
   */
  async rulesForHandoff(
    tx: Tx,
    orgId: number,
    locked: LockedConversation,
    facts: { contactId: number | null; channelKind: string; language: string | null },
    messageText: string | null,
    canOpen: ReadonlySet<number>,
    cal: Calendar,
    trace: HandoffTraceLine[],
    now: Date,
  ): Promise<{ pick: Pick; rule: { id: string; name: string } } | null> {
    const rules = await this.repo.activeRules(tx, orgId);
    const hours = await this.repo.businessHours(tx, orgId);
    // The contact row is read now, in this transaction: what a flow saved to the contact before the handoff counts (H18).
    const rf: RoutingFacts = {
      channelKind: facts.channelKind,
      messageText: messageText ?? (await this.repo.latestCustomerText(tx, orgId, locked.id)),
      language: facts.language,
      outsideHours: isOutsideBusinessHours(hours.hours, hours.timezone, now),
      contactKind: await this.contactKindFor(tx, orgId, rules, facts.contactId, locked.id),
    };
    const ordered = [
      ...rules.filter((r) => r.is_fallback !== true),
      ...rules.filter((r) => r.is_fallback === true),
    ];
    if (ordered.length === 0) trace.push({ step: 'rules', result: 'info', why: 'no_rules' });
    for (const rule of ordered) {
      const name = rule.name as string;
      if (!(await this.ruleMatches(tx, orgId, rule, rf, facts.contactId, false)).matched) {
        continue;
      }
      const turn = await this.fire(tx, orgId, rule, canOpen, cal);
      if (!turn || !turn.pick) {
        trace.push({ step: 'rule', who: name, result: 'skipped', why: 'nobody_available' });
        continue;
      }
      if (turn.flowId || turn.autoReply || turn.markSpam || turn.escalation) {
        trace.push({
          step: 'rule',
          who: name,
          result: 'info',
          why: 'flow_reply_spam_and_escalation_actions_are_not_run_at_handoff',
        });
      }
      await this.decorateByRule(
        tx,
        orgId,
        locked,
        rule.uuid as string,
        turn.priority,
        turn.addTags,
      );
      trace.push({ step: 'rule', who: name, result: 'chosen', why: `strategy ${turn.pick.how}` });
      return { pick: turn.pick, rule: { id: rule.uuid as string, name } };
    }
    trace.push({ step: 'rules', result: 'info', why: 'no_rule_matched' });
    return null;
  }

  // --- matching ----------------------------------------------------------------------------------------------------------------

  /**
   * Whether a rule matches, and how each part of its conditions came out. A rule that applies to every conversation matches without
   * looking at its conditions (they stay stored). Otherwise a rule with no condition is a catch-all only when it is the fallback (a hand-edited
   * row that is not never matches). The contact details part is the segment rule engine over the contact's saved row. `explainAll` also
   * evaluates the later parts after one failed, for the "Try it" box; a real run stops at the first that failed.
   */
  private async ruleMatches(
    tx: Tx,
    orgId: number,
    rule: RuleRow,
    facts: RoutingFacts,
    contactId: number | null,
    explainAll: boolean,
  ): Promise<{ matched: boolean; parts: RoutingTestCondition[] }> {
    if (rule.applies_to_all === true) return { matched: true, parts: [] };
    const c = decodeConditions(rule.conditions);
    if (!hasRoutingConditions(c)) return { matched: rule.is_fallback === true, parts: [] };
    const parts = explainFacts(c, facts);
    const factsOk = parts.every((p) => p.matched);
    if (c.contact !== null && (factsOk || explainAll)) {
      if (contactId === null) {
        parts.push({ part: 'contact', matched: false, why: 'no_contact' });
      } else {
        const rules = c.contact as unknown as Parameters<typeof collectRuleRefs>[0];
        const rc = await loadRuleContext(tx, orgId, collectRuleRefs(rules));
        const ok = await this.repo.contactMatches(
          tx,
          orgId,
          contactId,
          compileRules(orgId, rules, rc).where,
        );
        parts.push({ part: 'contact', matched: ok, why: ok ? null : 'no_saved_value' });
      }
    }
    return { matched: parts.every((p) => p.matched), parts };
  }

  /** New or returning, read only when some active rule asks (one query); null when the conversation has no contact. */
  private async contactKindFor(
    tx: Tx,
    orgId: number,
    rules: readonly RuleRow[],
    contactId: number | null,
    conversationId: number | null,
    force = false,
  ): Promise<'new' | 'returning' | null> {
    if (contactId === null) return null;
    const needed =
      force ||
      rules.some(
        (r) => r.applies_to_all !== true && decodeConditions(r.conditions).contactKind !== 'any',
      );
    if (!needed) return null;
    return this.repo.contactKindOf(
      tx,
      orgId,
      contactId,
      conversationId,
      ROUTING_NEW_CONTACT_GRACE_MINUTES,
    );
  }

  /**
   * THE decision of the arrival pipeline, shared by the real run (`route`, with hooks that write) and the dry run (`dryRun`, none): the
   * switch, the contact's own agent, the rules in order, the fallback. It reads; every write goes through a hook, so a dry run cannot write
   * even by mistake (and it also runs in a read-only transaction). It returns each step with the reason, which "Try it" shows.
   */
  private async decideArrival(
    inp: ArrivalInput,
    tx: Tx,
    hooks: ArrivalHooks | null,
  ): Promise<ArrivalDecision> {
    const { orgId } = inp;
    const steps: RoutingTestStep[] = [];
    const decision: ArrivalDecision = { steps, sticky: null, fired: [], autoAssignOff: false };
    const step = (
      kind: RoutingTestStep['kind'],
      result: RoutingTestStep['result'],
      why: string,
      rule: RuleRow | null = null,
      conditions: RoutingTestCondition[] = [],
    ) =>
      steps.push({
        kind,
        result,
        why,
        ruleId: rule ? (rule.uuid as string) : null,
        ruleName: rule ? (rule.name as string) : null,
        conditions,
      });

    if (!inp.arrival.autoAssign) {
      decision.autoAssignOff = true;
      step('switch', 'decided', 'auto_assign_off');
      return decision;
    }

    // 2. the contact's own agent: the legacy switch (owner, else last handler), and/or the owner modes (owner first), which need the
    //    sticky plan feature (BL-402). The window limits the last handler only under the sticky feature.
    const ownerMode = inp.stickyPlan && inp.arrival.ownerMode !== 'independent';
    if (!inp.arrival.keep && !ownerMode) {
      step('sticky', 'passed', 'sticky_off');
    } else if (inp.contactId === null) {
      step('sticky', 'passed', 'no_contact');
    } else {
      const mine = await this.contactAgent(
        tx,
        orgId,
        inp.contactId,
        inp.conversationId,
        inp.canOpen,
        inp.cal,
        { last: inp.arrival.keep, days: inp.stickyPlan ? inp.arrival.days : null },
        inp.trace,
      );
      if (mine) {
        step('sticky', 'decided', mine.from);
        decision.sticky = mine;
        if (hooks) await hooks.onSticky(mine, inp.arrival.keep ? 'contact_agent' : 'owner');
        return decision;
      }
      step('sticky', 'passed', 'no_agent_found');
    }

    // 3 and 4. the rules, then the fallback when no other rule fired
    const run = async (rule: RuleRow, kind: 'rule' | 'everyone_else'): Promise<boolean> => {
      const verdict = await this.ruleMatches(
        tx,
        orgId,
        rule,
        inp.rf,
        inp.contactId,
        inp.dry,
      );
      if (!verdict.matched) {
        step(kind, 'passed', 'conditions_failed', rule, verdict.parts);
        return false;
      }
      const turn = await this.turnFor(tx, orgId, rule, inp.canOpen, inp.cal, inp.dry, inp.trace);
      if (!turn) {
        step(kind, 'passed', 'nobody_available', rule, verdict.parts);
        return false;
      }
      if (hooks) await hooks.onRule(rule, turn);
      decision.fired.push({ rule, turn });
      step(
        kind,
        'decided',
        turn.pick
          ? turn.pick.userId === null
            ? 'team_queue'
            : 'agent_picked'
          : 'no_assignment_in_rule',
        rule,
        verdict.parts,
      );
      return true;
    };
    for (const rule of inp.rules.filter((r) => r.is_fallback !== true)) {
      if ((await run(rule, 'rule')) && rule.stop_on_match === true) break;
    }
    if (decision.fired.length === 0) {
      const fallbacks = inp.rules.filter((r) => r.is_fallback === true);
      if (fallbacks.length === 0) step('everyone_else', 'info', 'not_set');
      for (const rule of fallbacks) {
        if (await run(rule, 'everyone_else')) break;
      }
    }
    return decision;
  }

  /**
   * "Try it" (spec decision H20): which step of the arrival pipeline would decide for this contact, channel and message, and why. It calls
   * the same `decideArrival` as `route`, with no hooks and inside a READ ONLY transaction: nothing is assigned, counted, moved, logged or sent
   * (the database would refuse a write). The round robin cursor is read as it is and left alone.
   */
  async dryRun(
    orgId: number,
    req: RoutingTestRequest,
    now: Date = new Date(),
  ): Promise<RoutingTestResponse> {
    const canOpen = await this.inboxPeople(orgId);
    const stickyPlan = await this.entitlements.featureEnabled(orgId, HANDOFF_GATES.ownerFirst);
    return this.db.txAs({ orgId }, async (tx) => {
      await tx.execute(sql`SET TRANSACTION READ ONLY`);
      let contactId: number | null = null;
      const summary: RoutingTestResponse['contact'] = {
        found: false,
        kind: null,
        stage: null,
        hasOwner: false,
        tagCount: 0,
      };
      if (req.contactId !== null) {
        const snap = await this.repo.contactSnapshot(tx, orgId, req.contactId);
        if (!snap) throw AppError.notFound('Contact');
        contactId = snap.id;
        summary.found = true;
        summary.stage = snap.stage;
        summary.hasOwner = snap.hasOwner;
        summary.tagCount = snap.tagCount;
      }
      const arrival = await this.repo.arrivalSettings(tx, orgId);
      const rules = await this.repo.activeRules(tx, orgId);
      const hours = await this.repo.businessHours(tx, orgId);
      const outsideHours =
        req.outsideHours ?? isOutsideBusinessHours(hours.hours, hours.timezone, now);
      // With no contact picked the sample is a brand-new person: new, and nothing saved to look at.
      const kind =
        contactId === null
          ? 'new'
          : await this.contactKindFor(tx, orgId, rules, contactId, null, true);
      summary.kind = kind;
      const rf: RoutingFacts = {
        channelKind: req.channelKind,
        messageText: req.messageText === '' ? null : req.messageText,
        language: req.language,
        outsideHours,
        contactKind: kind,
      };
      const trace: HandoffTraceLine[] = [];
      const cal: Calendar = {
        today: (await loadWorkspaceCalendar(tx, orgId, now)).today,
        blocked: new Set<number>(),
      };
      const d = await this.decideArrival(
        {
          orgId,
          conversationId: null,
          contactId,
          rf,
          rules,
          arrival,
          stickyPlan,
          canOpen,
          cal,
          dry: true,
          trace,
        },
        tx,
        null,
      );
      // The assignment that would stand: the last firing rule that picked somebody (a later rule takes over when "stop" is off).
      const last = [...d.fired].reverse().find((f) => f.turn.pick);
      const pick: Pick | null = d.sticky ?? last?.turn.pick ?? null;
      const rule = d.sticky ? null : (last?.rule ?? null);
      const outcome: RoutingTestResponse['outcome'] = d.autoAssignOff
        ? 'off'
        : d.sticky
          ? 'sticky'
          : pick && rule
            ? rule.is_fallback === true
              ? 'everyone_else'
              : 'rule'
            : 'queue';
      return {
        outcome,
        ruleId: rule ? (rule.uuid as string) : null,
        ruleName: rule ? (rule.name as string) : null,
        assigneeUserId: pick?.userUuid ?? null,
        assigneeTeamId: pick?.teamUuid ?? null,
        how: pick?.how ?? null,
        steps: d.steps,
        trace,
        contact: summary,
        outsideHours,
      };
    });
  }

  // --- picking -----------------------------------------------------------------------------------------------------------------

  /**
   * A matching rule's turn: read its actions (locked when `dry` is false, so two conversations arriving together take two turns), pick, and
   * report what the rule would do. Null when the rule has nobody to give the conversation to and nothing else to do (it does not fire: no
   * count, no cursor move). A rule that also starts a flow fires even when nobody is available: that is the case a flow answers ("we will be
   * right with you"). It writes nothing: `recordFire` counts the firing.
   */
  private async turnFor(
    tx: Tx,
    orgId: number,
    rule: RuleRow,
    canOpen: ReadonlySet<number>,
    cal: Calendar,
    dry: boolean,
    trace?: HandoffTraceLine[],
  ): Promise<RuleTurn | null> {
    const ruleId = Number(rule.id);
    const stored = decodeActions(
      dry ? await this.repo.readActions(tx, orgId, ruleId) : await this.repo.lockActions(tx, orgId, ruleId),
    );
    const pick = stored.assign
      ? await this.choose(tx, orgId, stored.assign, stored.cursor, canOpen, cal, trace)
      : null;
    const decorates = stored.priority !== null || stored.addTags.length > 0;
    const escalates = stored.escalation !== null;
    const replies = stored.autoReply !== null;
    if (
      !pick &&
      !stored.triggerFlowId &&
      !stored.markSpam &&
      !decorates &&
      !escalates &&
      !replies
    ) {
      return null;
    }
    return {
      pick,
      flowId: stored.triggerFlowId,
      markSpam: stored.markSpam,
      priority: stored.priority,
      addTags: stored.addTags,
      escalation: stored.escalation
        ? {
            minutes: stored.escalation.minutes,
            priority: stored.escalation.priority,
            // The agents as they are now: the escalation keeps them even if the rule is edited later.
            assign: stored.escalation.reassign ? stored.assign : null,
          }
        : null,
      autoReply: stored.autoReply,
      stored,
    };
  }

  /** Counts a firing and stores the round robin cursor of the person who took the turn. */
  private async recordFire(tx: Tx, orgId: number, rule: RuleRow, turn: RuleTurn): Promise<void> {
    await this.repo.markFired(
      tx,
      orgId,
      Number(rule.id),
      encodeActions({
        ...turn.stored,
        cursor: turn.pick && turn.pick.userId !== null ? turn.pick.cursor : turn.stored.cursor,
      }),
    );
  }

  /** `turnFor` and `recordFire` in one: the rule fires now (handoff time). */
  private async fire(
    tx: Tx,
    orgId: number,
    rule: RuleRow,
    canOpen: ReadonlySet<number>,
    cal: Calendar,
  ): Promise<RuleTurn | null> {
    const turn = await this.turnFor(tx, orgId, rule, canOpen, cal, false);
    if (turn) await this.recordFire(tx, orgId, rule, turn);
    return turn;
  }

  /**
   * The rule's priority and tags. A priority that is already set is left alone (no event); a tag the thread already has is no event.
   * Each change is a timeline event that names the rule, and the priority change also goes to the outbox like a person's change does.
   */
  private async decorateByRule(
    tx: Tx,
    orgId: number,
    locked: LockedConversation,
    ruleId: string,
    priority: ConversationPriority | null,
    addTags: RoutingTag[],
  ): Promise<void> {
    if (priority !== null) {
      const before = await this.conversations.byUuid(tx, orgId, locked.uuid);
      const from = before?.priority ?? null;
      if (from !== priority) {
        await this.repo.setPriority(tx, orgId, locked.id, priority);
        await this.events.append(tx, orgId, {
          conversationId: locked.id,
          type: 'priority_changed',
          actorKind: 'system',
          actorUserId: null,
          payload: { from, to: priority, by: 'routing', ruleId },
        });
        await this.outbox.emit(tx, {
          aggregateModule: 'conversations',
          aggregateId: locked.id,
          orgId,
          eventType: 'conversation.priority_changed',
          payload: { conversationId: locked.uuid, from, to: priority },
        });
        await this.audit.record(tx, {
          module: 'conversations',
          recordId: locked.id,
          action: 'update',
          delta: { priority: { old: from, new: priority } },
        });
      }
    }
    for (const tag of addTags) {
      const tagId = await this.repo.findOrCreateTag(tx, orgId, tag.name, tag.color);
      if (await this.repo.attachTag(tx, orgId, locked.id, tagId)) {
        await this.repo.touchConversation(tx, orgId, locked.id);
        await this.events.append(tx, orgId, {
          conversationId: locked.id,
          type: 'tag_added',
          actorKind: 'system',
          actorUserId: null,
          payload: { tag: tag.name, by: 'routing', ruleId },
        });
      }
    }
  }

  /**
   * Marks the conversation as spam for a rule's mark_spam action: the same state the bulk "Mark as spam" writes (status spam, the wake
   * time dropped), with a timeline event that names the rule and an audit row. A thread already spam is left alone.
   */
  private async markSpamByRule(
    tx: Tx,
    orgId: number,
    locked: LockedConversation,
    ruleId: string,
  ): Promise<void> {
    if (locked.status === 'spam') return;
    await this.conversations.markSpam(tx, orgId, locked.id);
    await this.events.append(tx, orgId, {
      conversationId: locked.id,
      type: 'spam_flagged',
      actorKind: 'system',
      actorUserId: null,
      payload: { from: locked.status, by: 'routing', ruleId },
    });
    await this.audit.record(tx, {
      module: 'conversations',
      recordId: locked.id,
      action: 'update',
      delta: { status: { old: locked.status, new: 'spam' } },
    });
  }

  /**
   * Who takes it under this action: the agents available now (the listed people plus the members of the listed teams, active, who
   * can open the inbox, not offline or busy), picked by the strategy. Nobody available: the first listed team's queue, or nothing.
   */
  private async choose(
    tx: Tx,
    orgId: number,
    a: RoutingAssign,
    cursor: number | null,
    canOpen: ReadonlySet<number>,
    cal: Calendar,
    trace?: HandoffTraceLine[],
  ): Promise<Pick | null> {
    const users = a.everyone
      ? new Map((await this.repo.allActiveUserIds(tx, orgId)).map((id) => [String(id), id] as const))
      : await this.repo.activeUsers(tx, orgId, a.userIds);
    const teams = await this.repo.teams(tx, orgId, a.teamIds, { receivingOnly: true });
    const teamIds = a.teamIds.filter((t) => teams.has(t)).map((t) => teams.get(t)!);
    const members = await this.repo.teamMembers(tx, orgId, teamIds);

    // Where each candidate comes from, so a person drawn through a team brings that team along; a person named directly does not.
    const origin = new Map<number, number | null>();
    for (const t of a.teamIds) {
      const tid = teams.get(t);
      if (tid === undefined) continue;
      for (const m of members)
        if (m.teamId === tid && !origin.has(m.userId)) origin.set(m.userId, tid);
    }
    for (const id of users.values()) origin.set(id, null);

    // On leave today (BL-112): never picked. A person NAMED by the rule who is away is replaced by their delegate, and the named
    // people (with their delegates) go ahead of the rule's teams; with nobody to take their place the team pool decides.
    const away = await onLeaveMap(tx, orgId, [...origin.keys()], cal.today);
    const delegateFor = new Map<number, string>(); // delegate id -> uuid of the absent person
    let namedAway = false;
    if (away.size > 0) {
      const awayNamed = [...away.keys()].filter((id) => origin.get(id) === null);
      namedAway = awayNamed.length > 0;
      const delegates = await this.repo.delegatesOf(tx, orgId, awayNamed);
      const delegateAway = await onLeaveMap(
        tx,
        orgId,
        [...delegates.values()].map((d) => d.id),
        cal.today,
      );
      const delegateOf = new Map([...delegates].map(([p, d]) => [p, d.id] as const));
      const personUuid = await this.repo.userUuids(tx, orgId, awayNamed);
      for (const id of away.keys()) {
        origin.delete(id);
        cal.blocked.add(id);
      }
      for (const person of awayNamed) {
        const d = pickDelegate(
          delegateOf,
          person,
          (x) => delegateAway.has(x),
          (x) => canOpen.has(x),
        );
        if (d !== null && !origin.has(d) && !away.has(d)) {
          origin.set(d, null);
          delegateFor.set(d, personUuid.get(person) ?? '');
        }
      }
    }

    const considered = [...origin.keys()];
    let pool = (await this.repo.available(tx, orgId, considered, cal.today)).filter((p) =>
      canOpen.has(p.id),
    );
    if (trace) {
      // Why somebody was not picked (BL-401): the run log must be able to show it.
      const names = await this.repo.userUuids(tx, orgId, [...away.keys(), ...considered]);
      for (const id of away.keys()) {
        trace.push({
          step: 'candidate',
          who: names.get(id) ?? null,
          result: 'skipped',
          why: 'on_leave',
        });
      }
      const inPool = new Set(pool.map((p) => p.id));
      for (const id of considered) {
        if (inPool.has(id)) continue;
        trace.push({
          step: 'candidate',
          who: names.get(id) ?? null,
          result: 'skipped',
          why: canOpen.has(id) ? 'offline_busy_or_at_capacity' : 'cannot_read',
        });
      }
      for (const [d, absent] of delegateFor) {
        trace.push({
          step: 'delegate',
          who: names.get(d) ?? null,
          result: 'info',
          why: `covers ${absent}`,
        });
      }
    }
    if (namedAway) {
      const direct = pool.filter((p) => origin.get(p.id) === null);
      if (direct.length > 0) pool = direct;
    }
    // Somebody (a delegate or a teammate) took the place of whoever was away: nothing is blocked for this rule.
    if (pool.length > 0) for (const id of away.keys()) cal.blocked.delete(id);
    const chosen =
      a.strategy === 'least_busy'
        ? pickLeastBusy(
            pool.map((p) => ({ userId: p.id, open: p.open })),
            cursor,
          )
        : pickRoundRobin(
            pool.map((p) => p.id),
            cursor,
          ); // `specific` has a pool of one

    if (chosen !== null) {
      const person = pool.find((p) => p.id === chosen)!;
      const teamId = origin.get(chosen) ?? null;
      const teamUuid =
        teamId === null ? null : (a.teamIds.find((t) => teams.get(t) === teamId) ?? null);
      return {
        userId: person.id,
        userUuid: person.uuid,
        teamId,
        teamUuid,
        how: a.strategy,
        cursor: person.id,
        delegateFor: delegateFor.get(person.id) ?? null,
      };
    }
    const queue = a.teamIds.find((t) => teams.has(t));
    if (queue) {
      return {
        userId: null,
        userUuid: null,
        teamId: teams.get(queue)!,
        teamUuid: queue,
        how: a.strategy,
        cursor: null,
      };
    }
    return null;
  }

  /**
   * "Keep returning contacts with their agent": the contact's owner (`contacts.owner_id`), else whoever held the contact's most
   * recent other conversation, as long as they are an active member who can open the inbox. Availability is not checked. `trace` collects
   * why a candidate was passed over (the "Try it" box).
   */
  private async contactAgent(
    tx: Tx,
    orgId: number,
    contactId: number,
    exceptConversationId: number | null,
    canOpen: ReadonlySet<number>,
    cal: Calendar,
    opts: { last: boolean; days: number | null } = { last: true, days: null },
    trace?: HandoffTraceLine[],
  ): Promise<ContactAgentPick | null> {
    const candidates: Array<{ from: 'owner' | 'last_handler'; id: number | null }> = [
      { from: 'owner', id: await this.repo.contactOwner(tx, orgId, contactId) },
      {
        from: 'last_handler',
        id: opts.last
          ? await this.repo.lastAgentOf(tx, orgId, contactId, exceptConversationId ?? -1, opts.days)
          : null,
      },
    ];
    for (const cand of candidates) {
      let id = cand.id;
      if (id === null) {
        if (cand.from === 'owner' || opts.last)
          trace?.push({
            step: cand.from,
            result: 'skipped',
            why: cand.from === 'owner' ? 'no_owner' : 'no_previous_handler_in_window',
          });
        continue;
      }
      // The owner is away (BL-112): their delegate carries the contact meanwhile; with none present, on to the rules.
      if ((await onLeaveMap(tx, orgId, [id], cal.today)).has(id)) {
        const d = (await this.repo.delegatesOf(tx, orgId, [id])).get(id);
        const dAway = d ? await onLeaveMap(tx, orgId, [d.id], cal.today) : new Map();
        const next = pickDelegate(
          new Map(d ? [[id, d.id]] : []),
          id,
          (x) => dAway.has(x),
          (x) => canOpen.has(x),
        );
        if (next === null) {
          cal.blocked.add(id);
          trace?.push({ step: cand.from, result: 'skipped', why: 'on_leave' });
          continue;
        }
        id = next;
      }
      if (!canOpen.has(id)) {
        trace?.push({ step: cand.from, result: 'skipped', why: 'cannot_read' });
        continue;
      }
      const user = await this.repo.activeUserById(tx, orgId, id);
      if (user) {
        return {
          userId: user.id,
          userUuid: user.uuid,
          teamId: null,
          teamUuid: null,
          how: 'contact_agent',
          cursor: null,
          from: cand.from,
        };
      }
      trace?.push({ step: cand.from, result: 'skipped', why: 'not_an_active_member' });
    }
    return null;
  }

  /** Internal ids of the members who can open the inbox (the 30 second cached list the realtime layer uses). */
  private async inboxPeople(orgId: number): Promise<Set<number>> {
    const viewers = await this.directory.viewers(orgId, PERM_CONVERSATION_READ);
    return new Set(viewers.filter((v) => v.scope !== null).map((v) => v.userId));
  }
}
