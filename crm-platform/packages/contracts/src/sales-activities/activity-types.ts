import { z } from 'zod';
import { uuidSchema } from '../common/ids';

/**
 * The workspace's activity types (Settings > Sales Activities). Seven are always there (the defaults); a business adds its own. Each carries a
 * few switches and, depending on what it behaves as, an ordered list of task types and an ordered list of outcomes. Labels of the defaults
 * are NOT in the data (`name` is null): the web shows its own localised word and the workspace's vocabulary for them.
 */

export const DEFAULT_ACTIVITY_KEYS = [
  'task',
  'meeting',
  'phone',
  'email',
  'reminder',
  'sms',
  'chat',
] as const;
export type DefaultActivityKey = (typeof DEFAULT_ACTIVITY_KEYS)[number];

/** What an activity does: `task`/`meeting`/`phone` are the three the product has screens for; `other` is a plain logged activity. */
export const ACTIVITY_BEHAVIOURS = ['task', 'meeting', 'phone', 'other'] as const;
export const activityBehaviourSchema = z.enum(ACTIVITY_BEHAVIOURS);
export type ActivityBehaviour = z.infer<typeof activityBehaviourSchema>;

/** The kinds a custom activity can be made to behave like (`other` is for the defaults that have no editor). */
export const CUSTOM_ACTIVITY_BEHAVIOURS = ['task', 'meeting', 'phone'] as const;
export const customActivityBehaviourSchema = z.enum(CUSTOM_ACTIVITY_BEHAVIOURS);

/** A small set of drawn icons; the web has one picture per name. */
export const ACTIVITY_ICONS = [
  'task',
  'meeting',
  'phone',
  'email',
  'reminder',
  'sms',
  'chat',
  'visit',
  'video',
  'document',
  'flag',
  'star',
] as const;
export const activityIconSchema = z.enum(ACTIVITY_ICONS);
export type ActivityIcon = z.infer<typeof activityIconSchema>;

export const ACTIVITY_NAME_MAX = 80;
export const ACTIVITY_OPTION_NAME_MAX = 80;
/** Limits that keep a list usable in a drawer and a picker. */
export const MAX_CUSTOM_ACTIVITIES = 20;
export const MAX_OPTIONS_PER_LIST = 50;

export const ACTIVITY_OPTION_KINDS = ['type', 'outcome'] as const;
export const activityOptionKindSchema = z.enum(ACTIVITY_OPTION_KINDS);
export type ActivityOptionKind = z.infer<typeof activityOptionKindSchema>;

/** The built-in call outcomes (the call log's reports and stage nudges understand these seven). */
export const PHONE_COUNTS_AS = [
  'connected',
  'no_answer',
  'busy',
  'left_voicemail',
  'wrong_number',
  'declined',
  'failed',
] as const;
export const phoneCountsAsSchema = z.enum(PHONE_COUNTS_AS);
export type PhoneCountsAs = z.infer<typeof phoneCountsAsSchema>;

/** One task type or outcome in an activity's list. `name` is null on a seeded one (the web shows its localised word for `key`). */
export const activityOptionSchema = z.object({
  id: uuidSchema,
  kind: activityOptionKindSchema,
  key: z.string(),
  name: z.string().nullable(),
  isSystem: z.boolean(),
  /** Phone outcomes only: the built-in outcome this one counts as in the call log. Null on a built-in one. */
  countsAs: phoneCountsAsSchema.nullable(),
  position: z.number().int(),
});
export type ActivityOption = z.infer<typeof activityOptionSchema>;

/**
 * How a task type or an outcome is named on a record that holds it. It stays readable after the option is removed from the list
 * (`removed: true`): old records keep their outcome.
 */
export const activityOptionRefSchema = z.object({
  id: uuidSchema,
  key: z.string(),
  name: z.string().nullable(),
  isSystem: z.boolean(),
  /** The activity it belongs to, so the web can find the localised word of a seeded option. */
  activityKey: z.string(),
  removed: z.boolean(),
});
export type ActivityOptionRef = z.infer<typeof activityOptionRefSchema>;

export const salesActivityTypeSchema = z.object({
  id: uuidSchema,
  key: z.string(),
  /** Null on a default activity (the web shows its localised name). */
  name: z.string().nullable(),
  isDefault: z.boolean(),
  behavesAs: activityBehaviourSchema,
  icon: z.string(),
  position: z.number().int(),
  /** "Show this activity in My calendar on Activities Dashboard". */
  showInCalendar: z.boolean(),
  /** "Allow users to mark this activity as completed". */
  allowComplete: z.boolean(),
  /** "Allow users to edit the completed date and time of this activity". */
  allowEditCompleted: z.boolean(),
  /** "Allow users to check in and check out from the mobile app". Stored; the mobile app has no check-in yet, so it has no effect. */
  mobileCheckIn: z.boolean(),
  /** "Predict outcomes for this activity": the outcome picker is offered. */
  outcomesEnabled: z.boolean(),
  /** The task types (only a task-like activity has them), in order. */
  taskTypes: z.array(activityOptionSchema),
  outcomes: z.array(activityOptionSchema),
  rowVersion: z.number().int(),
});
export type SalesActivityType = z.infer<typeof salesActivityTypeSchema>;

export const activityTypesResponseSchema = z.object({ data: z.array(salesActivityTypeSchema) });
export type ActivityTypesResponse = z.infer<typeof activityTypesResponseSchema>;

/** Which switches and lists each behaviour offers. The drawer and the API read the same table. */
export interface ActivityCapabilities {
  showInCalendar: boolean;
  allowComplete: boolean;
  allowEditCompleted: boolean;
  mobileCheckIn: boolean;
  taskTypes: boolean;
  outcomes: boolean;
}
export function activityCapabilities(behavesAs: ActivityBehaviour): ActivityCapabilities {
  switch (behavesAs) {
    case 'task':
      return {
        showInCalendar: true,
        allowComplete: true,
        allowEditCompleted: true,
        mobileCheckIn: false,
        taskTypes: true,
        outcomes: true,
      };
    case 'meeting':
      return {
        showInCalendar: true,
        allowComplete: true,
        allowEditCompleted: true,
        mobileCheckIn: true,
        taskTypes: false,
        outcomes: true,
      };
    case 'phone':
      return {
        showInCalendar: false,
        allowComplete: false,
        allowEditCompleted: false,
        mobileCheckIn: false,
        taskTypes: false,
        outcomes: true,
      };
    default:
      return {
        showInCalendar: false,
        allowComplete: false,
        allowEditCompleted: false,
        mobileCheckIn: false,
        taskTypes: false,
        outcomes: false,
      };
  }
}

/** Create a custom activity. */
export const createActivityTypeSchema = z.object({
  name: z.string().trim().min(1).max(ACTIVITY_NAME_MAX),
  icon: activityIconSchema.default('task'),
  behavesAs: customActivityBehaviourSchema,
});
export type CreateActivityTypeInput = z.infer<typeof createActivityTypeSchema>;

/** Edit an activity. A default's name is locked; every switch can change. Absent keeps. */
export const updateActivityTypeSchema = z.object({
  name: z.string().trim().min(1).max(ACTIVITY_NAME_MAX).optional(),
  icon: activityIconSchema.optional(),
  showInCalendar: z.boolean().optional(),
  allowComplete: z.boolean().optional(),
  allowEditCompleted: z.boolean().optional(),
  mobileCheckIn: z.boolean().optional(),
  outcomesEnabled: z.boolean().optional(),
  rowVersion: z.number().int().positive(),
});
export type UpdateActivityTypeInput = z.infer<typeof updateActivityTypeSchema>;

/** Add a task type or an outcome at the end of its list. The same name as a removed one brings that one back. */
export const addActivityOptionSchema = z.object({
  kind: activityOptionKindSchema,
  name: z.string().trim().min(1).max(ACTIVITY_OPTION_NAME_MAX),
  /** Phone outcomes: what the new outcome counts as in the call log reports. Default `connected`. */
  countsAs: phoneCountsAsSchema.optional(),
});
export type AddActivityOptionInput = z.infer<typeof addActivityOptionSchema>;

/** The full order of one list: every current id, once. */
export const reorderActivityOptionsSchema = z.object({
  kind: activityOptionKindSchema,
  ids: z.array(uuidSchema).min(1).max(MAX_OPTIONS_PER_LIST),
});
export type ReorderActivityOptionsInput = z.infer<typeof reorderActivityOptionsSchema>;

// --- a completed meeting ---------------------------------------------------------------------------------------------------

export const MEETING_RESULT_NOTE_MAX = 2000;

/** The outcome and notes of a completed meeting. */
export const meetingResultSchema = z.object({
  meetingId: uuidSchema,
  outcome: activityOptionRefSchema.nullable(),
  note: z.string().nullable(),
  completedAt: z.string().datetime(),
  completedBy: uuidSchema.nullable(),
  rowVersion: z.number().int(),
});
export type MeetingResult = z.infer<typeof meetingResultSchema>;

export const meetingResultsResponseSchema = z.object({ data: z.array(meetingResultSchema) });
export type MeetingResultsResponse = z.infer<typeof meetingResultsResponseSchema>;

/** Complete a meeting with an outcome and notes, or change them. `completedAt` needs "edit the completed date and time" on the Meeting activity. */
export const setMeetingResultSchema = z.object({
  outcomeId: uuidSchema.nullish(),
  note: z.string().trim().max(MEETING_RESULT_NOTE_MAX).nullish(),
  completedAt: z.string().datetime({ offset: true }).optional(),
});
export type SetMeetingResultInput = z.infer<typeof setMeetingResultSchema>;
