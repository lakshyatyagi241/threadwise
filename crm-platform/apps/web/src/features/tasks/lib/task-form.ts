import {
  TASK_NOTES_MAX,
  TASK_TITLE_MAX,
  type CreateTaskInput,
  type TaskPriority,
  type TaskResponse,
} from '@crm/contracts';
import { PRIORITIES } from '../api/schemas';
import { fromLocalInput, toLocalInput } from './dates';

/** The form's own state: strings, as the inputs hold them. */
export interface TaskDraft {
  title: string;
  notes: string;
  priority: TaskPriority;
  /** A `datetime-local` value or empty. */
  due: string;
  /** A member id or empty for nobody. */
  assigneeId: string;
  contactId: string;
  dealId: string;
  /** The company a new task was started from (the company page's tasks card); not editable in the form. */
  companyId: string;
}

export const emptyDraft = (assigneeId: string): TaskDraft => ({
  title: '',
  notes: '',
  priority: 'medium',
  due: '',
  assigneeId,
  contactId: '',
  dealId: '',
  companyId: '',
});

export const draftOf = (t: TaskResponse): TaskDraft => ({
  title: t.title,
  notes: t.notes ?? '',
  priority: t.priority,
  due: toLocalInput(t.dueAt),
  assigneeId: t.assignee?.id ?? '',
  contactId: t.contact?.id ?? '',
  dealId: t.deal?.id ?? '',
  companyId: t.company?.id ?? '',
});

export type DraftProblem =
  | 'titleRequired'
  | 'titleTooLong'
  | 'notesTooLong'
  | 'dueRequired'
  | 'dueInvalid'
  | 'priorityRequired'
  | 'assigneeRequired';

type DraftField = 'title' | 'notes' | 'due' | 'priority' | 'assignee';

/** Priority, assignee and due are required (a task with no owner or no date drops out of Today and Upcoming, so nobody is reminded). */
export function validateDraft(d: TaskDraft): Partial<Record<DraftField, DraftProblem>> {
  const out: Partial<Record<DraftField, DraftProblem>> = {};
  if (!(PRIORITIES as readonly string[]).includes(d.priority)) out.priority = 'priorityRequired';
  if (d.assigneeId === '') out.assignee = 'assigneeRequired';
  const title = d.title.trim();
  if (title === '') out.title = 'titleRequired';
  else if ([...title].length > TASK_TITLE_MAX) out.title = 'titleTooLong';
  if ([...d.notes.trim()].length > TASK_NOTES_MAX) out.notes = 'notesTooLong';
  if (d.due === '') out.due = 'dueRequired';
  else if (fromLocalInput(d.due) === null) out.due = 'dueInvalid';
  return out;
}

export function createBody(d: TaskDraft): CreateTaskInput {
  return {
    title: d.title.trim(),
    notes: d.notes.trim() || null,
    priority: d.priority,
    dueAt: fromLocalInput(d.due),
    assigneeId: d.assigneeId || null,
    contactId: d.contactId || null,
    dealId: d.dealId || null,
    ...(d.companyId ? { companyId: d.companyId } : {}),
  };
}

export type TaskPatch = Partial<Omit<CreateTaskInput, 'companyId'>>;

/** Only what changed against the task as it was read: an untouched form sends nothing. */
export function patchBody(task: TaskResponse, d: TaskDraft): TaskPatch {
  const was = draftOf(task);
  const next = createBody(d);
  const out: TaskPatch = {};
  if (d.title.trim() !== was.title) out.title = next.title;
  if (d.notes.trim() !== was.notes.trim()) out.notes = next.notes;
  if (d.priority !== was.priority) out.priority = d.priority;
  if (d.due !== was.due) out.dueAt = next.dueAt;
  if (d.assigneeId !== was.assigneeId) out.assigneeId = next.assigneeId;
  if (d.contactId !== was.contactId) out.contactId = next.contactId;
  if (d.dealId !== was.dealId) out.dealId = next.dealId;
  return out;
}
