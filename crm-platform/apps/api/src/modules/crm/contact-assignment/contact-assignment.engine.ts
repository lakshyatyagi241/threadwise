import { Injectable, Logger } from '@nestjs/common';
import {
  CONTACT_AUTO_ASSIGNED,
  DEAL_AUTO_ASSIGNED,
  type AssignmentSubject,
  type TestAssignmentResponse,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { pickLeastBusy, pickRoundRobin } from '../../../common/agent-picker';
import { pickDelegate } from '../../../common/leave-delegate';
import { loadWorkspaceCalendar, onLeaveMap } from '../../../common/workspace-calendar';
import { DatabaseService } from '../../../infra/db/database.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { PlanEntitlementService } from '../../plans-subscriptions-trials';
import { ContactTouchService } from '../lead-handling/contact-touch.service';
import { candidateOrder, matchesAssignment, type AssignmentFacts } from './assignment-matcher';
import {
  ContactAssignmentRepository,
  type Candidate,
  type RecordFacts,
  type RuleRow,
} from './contact-assignment.repository';

export type AssignOutcome =
  | {
      outcome: 'assigned';
      ruleId: string;
      ruleName: string;
      ownerId: number;
      ownerUuid: string;
      ownerName: string;
    }
  | {
      outcome:
        'disabled' | 'plan' | 'not_found' | 'has_owner' | 'no_rule' | 'nobody_available' | 'raced';
    };

interface Pick {
  rule: RuleRow;
  person: Candidate;
}

/**
 * The engine of contact and deal auto-assignment (BL-013, BL-112 phase 3). Runs in the worker when `contact.created` / `deal.created`
 * is delivered (`ContactAssignmentConsumer`), never in a request; the test box of the settings screen runs the same code with
 * `dry = true`.
 *
 * One transaction holding the record's row lock:
 *  1. the workspace switch is on (default OFF) and the plan has routing (`inbox_routing`, the feature routing rules already use);
 *  2. the record still has no owner AND nobody ever set one (`owner_changed_at IS NULL`: an explicit owner, even an explicit
 *     "nobody", is authoritative, and a redelivered event finds an owner and does nothing: idempotent);
 *  3. active rules of the subject in priority order; the first whose conditions hold AND that finds somebody fires. Candidates are the
 *     rule's people and its teams' members who are active, NOT ON LEAVE today (the workspace calendar) and, by default, not offline. A
 *     fixed rule whose person is away uses their delegate. A rule that matches but finds nobody does not fire; the next one is tried;
 *  4. the owner is written (only where it is still empty), with an audit row, `contact.updated` (flagged `autoAssigned`, so the flows
 *     and the engine itself can tell it from a person's edit: this engine listens to `*.created` only, so assignment cannot trigger
 *     assignment), and `contact.auto_assigned` / `deal.auto_assigned` carrying the rule id.
 * Rotation: round robin continues after the last person who took a turn (an id, so people coming and going never repeat or jump it);
 * least busy takes the person holding the fewest records of the subject now, ties broken by the rotation.
 */
@Injectable()
export class ContactAssignmentEngine {
  private readonly logger = new Logger(ContactAssignmentEngine.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ContactAssignmentRepository,
    private readonly outbox: OutboxService,
    private readonly entitlements: PlanEntitlementService,
    private readonly touch: ContactTouchService,
  ) {}

  async assign(
    orgId: number,
    subject: AssignmentSubject,
    recordUuid: string,
    origin: string,
    now: Date = new Date(),
  ): Promise<AssignOutcome> {
    return this.db.txAs({ orgId }, async (tx) => {
      const settings = await this.repo.settings(tx, orgId);
      if (!settings.enabled) return { outcome: 'disabled' };
      if (origin === 'import' && !settings.applyToImports) return { outcome: 'disabled' };
      if (!(await this.entitlements.featureEnabled(orgId, 'inbox_routing')))
        return { outcome: 'plan' };

      const rec = await this.load(tx, orgId, subject, recordUuid, origin, true);
      if (!rec) return { outcome: 'not_found' };
      if (rec.ownerId !== null || rec.ownerChangedAt !== null) return { outcome: 'has_owner' };

      const cal = await loadWorkspaceCalendar(tx, orgId, now);
      const decided = await this.decide(tx, orgId, subject, rec.facts, cal.today, true);
      if (!decided.pick) return { outcome: decided.matched ? 'nobody_available' : 'no_rule' };

      const { rule, person } = decided.pick;
      if (!(await this.repo.setOwner(tx, orgId, subject, rec.id, person.id)))
        return { outcome: 'raced' };
      await this.repo.markFired(tx, orgId, rule.id, person.id);
      // The contact has an owner now: back to uncontacted when the workspace says an assignment does that (BL-290).
      if (subject === 'contact') await this.touch.afterReassign(tx, orgId, [rec.id]);
      const module = subject === 'contact' ? 'contacts' : 'deals';
      await this.repo.audit(tx, {
        orgId,
        module,
        recordId: rec.id,
        action: subject === 'contact' ? CONTACT_AUTO_ASSIGNED : DEAL_AUTO_ASSIGNED,
        delta: { ownerId: { old: null, new: person.uuid }, ruleId: { old: null, new: rule.uuid } },
      });
      await this.outbox.emit(tx, {
        orgId,
        aggregateModule: module,
        aggregateId: rec.id,
        eventType: subject === 'contact' ? 'contact.updated' : 'deal.owner_changed',
        payload: {
          uuid: rec.uuid,
          ownerId: person.uuid,
          previousOwnerId: null,
          autoAssigned: true,
          ruleId: rule.uuid,
        },
      });
      await this.outbox.emit(tx, {
        orgId,
        aggregateModule: module,
        aggregateId: rec.id,
        eventType: subject === 'contact' ? CONTACT_AUTO_ASSIGNED : DEAL_AUTO_ASSIGNED,
        payload: {
          uuid: rec.uuid,
          ownerId: person.uuid,
          ruleId: rule.uuid,
          ruleName: rule.name,
          autoAssigned: true,
        },
      });
      return {
        outcome: 'assigned',
        ruleId: rule.uuid,
        ruleName: rule.name,
        ownerId: person.id,
        ownerUuid: person.uuid,
        ownerName: person.name,
      };
    });
  }

  /** The test box: what WOULD happen for a record or a described record. Changes nothing (no owner, no counter, no cursor). */
  async dryRun(
    orgId: number,
    subject: AssignmentSubject,
    input: { recordUuid?: string; facts?: Partial<AssignmentFacts> },
    now: Date = new Date(),
  ): Promise<TestAssignmentResponse> {
    return this.db.tx(async (tx) => {
      const settings = await this.repo.settings(tx, orgId);
      const base: TestAssignmentResponse = {
        enabled: settings.enabled,
        outcome: 'disabled',
        rule: null,
        owner: null,
        skipped: [],
      };
      let facts: AssignmentFacts = {
        source: null,
        countryCode: null,
        phoneDigits: null,
        lifecycleStage: null,
        tagIds: [],
        origin: 'manual',
        properties: {},
        pipelineId: null,
        value: null,
        ...(input.facts ?? {}),
      };
      if (input.recordUuid) {
        const rec = await this.load(
          tx,
          orgId,
          subject,
          input.recordUuid,
          input.facts?.origin ?? 'manual',
          false,
        );
        if (!rec) return { ...base, outcome: 'no_rule' };
        facts = rec.facts;
        if (rec.ownerId !== null || rec.ownerChangedAt !== null) {
          return { ...base, outcome: 'has_owner' };
        }
      }
      if (!(await this.entitlements.featureEnabled(orgId, 'inbox_routing')))
        return { ...base, outcome: 'plan' };
      const cal = await loadWorkspaceCalendar(tx, orgId, now);
      const decided = await this.decide(tx, orgId, subject, facts, cal.today, false);
      const skipped = decided.skipped.map((r) => ({ id: r.uuid, name: r.name }));
      if (!decided.pick) {
        return { ...base, outcome: decided.matched ? 'nobody_available' : 'no_rule', skipped };
      }
      return {
        enabled: settings.enabled,
        // The switch being off does not stop the test: it says what would happen once it is on.
        outcome: 'would_assign',
        rule: { id: decided.pick.rule.uuid, name: decided.pick.rule.name },
        owner: { id: decided.pick.person.uuid, name: decided.pick.person.name },
        skipped,
      };
    });
  }

  private load(
    tx: Tx,
    orgId: number,
    subject: AssignmentSubject,
    uuid: string,
    origin: string,
    lock: boolean,
  ): Promise<RecordFacts | null> {
    return subject === 'contact'
      ? this.repo.contactFacts(tx, orgId, uuid, origin, lock)
      : this.repo.dealFacts(tx, orgId, uuid, origin, lock);
  }

  /** Walks the rules in order; `fire` locks the rule row (a fresh cursor) so two records arriving together take two turns. */
  private async decide(
    tx: Tx,
    orgId: number,
    subject: AssignmentSubject,
    facts: AssignmentFacts,
    today: string,
    fire: boolean,
  ): Promise<{ pick: Pick | null; matched: boolean; skipped: RuleRow[] }> {
    const rules = await this.repo.rules(tx, orgId, subject, true);
    const skipped: RuleRow[] = [];
    let matched = false;
    for (const listed of rules) {
      if (!matchesAssignment(listed.conditions, facts)) continue;
      matched = true;
      const rule = fire
        ? ((await this.repo.ruleById(tx, orgId, listed.id, true)) ?? listed)
        : listed;
      const person = await this.choose(tx, orgId, subject, rule, today);
      if (person) return { pick: { rule, person }, matched, skipped };
      skipped.push(rule);
    }
    return { pick: null, matched, skipped };
  }

  private async choose(
    tx: Tx,
    orgId: number,
    subject: AssignmentSubject,
    rule: RuleRow,
    today: string,
  ): Promise<Candidate | null> {
    const users = await this.repo.userIdsByUuid(tx, orgId, rule.userIds);
    const named = rule.userIds.map((u) => users.get(u)).filter((x): x is number => x !== undefined);
    const teams = await this.repo.teamIdsByUuid(tx, orgId, rule.teamIds);
    const teamMembers = await this.repo.teamMembers(tx, orgId, [...teams.values()]);

    let ids = candidateOrder(named, teamMembers);
    if (rule.strategy === 'fixed' && named.length === 1) {
      // A fixed person who is away is replaced by their delegate (one hop, present and active); with none the rule finds nobody.
      const away = await onLeaveMap(tx, orgId, named, today);
      if (away.size > 0) {
        const delegates = await this.repo.delegatesOf(tx, orgId, named);
        const dAway = await onLeaveMap(tx, orgId, [...delegates.values()], today);
        const d = pickDelegate(
          delegates,
          named[0]!,
          (x) => dAway.has(x),
          () => true,
        );
        ids = d === null ? [] : [d];
      }
    }
    const pool = await this.repo.candidates(tx, orgId, ids, subject, rule.skipOffline, today);
    if (pool.length === 0) return null;
    const chosen =
      rule.strategy === 'least_busy'
        ? pickLeastBusy(
            pool.map((p) => ({ userId: p.id, open: p.load })),
            rule.rrCursor,
          )
        : rule.strategy === 'round_robin'
          ? pickRoundRobin(
              pool.map((p) => p.id),
              rule.rrCursor,
            )
          : pool[0]!.id;
    return pool.find((p) => p.id === chosen) ?? null;
  }
}
