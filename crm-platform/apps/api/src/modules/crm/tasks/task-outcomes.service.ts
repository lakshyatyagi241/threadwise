import { HttpStatus, Injectable } from '@nestjs/common';
import {
  ERROR_CODES,
  type CreateTaskOutcomeInput,
  type ReorderTaskOutcomesInput,
  type TaskOutcomeResponse,
  type UpdateTaskOutcomeInput,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { pgError } from '../pipelines/pipelines.service';
import { TaskOutcomesRepository, type TaskOutcomeRow } from './task-outcomes.repository';

const MODULE_KEY = 'task_outcomes';

export function toTaskOutcomeResponse(row: TaskOutcomeRow): TaskOutcomeResponse {
  return {
    id: row.uuid,
    name: row.name,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    taskCount: row.taskCount,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const nameTaken = (name: string) =>
  new AppError(
    ERROR_CODES.TASK_OUTCOME_NAME_TAKEN,
    `A task outcome named "${name}" already exists.`,
    HttpStatus.CONFLICT,
  );

/**
 * The workspace's task outcomes (Interested, Left message, ...): the list a person picks from when completing or logging a task.
 * Waboo's rules carry over: a name is unique (ignoring case), an outcome can be hidden without losing the tasks that carry it, and
 * an outcome that a task uses cannot be deleted. Not plan-gated: the list is a workspace setting and a migrated workspace has one
 * whatever its plan.
 */
@Injectable()
export class TaskOutcomesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TaskOutcomesRepository,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  /** `activeOnly` is what a picker wants; the settings screen lists everything. */
  async list(activeOnly: boolean): Promise<TaskOutcomeResponse[]> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) =>
      (await this.repo.list(tx, ctx.orgId, activeOnly)).map(toTaskOutcomeResponse),
    );
  }

  async create(input: CreateTaskOutcomeInput): Promise<TaskOutcomeResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      if (await this.repo.byName(tx, ctx.orgId, input.name)) throw nameTaken(input.name);
      let created: { id: number; uuid: string };
      try {
        // A savepoint: a unique violation from a racing request must not poison the outer transaction.
        created = await tx.transaction(async (sp) =>
          this.repo.insert(sp, ctx.orgId, {
            name: input.name,
            isActive: input.isActive ?? true,
            sortOrder: (await this.repo.maxOrder(sp, ctx.orgId)) + 1,
          }),
        );
      } catch (err) {
        if (pgError(err).code === '23505') throw nameTaken(input.name);
        throw err;
      }
      await this.audit.record(tx, { module: MODULE_KEY, recordId: created.id, action: 'insert' });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: created.id,
        eventType: 'task_outcome.created',
        payload: { uuid: created.uuid, name: input.name },
      });
      return toTaskOutcomeResponse((await this.repo.byUuid(tx, ctx.orgId, created.uuid))!);
    });
  }

  async update(uuid: string, input: UpdateTaskOutcomeInput): Promise<TaskOutcomeResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const existing = await this.repo.byUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('Task outcome', uuid);
      if (input.name !== undefined) {
        const clash = await this.repo.byName(tx, ctx.orgId, input.name);
        if (clash && clash.id !== existing.id) throw nameTaken(input.name);
      }
      let updated: boolean;
      try {
        updated = await tx.transaction((sp) =>
          this.repo.update(sp, ctx.orgId, existing.id, input.rowVersion, {
            name: input.name,
            isActive: input.isActive,
          }),
        );
      } catch (err) {
        if (pgError(err).code === '23505') throw nameTaken(input.name ?? existing.name);
        throw err;
      }
      if (!updated) throw AppError.rowVersionConflict('Task outcome');
      const after = (await this.repo.byUuid(tx, ctx.orgId, uuid))!;
      const delta = this.audit.diff(
        { name: existing.name, isActive: existing.isActive },
        { name: after.name, isActive: after.isActive },
      );
      if (Object.keys(delta).length > 0) {
        await this.audit.record(tx, {
          module: MODULE_KEY,
          recordId: existing.id,
          action: 'update',
          delta,
        });
        await this.outbox.emit(tx, {
          aggregateModule: MODULE_KEY,
          aggregateId: existing.id,
          eventType: 'task_outcome.updated',
          payload: { uuid, name: after.name, isActive: after.isActive },
        });
      }
      return toTaskOutcomeResponse(after);
    });
  }

  async reorder(input: ReorderTaskOutcomesInput): Promise<TaskOutcomeResponse[]> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const all = await this.repo.list(tx, ctx.orgId, false);
      const byUuid = new Map(all.map((o) => [o.uuid, o.id]));
      const unique = new Set(input.outcomeIds);
      if (
        unique.size !== input.outcomeIds.length ||
        input.outcomeIds.length !== all.length ||
        input.outcomeIds.some((u) => !byUuid.has(u))
      ) {
        throw new AppError(
          ERROR_CODES.TASK_OUTCOME_ORDER_INVALID,
          'Send every id exactly once, in the order you want.',
          HttpStatus.UNPROCESSABLE_ENTITY,
          [{ path: 'outcomeIds', message: 'must list every existing item exactly once' }],
        );
      }
      await this.repo.setOrder(
        tx,
        ctx.orgId,
        input.outcomeIds.map((u) => byUuid.get(u)!),
      );
      return (await this.repo.list(tx, ctx.orgId, false)).map(toTaskOutcomeResponse);
    });
  }

  async remove(uuid: string): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const existing = await this.repo.byUuid(tx, ctx.orgId, uuid);
      if (!existing) throw AppError.notFound('Task outcome', uuid);
      // Waboo refused to delete an outcome a task uses. The foreign key is NO ACTION, so the database refuses too.
      if (existing.taskCount > 0) {
        throw new AppError(
          ERROR_CODES.TASK_OUTCOME_IN_USE,
          `"${existing.name}" is used by ${existing.taskCount} task(s) and cannot be deleted. Hide it instead.`,
          HttpStatus.CONFLICT,
          [{ path: 'taskCount', message: String(existing.taskCount) }],
        );
      }
      await this.audit.record(tx, {
        module: MODULE_KEY,
        recordId: existing.id,
        action: 'delete',
        delta: { name: { old: existing.name, new: null } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: MODULE_KEY,
        aggregateId: existing.id,
        eventType: 'task_outcome.deleted',
        payload: { uuid, name: existing.name },
      });
      await this.repo.delete(tx, ctx.orgId, existing.id);
    });
  }
}
