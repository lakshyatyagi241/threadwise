/**
 * The inline task row of a contact's Tasks section (no dialog): what the row starts with, what is wrong with it, and how the
 * cached task lists change before the server has answered (optimistic add and complete, with an exact rollback when the call
 * fails). Pure over a `QueryClient`, so it is tested without a screen.
 */
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import {
  TASK_TITLE_MAX,
  type CreateTaskInput,
  type TaskPriority,
  type TaskResponse,
} from '@crm/contracts';
import { KEYS } from '../api/hooks';
import type { TaskSource } from '../api/service';
import { bucketOf, fromLocalInput, presetDue, toLocalInput } from './dates';

/** The row's own state, as the inputs hold it. */
export interface InlineDraft {
  title: string;
  /** A `datetime-local` value; the row starts on tomorrow at 17:00 so Enter alone saves a task that will come due. */
  due: string;
  assigneeId: string;
  priority: TaskPriority;
}

export const inlineDraft = (assigneeId: string, now: Date): InlineDraft => ({
  title: '',
  due: toLocalInput(presetDue('tomorrow', now)),
  assigneeId,
  priority: 'medium',
});

export type InlineProblem = 'titleRequired' | 'titleTooLong' | 'dueRequired' | 'dueInvalid';

/** Title and due date are required (a task without a date never comes due); the assignee starts as the signed-in person. */
export function validateInline(d: InlineDraft): Partial<Record<'title' | 'due', InlineProblem>> {
  const out: Partial<Record<'title' | 'due', InlineProblem>> = {};
  const title = d.title.trim();
  if (title === '') out.title = 'titleRequired';
  else if ([...title].length > TASK_TITLE_MAX) out.title = 'titleTooLong';
  if (d.due === '') out.due = 'dueRequired';
  else if (fromLocalInput(d.due) === null) out.due = 'dueInvalid';
  return out;
}

/** The create request for a record, from a valid draft. */
export function inlineCreateBody(
  d: InlineDraft,
  link: { kind: 'contact' | 'deal' | 'company'; id: string },
): CreateTaskInput {
  return {
    title: d.title.trim(),
    priority: d.priority,
    dueAt: fromLocalInput(d.due),
    assigneeId: d.assigneeId || null,
    ...(link.kind === 'contact' ? { contactId: link.id } : {}),
    ...(link.kind === 'deal' ? { dealId: link.id } : {}),
    ...(link.kind === 'company' ? { companyId: link.id } : {}),
  };
}

type Page = { tasks: TaskResponse[]; nextCursor: string | null; hasMore: boolean };
type ListData = { pages: Page[]; pageParams: unknown[] };

/** The cached list queries of a record: `[...KEYS.list, source, query]`. */
function listQueries(qc: QueryClient, source: TaskSource) {
  return qc.getQueriesData<ListData>({ queryKey: [...KEYS.list, source] });
}

/** What the cache held before an optimistic change, to put back exactly if the call fails. */
export type Rollback = () => void;

function snapshotOf(qc: QueryClient, source: TaskSource): Array<[QueryKey, ListData | undefined]> {
  return listQueries(qc, source).map(([key, data]) => [key, data]);
}

function restore(qc: QueryClient, snap: Array<[QueryKey, ListData | undefined]>): Rollback {
  return () => {
    for (const [key, data] of snap) qc.setQueryData(key, data);
  };
}

const queryOf = (key: QueryKey) => (key[key.length - 1] ?? {}) as { status?: string };

/**
 * A new task is shown at the top of the record's open lists at once (a made-up id until the server's answer replaces it).
 * Returns the rollback, and `confirm` swaps the made-up row for the real one.
 */
export function optimisticAdd(
  qc: QueryClient,
  source: TaskSource,
  task: TaskResponse,
): { rollback: Rollback; confirm: (real: TaskResponse) => void } {
  const snap = snapshotOf(qc, source);
  for (const [key, data] of listQueries(qc, source)) {
    if (!data || queryOf(key).status !== 'open') continue;
    qc.setQueryData<ListData>(key, {
      ...data,
      pages: data.pages.map((p, i) => (i === 0 ? { ...p, tasks: [task, ...p.tasks] } : p)),
    });
  }
  return {
    rollback: restore(qc, snap),
    confirm: (real) => {
      for (const [key, data] of listQueries(qc, source)) {
        if (!data) continue;
        qc.setQueryData<ListData>(key, {
          ...data,
          pages: data.pages.map((p) => ({
            ...p,
            tasks: p.tasks.map((t) => (t.id === task.id ? real : t)),
          })),
        });
      }
    },
  };
}

/** The task as the list shows it the moment it is ticked (or unticked), before the server has said so. */
export function toggled(task: TaskResponse, now: Date, zone?: string): TaskResponse {
  const done = task.status !== 'done';
  const status = done ? ('done' as const) : ('open' as const);
  return {
    ...task,
    status,
    doneAt: done ? now.toISOString() : null,
    bucket: bucketOf(task.dueAt, status, now, zone),
    overdue: !done && bucketOf(task.dueAt, 'open', now, zone) === 'overdue',
  };
}

/** Ticks or unticks a task in every cached list of the record at once; the rollback puts the old rows back. */
export function optimisticToggle(
  qc: QueryClient,
  source: TaskSource,
  task: TaskResponse,
  now: Date,
  zone?: string,
): Rollback {
  const snap = snapshotOf(qc, source);
  const next = toggled(task, now, zone);
  for (const [key, data] of listQueries(qc, source)) {
    if (!data) continue;
    qc.setQueryData<ListData>(key, {
      ...data,
      pages: data.pages.map((p) => ({
        ...p,
        tasks: p.tasks.map((t) => (t.id === task.id ? next : t)),
      })),
    });
  }
  return restore(qc, snap);
}

/** A task that exists only in the browser until the server has made it. */
export function pendingTask(
  body: CreateTaskInput,
  who: {
    assignee: { id: string; name: string } | null;
    createdBy: { id: string; name: string } | null;
    contact?: { id: string; name: string | null } | null;
  },
  now: Date,
  zone?: string,
): TaskResponse {
  const at = now.toISOString();
  return {
    id: `pending-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
    title: body.title,
    notes: null,
    priority: body.priority ?? 'medium',
    status: 'open',
    dueAt: body.dueAt ?? null,
    doneAt: null,
    remindedAt: null,
    bucket: bucketOf(body.dueAt, 'open', now, zone),
    overdue: bucketOf(body.dueAt, 'open', now, zone) === 'overdue',
    assignee: who.assignee,
    createdBy: who.createdBy,
    contact: who.contact ?? null,
    deal: null,
    company: null,
    source: 'manual',
    kind: 'task',
    taskType: null,
    outcome: null,
    rowVersion: 1,
    createdAt: at,
    updatedAt: at,
  };
}

/** Whether a task row is the browser-only one that has not been saved yet (it cannot be ticked until it is). */
export const isPending = (id: string): boolean => id.startsWith('pending-');
