import {
  assigneeResponseSchema,
  contactResponseSchema,
  contactSelectItemSchema,
  taskPageResponseSchema,
  taskResponseSchema,
  type CreateTaskInput,
  type TaskDueFilter,
  type TaskPriority,
  type UpdateTaskInput,
} from '@crm/contracts';
import { z } from 'zod';
import { apiFetch } from '@/lib/api';

/** Which tasks a list shows: one contact's, the caller's own ("My tasks"), or everyone's inside the caller's record scope. */
export type TaskListSource =
  { kind: 'contact'; contactId: string } | { kind: 'mine' } | { kind: 'all' };

/** The filters the app offers. Names and meanings are the API's (`listTasksQuerySchema`). */
export type TaskListFilters = {
  status: 'open' | 'done' | 'all';
  priority?: TaskPriority;
  due?: TaskDueFilter;
  mine?: boolean;
  unassigned?: boolean;
  q?: string;
};

export type TaskListParams = TaskListFilters & { limit: number; cursor?: string };

/** The route behind a source. `/tasks/my` is `/tasks` with `mine` forced on. */
export function taskListPath(source: TaskListSource): string {
  if (source.kind === 'contact') return `/v2/contacts/${source.contactId}/tasks`;
  return source.kind === 'mine' ? '/v2/tasks/my' : '/v2/tasks';
}

/** One page of tasks, soonest due first (undated last). */
export const listTasks = (source: TaskListSource, params: TaskListParams, signal?: AbortSignal) =>
  apiFetch(taskListPath(source), { query: params, schema: taskPageResponseSchema, signal });

export const getTask = (id: string, signal?: AbortSignal) =>
  apiFetch(`/v2/tasks/${id}`, { schema: taskResponseSchema, signal });

/** Creates a task. Leaving `assigneeId` out assigns it to the caller; `null` leaves it with nobody. */
export const createTask = (body: CreateTaskInput, idempotencyKey?: string) =>
  apiFetch('/v2/tasks', { method: 'POST', body, schema: taskResponseSchema, idempotencyKey });

/** Changes a task. `rowVersion` is the version that was read; a stale one is 409 ROW_VERSION_CONFLICT. */
export const updateTask = (id: string, body: UpdateTaskInput, idempotencyKey?: string) =>
  apiFetch(`/v2/tasks/${id}`, {
    method: 'PATCH',
    body,
    schema: taskResponseSchema,
    idempotencyKey,
  });

/** Marks a task done. Doing it to a task that is already done changes nothing. */
export const completeTask = (id: string, rowVersion: number, idempotencyKey?: string) =>
  apiFetch(`/v2/tasks/${id}/complete`, {
    method: 'POST',
    body: { rowVersion },
    schema: taskResponseSchema,
    idempotencyKey,
  });

/** Opens a done task again. */
export const reopenTask = (id: string, rowVersion: number, idempotencyKey?: string) =>
  apiFetch(`/v2/tasks/${id}/reopen`, {
    method: 'POST',
    body: { rowVersion },
    schema: taskResponseSchema,
    idempotencyKey,
  });

/** Deletes a task (204, nothing comes back). */
export const deleteTask = (id: string, idempotencyKey?: string) =>
  apiFetch(`/v2/tasks/${id}`, { method: 'DELETE', idempotencyKey });

const assigneeListSchema = z.array(assigneeResponseSchema);

/** The active staff a task can be given to. Needs the permission to read contacts: that is where the API keeps this list. */
export const listAssignees = (signal?: AbortSignal) =>
  apiFetch('/v2/contacts/assignees', { schema: assigneeListSchema, signal });

const contactChoiceListSchema = z.array(contactSelectItemSchema);

/** Contacts matching the words, for the "Link contact" picker. */
export const searchContacts = (q: string, signal?: AbortSignal) =>
  apiFetch('/v2/contacts/select-data', {
    query: { q: q || undefined, limit: 20 },
    schema: contactChoiceListSchema,
    signal,
  });

/** One contact, for the name of the contact a new task is added for. */
export const getLinkedContact = (id: string, signal?: AbortSignal) =>
  apiFetch(`/v2/contacts/${id}`, { schema: contactResponseSchema, signal });
