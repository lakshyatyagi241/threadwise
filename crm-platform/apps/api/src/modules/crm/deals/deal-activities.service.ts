import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  type CreateDealActivityInput,
  type DealActivityResponse,
  type DealTaskResponse,
  type ListDealActivitiesQuery,
  type ListDealTasksQuery,
  type PageResponse,
  type RecordScope,
} from '@crm/contracts';
import { RequestContextStore } from '../../../common/context/request-context';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { AppError } from '../../../common/errors/app-error';
import { buildPage } from '../../../common/pagination/cursor';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import {
  DealActivitiesRepository,
  encodeTaskCursor,
  type ActivityRow,
} from './deal-activities.repository';
import { DEAL_MODULE } from './deal-engine.service';
import { DealsRepository, dealScopeCondition } from './deals.repository';
import { DealsService } from './deals.service';

/**
 * The deal timeline and its tasks (WD-DEAL-015, 016). A body is encrypted at rest (as in WaDesk) and decrypted here; nothing
 * else in the service sees ciphertext. Adding or completing something needs `record.deals.update` on the deal, reading the
 * timeline needs `record.deals.read`, and both are subject to the caller's record scope on the deal's owner.
 */
@Injectable()
export class DealActivitiesService {
  private readonly logger = new Logger(DealActivitiesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: DealActivitiesRepository,
    private readonly dealsRepo: DealsRepository,
    private readonly deals: DealsService,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async list(
    dealUuid: string,
    query: ListDealActivitiesQuery,
    scope: RecordScope,
  ): Promise<PageResponse<DealActivityResponse>> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const deal = await this.dealsRepo.findByUuid(tx, ctx.orgId, dealUuid);
      if (!deal) throw AppError.notFound('Deal', dealUuid);
      await this.deals.assertScope(tx, scope, deal.ownerId);
      const rows = await this.repo.listForDeal(tx, ctx.orgId, deal.id, query);
      const { items, page } = buildPage(rows, query.limit);
      return { data: items.map((r) => this.toResponse(r)), page };
    });
  }

  async add(
    dealUuid: string,
    input: CreateDealActivityInput,
    scope: RecordScope,
  ): Promise<DealActivityResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const deal = await this.deals.lockForWrite(tx, dealUuid, scope);

      let assigneeId: number | null = null;
      if (input.type === 'task') {
        if (input.assigneeId) {
          const user = await this.dealsRepo.resolveActiveUser(tx, ctx.orgId, input.assigneeId);
          if (!user) {
            throw new AppError(
              ERROR_CODES.DEAL_OWNER_INVALID,
              'The assignee must be an active member of this workspace.',
              HttpStatus.UNPROCESSABLE_ENTITY,
              [{ path: 'assigneeId', message: input.assigneeId }],
            );
          }
          assigneeId = user.id;
        } else if (input.assigneeId === undefined) {
          assigneeId = ctx.userId;
        }
      }

      const id = await this.repo.insert(tx, ctx.orgId, {
        dealId: deal.id,
        userId: ctx.userId,
        type: input.type,
        bodyCipher: this.crypto.encrypt(input.body),
        dueAt: input.type === 'task' && input.dueAt ? new Date(input.dueAt) : null,
        assigneeUserId: assigneeId,
      });
      const row = (await this.repo.findById(tx, ctx.orgId, id))!;
      await this.audit.record(tx, {
        module: DEAL_MODULE,
        recordId: deal.id,
        action: 'update',
        delta: { activity: { old: null, new: input.type } },
      });
      await this.outbox.emit(tx, {
        aggregateModule: DEAL_MODULE,
        aggregateId: deal.id,
        eventType: 'deal.activity_added',
        payload: {
          uuid: deal.uuid,
          activityId: row.uuid,
          type: input.type,
          dueAt: row.dueAt ? row.dueAt.toISOString() : null,
          assigneeId: row.assigneeUuid,
        },
      });
      return this.toResponse(row);
    });
  }

  /** Marks a task done. Completing a done task is a no-op. A task of another type or another deal is 404. */
  async complete(
    dealUuid: string,
    activityUuid: string,
    scope: RecordScope,
  ): Promise<DealActivityResponse> {
    return this.setDone(dealUuid, activityUuid, true, scope);
  }

  /** Reopens a task and clears its reminder stamp, so an overdue reopened task is reminded again (D-20). */
  async reopen(
    dealUuid: string,
    activityUuid: string,
    scope: RecordScope,
  ): Promise<DealActivityResponse> {
    return this.setDone(dealUuid, activityUuid, false, scope);
  }

  /** Tasks across the deals the caller may see ("my tasks"). */
  async tasks(
    query: ListDealTasksQuery,
    scope: RecordScope,
  ): Promise<PageResponse<DealTaskResponse>> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      let assigneeId: number | undefined;
      if (query.mine) {
        assigneeId = ctx.userId ?? undefined;
      } else if (query.assigneeId) {
        assigneeId = await this.dealsRepo.resolveUserId(tx, ctx.orgId, query.assigneeId);
        if (assigneeId === undefined)
          return { data: [], page: { nextCursor: null, hasMore: false, limit: query.limit } };
      }
      let dealId: number | undefined;
      if (query.dealId) {
        dealId = (await this.dealsRepo.findByUuid(tx, ctx.orgId, query.dealId))?.id;
        if (dealId === undefined)
          return { data: [], page: { nextCursor: null, hasMore: false, limit: query.limit } };
      }
      const rows = await this.repo.listTasks(tx, ctx.orgId, {
        scope: dealScopeCondition(ctx.orgId, scope, ctx.userId),
        dealId,
        assigneeId,
        status: query.status,
        overdue: query.overdue,
        cursor: query.cursor,
        limit: query.limit,
      });
      const hasMore = rows.length > query.limit;
      const items = hasMore ? rows.slice(0, query.limit) : rows;
      const last = items[items.length - 1];
      return {
        data: items.map((r) => ({
          ...this.toResponse(r),
          deal: { id: r.dealUuid, title: r.dealTitle },
        })),
        page: {
          nextCursor: hasMore && last ? encodeTaskCursor(last) : null,
          hasMore,
          limit: query.limit,
        },
      };
    });
  }

  private async setDone(
    dealUuid: string,
    activityUuid: string,
    done: boolean,
    scope: RecordScope,
  ): Promise<DealActivityResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const deal = await this.deals.lockForWrite(tx, dealUuid, scope);
      const before = await this.repo.findForDeal(tx, ctx.orgId, deal.id, activityUuid);
      if (!before || before.type !== 'task') {
        throw new AppError(
          ERROR_CODES.DEAL_TASK_NOT_FOUND,
          'Task not found.',
          HttpStatus.NOT_FOUND,
        );
      }
      const wasDone = before.doneAt !== null;
      if (wasDone !== done) {
        await this.repo.setDone(tx, ctx.orgId, deal.id, activityUuid, done);
        await this.audit.record(tx, {
          module: DEAL_MODULE,
          recordId: deal.id,
          action: 'update',
          delta: { taskDone: { old: wasDone, new: done } },
        });
        await this.outbox.emit(tx, {
          aggregateModule: DEAL_MODULE,
          aggregateId: deal.id,
          eventType: done ? 'deal.task_completed' : 'deal.task_reopened',
          payload: { uuid: deal.uuid, activityId: before.uuid },
        });
      }
      return this.toResponse((await this.repo.findById(tx, ctx.orgId, before.id))!);
    });
  }

  private toResponse(r: ActivityRow): DealActivityResponse {
    return {
      id: r.uuid,
      dealId: r.dealUuid,
      type: r.type,
      body: this.readBody(r),
      dueAt: r.dueAt ? r.dueAt.toISOString() : null,
      doneAt: r.doneAt ? r.doneAt.toISOString() : null,
      done: r.doneAt !== null,
      assignee: r.assigneeUuid ? { id: r.assigneeUuid, name: r.assigneeName ?? '' } : null,
      author: r.authorUuid ? { id: r.authorUuid, name: r.authorName ?? '' } : null,
      stageChange:
        r.type === 'stage_change' && r.meta
          ? {
              from: r.meta.from ? { id: r.meta.from.id, name: r.meta.from.name } : null,
              to: { id: r.meta.to.id, name: r.meta.to.name },
            }
          : null,
      rowVersion: r.rowVersion,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private readBody(r: ActivityRow): string | null {
    if (r.bodyCipher === null) return null;
    try {
      return this.crypto.decrypt(r.bodyCipher);
    } catch (err) {
      // A body written under a key this process no longer has must not take the whole timeline down.
      this.logger.warn({ err, activityId: r.uuid }, 'could not decrypt a deal activity body');
      return null;
    }
  }
}
