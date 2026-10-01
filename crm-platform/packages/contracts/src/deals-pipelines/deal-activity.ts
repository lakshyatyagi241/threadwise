import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { pageInfoSchema, paginationQuerySchema } from '../common/pagination';
import { queryBoolean } from '../contacts-attributes-tags/query-helpers';
import { dealUserRefSchema } from './deal';

/**
 * The deal timeline and its tasks (WD-DEAL-015, 016). One row per thing that happened to a deal: a note, a logged call, a
 * message, an email, a meeting, a task, or the system's own `stage_change` row (written for every placement and move).
 */
export const ACTIVITY_BODY_MAX = 5000;

export const activityTypeSchema = z.enum([
  'note',
  'call',
  'message',
  'email',
  'meeting',
  'task',
  'stage_change',
]);
export type ActivityType = z.infer<typeof activityTypeSchema>;

/** The types a person can add. `stage_change` is written by the system only. */
export const manualActivityTypeSchema = z.enum([
  'note',
  'call',
  'message',
  'email',
  'meeting',
  'task',
]);
export type ManualActivityType = z.infer<typeof manualActivityTypeSchema>;

const stageNameRef = z.object({ id: uuidSchema.nullable(), name: z.string() });

export const dealActivityResponseSchema = z.object({
  id: uuidSchema,
  dealId: uuidSchema,
  type: activityTypeSchema,
  /** Null for `stage_change`. Encrypted at rest. */
  body: z.string().nullable(),
  /** Tasks only. */
  dueAt: z.string().datetime().nullable(),
  doneAt: z.string().datetime().nullable(),
  done: z.boolean(),
  /** Tasks only: who is to do it. */
  assignee: dealUserRefSchema.nullable(),
  /** Null for the system (a flow, an import, a worker). */
  author: dealUserRefSchema.nullable(),
  /** `stage_change` only; the names are kept with the row so a deleted stage still reads. `from` is null for the first placement. */
  stageChange: z.object({ from: stageNameRef.nullable(), to: stageNameRef }).nullable(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type DealActivityResponse = z.infer<typeof dealActivityResponseSchema>;

export const createDealActivitySchema = z
  .object({
    type: manualActivityTypeSchema,
    body: z.string().trim().min(1).max(ACTIVITY_BODY_MAX),
    /** Tasks only (422 for other types, not silently dropped as WaDesk did). A full timestamp, not a date at midnight. */
    dueAt: z.string().datetime({ offset: true }).optional(),
    /** Tasks only. Omit for the caller. */
    assigneeId: uuidSchema.nullish(),
  })
  .refine((v) => v.type === 'task' || (v.dueAt === undefined && v.assigneeId === undefined), {
    message: 'dueAt and assigneeId apply to tasks only',
    path: ['dueAt'],
  });
export type CreateDealActivityInput = z.infer<typeof createDealActivitySchema>;

export const listDealActivitiesQuerySchema = paginationQuerySchema.extend({
  type: activityTypeSchema.optional(),
});
export type ListDealActivitiesQuery = z.infer<typeof listDealActivitiesQuerySchema>;

export const dealActivityPageResponseSchema = z.object({
  data: z.array(dealActivityResponseSchema),
  page: pageInfoSchema,
});

/** Open tasks across deals ("my tasks"), soonest due first. */
export const listDealTasksQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().min(1).max(512).optional(),
  /** Tasks assigned to the caller. Without it, the tasks the caller's record scope can see. */
  mine: queryBoolean().optional(),
  assigneeId: uuidSchema.optional(),
  dealId: uuidSchema.optional(),
  /** `open` (default), `done` or `all`. */
  status: z.enum(['open', 'done', 'all']).default('open'),
  /** Only tasks already past due. */
  overdue: queryBoolean().optional(),
});
export type ListDealTasksQuery = z.infer<typeof listDealTasksQuerySchema>;

export const dealTaskResponseSchema = dealActivityResponseSchema.extend({
  deal: z.object({ id: uuidSchema, title: z.string() }),
});
export type DealTaskResponse = z.infer<typeof dealTaskResponseSchema>;
