import {
  TASK_NOTES_MAX,
  TASK_TITLE_MAX,
  createTaskSchema,
  updateTaskSchema,
  type CreateTaskInput,
  type TaskPriority,
  type TaskResponse,
  type UpdateTaskInput,
} from '@crm/contracts';
import { fromDueAt, parseDateText, parseTimeText, toDueAt } from './dates';

/** Who a task goes to: the caller (the API's default when nothing is sent), nobody, or a named member of the team. */
export type AssigneeChoice =
  { kind: 'me' } | { kind: 'none' } | { kind: 'user'; id: string; name: string };

export interface ContactChoice {
  id: string;
  name: string;
}

export interface TaskFormValues {
  title: string;
  notes: string;
  priority: TaskPriority;
  /** The day as typed, "2026-10-31"; empty with `time` for a task without a due date. */
  date: string;
  /** The time as typed, "14:30". */
  time: string;
  assignee: AssigneeChoice;
  contact: ContactChoice | null;
}

/** The fields a message can sit under. */
export type TaskField = 'title' | 'notes' | 'date' | 'time' | 'owner' | 'contact';

export type TaskFormErrorKey =
  | 'tasks.form.errors.titleRequired'
  | 'tasks.form.errors.titleTooLong'
  | 'tasks.form.errors.titleNeedsLetter'
  | 'tasks.form.errors.notesTooLong'
  | 'tasks.form.errors.dateInvalid'
  | 'tasks.form.errors.timeInvalid'
  | 'tasks.form.errors.dateNeeded'
  | 'tasks.form.errors.timeNeeded'
  | 'tasks.form.errors.dueInvalid';

export type TaskFormProblems = Partial<Record<TaskField, TaskFormErrorKey>>;

export const EMPTY_TASK: TaskFormValues = {
  title: '',
  notes: '',
  priority: 'medium',
  date: '',
  time: '',
  assignee: { kind: 'me' },
  contact: null,
};

/** Any letter of any script (Devanagari included): a title of digits and punctuation alone is not a title. */
const HAS_LETTER = /\p{L}/u;

/**
 * The rules of the form, checked before anything is sent: the title (required, at most 255, with a letter in it), the description
 * length, and the day and time (both or neither, each in the shape the person is told). What only the server can know (is this
 * member active, does this contact exist) comes back as its answer.
 */
export function validateTask(values: TaskFormValues): TaskFormProblems {
  const problems: TaskFormProblems = {};
  const title = values.title.trim();
  if (!title) problems.title = 'tasks.form.errors.titleRequired';
  else if (title.length > TASK_TITLE_MAX) problems.title = 'tasks.form.errors.titleTooLong';
  else if (!HAS_LETTER.test(title)) problems.title = 'tasks.form.errors.titleNeedsLetter';

  if (values.notes.trim().length > TASK_NOTES_MAX)
    problems.notes = 'tasks.form.errors.notesTooLong';

  const date = values.date.trim();
  const time = values.time.trim();
  if (date && !parseDateText(date)) problems.date = 'tasks.form.errors.dateInvalid';
  if (time && !parseTimeText(time)) problems.time = 'tasks.form.errors.timeInvalid';
  if (date && !time && !problems.date) problems.time = 'tasks.form.errors.timeNeeded';
  if (time && !date && !problems.time) problems.date = 'tasks.form.errors.dateNeeded';
  return problems;
}

/** The due date the API takes for the typed day and time, or null for none. */
export const dueAtOf = (values: TaskFormValues): string | null =>
  values.date.trim() && values.time.trim() ? toDueAt(values.date, values.time) : null;

const assigneeBody = (choice: AssigneeChoice): { assigneeId?: string | null } => {
  if (choice.kind === 'none') return { assigneeId: null };
  return choice.kind === 'user' ? { assigneeId: choice.id } : {};
};

/** What the create form sends. Leaving the assignee out is how the API is told "the caller". */
export function buildCreateBody(values: TaskFormValues): CreateTaskInput {
  const notes = values.notes.trim();
  const dueAt = dueAtOf(values);
  return {
    title: values.title.trim(),
    ...(notes ? { notes } : {}),
    priority: values.priority,
    ...(dueAt ? { dueAt } : {}),
    ...assigneeBody(values.assignee),
    ...(values.contact ? { contactId: values.contact.id } : {}),
  };
}

/** What the form starts from when it edits a task: the task as the API has it, the due date on this phone's clock. */
export function valuesOfTask(task: TaskResponse, myId: string | undefined): TaskFormValues {
  const due = fromDueAt(task.dueAt);
  let assignee: AssigneeChoice = { kind: 'none' };
  if (task.assignee) {
    assignee =
      task.assignee.id === myId
        ? { kind: 'me' }
        : { kind: 'user', id: task.assignee.id, name: task.assignee.name };
  }
  return {
    title: task.title,
    notes: task.notes ?? '',
    priority: task.priority,
    date: due.date,
    time: due.time,
    assignee,
    contact: task.contact ? { id: task.contact.id, name: task.contact.name ?? '' } : null,
  };
}

const minuteOf = (iso: string) => Math.floor(new Date(iso).getTime() / 60_000);

/**
 * The fields the form changed, as the API's update body: an emptied field is sent as null, an untouched one is left out (the due
 * date is compared to the minute, since the form cannot show seconds).
 */
export function buildUpdateBody(
  task: TaskResponse,
  values: TaskFormValues,
  myId: string | undefined,
): Omit<UpdateTaskInput, 'rowVersion'> {
  const body: Omit<UpdateTaskInput, 'rowVersion'> = {};
  const title = values.title.trim();
  if (title !== task.title) body.title = title;

  const notes = values.notes.trim();
  if (notes !== (task.notes ?? '').trim()) body.notes = notes || null;

  if (values.priority !== task.priority) body.priority = values.priority;

  const dueAt = dueAtOf(values);
  const dueChanged =
    dueAt === null || task.dueAt === null
      ? dueAt !== task.dueAt
      : minuteOf(dueAt) !== minuteOf(task.dueAt);
  if (dueChanged) body.dueAt = dueAt;

  const assigneeBefore = task.assignee?.id ?? null;
  const assigneeAfter =
    values.assignee.kind === 'none'
      ? null
      : values.assignee.kind === 'me'
        ? (myId ?? assigneeBefore)
        : values.assignee.id;
  if (assigneeAfter !== assigneeBefore) body.assigneeId = assigneeAfter;

  const contactAfter = values.contact?.id ?? null;
  if (contactAfter !== (task.contact?.id ?? null)) body.contactId = contactAfter;
  return body;
}

/**
 * The contract's own schema as the last gate: whatever the rules above let through must be a body the API accepts. A refusal
 * here means the form and the contract have drifted apart, and is shown under the field the contract names.
 */
export function contractProblems(
  body: CreateTaskInput | UpdateTaskInput,
  mode: 'create' | 'update',
): TaskFormProblems {
  const result = (mode === 'create' ? createTaskSchema : updateTaskSchema).safeParse(body);
  if (result.success) return {};
  const problems: TaskFormProblems = {};
  for (const issue of result.error.issues) {
    const path = issue.path[0];
    if (path === 'title') problems.title = 'tasks.form.errors.titleRequired';
    else if (path === 'notes') problems.notes = 'tasks.form.errors.notesTooLong';
    else if (path === 'dueAt') problems.date = 'tasks.form.errors.dueInvalid';
  }
  return problems;
}
