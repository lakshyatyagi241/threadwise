import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * Task outcomes: the workspace's list of results a person picks when they complete or log a task ("Interested", "Left message", "No
 * response", ...). Waboo kept the list as a settings document with a position and a visible flag per entry; here it is a table. A
 * task points at one outcome or none. A hidden (inactive) outcome is no longer offered but stays on the tasks that carry it, and an
 * outcome that a task uses cannot be deleted (Waboo refused it too).
 */
export const TASK_OUTCOME_NAME_MAX = 191;
export const TASK_OUTCOMES_MAX = 200;

export const taskOutcomeResponseSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  sortOrder: z.number().int(),
  /** `false` hides it from pickers; the tasks that already carry it keep it. */
  isActive: z.boolean(),
  /** Tasks that currently carry this outcome. */
  taskCount: z.number().int(),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TaskOutcomeResponse = z.infer<typeof taskOutcomeResponseSchema>;

/** The outcome as a task shows it. */
export const taskOutcomeRefSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  isActive: z.boolean(),
});
export type TaskOutcomeRef = z.infer<typeof taskOutcomeRefSchema>;

export const listTaskOutcomesQuerySchema = z.object({
  /** `true` for the outcomes a picker may offer. */
  activeOnly: z
    .preprocess(
      (v) => (v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : v),
      z.boolean(),
    )
    .optional(),
});
export type ListTaskOutcomesQuery = z.infer<typeof listTaskOutcomesQuerySchema>;

export const createTaskOutcomeSchema = z.object({
  name: z.string().trim().min(1).max(TASK_OUTCOME_NAME_MAX),
  isActive: z.boolean().optional(),
});
export type CreateTaskOutcomeInput = z.infer<typeof createTaskOutcomeSchema>;

export const updateTaskOutcomeSchema = z.object({
  name: z.string().trim().min(1).max(TASK_OUTCOME_NAME_MAX).optional(),
  isActive: z.boolean().optional(),
  rowVersion: z.number().int().positive(),
});
export type UpdateTaskOutcomeInput = z.infer<typeof updateTaskOutcomeSchema>;

/** Every outcome exactly once, in the order wanted. */
export const reorderTaskOutcomesSchema = z.object({
  outcomeIds: z.array(uuidSchema).min(1).max(TASK_OUTCOMES_MAX),
});
export type ReorderTaskOutcomesInput = z.infer<typeof reorderTaskOutcomesSchema>;
