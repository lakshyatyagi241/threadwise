import { z } from 'zod';

/**
 * Lead handling settings (docs/specs/lead-followup-settings.md): one document per section, one row per (workspace, section).
 * A section that was never saved reads as its defaults, merged field by field, so a knob added later needs no data migration.
 *
 * HARD RULE: the defaults change nothing for an existing workspace. Everything that would write data on its own is off.
 */

export const LEAD_HANDLING_SECTIONS = ['uncontacted', 'follow_ups', 'duplicates'] as const;
export type LeadHandlingSection = (typeof LEAD_HANDLING_SECTIONS)[number];

// --- uncontacted --------------------------------------------------------------------------------------------------------------

/** What counts as reaching out (clears the marker) and which new contacts start uncontacted. */
export const uncontactedSettingsSchema = z.object({
  clearOn: z.object({
    /** Call, SMS, e-mail or WhatsApp button; a placed or answered call. */
    contactButton: z.boolean(),
    /** A message, template, saved reply or file a staff member sent from the inbox. */
    message: z.boolean(),
    /** A campaign, broadcast or flow send reached the contact. */
    automation: z.boolean(),
    /** A staff member added a timeline activity, note or meeting. */
    activity: z.boolean(),
  }),
  markNew: z.object({
    /** A staff member created the contact in the app. */
    manual: z.boolean(),
    /** CSV import and the Sheets add-on. */
    import: z.boolean(),
    /** Lead sources (webhook, lead ads, portals), forms and API integrations. */
    leadSource: z.boolean(),
  }),
  /** `mark`: a new owner (single, bulk, leave batch, auto-assign) puts the contact back to uncontacted. A restore after leave never does. */
  onReassign: z.enum(['keep', 'mark']),
});
export type UncontactedSettingsValues = z.infer<typeof uncontactedSettingsSchema>;

/** Clearing only acts on contacts that are already uncontacted, so it can be on by default; creating and reassigning are off. */
export const UNCONTACTED_DEFAULTS: UncontactedSettingsValues = {
  clearOn: { contactButton: true, message: true, automation: true, activity: true },
  markNew: { manual: false, import: false, leadSource: false },
  onReassign: 'keep',
};

const flag = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);
const obj = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** The stored document over the defaults, field by field: unknown or malformed keys fall back, nothing throws. */
export function mergeUncontactedSettings(stored: unknown): UncontactedSettingsValues {
  const d = UNCONTACTED_DEFAULTS;
  const s = obj(stored);
  const clear = obj(s.clearOn);
  const mark = obj(s.markNew);
  return {
    clearOn: {
      contactButton: flag(clear.contactButton, d.clearOn.contactButton),
      message: flag(clear.message, d.clearOn.message),
      automation: flag(clear.automation, d.clearOn.automation),
      activity: flag(clear.activity, d.clearOn.activity),
    },
    markNew: {
      manual: flag(mark.manual, d.markNew.manual),
      import: flag(mark.import, d.markNew.import),
      leadSource: flag(mark.leadSource, d.markNew.leadSource),
    },
    onReassign: s.onReassign === 'mark' || s.onReassign === 'keep' ? s.onReassign : d.onReassign,
  };
}

/** A save replaces the whole section (the screen edits all of it); `rowVersion` is absent on the first save. */
export const updateUncontactedSettingsSchema = uncontactedSettingsSchema.extend({
  rowVersion: z.number().int().positive().optional(),
});
export type UpdateUncontactedSettingsInput = z.infer<typeof updateUncontactedSettingsSchema>;

export type UncontactedSettings = UncontactedSettingsValues & {
  rowVersion: number | null;
  updatedAt: string | null;
};

// --- follow-ups ---------------------------------------------------------------------------------------------------------------

/** The date an automatic follow-up is set to, counted from the day of the touch in the workspace's time zone. */
export const followUpDefaultDateSchema = z.discriminatedUnion('kind', [
  /** A number of days later: 1 day, 3 days, 1 week (7) or a custom number. */
  z.object({ kind: z.literal('days'), days: z.number().int().min(1).max(365) }),
  /** The same day of the next calendar month (the last day when that month is shorter). */
  z.object({ kind: z.literal('month') }),
  /** An open follow-up without a date: it stays in the Someday list and is never reminded. */
  z.object({ kind: z.literal('someday') }),
  /** No follow-up: the contact's open follow-up is completed and nothing new is made. */
  z.object({ kind: z.literal('none') }),
]);
export type FollowUpDefaultDate = z.infer<typeof followUpDefaultDateSchema>;

/** The alert time of a follow-up (`HH:mm`, 24 hours), read on the workspace's time zone. */
export const followUpTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:mm');

/** Which states of a contact's next follow-up an action that contacts them updates, and to what. */
export const followUpSettingsSchema = z.object({
  updateWhen: z.object({
    /** The contact has no follow-up (or one without a date). */
    none: z.boolean(),
    overdue: z.boolean(),
    today: z.boolean(),
    /** Due after today. */
    future: z.boolean(),
  }),
  defaultDate: followUpDefaultDateSchema,
  defaultTime: followUpTimeSchema,
});
export type FollowUpSettingsValues = z.infer<typeof followUpSettingsSchema>;

/** Off by default: an automatic follow-up creates tasks and notifications, which only a workspace that asked for them should get. */
export const FOLLOW_UP_DEFAULTS: FollowUpSettingsValues = {
  updateWhen: { none: false, overdue: false, today: false, future: false },
  defaultDate: { kind: 'days', days: 3 },
  defaultTime: '09:00',
};

/** The stored document over the defaults, field by field: malformed keys fall back, nothing throws. */
export function mergeFollowUpSettings(stored: unknown): FollowUpSettingsValues {
  const d = FOLLOW_UP_DEFAULTS;
  const s = obj(stored);
  const when = obj(s.updateWhen);
  const date = followUpDefaultDateSchema.safeParse(s.defaultDate);
  const time = followUpTimeSchema.safeParse(s.defaultTime);
  return {
    updateWhen: {
      none: flag(when.none, d.updateWhen.none),
      overdue: flag(when.overdue, d.updateWhen.overdue),
      today: flag(when.today, d.updateWhen.today),
      future: flag(when.future, d.updateWhen.future),
    },
    defaultDate: date.success ? date.data : d.defaultDate,
    defaultTime: time.success ? time.data : d.defaultTime,
  };
}

export const updateFollowUpSettingsSchema = followUpSettingsSchema.extend({
  rowVersion: z.number().int().positive().optional(),
});
export type UpdateFollowUpSettingsInput = z.infer<typeof updateFollowUpSettingsSchema>;

export type FollowUpSettings = FollowUpSettingsValues & {
  rowVersion: number | null;
  updatedAt: string | null;
};

// --- duplicate leads ----------------------------------------------------------------------------------------------------------

/**
 * What happens to a new lead from a lead source whose phone number or e-mail already belongs to a contact: `merge` (what has always
 * happened: the lead fills the contact's blanks and adds a touch) or `create_new` (a separate contact is made).
 */
export const duplicateSettingsSchema = z.object({
  mode: z.enum(['merge', 'create_new']),
  /** Leave a line on the contact's timeline when a lead is merged into it. */
  noteOnMerge: z.boolean(),
});
export type DuplicateSettingsValues = z.infer<typeof duplicateSettingsSchema>;

/** The defaults are the code's behaviour before this setting existed: merge, and no timeline line. */
export const DUPLICATE_DEFAULTS: DuplicateSettingsValues = { mode: 'merge', noteOnMerge: false };

export function mergeDuplicateSettings(stored: unknown): DuplicateSettingsValues {
  const s = obj(stored);
  return {
    mode: s.mode === 'create_new' || s.mode === 'merge' ? s.mode : DUPLICATE_DEFAULTS.mode,
    noteOnMerge: flag(s.noteOnMerge, DUPLICATE_DEFAULTS.noteOnMerge),
  };
}

export const updateDuplicateSettingsSchema = duplicateSettingsSchema.extend({
  rowVersion: z.number().int().positive().optional(),
});
export type UpdateDuplicateSettingsInput = z.infer<typeof updateDuplicateSettingsSchema>;

export type DuplicateSettings = DuplicateSettingsValues & {
  rowVersion: number | null;
  updatedAt: string | null;
};

/** `GET /lead-handling/settings`: every section, each with its own version. */
export interface LeadHandlingSettings {
  uncontacted: UncontactedSettings;
  followUps: FollowUpSettings;
  duplicates: DuplicateSettings;
}
