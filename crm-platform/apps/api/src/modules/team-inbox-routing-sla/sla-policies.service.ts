import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type CreateInboxSlaPolicyInput,
  type InboxSlaPolicy,
  type InboxSlaPolicyList,
  type UpdateInboxSlaPolicyInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../common/context/request-context';
import { AppError } from '../../common/errors/app-error';
import { DatabaseService } from '../../infra/db/database.service';
import { AuditService } from '../../kernel/audit/audit.service';
import { OutboxService } from '../../kernel/outbox/outbox.service';
import {
  SlaPoliciesRepository,
  type PolicyValues,
  type SlaPolicyRow,
} from './sla-policies.repository';

const MODULE_KEY = 'sla_policies';

const notFound = () =>
  new AppError(ERROR_CODES.SLA_POLICY_NOT_FOUND, 'SLA policy not found', HttpStatus.NOT_FOUND);

export const toPolicy = (r: SlaPolicyRow): InboxSlaPolicy => ({
  id: r.uuid,
  name: r.name,
  firstResponseMinutes: r.firstResponseMinutes,
  resolutionMinutes: r.resolutionMinutes,
  pauseWhenWaitingOnCustomer: r.pauseWhenWaitingOnCustomer,
  respectBusinessHours: r.respectBusinessHours,
  priorityOverrides: r.priorityOverrides,
  isDefault: r.isDefault,
  conversationCount: r.conversationCount,
  rowVersion: r.rowVersion,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

/**
 * SLA policies (TW-TIB2-024, 025): list, create, edit and delete the workspace's response targets. The plan feature `inbox_sla` and the
 * permissions are enforced by the controller. Fixes over Reference: every write is validated (Reference trusted an update's body), an
 * edit carries the version it read, the default flag is exclusive inside one transaction (the workspace's first policy is the default),
 * and every change leaves an audit row and an outbox event. Deleting a policy leaves the conversations that used it with the clocks they
 * already run (their policy link is cleared); a new conversation takes the default.
 */
@Injectable()
export class SlaPoliciesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: SlaPoliciesRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async list(): Promise<InboxSlaPolicyList> {
    const ctx = RequestContextStore.require();
    const rows = await this.db.tx((tx) => this.repo.list(tx, ctx.orgId));
    return { data: rows.map(toPolicy) };
  }

  async create(input: CreateInboxSlaPolicyInput): Promise<InboxSlaPolicy> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const existing = await this.repo.lockAll(tx, ctx.orgId);
      const values: PolicyValues = {
        name: input.name,
        firstResponseMinutes: input.firstResponseMinutes ?? null,
        resolutionMinutes: input.resolutionMinutes ?? null,
        pauseWhenWaitingOnCustomer: input.pauseWhenWaitingOnCustomer,
        respectBusinessHours: input.respectBusinessHours,
        priorityOverrides: input.priorityOverrides,
        // The first policy of a workspace is its default: without one nothing would start a clock.
        isDefault: input.isDefault || existing === 0,
      };
      if (values.isDefault) await this.repo.clearDefault(tx, ctx.orgId);
      const id = await this.repo.insert(tx, ctx.orgId, values);
      const row = (await this.repo.byId(tx, ctx.orgId, id))!;
      await this.audit.record(tx, { module: MODULE_KEY, recordId: id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: id,
        eventType: 'inbox.sla_policy.created',
        payload: { policyId: row.uuid, name: row.name, isDefault: row.isDefault },
      });
      return toPolicy(row);
    });
  }

  async update(uuid: string, input: UpdateInboxSlaPolicyInput): Promise<InboxSlaPolicy> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      await this.repo.lockAll(tx, ctx.orgId);
      const before = await this.repo.byUuid(tx, ctx.orgId, uuid);
      if (!before) throw notFound();
      const values: PolicyValues = {
        name: input.name ?? before.name,
        firstResponseMinutes:
          input.firstResponseMinutes === undefined
            ? before.firstResponseMinutes
            : input.firstResponseMinutes,
        resolutionMinutes:
          input.resolutionMinutes === undefined
            ? before.resolutionMinutes
            : input.resolutionMinutes,
        pauseWhenWaitingOnCustomer:
          input.pauseWhenWaitingOnCustomer ?? before.pauseWhenWaitingOnCustomer,
        respectBusinessHours: input.respectBusinessHours ?? before.respectBusinessHours,
        priorityOverrides: input.priorityOverrides ?? before.priorityOverrides,
        isDefault: input.isDefault ?? before.isDefault,
      };
      if (!(await this.repo.update(tx, ctx.orgId, before.id, input.rowVersion, values))) {
        throw AppError.rowVersionConflict('SLA policy');
      }
      if (values.isDefault) await this.repo.clearDefault(tx, ctx.orgId, before.id);
      const row = (await this.repo.byId(tx, ctx.orgId, before.id))!;
      const delta: Record<string, { old: unknown; new: unknown }> = {};
      for (const k of [
        'name',
        'firstResponseMinutes',
        'resolutionMinutes',
        'pauseWhenWaitingOnCustomer',
        'respectBusinessHours',
        'isDefault',
      ] as const) {
        if (before[k] !== row[k]) delta[k] = { old: before[k], new: row[k] };
      }
      if (JSON.stringify(before.priorityOverrides) !== JSON.stringify(row.priorityOverrides)) {
        delta.priorityOverrides = { old: before.priorityOverrides, new: row.priorityOverrides };
      }
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: before.id,
        action: 'update',
        delta,
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: before.id,
        eventType: 'inbox.sla_policy.updated',
        payload: { policyId: row.uuid, name: row.name, isDefault: row.isDefault },
      });
      return toPolicy(row);
    });
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      await this.repo.lockAll(tx, ctx.orgId);
      const before = await this.repo.byUuid(tx, ctx.orgId, uuid);
      if (!before) throw notFound();
      await this.repo.delete(tx, ctx.orgId, before.id);
      await this.audit.record(tx, { module: MODULE_KEY, recordId: before.id, action: 'delete' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: before.id,
        eventType: 'inbox.sla_policy.deleted',
        payload: { policyId: before.uuid, name: before.name },
      });
    });
  }
}
