import { Injectable, Logger } from '@nestjs/common';
import {
  COMPANY_AUTO_ASSIGNED,
  CONTACT_AUTO_ASSIGNED,
  DEAL_AUTO_ASSIGNED,
  RECORD_ASSIGNMENT_FEATURE,
  type AssignmentReason,
  type AssignmentSubject,
  type AssignmentTraceEntry,
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
import { compileAssignment, loadAssignmentContext } from './assignment-compiler';
import { candidateOrder, orderRules, sameInstant } from './assignment-matcher';
import {
  ContactAssignmentRepository,
  type Candidate,
  type RecordHead,
  type RuleRow,
  type RunRow,
} from './contact-assignment.repository';

export type AssignTrigger = 'created' | 'updated';

export type AssignOutcome =
  | {
      outcome: 'assigned' | 'reassigned';
      ruleId: string;
      ruleName: string;
      ownerId: number;
      ownerUuid: string;
      ownerName: string;
    }
  | {
      outcome:
        | 'disabled'
        | 'plan'
        | 'not_found'
        | 'has_owner'
        | 'no_rule'
        | 'nobody_available'
        | 'unchanged'
        | 'raced';
    };

interface Pick {
  rule: RuleRow;
  person: Candidate;
}

interface Decision {
  pick: Pick | null;
  /** The rule that matched first and is the one the engine already used (reassign mode), or one that may not take over. */
  holdsRecord: boolean;
  matched: boolean;
  skipped: RuleRow[];
  trace: AssignmentTraceEntry[];
}

const MODULE = { contact: 'contacts', company: 'companies', deal: 'deals' } as const;
const AUTO_EVENT = {
  contact: CONTACT_AUTO_ASSIGNED,
  company: COMPANY_AUTO_ASSIGNED,
  deal: DEAL_AUTO_ASSIGNED,
} as const;
/** The event that tells the rest of the product the owner changed (the engine's own is flagged `autoAssigned`, which it ignores). */
const OWNER_EVENT = {
  contact: 'contact.updated',
  company: 'company.updated',
  deal: 'deal.owner_changed',
} as const;

/**
 * The engine of record auto-assignment for contacts, companies and deals (BL-013, BL-340..345). It runs in the worker when a record's
 * creation (or, for updates, change) event is delivered (`ContactAssignmentConsumer`): every write path (screen, API, import, form, lead
 * source, flow, mobile) already announces its record through the outbox, so this is the one shared place, outside the write's own
 * transaction, idempotent and unable to fail a write. The test box of the settings screen runs the same code with `fire = false`.
 *
 * One transaction holding the record's row lock:
 *  1. the workspace switch is on (default OFF) and the plan has `record_assignment` (higher plans only);
 *  2. the record still has no owner AND nobody ever set one (`owner_changed_at IS NULL`: an explicit owner, even an explicit "nobody", is
 *     authoritative; a redelivered event finds an owner and does nothing). The one exception is a rule with "reassign on update": a record
 *     whose owner is still the engine's own last pick (nobody changed it since) may move to a rule that now matches;
 *  3. the active rules in priority order, the rules WITHOUT conditions last (they match everything: the fallback). The first whose
 *     conditions hold AND that finds somebody fires. Candidates are the rule's people and its teams' members who are active, NOT ON LEAVE
 *     today (the workspace calendar) and, by default, not offline. A specific-user rule whose person is away uses their delegate. A rule
 *     that matches but finds nobody does not fire; the next one is tried;
 *  4. the owner is written (only where the record still looks as it did), with an audit row, the owner-changed event (flagged
 *     `autoAssigned`), `<module>.auto_assigned`, and a row in the run log with the trace of every rule tried.
 * Rotation: round robin continues after the last person who took a turn (an id, so people coming and going never repeat or jump it); the
 * least busy method takes the person holding the fewest records of the module now (open deals for deals), ties broken by the rotation.
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
    trigger: AssignTrigger = 'created',
    now: Date = new Date(),
  ): Promise<AssignOutcome> {
    return this.db.txAs({ orgId }, async (tx) => {
      const settings = await this.repo.settings(tx, orgId);
      if (!settings.enabled) return { outcome: 'disabled' };
      if (origin === 'import' && !settings.applyToImports) return { outcome: 'disabled' };
      if (!(await this.entitlements.featureEnabled(orgId, RECORD_ASSIGNMENT_FEATURE)))
        return { outcome: 'plan' };

      const rec = await this.repo.recordHead(tx, orgId, subject, recordUuid, true);
      if (!rec) return { outcome: 'not_found' };
      const rules = orderRules(await this.repo.rules(tx, orgId, subject, true).then(withFlags));
      if (rules.length === 0) return { outcome: 'no_rule' };

      const log = (v: {
        outcome: RunRow['outcome'];
        reason: AssignmentReason;
        rule?: RuleRow | null;
        ownerId?: number | null;
        trace?: AssignmentTraceEntry[];
        stamp?: Date | null;
      }) =>
        this.repo.insertRun(tx, orgId, {
          subject,
          recordId: rec.id,
          ruleId: v.rule?.id ?? null,
          ruleName: v.rule?.name ?? null,
          outcome: v.outcome,
          reason: v.reason,
          ownerId: v.ownerId ?? null,
          method: v.rule?.strategy ?? null,
          origin,
          trigger,
          trace: v.trace ?? [],
          ownerStamp: v.stamp ?? null,
        });

      // Who decided the owner. A person did unless the record still carries the engine's own last pick.
      let engineOwned: RunRow | null = null;
      if (rec.ownerId !== null || rec.ownerChangedAt !== null) {
        if (trigger === 'created') {
          await log({ outcome: 'skipped', reason: 'has_owner' });
          return { outcome: 'has_owner' };
        }
        if (rec.ownerId === null || !rules.some((r) => r.reassignOnUpdate)) {
          return { outcome: 'has_owner' };
        }
        const last = await this.repo.lastPick(tx, orgId, subject, rec.id);
        if (
          !last ||
          last.ownerId !== rec.ownerId ||
          !sameInstant(last.ownerStamp, rec.ownerChangedAt)
        ) {
          return { outcome: 'has_owner' };
        }
        engineOwned = last;
      }

      const cal = await loadWorkspaceCalendar(tx, orgId, now);
      const decided = await this.decide(
        tx,
        orgId,
        subject,
        rec,
        rules,
        origin,
        cal.today,
        true,
        engineOwned,
      );
      if (!decided.pick) {
        if (decided.holdsRecord) return { outcome: 'unchanged' };
        const reason: AssignmentReason = decided.matched ? 'nobody_available' : 'no_rule';
        // An edit that finds no rule is not news: only a new record's miss is logged.
        if (trigger === 'created') await log({ outcome: 'skipped', reason, trace: decided.trace });
        return { outcome: decided.matched ? 'nobody_available' : 'no_rule' };
      }

      const { rule, person } = decided.pick;
      if (engineOwned && person.id === rec.ownerId) return { outcome: 'unchanged' };
      const stamp = await this.repo.setOwner(
        tx,
        orgId,
        subject,
        rec.id,
        person.id,
        engineOwned
          ? { kind: 'engine', ownerId: engineOwned.ownerId!, stamp: engineOwned.ownerStamp }
          : { kind: 'unowned' },
      );
      if (!stamp) return { outcome: 'raced' };
      await this.repo.markFired(tx, orgId, rule.id, person.id);
      // The contact has an owner now: back to uncontacted when the workspace says an assignment does that (BL-290).
      if (subject === 'contact') await this.touch.afterReassign(tx, orgId, [rec.id]);
      const previous = engineOwned?.ownerId ?? null;
      await this.repo.audit(tx, {
        orgId,
        module: MODULE[subject],
        recordId: rec.id,
        action: AUTO_EVENT[subject],
        delta: {
          ownerId: { old: previous === null ? null : String(previous), new: person.uuid },
          ruleId: { old: null, new: rule.uuid },
        },
      });
      await this.outbox.emit(tx, {
        orgId,
        aggregateModule: MODULE[subject],
        aggregateId: rec.id,
        eventType: OWNER_EVENT[subject],
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
        aggregateModule: MODULE[subject],
        aggregateId: rec.id,
        eventType: AUTO_EVENT[subject],
        payload: {
          uuid: rec.uuid,
          ownerId: person.uuid,
          ruleId: rule.uuid,
          ruleName: rule.name,
          autoAssigned: true,
        },
      });
      const outcome = engineOwned ? 'reassigned' : 'assigned';
      await log({
        outcome,
        reason: 'matched',
        rule,
        ownerId: person.id,
        trace: decided.trace,
        stamp,
      });
      return {
        outcome,
        ruleId: rule.uuid,
        ruleName: rule.name,
        ownerId: person.id,
        ownerUuid: person.uuid,
        ownerName: person.name,
      };
    });
  }

  /** The test box: what WOULD happen for a record. Changes nothing (no owner, no counter, no cursor, no log). */
  async dryRun(
    orgId: number,
    subject: AssignmentSubject,
    recordUuid: string,
    now: Date = new Date(),
  ): Promise<TestAssignmentResponse> {
    return this.db.tx(async (tx) => {
      const settings = await this.repo.settings(tx, orgId);
      const base: TestAssignmentResponse = {
        enabled: settings.enabled,
        outcome: 'disabled',
        record: null,
        rule: null,
        owner: null,
        trace: [],
        skipped: [],
      };
      const rec = await this.repo.recordHead(tx, orgId, subject, recordUuid, false);
      if (!rec) return { ...base, outcome: 'not_found' };
      const record = { id: rec.uuid, label: rec.label };
      if (!(await this.entitlements.featureEnabled(orgId, RECORD_ASSIGNMENT_FEATURE)))
        return { ...base, record, outcome: 'plan' };
      const rules = orderRules(await this.repo.rules(tx, orgId, subject, true).then(withFlags));
      const cal = await loadWorkspaceCalendar(tx, orgId, now);
      const decided = await this.decide(
        tx,
        orgId,
        subject,
        rec,
        rules,
        'manual',
        cal.today,
        false,
        null,
      );
      const skipped = decided.skipped.map((r) => ({ id: r.uuid, name: r.name }));
      const shared = { ...base, record, trace: decided.trace, skipped };
      // The trace is shown either way, so a person sees which rule WOULD have taken a record that already has an owner.
      if (rec.ownerId !== null || rec.ownerChangedAt !== null)
        return { ...shared, outcome: 'has_owner' };
      if (!decided.pick) {
        return { ...shared, outcome: decided.matched ? 'nobody_available' : 'no_rule' };
      }
      return {
        ...shared,
        // The switch being off does not stop the test: it says what would happen once it is on.
        outcome: 'would_assign',
        rule: { id: decided.pick.rule.uuid, name: decided.pick.rule.name },
        owner: { id: decided.pick.person.uuid, name: decided.pick.person.name },
      };
    });
  }

  /**
   * Walks the rules in order; `fire` locks the rule row (a fresh cursor) so two records arriving together take two turns. In reassign
   * mode (`engineOwned`) the first rule that matches decides: it takes the record only when it is a different rule that allows
   * reassigning, otherwise the record stays (`holdsRecord`), and rules after it are not consulted.
   */
  private async decide(
    tx: Tx,
    orgId: number,
    subject: AssignmentSubject,
    rec: RecordHead,
    rules: RuleRow[],
    origin: string,
    today: string,
    fire: boolean,
    engineOwned: RunRow | null,
  ): Promise<Decision> {
    const ctx = await loadAssignmentContext(
      tx,
      orgId,
      subject,
      rules.map((r) => r.tree),
    );
    const compiled = rules.map((r) =>
      r.tree && r.tree.children.length > 0
        ? compileAssignment(subject, orgId, r.tree, ctx, origin)
        : null,
    );
    const live = compiled.flatMap((c, i) => (c ? [{ i, where: c.where }] : []));
    const results = await this.repo.evaluate(
      tx,
      orgId,
      subject,
      rec.id,
      live.map((l) => l.where),
    );
    const holds = new Map(live.map((l, k) => [l.i, results[k]!]));

    const decision: Decision = {
      pick: null,
      holdsRecord: false,
      matched: false,
      skipped: [],
      trace: [],
    };
    for (let i = 0; i < rules.length; i++) {
      const listed = rules[i]!;
      const c = compiled[i];
      const matched = c === null ? true : holds.get(i) === true;
      const entry: AssignmentTraceEntry = {
        ruleId: listed.uuid,
        name: listed.name,
        matched,
        nobody: false,
        broken: (c?.invalid.length ?? 0) > 0,
      };
      decision.trace.push(entry);
      if (!matched) continue;
      decision.matched = true;
      if (engineOwned && (listed.id === engineOwned.ruleId || !listed.reassignOnUpdate)) {
        decision.holdsRecord = true;
        return decision;
      }
      const rule = fire
        ? ((await this.repo.ruleById(tx, orgId, listed.id, true)) ?? listed)
        : listed;
      const person = await this.choose(tx, orgId, subject, rule, today);
      if (person) {
        decision.pick = { rule, person };
        return decision;
      }
      entry.nobody = true;
      decision.skipped.push(rule);
    }
    return decision;
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
      // A specific person who is away is replaced by their delegate (one hop, present and active); with none the rule finds nobody.
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

/** Adds the `isFallback` flag `orderRules` reads: a rule without a single condition matches everything. */
export const withFlags = (rows: RuleRow[]): Array<RuleRow & { isFallback: boolean }> =>
  rows.map((r) => ({ ...r, isFallback: !r.tree || r.tree.children.length === 0 }));
