import { z } from 'zod';

/**
 * A contact's next follow-up (BL-291): the one open task of kind `follow_up` linked to the contact (docs/specs/lead-followup-settings.md,
 * section 2.3). `dueAt` null is "someday": an open follow-up without a date, which is never reminded.
 */
export interface NextFollowUp {
  /** The task's id. */
  id: string;
  dueAt: string | null;
  assigneeId: string | null;
}

/** The two kinds of task: an ordinary one, and a contact's follow-up (at most one open per contact). */
export const TASK_KINDS = ['task', 'follow_up'] as const;
export const taskKindSchema = z.enum(TASK_KINDS);
export type TaskKind = (typeof TASK_KINDS)[number];

/** `PUT /contacts/:id/follow-up`: set or move the contact's next follow-up. `dueAt: null` makes it a "someday" follow-up. */
export const setFollowUpSchema = z.object({ dueAt: z.string().datetime().nullable() });
export type SetFollowUpInput = z.infer<typeof setFollowUpSchema>;

/** `POST /contacts/:id/follow-up/snooze`: move it to the preset's day at the workspace's default alert time. */
export const FOLLOW_UP_SNOOZES = ['day', 'three_days', 'week'] as const;
export const snoozeFollowUpSchema = z.object({ preset: z.enum(FOLLOW_UP_SNOOZES) });
export type SnoozeFollowUpInput = z.infer<typeof snoozeFollowUpSchema>;

/** The list filter `followUp`: where a contact's next follow-up stands now, in the workspace's time zone. */
export const FOLLOW_UP_FILTERS = ['overdue', 'today', 'upcoming', 'someday', 'none'] as const;
export const followUpFilterSchema = z.enum(FOLLOW_UP_FILTERS);
export type FollowUpFilter = (typeof FOLLOW_UP_FILTERS)[number];

/** What the follow-up endpoints answer: the follow-up after the change, or null when there is none (done, cleared). */
export interface FollowUpResult {
  nextFollowUp: NextFollowUp | null;
}
