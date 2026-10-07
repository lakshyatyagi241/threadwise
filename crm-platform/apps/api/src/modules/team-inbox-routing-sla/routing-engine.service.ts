import { Injectable, Logger } from '@nestjs/common';
import { hasRoutingConditions, type RoutingAssign, type RoutingConditions } from '@crm/contracts';
import type { Tx } from '@crm/db';
import { isOutsideBusinessHours } from '../../common/business-hours';
import { DatabaseService } from '../../infra/db/database.service';
import { MemberDirectory, PERM_CONVERSATION_READ } from '../../realtime';
import { collectRuleRefs, compileRules, loadRuleContext } from '../crm';
import { PlanEntitlementService } from '../plans-subscriptions-trials';
import { ConversationsRepository, type LockedConversation } from '../team-inbox-conversations';
import { AssignmentService, type AssignmentChange, type AssignmentHow } from './assignment.service';
import { pickLeastBusy, pickRoundRobin } from './agent-picker';
import { matchesFacts, type RoutingFacts } from './routing-matcher';
import { decodeActions, decodeConditions, encodeActions } from './routing-rules.mapper';
import { RoutingRulesRepository, type RuleRow } from './routing-rules.repository';

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
  | { outcome: 'assigned'; via: 'contact_agent' | 'rule'; ruleIds: string[] };

type Done = { result: RoutingOutcome; change?: AssignmentChange | null };

interface Pick {
  userId: number | null;
  userUuid: string | null;
  teamId: number | null;
  teamUuid: string | null;
  how: AssignmentHow;
  /** The person who took the turn (the rule's new round robin cursor). */
  cursor: number | null;
}

/**
 * The auto-assignment engine (WD-TIB2-010, 011, 020, trimmed to the assign action): when an inbound message creates a conversation (or
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
 *     takes over the assignment (WaDesk ran every matching rule's actions in order too).
 *  4. If no primary rule fired, the fallback rule (conditions, when it has any, still apply). Otherwise the conversation stays unassigned.
 */
@Injectable()
export class RoutingEngine {
  private readonly logger = new Logger(RoutingEngine.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: RoutingRulesRepository,
    private readonly conversations: ConversationsRepository,
    private readonly assignment: AssignmentService,
    private readonly directory: MemberDirectory,
    private readonly entitlements: PlanEntitlementService,
  ) {}

  async route(input: RoutingInput, now: Date = new Date()): Promise<RoutingOutcome> {
    const { orgId } = input;
    if (!(await this.entitlements.featureEnabled(orgId, 'inbox_routing'))) {
      return { outcome: 'skipped', reason: 'plan' };
    }
    const canOpen = await this.inboxPeople(orgId);

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
        locked.assigneeUserId !== null ||
        locked.assigneeTeamId !== null ||
        locked.assigneeAgentId !== null
      ) {
        return { result: { outcome: 'skipped', reason: 'not_eligible' } };
      }
      // Whatever happens below, this message has been looked at: a retry must not look again.
      await this.repo.stampRouted(tx, orgId, locked.id, input.messageUuid);

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

      // 2. the contact's own agent
      if (facts.contactId !== null && (await this.repo.keepContactAgent(tx, orgId))) {
        const mine = await this.contactAgent(tx, orgId, facts.contactId, locked, canOpen);
        if (mine) {
          await apply(
            { ...mine, teamId: null, teamUuid: null, how: 'contact_agent', cursor: null },
            {},
          );
          return { result: { outcome: 'assigned', via: 'contact_agent', ruleIds: [] }, change };
        }
      }

      // 3 and 4. the rules
      const rules = await this.repo.activeRules(tx, orgId);
      const hours = await this.repo.businessHours(tx, orgId);
      const rf: RoutingFacts = {
        channelKind: facts.channelKind,
        messageText: input.messageText,
        language: facts.language,
        outsideHours: isOutsideBusinessHours(hours.hours, hours.timezone, now),
      };
      const fired: string[] = [];
      const run = async (rule: RuleRow): Promise<boolean> => {
        if (
          !(await this.matches(
            tx,
            orgId,
            decodeConditions(rule.conditions),
            rule.is_fallback === true,
            rf,
            facts.contactId,
          ))
        ) {
          return false;
        }
        const pick = await this.fire(tx, orgId, rule, canOpen);
        if (!pick) return false;
        await apply(pick, { ruleId: rule.uuid as string, ruleName: rule.name as string });
        fired.push(rule.uuid as string);
        return true;
      };
      for (const rule of rules.filter((r) => r.is_fallback !== true)) {
        if ((await run(rule)) && rule.stop_on_match === true) break;
      }
      if (fired.length === 0) {
        for (const rule of rules.filter((r) => r.is_fallback === true)) {
          if (await run(rule)) break;
        }
      }
      if (fired.length === 0) return { result: { outcome: 'unmatched' } };
      return { result: { outcome: 'assigned', via: 'rule', ruleIds: fired }, change };
    });

    if (done.change) await this.assignment.afterCommit(orgId, done.change);
    return done.result;
  }

  // --- matching ----------------------------------------------------------------------------------------------------------------

  /**
   * Every part of the conditions holds. A rule with no condition is a catch-all and only the fallback may be one (the API refuses
   * the other; a hand-edited row that is one never matches). The contact part is the segment rule engine over the contact.
   */
  private async matches(
    tx: Tx,
    orgId: number,
    c: RoutingConditions,
    isFallback: boolean,
    facts: RoutingFacts,
    contactId: number | null,
  ): Promise<boolean> {
    if (!hasRoutingConditions(c)) return isFallback;
    if (!matchesFacts(c, facts)) return false;
    if (c.contact === null) return true;
    if (contactId === null) return false;
    const rules = c.contact as unknown as Parameters<typeof collectRuleRefs>[0];
    const rc = await loadRuleContext(tx, orgId, collectRuleRefs(rules));
    return this.repo.contactMatches(tx, orgId, contactId, compileRules(orgId, rules, rc).where);
  }

  // --- picking -----------------------------------------------------------------------------------------------------------------

  /**
   * A matching rule's turn: lock it, read the cursor as it is now, pick, and record the firing. Null when the rule has nobody to give
   * the conversation to (it does not fire: no count, no cursor move).
   */
  private async fire(
    tx: Tx,
    orgId: number,
    rule: RuleRow,
    canOpen: ReadonlySet<number>,
  ): Promise<Pick | null> {
    const ruleId = Number(rule.id);
    const stored = decodeActions(await this.repo.lockActions(tx, orgId, ruleId));
    const pick = await this.choose(tx, orgId, stored.assign, stored.cursor, canOpen);
    if (!pick) return null;
    await this.repo.markFired(
      tx,
      orgId,
      ruleId,
      encodeActions({ ...stored, cursor: pick.userId !== null ? pick.cursor : stored.cursor }),
    );
    return pick;
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
  ): Promise<Pick | null> {
    const users = await this.repo.activeUsers(tx, orgId, a.userIds);
    const teams = await this.repo.teams(tx, orgId, a.teamIds);
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

    const pool = (await this.repo.available(tx, orgId, [...origin.keys()])).filter((p) =>
      canOpen.has(p.id),
    );
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
   * recent other conversation, as long as they are an active member who can open the inbox. Availability is not checked.
   */
  private async contactAgent(
    tx: Tx,
    orgId: number,
    contactId: number,
    locked: LockedConversation,
    canOpen: ReadonlySet<number>,
  ): Promise<Pick | null> {
    const candidates = [
      await this.repo.contactOwner(tx, orgId, contactId),
      await this.repo.lastAgentOf(tx, orgId, contactId, locked.id),
    ];
    for (const id of candidates) {
      if (id === null || !canOpen.has(id)) continue;
      const user = await this.repo.activeUserById(tx, orgId, id);
      if (user) {
        return {
          userId: user.id,
          userUuid: user.uuid,
          teamId: null,
          teamUuid: null,
          how: 'contact_agent',
          cursor: null,
        };
      }
    }
    return null;
  }

  /** Internal ids of the members who can open the inbox (the 30 second cached list the realtime layer uses). */
  private async inboxPeople(orgId: number): Promise<Set<number>> {
    const viewers = await this.directory.viewers(orgId, PERM_CONVERSATION_READ);
    return new Set(viewers.filter((v) => v.scope !== null).map((v) => v.userId));
  }
}
