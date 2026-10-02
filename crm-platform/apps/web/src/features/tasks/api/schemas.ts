import { z } from 'zod';

/**
 * The tasks screens work with the wire shapes of `@crm/contracts` (tasks) directly: a task already arrives flat, with uuid
 * ids, nested `{id, name}` refs, the workspace-zone `bucket` and an `overdue` flag, so no mapping layer is needed.
 */
export {
  TASK_BULK_MAX,
  TASK_NOTES_MAX,
  TASK_TITLE_MAX,
  type CreateTaskInput,
  type TaskBucket,
  type TaskCountsResponse,
  type TaskPriority,
  type TaskResponse,
  type TaskStatus,
  type UpdateTaskInput,
} from '@crm/contracts';

export const PRIORITIES = ['high', 'medium', 'low'] as const;

export interface Member {
  id: string;
  fullName: string;
}

/** Only what the pickers read; the rest of those responses is ignored. */
export const memberPageSchema = z.object({
  data: z.array(z.object({ id: z.string(), fullName: z.string() })),
});

export const contactHitSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  phone: z.string().nullable(),
});
export type ContactHit = z.infer<typeof contactHitSchema>;
export const contactHitPageSchema = z.object({ data: z.array(contactHitSchema) });

export const dealHitSchema = z.object({ id: z.string(), title: z.string() });
export type DealHit = z.infer<typeof dealHitSchema>;
export const dealHitPageSchema = z.object({ data: z.array(dealHitSchema) });

/** A record a task can link to, as the pickers hold it. */
export interface RecordRef {
  id: string;
  label: string;
  /** Secondary text (a phone number). */
  hint?: string | null;
}

export const contactLabel = (c: ContactHit): string =>
  c.name || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.phone || '';

export interface BulkOutcome {
  changed: number;
  failed: number;
}
