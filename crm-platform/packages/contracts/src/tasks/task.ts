import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { pageInfoSchema } from '../common/pagination';
import { queryBoolean, queryList } from '../contacts-attributes-tags/query-helpers';

/**
 * Tasks (WD-TASK-001..014). A task is open or done. `status` and `doneAt` always agree (a CHECK in the database), and
 * a task links to at most one contact, one deal and one company.
 */
export const TASK_TITLE_MAX = 255;
export const TASK_NOTES_MAX = 5000;
export const TASK_BULK_MAX = 200;

export const taskStatusSchema = z.enum(['open', 'done']);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export const taskPrioritySchema = z.enum(['low', 'medium', 'high']);
export type TaskPriority = z.infer<typeof taskPrioritySchema>;

/** Who wrote the task: a person (`manual`), the AI copilot, the API, a flow, or the deal timeline (`deal`). */
export const TASK_SOURCES = ['manual', 'deal', 'ai', 'api', 'flow'] as const;
export const taskSourceSchema = z.enum(TASK_SOURCES);
export type TaskSource = z.infer<typeof taskSourceSchema>;

/**
 * Where an OPEN task sits against the clock, cut in the workspace's time zone: `overdue` (due instant passed), `today` (due later
 * today), `upcoming` (a later day), `no_date`. A done task has none (null).
 */
export const taskBucketSchema = z.enum(['overdue', 'today', 'upcoming', 'no_date']);
export type TaskBucket = z.infer<typeof taskBucketSchema>;

export const taskUserRefSchema = z.object({ id: uuidSchema, name: z.string() });
export type TaskUserRef = z.infer<typeof taskUserRefSchema>;

export const taskContactRefSchema = z.object({ id: uuidSchema, name: z.string().nullable() });
export const taskDealRefSchema = z.object({ id: uuidSchema, title: z.string() });
export const taskCompanyRefSchema = z.object({ id: uuidSchema, name: z.string() });

export const taskResponseSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  /** Encrypted at rest. */
  notes: z.string().nullable(),
  priority: taskPrioritySchema,
  status: taskStatusSchema,
  dueAt: z.string().datetime().nullable(),
  doneAt: z.string().datetime().nullable(),
  /** The last due reminder; cleared when the task is reopened or its due date changes. */
  remindedAt: z.string().datetime().nullable(),
  bucket: taskBucketSchema.nullable(),
  /** Open and past due. */
  overdue: z.boolean(),
  assignee: taskUserRefSchema.nullable(),
  createdBy: taskUserRefSchema.nullable(),
  contact: taskContactRefSchema.nullable(),
  deal: taskDealRefSchema.nullable(),
  company: taskCompanyRefSchema.nullable(),
  source: taskSourceSchema,
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TaskResponse = z.infer<typeof taskResponseSchema>;

export const taskPageResponseSchema = z.object({
  data: z.array(taskResponseSchema),
  page: pageInfoSchema,
});
export type TaskPageResponse = z.infer<typeof taskPageResponseSchema>;

/** A due date is a full timestamp with an offset, never a bare date read as midnight. */
const dueAt = z.string().datetime({ offset: true });

export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(TASK_TITLE_MAX),
  notes: z.string().trim().max(TASK_NOTES_MAX).nullish(),
  /** Default `medium`. */
  priority: taskPrioritySchema.optional(),
  dueAt: dueAt.nullish(),
  /** An active member of this workspace. Omit for the caller; `null` for nobody. */
  assigneeId: uuidSchema.nullish(),
  contactId: uuidSchema.nullish(),
  dealId: uuidSchema.nullish(),
  companyId: uuidSchema.nullish(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;

/** Absent keeps, `null` clears (where a field can be empty). Status changes through complete / reopen. */
export const updateTaskSchema = z.object({
  title: z.string().trim().min(1).max(TASK_TITLE_MAX).optional(),
  notes: z.string().trim().max(TASK_NOTES_MAX).nullish(),
  priority: taskPrioritySchema.optional(),
  dueAt: dueAt.nullish(),
  assigneeId: uuidSchema.nullish(),
  contactId: uuidSchema.nullish(),
  dealId: uuidSchema.nullish(),
  companyId: uuidSchema.nullish(),
  rowVersion: z.number().int().positive(),
});
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

/**
 * Link or unlink in one call (the link/unlink buttons on a task, a contact or a deal). Absent keeps, `null` unlinks. Last write
 * wins: no `rowVersion`, because it touches nothing a person edits.
 */
export const taskLinksSchema = z.object({
  contactId: uuidSchema.nullish(),
  dealId: uuidSchema.nullish(),
  companyId: uuidSchema.nullish(),
});
export type TaskLinksInput = z.infer<typeof taskLinksSchema>;

/** Complete and reopen are idempotent; `rowVersion` is optional (last write wins without it). */
export const taskTransitionSchema = z.object({
  rowVersion: z.number().int().positive().optional(),
});
export type TaskTransitionInput = z.infer<typeof taskTransitionSchema>;

export const TASK_DUE_FILTERS = ['overdue', 'today', 'upcoming', 'none'] as const;
export const taskDueFilterSchema = z.enum(TASK_DUE_FILTERS);
export type TaskDueFilter = z.infer<typeof taskDueFilterSchema>;

export const TASK_SORTS = ['due', 'created', 'completed'] as const;
export const taskSortSchema = z.enum(TASK_SORTS);
export type TaskSort = z.infer<typeof taskSortSchema>;

/** The filters a list and the counts share. */
const taskFilterShape = {
  /** Title search (notes are encrypted and not searched). */
  q: z.string().trim().min(1).max(100).optional(),
  priority: queryList(taskPrioritySchema).optional(),
  /** Assigned to the caller. */
  mine: queryBoolean().optional(),
  assigneeId: uuidSchema.optional(),
  unassigned: queryBoolean().optional(),
  contactId: uuidSchema.optional(),
  dealId: uuidSchema.optional(),
  companyId: uuidSchema.optional(),
};

export const listTasksQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).max(512).optional(),
  /** `open` (default), `done` or `all`. */
  status: z.enum(['open', 'done', 'all']).default('open'),
  /** `overdue`, `today`, `upcoming` (open tasks, in the workspace zone) or `none` (no due date). */
  due: taskDueFilterSchema.optional(),
  /** Due between two instants (inclusive start, exclusive end). */
  dueFrom: dueAt.optional(),
  dueTo: dueAt.optional(),
  /** `due` (soonest first, undated last; default), `created` (newest first), `completed` (latest done first; default for done). */
  sort: taskSortSchema.optional(),
  ...taskFilterShape,
});
export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;

/** The tasks of one contact or deal (the id is in the path). */
export const listLinkedTasksQuerySchema = listTasksQuerySchema.omit({
  contactId: true,
  dealId: true,
  companyId: true,
});
export type ListLinkedTasksQuery = z.infer<typeof listLinkedTasksQuerySchema>;

export const taskCountsQuerySchema = z.object({ ...taskFilterShape });
export type TaskCountsQuery = z.infer<typeof taskCountsQuerySchema>;

/** Tab badges. The buckets partition the OPEN tasks inside the filter; `open` is their sum. */
export const taskCountsResponseSchema = z.object({
  overdue: z.number().int(),
  today: z.number().int(),
  upcoming: z.number().int(),
  noDate: z.number().int(),
  open: z.number().int(),
  done: z.number().int(),
  /** The caller's own open and overdue tasks inside their record scope, whatever the filter (the "My tasks" badge). */
  mine: z.object({ open: z.number().int(), overdue: z.number().int() }),
});
export type TaskCountsResponse = z.infer<typeof taskCountsResponseSchema>;

export const bulkTaskIdsSchema = z.object({
  ids: z.array(uuidSchema).min(1).max(TASK_BULK_MAX),
});
export type BulkTaskIdsInput = z.infer<typeof bulkTaskIdsSchema>;

export const bulkAssignTasksSchema = z.object({
  ids: z.array(uuidSchema).min(1).max(TASK_BULK_MAX),
  /** An active member, or `null` to unassign. */
  assigneeId: uuidSchema.nullable(),
});
export type BulkAssignTasksInput = z.infer<typeof bulkAssignTasksSchema>;

/** One bad id in a bulk call must not sink the others: the rest succeed and the failures say why. */
export const taskBulkResultSchema = z.object({
  succeeded: z.array(uuidSchema),
  failed: z.array(z.object({ id: uuidSchema, code: z.string(), message: z.string() })),
});
export type TaskBulkResult = z.infer<typeof taskBulkResultSchema>;
