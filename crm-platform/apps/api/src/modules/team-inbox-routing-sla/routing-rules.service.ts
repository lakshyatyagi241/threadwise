import { Injectable } from '@nestjs/common';
import {
  hasRoutingConditions,
  type CreateRoutingRuleInput,
  type ListRoutingRulesQuery,
  type ReorderRoutingRulesInput,
  type RoutingAssign,
  type RoutingRule,
  type RoutingRuleListResponse,
  type RoutingSettings,
  type UpdateRoutingRuleInput,
  type UpdateRoutingSettingsInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import { MemberDirectory, PERM_CONVERSATION_READ } from '../../realtime';
import { PlanEntitlementService, PlanUsageService } from '../plans-subscriptions-trials';
import { decodeActions, encodeActions, toRoutingRule } from './routing-rules.mapper';
import { RoutingRulesRepository, type RuleRow } from './routing-rules.repository';

const MODULE_KEY = 'routing_rules';
const SETTINGS_MODULE = 'routing_settings';

/**
 * Routing rules CRUD (TW-TIB2-004 to 007; the engine that runs them is `RoutingEngine`). Every write is one transaction holding the
 * change, its audit row and its outbox event. The caller's permission (`inbox.routing.manage` to write, `inbox.settings.read` to read)
 * and the plan feature `inbox_routing` are enforced by the controller; the plan's `routing_rules` limit here, on create and duplicate.
 *
 * Rules beyond Reference: priority is real (`sort`, set by reorder; a new rule goes last), at most ONE fallback (saving a rule as the
 * fallback takes the flag off the previous one), targets are validated (an agent must be an active member who can open the inbox,
 * a team must exist) with the friendly 422 Reference used, and a rule is saved switched OFF unless the form says "Save and Activate".
 */
@Injectable()
export class RoutingRulesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: RoutingRulesRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly directory: MemberDirectory,
    private readonly usage: PlanUsageService,
    private readonly entitlements: PlanEntitlementService,
  ) {}

  async list(query: ListRoutingRulesQuery): Promise<RoutingRuleListResponse> {
    const { orgId } = RequestContextStore.require();
    const limit = await this.entitlements.limit(orgId, 'routing_rules');
    return this.db.tx(async (tx) => {
      const page = await this.repo.list(tx, orgId, query);
      const data = await this.present(tx, orgId, page.rows);
      return {
        data,
        page: {
          nextCursor: page.nextCursor,
          hasMore: page.nextCursor !== null,
          limit: query.limit,
        },
        total: await this.repo.count(tx, orgId),
        limit: limit > 0 ? limit : null,
      };
    });
  }

  async get(uuid: string): Promise<RoutingRule> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.byUuid(tx, orgId, uuid);
      if (!row) throw AppError.notFound('Routing rule');
      return (await this.present(tx, orgId, [row]))[0]!;
    });
  }

  async create(input: CreateRoutingRuleInput): Promise<RoutingRule> {
    const { orgId } = RequestContextStore.require();
    // The plan's row limit counts every rule, switched off ones too (TW-TIB2-005 rule 4), and is checked before anything else.
    await this.usage.assertCanAdd(orgId, 'routing_rules');
    return this.db.tx(async (tx) => {
      await this.assertTargets(tx, orgId, input.assign);
      await this.assertFlow(tx, orgId, input.triggerFlowId);
      const created = await this.repo.insert(tx, orgId, {
        name: input.name,
        conditions: input.conditions,
        actions: encodeActions({
          assign: input.assign,
          triggerFlowId: input.triggerFlowId,
          description: input.description,
          cursor: null,
        }),
        stopOnMatch: input.stopOnMatch,
        isActive: input.isActive,
        isFallback: input.isFallback,
        sort: await this.repo.nextSort(tx, orgId),
      });
      if (input.isFallback) await this.repo.clearOtherFallbacks(tx, orgId, created.id);
      await this.audit.record(tx, { module: MODULE_KEY, recordId: created.id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: created.id,
        eventType: 'routing_rule.created',
        payload: { ruleId: created.uuid, name: input.name, isActive: input.isActive },
      });
      return this.reread(tx, orgId, created.uuid);
    });
  }

  async update(uuid: string, input: UpdateRoutingRuleInput): Promise<RoutingRule> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.repo.byUuid(tx, orgId, uuid, true);
      if (!row) throw AppError.notFound('Routing rule');
      if (Number(row.row_version) !== input.rowVersion)
        throw AppError.rowVersionConflict('Routing rule');

      const before = toRoutingRule(row, 0);
      const stored = decodeActions(row.actions);
      // The form sends the whole assign action; the cursor is the server's and survives an edit of the same agents.
      const assign = input.assign ?? stored.assign;
      if (input.assign) await this.assertTargets(tx, orgId, input.assign);
      // `null` takes the flow off the rule; absent keeps it.
      const triggerFlowId =
        input.triggerFlowId === undefined ? stored.triggerFlowId : input.triggerFlowId;
      if (input.triggerFlowId && input.triggerFlowId !== stored.triggerFlowId)
        await this.assertFlow(tx, orgId, input.triggerFlowId);
      const nextConditions = input.conditions ?? before.conditions;
      const isFallback = input.isFallback ?? before.isFallback;
      // The fallback is the catch-all: a normal rule without any condition would catch everything, so it is refused here too.
      if (!isFallback && !hasRoutingConditions(nextConditions)) {
        throw AppError.validation(
          'Add at least one condition, or mark this rule as the fallback.',
          [
            {
              path: 'conditions',
              message: 'Add at least one condition, or mark this rule as the fallback.',
            },
          ],
        );
      }
      const ok = await this.repo.update(tx, orgId, Number(row.id), input.rowVersion, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.conditions !== undefined ? { conditions: input.conditions } : {}),
        ...(input.assign !== undefined ||
        input.description !== undefined ||
        input.triggerFlowId !== undefined
          ? {
              actions: encodeActions({
                assign,
                triggerFlowId,
                description: input.description ?? stored.description,
                cursor:
                  input.assign && !sameTargets(input.assign, stored.assign) ? null : stored.cursor,
              }),
            }
          : {}),
        ...(input.stopOnMatch !== undefined ? { stopOnMatch: input.stopOnMatch } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.isFallback !== undefined ? { isFallback: input.isFallback } : {}),
      });
      if (!ok) throw AppError.rowVersionConflict('Routing rule');
      if (input.isFallback) await this.repo.clearOtherFallbacks(tx, orgId, Number(row.id));

      const after = await this.reread(tx, orgId, uuid);
      const delta = this.audit.diff(
        {
          name: before.name,
          description: before.description,
          isActive: before.isActive,
          isFallback: before.isFallback,
          stopOnMatch: before.stopOnMatch,
          conditions: before.conditions,
          assign: before.assign,
          triggerFlowId: stored.triggerFlowId,
        },
        {
          name: after.name,
          description: after.description,
          isActive: after.isActive,
          isFallback: after.isFallback,
          stopOnMatch: after.stopOnMatch,
          conditions: after.conditions,
          assign: after.assign,
          triggerFlowId: after.triggerFlow?.id ?? null,
        },
      );
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: Number(row.id),
        action: 'update',
        delta,
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: Number(row.id),
        eventType: 'routing_rule.updated',
        payload: { ruleId: uuid, name: after.name, isActive: after.isActive },
      });
      return after;
    });
  }

  async remove(uuid: string): Promise<void> {
    const { orgId } = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const row = await this.repo.byUuid(tx, orgId, uuid, true);
      if (!row) throw AppError.notFound('Routing rule');
      await this.repo.remove(tx, orgId, Number(row.id));
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: Number(row.id),
        action: 'delete',
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: Number(row.id),
        eventType: 'routing_rule.deleted',
        payload: { ruleId: uuid, name: row.name as string },
      });
    });
  }

  /** A copy that goes last, switched off, not the fallback, with its counters at zero. Counts against the plan limit. */
  async duplicate(uuid: string): Promise<RoutingRule> {
    const { orgId } = RequestContextStore.require();
    await this.usage.assertCanAdd(orgId, 'routing_rules');
    return this.db.tx(async (tx) => {
      const row = await this.repo.byUuid(tx, orgId, uuid);
      if (!row) throw AppError.notFound('Routing rule');
      const src = toRoutingRule(row, 0);
      const created = await this.repo.insert(tx, orgId, {
        name: `${src.name} (copy)`.slice(0, 128),
        conditions: src.conditions,
        actions: encodeActions({
          assign: src.assign,
          triggerFlowId: src.triggerFlow?.id ?? null,
          description: src.description,
          cursor: null,
        }),
        stopOnMatch: src.stopOnMatch,
        isActive: false,
        isFallback: false,
        sort: await this.repo.nextSort(tx, orgId),
      });
      await this.audit.record(tx, { module: MODULE_KEY, recordId: created.id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: created.id,
        eventType: 'routing_rule.created',
        payload: {
          ruleId: created.uuid,
          name: `${src.name} (copy)`,
          isActive: false,
          copiedFrom: uuid,
        },
      });
      return this.reread(tx, orgId, created.uuid);
    });
  }

  /** The listed rules take the priority slots they hold now, in the order given (see `reorderRoutingRulesSchema`). */
  async reorder(input: ReorderRoutingRulesInput): Promise<{ ok: true }> {
    const { orgId } = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const slots = await this.repo.lockSlots(tx, orgId, input.ids);
      if (slots.length !== input.ids.length) throw AppError.notFound('Routing rule');
      const byUuid = new Map(slots.map((s) => [s.uuid, s]));
      // The slots are the sort values the listed rules hold, ascending; equal values are spread so the order sticks.
      const values = slots.map((s) => s.sort);
      for (let i = 1; i < values.length; i += 1)
        if (values[i]! <= values[i - 1]!) values[i] = values[i - 1]! + 1;
      for (const [i, id] of input.ids.entries())
        await this.repo.setSort(tx, orgId, byUuid.get(id)!.id, values[i]!);
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: slots[0]!.id,
        action: 'update',
        delta: { order: { old: slots.map((s) => s.uuid), new: input.ids } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: slots[0]!.id,
        eventType: 'routing_rule.reordered',
        payload: { ruleIds: input.ids },
      });
    });
    return { ok: true };
  }

  // --- settings --------------------------------------------------------------------------------------------------------------------

  async settings(): Promise<RoutingSettings> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => ({
      keepContactAgent: await this.repo.keepContactAgent(tx, orgId),
    }));
  }

  async updateSettings(input: UpdateRoutingSettingsInput): Promise<RoutingSettings> {
    const { orgId } = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const old = await this.repo.keepContactAgent(tx, orgId);
      await this.repo.setKeepContactAgent(tx, orgId, input.keepContactAgent);
      if (old !== input.keepContactAgent) {
        await this.audit.record(tx, {
          module: SETTINGS_MODULE,
          recordId: orgId,
          action: 'update',
          delta: { keepContactAgent: { old, new: input.keepContactAgent } },
        });
        await this.outbox.emit(tx, {
          aggregateModule: SETTINGS_MODULE,
          aggregateId: orgId,
          eventType: 'routing_settings.updated',
          payload: { keepContactAgent: input.keepContactAgent },
        });
      }
      return { keepContactAgent: input.keepContactAgent };
    });
  }

  // --- pieces ----------------------------------------------------------------------------------------------------------------------

  private async reread(tx: Tx, orgId: number, uuid: string): Promise<RoutingRule> {
    const row = await this.repo.byUuid(tx, orgId, uuid);
    return (await this.present(tx, orgId, [row!]))[0]!;
  }

  /** Rows as the API returns them, with how many of each rule's targets can no longer take a conversation (one lookup for the page). */
  private async present(tx: Tx, orgId: number, rows: RuleRow[]): Promise<RoutingRule[]> {
    const decoded = rows.map((r) => decodeActions(r.actions));
    const actions = decoded.map((d) => d.assign);
    const flows = await this.repo.flowsByUuid(tx, orgId, [
      ...new Set(decoded.flatMap((d) => (d.triggerFlowId ? [d.triggerFlowId] : []))),
    ]);
    const users = await this.repo.activeUsers(tx, orgId, [
      ...new Set(actions.flatMap((a) => a.userIds)),
    ]);
    const teams = await this.repo.teams(tx, orgId, [...new Set(actions.flatMap((a) => a.teamIds))]);
    return rows.map((r, i) => {
      const a = actions[i]!;
      const gone =
        a.userIds.filter((u) => !users.has(u)).length +
        a.teamIds.filter((t) => !teams.has(t)).length;
      return toRoutingRule(r, gone, flows);
    });
  }

  /** The flow a rule starts must be one of this workspace's (the friendly 422); whether it is switched on is read when the rule fires. */
  private async assertFlow(tx: Tx, orgId: number, flowId: string | null): Promise<void> {
    if (!flowId) return;
    if (!(await this.repo.flowsByUuid(tx, orgId, [flowId])).has(flowId)) {
      throw AppError.validation('That flow is not part of this workspace.', [
        { path: 'triggerFlowId', message: 'That flow is not part of this workspace.' },
      ]);
    }
  }

  /** Agents must be active members who may open the inbox; teams must belong to the workspace (the friendly 422 of TW-TIB2-005). */
  private async assertTargets(tx: Tx, orgId: number, assign: RoutingAssign): Promise<void> {
    const users = await this.repo.activeUsers(tx, orgId, assign.userIds);
    const missing = assign.userIds.find((u) => !users.has(u));
    if (missing) {
      throw AppError.validation('That member is not part of this workspace.', [
        { path: 'assign.userIds', message: 'That member is not part of this workspace.' },
      ]);
    }
    if (users.size > 0) {
      const viewers = await this.directory.viewers(orgId, PERM_CONVERSATION_READ);
      const canOpen = new Set(viewers.filter((v) => v.scope !== null).map((v) => v.userId));
      if ([...users.values()].some((id) => !canOpen.has(id))) {
        throw AppError.validation(
          'That member cannot open the inbox, so they cannot be given a conversation.',
          [{ path: 'assign.userIds', message: 'That member cannot open the inbox.' }],
        );
      }
    }
    const teams = await this.repo.teams(tx, orgId, assign.teamIds);
    if (assign.teamIds.some((t) => !teams.has(t))) {
      throw AppError.validation('That team is not part of this workspace.', [
        { path: 'assign.teamIds', message: 'That team is not part of this workspace.' },
      ]);
    }
  }
}

/** The same people and teams in any order: the rotation keeps its place through an edit that did not change who is in it. */
const sameTargets = (a: RoutingAssign, b: RoutingAssign) =>
  a.strategy === b.strategy &&
  [...a.userIds].sort().join() === [...b.userIds].sort().join() &&
  [...a.teamIds].sort().join() === [...b.teamIds].sort().join();
