import {
  taskCountsResponseSchema,
  taskBulkResultSchema,
  taskPageResponseSchema,
  taskResponseSchema,
  type CreateTaskInput,
  type TaskBulkResult,
  type TaskCountsResponse,
  type TaskResponse,
} from '@crm/contracts';
import { chunk } from '../lib/selection';
import type { TaskPatch } from '../lib/task-form';
import { call, callReal } from './http';
import {
  companyHitListSchema,
  companyHitSchema,
  contactHitPageSchema,
  contactHitSchema,
  dealHitPageSchema,
  dealHitSchema,
  memberPageSchema,
  type BulkOutcome,
  type CompanyHit,
  type ContactHit,
  type DealHit,
  type Member,
} from './schemas';

type Query = Record<string, string | number | boolean | undefined>;

export interface TaskPageResult {
  tasks: TaskResponse[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** Where a list of tasks comes from: the whole workspace, or the tasks of one contact, deal or company. */
export type TaskSource = { kind: 'all' } | { kind: 'contact' | 'deal' | 'company'; id: string };

const SOURCE_PATH = { contact: 'contacts', deal: 'deals', company: 'companies' } as const;
const pathOf = (s: TaskSource) =>
  s.kind === 'all' ? '/tasks' : `/${SOURCE_PATH[s.kind]}/${s.id}/tasks`;

function outcome(r: TaskBulkResult): BulkOutcome {
  return { changed: r.succeeded.length, failed: r.failed.length };
}

/** Every tasks call, one function each. Reads are parsed with the shared contracts. */
export const tasksApi = {
  async list(source: TaskSource, query: Query, signal?: AbortSignal): Promise<TaskPageResult> {
    const res = await call(pathOf(source), { query, schema: taskPageResponseSchema, signal });
    return { tasks: res.data, nextCursor: res.page.nextCursor, hasMore: res.page.hasMore };
  },
  counts(query: Query, signal?: AbortSignal): Promise<TaskCountsResponse> {
    return call('/tasks/counts', { query, schema: taskCountsResponseSchema, signal });
  },
  get(id: string, signal?: AbortSignal): Promise<TaskResponse> {
    return call(`/tasks/${id}`, { schema: taskResponseSchema, signal });
  },
  create(input: CreateTaskInput): Promise<TaskResponse> {
    return call('/tasks', { method: 'POST', body: input, schema: taskResponseSchema });
  },
  /** Needs the `rowVersion` that was read; a 409 means someone else changed the task. */
  update(task: Pick<TaskResponse, 'id' | 'rowVersion'>, patch: TaskPatch): Promise<TaskResponse> {
    return call(`/tasks/${task.id}`, {
      method: 'PATCH',
      body: { ...patch, rowVersion: task.rowVersion },
      schema: taskResponseSchema,
    });
  },
  /** Idempotent: completing a done task or reopening an open one changes nothing. */
  complete: (id: string): Promise<TaskResponse> =>
    call(`/tasks/${id}/complete`, { method: 'POST', body: {}, schema: taskResponseSchema }),
  reopen: (id: string): Promise<TaskResponse> =>
    call(`/tasks/${id}/reopen`, { method: 'POST', body: {}, schema: taskResponseSchema }),
  remove: (id: string): Promise<void> => call(`/tasks/${id}`, { method: 'DELETE' }),

  // bulk (at most 200 ids per call; bigger selections go out in chunks, each partial failure is counted)
  async bulkComplete(ids: readonly string[]): Promise<BulkOutcome> {
    return sum(
      await Promise.all(
        chunk(ids).map((c) =>
          call('/tasks/bulk/complete', {
            method: 'POST',
            body: { ids: c },
            schema: taskBulkResultSchema,
          }),
        ),
      ),
    );
  },
  async bulkAssign(ids: readonly string[], assigneeId: string | null): Promise<BulkOutcome> {
    return sum(
      await Promise.all(
        chunk(ids).map((c) =>
          call('/tasks/bulk/assign', {
            method: 'POST',
            body: { ids: c, assigneeId },
            schema: taskBulkResultSchema,
          }),
        ),
      ),
    );
  },
  async bulkDelete(ids: readonly string[]): Promise<BulkOutcome> {
    return sum(
      await Promise.all(
        chunk(ids).map((c) =>
          call('/tasks/bulk/delete', {
            method: 'POST',
            body: { ids: c },
            schema: taskBulkResultSchema,
          }),
        ),
      ),
    );
  },

  // pickers
  async members(signal?: AbortSignal): Promise<Member[]> {
    const page = await call('/users', { query: { limit: 200 }, schema: memberPageSchema, signal });
    return page.data;
  },
  async searchContacts(q: string, signal?: AbortSignal): Promise<ContactHit[]> {
    const page = await callReal('/contacts', {
      query: { q: q.trim() || undefined, limit: 15 },
      schema: contactHitPageSchema,
      signal,
    });
    return page.data;
  },
  /** Companies of the caller's record scope by a part of the name (the picker endpoint, at most 15). */
  searchCompanies: (q: string, signal?: AbortSignal): Promise<CompanyHit[]> =>
    callReal('/companies/select-data', {
      query: { q: q.trim() || undefined, limit: 15 },
      schema: companyHitListSchema,
      signal,
    }),
  /** One contact, deal or company by id, for a filter that arrived in the address with no name. */
  contactById: (id: string, signal?: AbortSignal): Promise<ContactHit> =>
    callReal(`/contacts/${id}`, { schema: contactHitSchema, signal }),
  dealById: (id: string, signal?: AbortSignal): Promise<DealHit> =>
    callReal(`/deals/${id}`, { schema: dealHitSchema, signal }),
  companyById: (id: string, signal?: AbortSignal): Promise<CompanyHit> =>
    callReal(`/companies/${id}`, { schema: companyHitSchema, signal }),
  async searchDeals(q: string, signal?: AbortSignal): Promise<DealHit[]> {
    const page = await callReal('/deals', {
      query: { q: q.trim() || undefined, limit: 15 },
      schema: dealHitPageSchema,
      signal,
    });
    return page.data;
  },
};

function sum(results: readonly TaskBulkResult[]): BulkOutcome {
  return results
    .map(outcome)
    .reduce((a, b) => ({ changed: a.changed + b.changed, failed: a.failed + b.failed }), {
      changed: 0,
      failed: 0,
    });
}
