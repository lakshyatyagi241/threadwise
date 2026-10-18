import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  ASSIGNMENT_RUN_RETENTION_DAYS,
  checkAssignmentRules,
  type AssignmentRule,
  type AssignmentRunPage,
  type AssignmentSettings,
  type AssignmentSubject,
  type CreateAssignmentRuleInput,
  type ListAssignmentRunsQuery,
  type ReorderAssignmentRulesInput,
  type TestAssignmentInput,
  type TestAssignmentResponse,
  type UpdateAssignmentRuleInput,
  type UpdateAssignmentSettingsInput,
  type AssignmentRules,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { compileAssignment, loadAssignmentContext } from './assignment-compiler';
import { priorities } from './assignment-matcher';
import { ContactAssignmentEngine, withFlags } from './contact-assignment.engine';
import {
  ContactAssignmentRepository,
  type RuleRow,
  type RunRow,
} from './contact-assignment.repository';

const MAX_RULES = 50;

const invalid = (message: string, path: string) =>
  new AppError(ERROR_CODES.VALIDATION_FAILED, message, HttpStatus.UNPROCESSABLE_ENTITY, [
    { path, message },
  ]);

type Ctx = ReturnType<typeof RequestContextStore.require>;

/**
 * The rules, the switch and the log of record auto-assignment (Settings > Automation > Record assignment rules). The whole controller is
 * gated by the plan feature `record_assignment` (higher plans only) and by `crm.assignment.read|manage` (Manager and above); the engine
 * itself is `ContactAssignmentEngine`. A rule's people must be active members and its teams teams of this workspace; its conditions must
 * be fields of its module.
 */
@Injectable()
export class ContactAssignmentService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ContactAssignmentRepository,
    private readonly engine: ContactAssignmentEngine,
  ) {}

  async getSettings(): Promise<AssignmentSettings> {
    const ctx = RequestContextStore.require();
    return this.db.tx((tx) => this.repo.settings(tx, ctx.orgId));
  }

  async updateSettings(input: UpdateAssignmentSettingsInput): Promise<AssignmentSettings> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const before = await this.repo.settings(tx, ctx.orgId);
      const next = {
        enabled: input.enabled ?? before.enabled,
        applyToImports: input.applyToImports ?? before.applyToImports,
      };
      await this.repo.saveSettings(tx, ctx.orgId, next);
      if (next.enabled !== before.enabled || next.applyToImports !== before.applyToImports) {
        await this.audit(tx, ctx, 'assignment.settings.updated', {
          enabled: { old: before.enabled, new: next.enabled },
          applyToImports: { old: before.applyToImports, new: next.applyToImports },
        });
      }
      return next;
    });
  }

  async list(): Promise<{ data: AssignmentRule[] }> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => ({
      data: await this.present(tx, ctx.orgId, await this.repo.rules(tx, ctx.orgId)),
    }));
  }

  async create(input: CreateAssignmentRuleInput): Promise<AssignmentRule> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const existing = await this.repo.rules(tx, ctx.orgId);
      if (existing.length >= MAX_RULES) throw invalid(`At most ${MAX_RULES} rules.`, 'name');
      await this.assertTargets(tx, ctx.orgId, input.userIds, input.teamIds);
      await this.assertTree(tx, ctx.orgId, input.subject, input.rules);
      const uuid = await this.repo.insertRule(tx, ctx.orgId, {
        name: input.name,
        description: input.description,
        subject: input.subject,
        rules: input.rules,
        strategy: input.strategy,
        userIds: input.userIds,
        teamIds: input.teamIds,
        skipOffline: input.skipOffline,
        reassignOnUpdate: input.reassignOnUpdate,
        isActive: input.isActive,
        sort: await this.repo.nextSort(tx, ctx.orgId, input.subject),
        actorId: ctx.userId ?? null,
      });
      await this.audit(tx, ctx, 'assignment.rule.created', {
        name: { old: null, new: input.name },
      });
      return this.one(tx, ctx.orgId, uuid);
    });
  }

  async update(uuid: string, input: UpdateAssignmentRuleInput): Promise<AssignmentRule> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rule = await this.repo.ruleByUuid(tx, ctx.orgId, uuid, true);
      if (!rule) throw AppError.notFound('Assignment rule', uuid);
      const next = {
        name: input.name ?? rule.name,
        description: input.description ?? rule.description,
        tree: input.rules === undefined ? rule.tree : input.rules,
        strategy: input.strategy ?? rule.strategy,
        userIds: input.userIds ?? rule.userIds,
        teamIds: input.teamIds ?? rule.teamIds,
        skipOffline: input.skipOffline ?? rule.skipOffline,
        reassignOnUpdate: input.reassignOnUpdate ?? rule.reassignOnUpdate,
        isActive: input.isActive ?? rule.isActive,
      };
      if (next.userIds.length + next.teamIds.length === 0)
        throw invalid('Name at least one person or team.', 'userIds');
      if (next.strategy === 'fixed' && (next.userIds.length !== 1 || next.teamIds.length !== 0)) {
        throw invalid('A specific-user rule names exactly one person.', 'userIds');
      }
      await this.assertTargets(tx, ctx.orgId, next.userIds, next.teamIds);
      if (input.rules !== undefined) await this.assertTree(tx, ctx.orgId, rule.subject, next.tree);
      const poolChanged =
        next.strategy !== rule.strategy ||
        JSON.stringify(next.userIds) !== JSON.stringify(rule.userIds) ||
        JSON.stringify(next.teamIds) !== JSON.stringify(rule.teamIds);
      if (
        !(await this.repo.updateRule(tx, ctx.orgId, rule.id, input.rowVersion, {
          ...next,
          actorId: ctx.userId ?? null,
          resetRotation: poolChanged,
        }))
      ) {
        throw AppError.rowVersionConflict('Assignment rule');
      }
      await this.audit(tx, ctx, 'assignment.rule.updated', {
        name: { old: rule.name, new: next.name },
      });
      return this.one(tx, ctx.orgId, uuid);
    });
  }

  /** Activate or pause a rule. A paused rule keeps its place in the list but is not prioritised and never runs. */
  async setActive(uuid: string, active: boolean): Promise<AssignmentRule> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rule = await this.repo.ruleByUuid(tx, ctx.orgId, uuid, true);
      if (!rule) throw AppError.notFound('Assignment rule', uuid);
      if (rule.isActive !== active) {
        await this.repo.setActive(tx, ctx.orgId, rule.id, active, ctx.userId ?? null);
        await this.audit(tx, ctx, active ? 'assignment.rule.activated' : 'assignment.rule.paused', {
          name: { old: rule.name, new: rule.name },
        });
      }
      return this.one(tx, ctx.orgId, uuid);
    });
  }

  /** A copy of a rule, last in its module and not active, so it can be edited before it takes any record. */
  async clone(uuid: string): Promise<AssignmentRule> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rule = await this.repo.ruleByUuid(tx, ctx.orgId, uuid);
      if (!rule) throw AppError.notFound('Assignment rule', uuid);
      if ((await this.repo.rules(tx, ctx.orgId)).length >= MAX_RULES)
        throw invalid(`At most ${MAX_RULES} rules.`, 'name');
      const copy = await this.repo.insertRule(tx, ctx.orgId, {
        name: `${rule.name} (copy)`.slice(0, 120),
        description: rule.description,
        subject: rule.subject,
        rules: rule.tree,
        strategy: rule.strategy,
        userIds: rule.userIds,
        teamIds: rule.teamIds,
        skipOffline: rule.skipOffline,
        reassignOnUpdate: rule.reassignOnUpdate,
        isActive: false,
        sort: await this.repo.nextSort(tx, ctx.orgId, rule.subject),
        actorId: ctx.userId ?? null,
      });
      await this.audit(tx, ctx, 'assignment.rule.cloned', {
        name: { old: rule.name, new: `${rule.name} (copy)` },
      });
      return this.one(tx, ctx.orgId, copy);
    });
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const rule = await this.repo.ruleByUuid(tx, ctx.orgId, uuid, true);
      if (!rule) throw AppError.notFound('Assignment rule', uuid);
      await this.repo.deleteRule(tx, ctx.orgId, rule.id);
      await this.audit(tx, ctx, 'assignment.rule.deleted', { name: { old: rule.name, new: null } });
    });
  }

  /** Puts the listed rules of one module first, in this order; the others keep their relative order after them. */
  async reorder(input: ReorderAssignmentRulesInput): Promise<{ data: AssignmentRule[] }> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const rows = await this.repo.rules(tx, ctx.orgId, input.subject);
      const byUuid = new Map(rows.map((r) => [r.uuid, r]));
      const listed = input.ids.map((id) => byUuid.get(id));
      if (listed.some((r) => !r) || new Set(input.ids).size !== input.ids.length) {
        throw invalid('Unknown or repeated rule.', 'ids');
      }
      const order = [...(listed as RuleRow[]), ...rows.filter((r) => !input.ids.includes(r.uuid))];
      let i = 10;
      for (const r of order) {
        await this.repo.setSort(tx, ctx.orgId, r.id, i);
        i += 10;
      }
      await this.audit(tx, ctx, 'assignment.rule.reordered', {});
    });
    return this.list();
  }

  /** "Which rule would take this record, and who?" for a real record. Changes nothing. */
  async test(input: TestAssignmentInput): Promise<TestAssignmentResponse> {
    const ctx = RequestContextStore.require();
    return this.engine.dryRun(ctx.orgId, input.subject, input.recordId);
  }

  async runs(q: ListAssignmentRunsQuery): Promise<AssignmentRunPage> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      let ruleId: number | undefined;
      if (q.ruleId) {
        const rule = await this.repo.ruleByUuid(tx, ctx.orgId, q.ruleId);
        if (!rule) return { data: [], nextCursor: null };
        ruleId = rule.id;
      }
      let recordId: number | undefined;
      if (q.recordId) {
        if (!q.subject) throw invalid('Name the module of the record.', 'subject');
        const id = await this.repo.recordIdByUuid(tx, ctx.orgId, q.subject, q.recordId);
        if (id === null) return { data: [], nextCursor: null };
        recordId = id;
      }
      const beforeId = q.cursor && /^\d+$/.test(q.cursor) ? Number(q.cursor) : undefined;
      const rows = await this.repo.runs(tx, ctx.orgId, {
        subject: q.subject,
        ruleId,
        recordId,
        outcome: q.outcome,
        beforeId,
        limit: q.limit + 1,
      });
      const page = rows.slice(0, q.limit);
      const rules = new Map((await this.repo.rules(tx, ctx.orgId)).map((r) => [r.id, r.uuid]));
      const labels = new Map<string, Awaited<ReturnType<ContactAssignmentRepository['labels']>>>();
      for (const subject of ['contact', 'company', 'deal'] as const) {
        labels.set(
          subject,
          await this.repo.labels(
            tx,
            ctx.orgId,
            subject,
            page.filter((r) => r.subject === subject).map((r) => r.recordId),
          ),
        );
      }
      return {
        data: page.map((r) => this.presentRun(r, rules, labels.get(r.subject)!.get(r.recordId))),
        nextCursor: rows.length > q.limit ? String(page[page.length - 1]!.id) : null,
      };
    });
  }

  /** Days a run stays in the log (documented on the screen). */
  static readonly RETENTION_DAYS = ASSIGNMENT_RUN_RETENTION_DAYS;

  // --- helpers --------------------------------------------------------------------------------------------------------------------

  private presentRun(
    r: RunRow,
    rules: Map<number, string>,
    rec: { uuid: string; label: string } | undefined,
  ) {
    return {
      id: r.uuid,
      subject: r.subject,
      record: rec ? { id: rec.uuid, label: rec.label } : null,
      ruleId: r.ruleId === null ? null : (rules.get(r.ruleId) ?? null),
      ruleName: r.ruleName,
      outcome: r.outcome,
      reason: r.reason as AssignmentRunPage['data'][number]['reason'],
      owner: r.ownerUuid ? { id: r.ownerUuid, name: r.ownerName ?? '' } : null,
      method: (r.method as AssignmentRunPage['data'][number]['method']) ?? null,
      origin: r.origin,
      trigger: r.trigger,
      trace: r.trace,
      createdAt: r.createdAt.toISOString(),
    };
  }

  private async one(tx: Tx, orgId: number, uuid: string): Promise<AssignmentRule> {
    const row = (await this.repo.ruleByUuid(tx, orgId, uuid))!;
    const all = await this.repo.rules(tx, orgId, row.subject);
    const presented = await this.present(tx, orgId, all);
    return presented.find((r) => r.id === row.uuid)!;
  }

  /** The rules as the screens see them: place in the list, priority among the active ones, the fallback flag and broken conditions. */
  private async present(tx: Tx, orgId: number, rows: RuleRow[]): Promise<AssignmentRule[]> {
    const out: AssignmentRule[] = [];
    for (const subject of ['contact', 'company', 'deal'] as const) {
      const of = rows.filter((r) => r.subject === subject);
      if (of.length === 0) continue;
      const flagged = withFlags(of);
      const rank = priorities(flagged);
      const ctx = await loadAssignmentContext(
        tx,
        orgId,
        subject,
        of.map((r) => r.tree),
      );
      flagged.forEach((r, i) => {
        const broken =
          r.tree && !r.isFallback
            ? compileAssignment(subject, orgId, r.tree, ctx, 'manual').invalid.length
            : 0;
        out.push({
          id: r.uuid,
          name: r.name,
          description: r.description,
          subject,
          rules: r.tree,
          strategy: r.strategy,
          userIds: r.userIds,
          teamIds: r.teamIds,
          skipOffline: r.skipOffline,
          reassignOnUpdate: r.reassignOnUpdate,
          isActive: r.isActive,
          isFallback: r.isFallback,
          position: i + 1,
          priority: rank.get(r.id) ?? null,
          firedCount: r.firedCount,
          lastFiredAt: r.lastFiredAt ? r.lastFiredAt.toISOString() : null,
          brokenConditions: broken,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
          lastModifiedBy: r.updatedBy ? { id: r.updatedBy.uuid, name: r.updatedBy.name } : null,
          rowVersion: r.rowVersion,
        });
      });
    }
    return out;
  }

  /**
   * A tree must use fields of its module, operators that suit them and values of the right shape; every thing it points at (a custom
   * property, a pipeline, a tag, a person) must exist now. Later deletions are tolerated: that condition just matches nothing.
   */
  private async assertTree(
    tx: Tx,
    orgId: number,
    subject: AssignmentSubject,
    tree: AssignmentRules | null,
  ): Promise<void> {
    if (!tree) return;
    const issues = checkAssignmentRules(subject, tree);
    if (issues.length > 0) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'The conditions are not valid',
        HttpStatus.UNPROCESSABLE_ENTITY,
        issues.slice(0, 10),
      );
    }
    const ctx = await loadAssignmentContext(tx, orgId, subject, [tree]);
    const compiled = compileAssignment(subject, orgId, tree, ctx, 'manual');
    if (compiled.invalid.length > 0) {
      throw new AppError(
        ERROR_CODES.VALIDATION_FAILED,
        'The conditions are not valid',
        HttpStatus.UNPROCESSABLE_ENTITY,
        compiled.invalid
          .slice(0, 10)
          .map((p) => ({ path: p.path ? `rules.${p.path}` : 'rules', message: p.message })),
      );
    }
  }

  private async assertTargets(
    tx: Tx,
    orgId: number,
    userIds: string[],
    teamIds: string[],
  ): Promise<void> {
    const users = await this.repo.userIdsByUuid(tx, orgId, userIds);
    const bad = userIds.find((u) => !users.has(u));
    if (bad) throw invalid('Only active members of this workspace can take work.', 'userIds');
    const teams = await this.repo.teamIdsByUuid(tx, orgId, teamIds);
    if (teamIds.some((t) => !teams.has(t))) throw invalid('Unknown team.', 'teamIds');
  }

  private async audit(
    tx: Tx,
    ctx: Ctx,
    action: string,
    delta: Record<string, unknown>,
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta, request_id)
      VALUES (${ctx.orgId}, ${ctx.actorId}, ${ctx.actorType}, 'assignment', 0, ${action}, ${JSON.stringify(delta)}::jsonb, ${ctx.requestId ?? null})`);
  }
}
