import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ERROR_CODES,
  type BulkAssignTasksInput,
  type BulkTaskIdsInput,
  type CreateTaskInput,
  type ListLinkedTasksQuery,
  type ListTasksQuery,
  type PageResponse,
  type RecordScope,
  type TaskCountsQuery,
  type TaskCountsResponse,
  type TaskLinksInput,
  type TaskBulkResult,
  type TaskResponse,
  type TaskSource,
  type TaskTransitionInput,
  type UpdateTaskInput,
} from '@crm/contracts';
import type { Tx } from '@crm/db';
import { RequestContextStore } from '../../../common/context/request-context';
import { CryptoService } from '../../../common/crypto/crypto.service';
import { AppError } from '../../../common/errors/app-error';
import { DatabaseService } from '../../../infra/db/database.service';
import { AuditService } from '../../../kernel/audit/audit.service';
import { OutboxService } from '../../../kernel/outbox/outbox.service';
import { RbacService } from '../../../kernel/rbac/rbac.service';
import { assertContactScope, ContactsRepository } from '../contacts';
// Not the deals barrel: it re-exports the activities service, which imports this one (a cycle that leaves a constructor
// parameter undefined at runtime).
import { DealsRepository, type DealRow } from '../deals/deals.repository';
import { DealsService } from '../deals/deals.service';
import { resolveTimezone } from '../deals/deal-calendar';
import { defaultSort, encodeTaskCursor, titleFromBody } from './task-rules';
import { taskEventPayload, toTaskResponse } from './tasks.mapper';
import {
  sortKeyOf,
  TasksRepository,
  taskScopeCondition,
  type TaskFilter,
  type TaskPatch,
  type TaskRow,
} from './tasks.repository';

export const TASK_MODULE = 'tasks';

const emptyPage = (limit: number): PageResponse<TaskResponse> => ({
  data: [],
  page: { nextCursor: null, hasMore: false, limit },
});

/** The filter fields a list and the counts share, as they arrive from a query. */
interface FilterInput {
  q?: string;
  priority?: Array<'low' | 'medium' | 'high'>;
  mine?: boolean;
  assigneeId?: string;
  unassigned?: boolean;
  contactId?: string;
  dealId?: string;
  companyId?: string;
}

/**
 * Tasks (WD-TASK-001..014). One transaction per operation: the row lock, the write, the audit row and the outbox events commit
 * together or not at all.
 *
 * What differs from WaDesk (all in the inventory's "Port decisions"): an assignee must be an active member (422, not a silent
 * replacement); a link to a contact, deal or company that is not in the workspace is 404; complete and reopen are explicit and
 * idempotent; a changed due date or a reopen arms the reminder again; the record scope applies to every read and write; and a
 * task added on a deal's timeline is mirrored here so it shows up in the one task list.
 */
@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly repo: TasksRepository,
    private readonly crypto: CryptoService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly rbac: RbacService,
    private readonly contacts: ContactsRepository,
    private readonly dealsRepo: DealsRepository,
    private readonly deals: DealsService,
  ) {}

  // --- reads -----------------------------------------------------------------------------------------------------------

  async list(query: ListTasksQuery, scope: RecordScope): Promise<PageResponse<TaskResponse>> {
    return this.db.tx((tx) => this.listIn(tx, query, scope, {}));
  }

  /** `mine`: open tasks assigned to the caller (the "My tasks" scope), soonest due first. */
  async myTasks(query: ListTasksQuery, scope: RecordScope): Promise<PageResponse<TaskResponse>> {
    return this.list({ ...query, mine: true }, scope);
  }

  /** A contact's tasks (WD-TASK-008): needs record.contacts.read on the contact, whose own scope applies. */
  async forContact(
    contactUuid: string,
    query: ListLinkedTasksQuery,
    scope: RecordScope,
  ): Promise<PageResponse<TaskResponse>> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const contact = await this.contacts.resolveContactRef(tx, ctx.orgId, contactUuid);
      if (!contact) throw AppError.notFound('Contact', contactUuid);
      const read = this.rbac.can(ctx.grants!, 'record.contacts.read');
      if (!read.allowed) throw AppError.forbidden('record.contacts.read');
      await assertContactScope(
        tx,
        this.contacts,
        ctx.orgId,
        read.scope,
        ctx.userId!,
        contact.ownerId,
      );
      return this.listIn(tx, query, scope, { contactId: contact.id });
    });
  }

  /** A deal's tasks: needs record.deals.read on the deal, whose own scope applies. */
  async forDeal(
    dealUuid: string,
    query: ListLinkedTasksQuery,
    scope: RecordScope,
  ): Promise<PageResponse<TaskResponse>> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const deal = await this.dealsRepo.findByUuid(tx, ctx.orgId, dealUuid);
      if (!deal) throw AppError.notFound('Deal', dealUuid);
      const read = this.rbac.can(ctx.grants!, 'record.deals.read');
      if (!read.allowed) throw AppError.forbidden('record.deals.read');
      await this.deals.assertScope(tx, read.scope, deal.ownerId);
      return this.listIn(tx, query, scope, { dealId: deal.id });
    });
  }

  async counts(query: TaskCountsQuery, scope: RecordScope): Promise<TaskCountsResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const tz = await this.zone(tx, ctx.orgId);
      const scopeSql = taskScopeCondition(ctx.orgId, scope, ctx.userId);
      const zero = { overdue: 0, today: 0, upcoming: 0, noDate: 0, done: 0 };
      const filter = await this.resolveFilter(tx, ctx.orgId, query, {});
      const c = filter ? await this.repo.counts(tx, ctx.orgId, filter, scopeSql, tz) : zero;
      const mine = ctx.userId
        ? await this.repo.counts(tx, ctx.orgId, { assigneeId: ctx.userId }, scopeSql, tz)
        : zero;
      return {
        overdue: c.overdue,
        today: c.today,
        upcoming: c.upcoming,
        noDate: c.noDate,
        open: c.overdue + c.today + c.upcoming + c.noDate,
        done: c.done,
        mine: {
          open: mine.overdue + mine.today + mine.upcoming + mine.noDate,
          overdue: mine.overdue,
        },
      };
    });
  }

  async get(uuid: string, scope: RecordScope): Promise<TaskResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const tz = await this.zone(tx, ctx.orgId);
      const row = await this.repo.findByUuid(tx, ctx.orgId, uuid, tz);
      if (!row) throw AppError.notFound('Task', uuid);
      await this.assertScope(tx, scope, row);
      return this.toResponse(row);
    });
  }

  // --- writes ----------------------------------------------------------------------------------------------------------

  async create(input: CreateTaskInput, source: TaskSource = 'manual'): Promise<TaskResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const assigneeId = await this.resolveAssignee(tx, ctx.orgId, input.assigneeId, ctx.userId);
      const links = await this.resolveLinks(tx, ctx.orgId, input, true);
      const id = await this.repo.insert(tx, ctx.orgId, {
        title: input.title,
        notesCipher: input.notes ? this.crypto.encrypt(input.notes) : null,
        priority: input.priority ?? 'medium',
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        assigneeId,
        createdBy: ctx.userId,
        contactId: links.contactId ?? null,
        dealId: links.dealId ?? null,
        companyId: links.companyId ?? null,
        source,
      });
      return this.afterInsert(tx, ctx.orgId, ctx.userId, id);
    });
  }

  async update(uuid: string, input: UpdateTaskInput, scope: RecordScope): Promise<TaskResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.lockForWrite(tx, uuid, scope);
      if (input.rowVersion !== row.rowVersion) throw AppError.rowVersionConflict('Task');

      const patch: TaskPatch = {};
      const delta: Record<string, { old: unknown; new: unknown }> = {};
      if (input.title !== undefined && input.title !== row.title) {
        patch.title = input.title;
        delta.title = { old: row.title, new: input.title };
      }
      if (input.notes !== undefined) {
        const next = input.notes ? input.notes : null;
        patch.notes = next ? this.crypto.encrypt(next) : null;
        // The audit trail is plain JSON: it records that the notes changed, never what they say.
        delta.notes = { old: row.notesCipher !== null, new: next !== null };
      }
      if (input.priority !== undefined && input.priority !== row.priority) {
        patch.priority = input.priority;
        delta.priority = { old: row.priority, new: input.priority };
      }
      let dueChanged = false;
      if (input.dueAt !== undefined) {
        const next = input.dueAt ? new Date(input.dueAt) : null;
        dueChanged = (next?.getTime() ?? null) !== (row.dueAt?.getTime() ?? null);
        if (dueChanged) {
          patch.due_at = next;
          // A new due date arms the reminder again (WaDesk never re-reminded a re-dated task).
          patch.clearReminder = true;
          delta.dueAt = { old: row.dueAt?.toISOString() ?? null, new: next?.toISOString() ?? null };
        }
      }
      let assigneeChanged = false;
      let newAssignee: number | null = row.assigneeId;
      if (input.assigneeId !== undefined) {
        newAssignee = await this.resolveAssignee(tx, ctx.orgId, input.assigneeId, ctx.userId);
        assigneeChanged = newAssignee !== row.assigneeId;
        if (assigneeChanged) patch.assignee_id = newAssignee;
      }
      const links = await this.resolveLinks(tx, ctx.orgId, input, false);
      this.applyLinks(patch, row, links);

      if (Object.keys(patch).length > 0) {
        const ok = await this.repo.update(tx, ctx.orgId, row.id, input.rowVersion, patch);
        if (!ok) throw AppError.rowVersionConflict('Task');
        await this.afterEdit(tx, ctx.orgId, ctx.userId, row, delta, {
          dueChanged,
          assigneeChanged,
          newAssignee,
        });
      }
      return this.toResponse(
        (await this.repo.findById(tx, ctx.orgId, row.id, await this.zone(tx, ctx.orgId)))!,
      );
    });
  }

  /** Link or unlink a contact, a deal and a company without a version (WD-TASK-008); `null` unlinks. */
  async setLinks(uuid: string, input: TaskLinksInput, scope: RecordScope): Promise<TaskResponse> {
    const ctx = RequestContextStore.require();
    return this.db.tx(async (tx) => {
      const row = await this.lockForWrite(tx, uuid, scope);
      const links = await this.resolveLinks(tx, ctx.orgId, input, false);
      const patch: TaskPatch = {};
      this.applyLinks(patch, row, links);
      if (Object.keys(patch).length > 0) {
        await this.repo.update(tx, ctx.orgId, row.id, undefined, patch);
        await this.afterEdit(
          tx,
          ctx.orgId,
          ctx.userId,
          row,
          {},
          {
            dueChanged: false,
            assigneeChanged: false,
            newAssignee: row.assigneeId,
          },
        );
      }
      return this.toResponse(
        (await this.repo.findById(tx, ctx.orgId, row.id, await this.zone(tx, ctx.orgId)))!,
      );
    });
  }

  /** Marks a task done. Completing a done task is a no-op (no event, no audit row). */
  async complete(
    uuid: string,
    input: TaskTransitionInput,
    scope: RecordScope,
  ): Promise<TaskResponse> {
    return this.transitionOne(uuid, true, input, scope);
  }

  /** Reopens a done task and arms its reminder again. */
  async reopen(
    uuid: string,
    input: TaskTransitionInput,
    scope: RecordScope,
  ): Promise<TaskResponse> {
    return this.transitionOne(uuid, false, input, scope);
  }

  async remove(uuid: string, scope: RecordScope): Promise<void> {
    const ctx = RequestContextStore.require();
    await this.db.tx(async (tx) => {
      const row = await this.lockForWrite(tx, uuid, scope);
      await this.deleteRow(tx, ctx.orgId, row);
    });
  }

  // --- bulk ------------------------------------------------------------------------------------------------------------

  bulkComplete(input: BulkTaskIdsInput, scope: RecordScope): Promise<TaskBulkResult> {
    return this.bulk(input.ids, scope, (tx, row) =>
      this.transition(tx, row, true).then(() => undefined),
    );
  }

  bulkReopen(input: BulkTaskIdsInput, scope: RecordScope): Promise<TaskBulkResult> {
    return this.bulk(input.ids, scope, (tx, row) =>
      this.transition(tx, row, false).then(() => undefined),
    );
  }

  bulkDelete(input: BulkTaskIdsInput, scope: RecordScope): Promise<TaskBulkResult> {
    const ctx = RequestContextStore.require();
    return this.bulk(input.ids, scope, (tx, row) => this.deleteRow(tx, ctx.orgId, row));
  }

  bulkAssign(input: BulkAssignTasksInput, scope: RecordScope): Promise<TaskBulkResult> {
    const ctx = RequestContextStore.require();
    // One lookup for the whole call; a bad assignee fails the call (422), not each row.
    let assignee: number | null | undefined;
    return this.bulk(input.ids, scope, async (tx, row) => {
      if (assignee === undefined) {
        assignee = await this.resolveAssignee(tx, ctx.orgId, input.assigneeId, ctx.userId);
      }
      if (assignee === row.assigneeId) return;
      await this.repo.update(tx, ctx.orgId, row.id, undefined, { assignee_id: assignee });
      await this.afterEdit(
        tx,
        ctx.orgId,
        ctx.userId,
        row,
        {},
        {
          dueChanged: false,
          assigneeChanged: true,
          newAssignee: assignee,
        },
      );
    });
  }

  /**
   * One transaction for the call; one bad id (unknown, outside the caller's scope) is listed in `failed` and does not stop the
   * rest. Only deliberate failures (AppError) are caught: a database error aborts the transaction and must surface.
   */
  private async bulk(
    ids: string[],
    scope: RecordScope,
    fn: (tx: Tx, row: TaskRow) => Promise<void>,
  ): Promise<TaskBulkResult> {
    return this.db.tx(async (tx) => {
      const result: TaskBulkResult = { succeeded: [], failed: [] };
      for (const id of [...new Set(ids)]) {
        try {
          const row = await this.lockForWrite(tx, id, scope);
          await fn(tx, row);
          result.succeeded.push(id);
        } catch (err) {
          if (!(err instanceof AppError)) throw err;
          // A bad assignee fails the whole call: it is the request that is wrong, not one row.
          if (err.code === ERROR_CODES.TASK_ASSIGNEE_INVALID) throw err;
          result.failed.push({ id, code: err.code, message: err.message });
        }
      }
      return result;
    });
  }

  // --- the deal timeline's mirror (called by DealActivitiesService inside its transaction) ------------------------------------------

  /**
   * A task added on a deal's timeline also becomes a row here (WD-TASK-014, D-14): linked to the deal and its contact and
   * company, assigned like the timeline row. The timeline row keeps its history and points at the task.
   */
  async mirrorFromDeal(
    tx: Tx,
    deal: DealRow,
    v: { activityId: number; body: string; dueAt: Date | null; assigneeId: number | null },
  ): Promise<void> {
    const ctx = RequestContextStore.require();
    const { title, notes } = titleFromBody(v.body);
    const id = await this.repo.insert(tx, ctx.orgId, {
      title,
      notesCipher: notes ? this.crypto.encrypt(notes) : null,
      priority: 'medium',
      dueAt: v.dueAt,
      assigneeId: v.assigneeId,
      createdBy: ctx.userId,
      contactId: deal.contactId,
      dealId: deal.id,
      companyId: deal.companyId,
      source: 'deal',
    });
    await this.repo.linkActivity(tx, ctx.orgId, v.activityId, id);
    await this.afterInsert(tx, ctx.orgId, ctx.userId, id);
  }

  /** The timeline row was completed or reopened: bring the mirrored task to the same state. */
  async syncFromActivity(tx: Tx, activityId: number, done: boolean): Promise<void> {
    const ctx = RequestContextStore.require();
    const taskId = await this.repo.taskOfActivity(tx, ctx.orgId, activityId);
    if (taskId === undefined) return;
    const row = await this.repo.findById(tx, ctx.orgId, taskId, await this.zone(tx, ctx.orgId));
    if (!row) return;
    // The timeline row is already updated; only the task moves, so nothing is written back.
    await this.transition(tx, row, done, { syncActivity: false });
  }

  // --- internals -------------------------------------------------------------------------------------------------------------

  private async listIn(
    tx: Tx,
    query: ListTasksQuery | ListLinkedTasksQuery,
    scope: RecordScope,
    fixed: { contactId?: number; dealId?: number },
  ): Promise<PageResponse<TaskResponse>> {
    const ctx = RequestContextStore.require();
    const filter = await this.resolveFilter(tx, ctx.orgId, query as FilterInput, fixed);
    if (!filter) return emptyPage(query.limit);
    const tz = await this.zone(tx, ctx.orgId);
    const sort = defaultSort(query.status, query.sort);
    const rows = await this.repo.list(tx, ctx.orgId, {
      filter,
      scope: taskScopeCondition(ctx.orgId, scope, ctx.userId),
      status: query.status,
      due: query.due,
      dueFrom: query.dueFrom,
      dueTo: query.dueTo,
      sort,
      cursor: query.cursor,
      limit: query.limit,
      tz,
    });
    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const last = items[items.length - 1];
    return {
      data: items.map((r) => this.toResponse(r)),
      page: {
        nextCursor: hasMore && last ? encodeTaskCursor(sort, sortKeyOf(sort, last), last.id) : null,
        hasMore,
        limit: query.limit,
      },
    };
  }

  /** uuids of a filter to internal ids. `null` means a uuid in it is not in this workspace: the answer is empty. */
  private async resolveFilter(
    tx: Tx,
    orgId: number,
    f: FilterInput,
    fixed: { contactId?: number; dealId?: number },
  ): Promise<TaskFilter | null> {
    const ctx = RequestContextStore.require();
    const out: TaskFilter = {
      q: f.q,
      priority: f.priority,
      unassigned: f.unassigned,
      contactId: fixed.contactId,
      dealId: fixed.dealId,
    };
    if (f.mine) {
      if (!ctx.userId) return null;
      out.assigneeId = ctx.userId;
    }
    if (f.assigneeId) {
      const id = await this.repo.resolveUserId(tx, orgId, f.assigneeId);
      if (id === undefined || (out.assigneeId !== undefined && out.assigneeId !== id)) return null;
      out.assigneeId = id;
    }
    if (f.contactId) {
      const c = await this.repo.resolveContact(tx, orgId, f.contactId);
      if (!c) return null;
      out.contactId = c.id;
    }
    if (f.dealId) {
      const dl = await this.repo.resolveDeal(tx, orgId, f.dealId);
      if (!dl) return null;
      out.dealId = dl.id;
    }
    if (f.companyId) {
      const co = await this.repo.resolveCompanyId(tx, orgId, f.companyId);
      if (co === undefined) return null;
      out.companyId = co;
    }
    return out;
  }

  /** `undefined` means the caller; `null` nobody; a uuid must be an ACTIVE member of this workspace (422 otherwise). */
  private async resolveAssignee(
    tx: Tx,
    orgId: number,
    uuid: string | null | undefined,
    actorId: number | null,
  ): Promise<number | null> {
    if (uuid === undefined) return actorId;
    if (uuid === null) return null;
    const user = await this.repo.resolveActiveUser(tx, orgId, uuid);
    if (!user) {
      throw new AppError(
        ERROR_CODES.TASK_ASSIGNEE_INVALID,
        'The assignee must be an active member of this workspace.',
        HttpStatus.UNPROCESSABLE_ENTITY,
        [{ path: 'assigneeId', message: uuid }],
      );
    }
    return user.id;
  }

  /**
   * The links a body names, as internal ids (`undefined` = not named, `null` = unlink). A record that is not in the workspace is
   * 404 (WaDesk stored any id). On create a deal brings its contact and company along unless the body names them.
   */
  private async resolveLinks(
    tx: Tx,
    orgId: number,
    body: { contactId?: string | null; dealId?: string | null; companyId?: string | null },
    inherit: boolean,
  ): Promise<{ contactId?: number | null; dealId?: number | null; companyId?: number | null }> {
    const out: { contactId?: number | null; dealId?: number | null; companyId?: number | null } =
      {};
    let dealContact: number | null = null;
    let dealCompany: number | null = null;
    if (body.dealId !== undefined) {
      if (body.dealId === null) out.dealId = null;
      else {
        const dl = await this.repo.resolveDeal(tx, orgId, body.dealId);
        if (!dl) throw AppError.notFound('Deal', body.dealId);
        out.dealId = dl.id;
        dealContact = dl.contactId;
        dealCompany = dl.companyId;
      }
    }
    if (body.contactId !== undefined) {
      if (body.contactId === null) out.contactId = null;
      else {
        const c = await this.repo.resolveContact(tx, orgId, body.contactId);
        if (!c) throw AppError.notFound('Contact', body.contactId);
        out.contactId = c.id;
      }
    } else if (inherit && dealContact !== null) out.contactId = dealContact;
    if (body.companyId !== undefined) {
      if (body.companyId === null) out.companyId = null;
      else {
        const co = await this.repo.resolveCompanyId(tx, orgId, body.companyId);
        if (co === undefined) throw AppError.notFound('Company', body.companyId);
        out.companyId = co;
      }
    } else if (inherit && dealCompany !== null) out.companyId = dealCompany;
    return out;
  }

  private applyLinks(
    patch: TaskPatch,
    row: TaskRow,
    links: { contactId?: number | null; dealId?: number | null; companyId?: number | null },
  ): void {
    if (links.contactId !== undefined && links.contactId !== row.contactId)
      patch.contact_id = links.contactId;
    if (links.dealId !== undefined && links.dealId !== row.dealId) patch.deal_id = links.dealId;
    if (links.companyId !== undefined && links.companyId !== row.companyId)
      patch.company_id = links.companyId;
  }

  /** Audit, events and the `task.assigned` hook for a row just inserted. */
  private async afterInsert(
    tx: Tx,
    orgId: number,
    actorId: number | null,
    id: number,
  ): Promise<TaskResponse> {
    const row = (await this.repo.findById(tx, orgId, id, await this.zone(tx, orgId)))!;
    await this.audit.record(tx, {
      module: TASK_MODULE,
      recordId: row.id,
      action: 'insert',
      delta: {
        title: { old: null, new: row.title },
        priority: { old: null, new: row.priority },
        dueAt: { old: null, new: row.dueAt ? row.dueAt.toISOString() : null },
        assignee: { old: null, new: row.assigneeUuid },
      },
    });
    await this.outbox.emit(tx, {
      aggregateModule: TASK_MODULE,
      aggregateId: row.id,
      eventType: 'task.created',
      payload: taskEventPayload(row),
    });
    if (row.assigneeId !== null && row.assigneeId !== actorId)
      await this.emitAssigned(tx, row, null);
    return this.toResponse(row);
  }

  /** Audit, events and the mirror sync after a field edit. `row` is the state BEFORE the edit. */
  private async afterEdit(
    tx: Tx,
    orgId: number,
    actorId: number | null,
    row: TaskRow,
    delta: Record<string, { old: unknown; new: unknown }>,
    changed: { dueChanged: boolean; assigneeChanged: boolean; newAssignee: number | null },
  ): Promise<void> {
    const after = (await this.repo.findById(tx, orgId, row.id, await this.zone(tx, orgId)))!;
    // Ids in the trail are uuids, read back from the row after the write (the repository speaks bigint, the audit must not).
    const named: Array<[string, string | null, string | null]> = [
      ['assignee', row.assigneeUuid, after.assigneeUuid],
      ['contact', row.contactUuid, after.contactUuid],
      ['deal', row.dealUuid, after.dealUuid],
      ['company', row.companyUuid, after.companyUuid],
    ];
    for (const [key, before, now] of named)
      if (before !== now) delta[key] = { old: before, new: now };
    await this.audit.record(tx, { module: TASK_MODULE, recordId: row.id, action: 'update', delta });
    await this.outbox.emit(tx, {
      aggregateModule: TASK_MODULE,
      aggregateId: row.id,
      eventType: 'task.updated',
      payload: { ...taskEventPayload(after), changed: Object.keys(delta) },
    });
    if (
      changed.assigneeChanged &&
      changed.newAssignee !== null &&
      changed.newAssignee !== actorId
    ) {
      await this.emitAssigned(tx, after, row.assigneeUuid);
    }
    await this.repo.syncActivity(tx, orgId, row.id, {
      ...(changed.dueChanged ? { dueAt: after.dueAt } : {}),
      ...(changed.assigneeChanged ? { assigneeId: changed.newAssignee } : {}),
    });
  }

  /** The hook point a notification consumer subscribes to: assigned to someone other than the person who did it. */
  private async emitAssigned(
    tx: Tx,
    row: TaskRow,
    previousAssigneeUuid: string | null,
  ): Promise<void> {
    await this.outbox.emit(tx, {
      aggregateModule: TASK_MODULE,
      aggregateId: row.id,
      eventType: 'task.assigned',
      payload: { ...taskEventPayload(row), previousAssigneeId: previousAssigneeUuid },
    });
  }

  private async transitionOne(
    uuid: string,
    done: boolean,
    input: TaskTransitionInput,
    scope: RecordScope,
  ): Promise<TaskResponse> {
    return this.db.tx(async (tx) => {
      const row = await this.lockForWrite(tx, uuid, scope);
      if (input.rowVersion !== undefined && input.rowVersion !== row.rowVersion) {
        throw AppError.rowVersionConflict('Task');
      }
      return this.toResponse(await this.transition(tx, row, done));
    });
  }

  private async transition(
    tx: Tx,
    row: TaskRow,
    done: boolean,
    opts: { syncActivity?: boolean } = {},
  ): Promise<TaskRow> {
    const ctx = RequestContextStore.require();
    const tz = await this.zone(tx, ctx.orgId);
    if ((row.status === 'done') === done) return row;
    await this.repo.setDone(tx, ctx.orgId, row.id, done);
    if (opts.syncActivity !== false) await this.repo.syncActivity(tx, ctx.orgId, row.id, { done });
    await this.audit.record(tx, {
      module: TASK_MODULE,
      recordId: row.id,
      action: 'update',
      delta: { status: { old: row.status, new: done ? 'done' : 'open' } },
    });
    const after = (await this.repo.findById(tx, ctx.orgId, row.id, tz))!;
    await this.outbox.emit(tx, {
      aggregateModule: TASK_MODULE,
      aggregateId: row.id,
      eventType: done ? 'task.completed' : 'task.reopened',
      payload: taskEventPayload(after),
    });
    return after;
  }

  private async deleteRow(tx: Tx, orgId: number, row: TaskRow): Promise<void> {
    await this.audit.record(tx, {
      module: TASK_MODULE,
      recordId: row.id,
      action: 'delete',
      delta: {
        title: { old: row.title, new: null },
        status: { old: row.status, new: null },
        assignee: { old: row.assigneeUuid, new: null },
      },
    });
    await this.outbox.emit(tx, {
      aggregateModule: TASK_MODULE,
      aggregateId: row.id,
      eventType: 'task.deleted',
      payload: taskEventPayload(row),
    });
    await this.repo.deleteById(tx, orgId, row.id);
  }

  private async lockForWrite(tx: Tx, uuid: string, scope: RecordScope): Promise<TaskRow> {
    const ctx = RequestContextStore.require();
    const tz = await this.zone(tx, ctx.orgId);
    const row = await this.repo.findByUuid(tx, ctx.orgId, uuid, tz, true);
    if (!row) throw AppError.notFound('Task', uuid);
    await this.assertScope(tx, scope, row);
    return row;
  }

  /** Not-found, never forbidden: a task outside the caller's scope is not revealed to exist. */
  private async assertScope(tx: Tx, scope: RecordScope, row: TaskRow): Promise<void> {
    const ctx = RequestContextStore.require();
    if (scope === 'all') return;
    const actor = ctx.userId;
    if (!actor) throw AppError.notFound('Task');
    if (row.assigneeId === actor || row.createdById === actor) return;
    if (scope === 'team') {
      for (const other of [row.assigneeId, row.createdById]) {
        if (other !== null && (await this.repo.isInActorTeam(tx, ctx.orgId, actor, other))) return;
      }
    }
    throw AppError.notFound('Task');
  }

  private async zone(tx: Tx, orgId: number): Promise<string> {
    return resolveTimezone(await this.repo.timezone(tx, orgId));
  }

  private toResponse(row: TaskRow): TaskResponse {
    return toTaskResponse(row, this.readNotes(row));
  }

  private readNotes(row: TaskRow): string | null {
    if (row.notesCipher === null) return null;
    try {
      return this.crypto.decrypt(row.notesCipher);
    } catch (err) {
      // Notes written under a key this process no longer has must not take the whole list down.
      this.logger.warn({ err, taskId: row.uuid }, 'could not decrypt task notes');
      return null;
    }
  }
}
