import { HttpStatus, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  ERROR_CODES,
  type AssignmentRule,
  type AssignmentSettings,
  type CreateAssignmentRuleInput,
  type ReorderAssignmentRulesInput,
  type TestAssignmentInput,
  type TestAssignmentResponse,
  type UpdateAssignmentRuleInput,
  type UpdateAssignmentSettingsInput,
  assignmentConditionsSchema,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { PlanEntitlementService } from '../../plans-subscriptions-trials';
import { ContactAssignmentEngine } from './contact-assignment.engine';
import { ContactAssignmentRepository, type RuleRow } from './contact-assignment.repository';

const MAX_RULES = 50;

const invalid = (message: string, path: string) =>
  new AppError(ERROR_CODES.VALIDATION_FAILED, message, HttpStatus.UNPROCESSABLE_ENTITY, [
    { path, message },
  ]);

const toResponse = (r: RuleRow, position: number): AssignmentRule => ({
  id: r.uuid,
  name: r.name,
  subject: r.subject,
  conditions: assignmentConditionsSchema.parse(r.conditions ?? {}),
  strategy: r.strategy,
  userIds: r.userIds,
  teamIds: r.teamIds,
  skipOffline: r.skipOffline,
  isActive: r.isActive,
  position,
  firedCount: r.firedCount,
  lastFiredAt: r.lastFiredAt ? r.lastFiredAt.toISOString() : null,
  rowVersion: r.rowVersion,
});

/**
 * The rules and the switch of contact and deal auto-assignment (Settings > Automation > Contact assignment). The API is gated by
 * `crm.assignment.read|manage` (Manager and above) and by the plan feature routing rules already use (`inbox_routing`); the engine
 * itself is `ContactAssignmentEngine`. A rule's people must be active members and its teams teams of this workspace.
 */
@Injectable()
export class ContactAssignmentService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: ContactAssignmentRepository,
    private readonly engine: ContactAssignmentEngine,
    private readonly entitlements: PlanEntitlementService,
  ) {}

  private async gate(orgId: number): Promise<void> {
    await this.entitlements.assertFeature(orgId, 'inbox_routing');
  }

  async getSettings(): Promise<AssignmentSettings> {
    const ctx = RequestContextStore.require();
    return this.db.tx((tx) => this.repo.settings(tx, ctx.orgId));
  }

  async updateSettings(input: UpdateAssignmentSettingsInput): Promise<AssignmentSettings> {
    const ctx = RequestContextStore.require();
    await this.gate(ctx.orgId);
    return this.db.tx(async (tx) => {
      const before = await this.repo.settings(tx, ctx.orgId);
      const next = {
        enabled: input.enabled ?? before.enabled,
        applyToImports: input.applyToImports ?? before.applyToImports,
      };
      await this.repo.saveSettings(tx, ctx.orgId, next);
      if (next.enabled !== before.enabled || next.applyToImports !== before.applyToImports) {
        await tx.execute(sql`
          INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta, request_id)
          VALUES (${ctx.orgId}, ${ctx.actorId}, ${ctx.actorType}, 'assignment', 0, 'assignment.settings.updated',
                  ${JSON.stringify({ enabled: { old: before.enabled, new: next.enabled }, applyToImports: { old: before.applyToImports, new: next.applyToImports } })}::jsonb,
                  ${ctx.requestId ?? null})`);
      }
      return next;
    });
  }

  async list(): Promise<{ data: AssignmentRule[] }> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const rows = await this.repo.rules(tx, ctx.orgId);
      const pos = new Map<string, number>();
      return {
        data: rows.map((r) =>
          toResponse(r, (pos.set(r.subject, (pos.get(r.subject) ?? 0) + 1), pos.get(r.subject)!)),
        ),
      };
    });
  }

  async create(input: CreateAssignmentRuleInput): Promise<AssignmentRule> {
    const ctx = RequestContextStore.require();
    await this.gate(ctx.orgId);
    return this.db.tx(async (tx) => {
      const existing = await this.repo.rules(tx, ctx.orgId);
      if (existing.length >= MAX_RULES) throw invalid(`At most ${MAX_RULES} rules.`, 'name');
      await this.assertTargets(tx, ctx.orgId, input.userIds, input.teamIds);
      const uuid = await this.repo.insertRule(tx, ctx.orgId, {
        ...input,
        sort: await this.repo.nextSort(tx, ctx.orgId, input.subject),
        createdBy: ctx.userId ?? null,
      });
      await this.audit(tx, ctx, 'assignment.rule.created', {
        name: { old: null, new: input.name },
      });
      const row = (await this.repo.ruleByUuid(tx, ctx.orgId, uuid))!;
      const all = await this.repo.rules(tx, ctx.orgId, row.subject);
      return toResponse(row, all.findIndex((r) => r.id === row.id) + 1);
    });
  }

  async update(uuid: string, input: UpdateAssignmentRuleInput): Promise<AssignmentRule> {
    const ctx = RequestContextStore.require();
    await this.gate(ctx.orgId);
    return this.db.tx(async (tx) => {
      const rule = await this.repo.ruleByUuid(tx, ctx.orgId, uuid, true);
      if (!rule) throw AppError.notFound('Assignment rule', uuid);
      const next = {
        name: input.name ?? rule.name,
        conditions: input.conditions ?? rule.conditions,
        strategy: input.strategy ?? rule.strategy,
        userIds: input.userIds ?? rule.userIds,
        teamIds: input.teamIds ?? rule.teamIds,
        skipOffline: input.skipOffline ?? rule.skipOffline,
        isActive: input.isActive ?? rule.isActive,
      };
      if (next.userIds.length + next.teamIds.length === 0)
        throw invalid('Name at least one person or team.', 'userIds');
      if (next.strategy === 'fixed' && (next.userIds.length !== 1 || next.teamIds.length !== 0)) {
        throw invalid('A fixed rule names exactly one person.', 'userIds');
      }
      await this.assertTargets(tx, ctx.orgId, next.userIds, next.teamIds);
      if (!(await this.repo.updateRule(tx, ctx.orgId, rule.id, input.rowVersion, next))) {
        throw AppError.rowVersionConflict('Assignment rule');
      }
      await this.audit(tx, ctx, 'assignment.rule.updated', {
        name: { old: rule.name, new: next.name },
      });
      const row = (await this.repo.ruleByUuid(tx, ctx.orgId, uuid))!;
      const all = await this.repo.rules(tx, ctx.orgId, row.subject);
      return toResponse(row, all.findIndex((r) => r.id === row.id) + 1);
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

  /** Puts the listed rules of one subject first, in this order; the others keep their relative order after them. */
  async reorder(input: ReorderAssignmentRulesInput): Promise<{ data: AssignmentRule[] }> {
    const ctx = RequestContextStore.require();
    await this.gate(ctx.orgId);
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

  async test(input: TestAssignmentInput): Promise<TestAssignmentResponse> {
    const ctx = RequestContextStore.require();
    const f = input.facts;
    return this.engine.dryRun(ctx.orgId, input.subject, {
      recordUuid: input.recordId,
      facts: f
        ? {
            source: f.source ?? null,
            countryCode: f.countryCode ?? null,
            phoneDigits: f.phone ? f.phone.replace(/\D/g, '') : null,
            lifecycleStage: f.lifecycleStage ?? null,
            tagIds: f.tagIds ?? [],
            origin: f.origin ?? 'manual',
            properties: f.properties ?? {},
            pipelineId: f.pipelineId ?? null,
            value: f.value ?? null,
          }
        : undefined,
    });
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
    ctx: ReturnType<typeof RequestContextStore.require>,
    action: string,
    delta: Record<string, unknown>,
  ): Promise<void> {
    await tx.execute(sql`
      INSERT INTO audit_log (org_id, actor_id, actor_type, module, record_id, action, delta, request_id)
      VALUES (${ctx.orgId}, ${ctx.actorId}, ${ctx.actorType}, 'assignment', 0, ${action}, ${JSON.stringify(delta)}::jsonb, ${ctx.requestId ?? null})`);
  }
}
