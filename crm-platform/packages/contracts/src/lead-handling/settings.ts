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

/** `GET /lead-handling/settings`: every section, each with its own version. */
export interface LeadHandlingSettings {
  uncontacted: UncontactedSettings;
}
