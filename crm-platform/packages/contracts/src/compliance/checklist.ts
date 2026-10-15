import { z } from 'zod';
import { complianceRegimeSchema } from './regimes';

/**
 * The compliance checklist (BL-174): each baseline point and each requirement of a switched-on profile, as built, partial or open,
 * worked out from what the workspace has actually set up. It is a list of tools and settings that help a workspace comply. It never
 * says "compliant", and a row that is built means the tool is in place, not that a law is satisfied.
 */
export const CHECKLIST_STATUSES = ['built', 'partial', 'open'] as const;
export const checklistStatusSchema = z.enum(CHECKLIST_STATUSES);
export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number];

/** The baseline rows, in order. Each is the key of its text under `compliance-center.checklist.items.<id>`. */
export const BASELINE_ITEM_IDS = [
  'lawful_basis',
  'consent_withdrawal',
  'notices',
  'rights',
  'retention',
  'security',
  'subprocessors',
  'children',
  'contact_links',
] as const;
export type BaselineItemId = (typeof BASELINE_ITEM_IDS)[number];

/** The rows a profile adds. Same text keys as the requirement ids, plus the enforcement note for quiet hours and windows. */
export const PROFILE_ITEM_IDS = [
  'dpo_contact',
  'grievance_officer',
  'notice_languages',
  'parental_flag',
  'opt_out_notice',
  'quiet_hours',
  'calling_window',
  'dnd_registry',
  'subprocessor_locations',
  'request_days',
  'marketing_opt_in',
  'windows_enforcement',
] as const;
export type ProfileItemId = (typeof PROFILE_ITEM_IDS)[number];

/**
 * Every explanation a row can carry, by row id: `checklist.items.<id>.detail.<key>` in the locale text. A row's `detail` is always one of
 * these (the API test walks the rules to prove it, the web test proves each has text in every language).
 */
export const CHECKLIST_DETAIL_KEYS: Readonly<Record<string, readonly string[]>> = {
  lawful_basis: ['built'],
  consent_withdrawal: ['detectionOff', 'optInOff', 'built'],
  notices: ['built', 'noDefault', 'none'],
  rights: ['overdue', 'noContact', 'built'],
  retention: ['recordingsOn', 'recordingsOff'],
  security: ['runbook'],
  subprocessors: ['built', 'none'],
  children: ['unset', 'minorsNoParental', 'no_minors', 'may_include_minors'],
  contact_links: ['built', 'none', 'some'],
  dpo_contact: ['built', 'one', 'none'],
  grievance_officer: ['built', 'one', 'none'],
  notice_languages: ['built', 'noSecond', 'secondMissing', 'englishMissing', 'none'],
  parental_flag: ['unset', 'minorsNoParental', 'no_minors', 'may_include_minors'],
  opt_out_notice: ['built', 'noUrl', 'off'],
  quiet_hours: ['built', 'off'],
  calling_window: ['built', 'off'],
  dnd_registry: ['off', 'hookOnly'],
  subprocessor_locations: ['built', 'some', 'none'],
  request_days: ['built', 'tooLong'],
  marketing_opt_in: ['built', 'off'],
  windows_enforcement: ['notEnforced'],
};

export const checklistItemSchema = z.object({
  id: z.string(),
  scope: z.enum(['baseline', 'profile']),
  /** The profiles that ask for the row (empty for the baseline). */
  regimes: z.array(complianceRegimeSchema),
  status: checklistStatusSchema,
  /**
   * Which sentence explains the status: a key under `checklist.items.<id>.detail.<detail>`. Values the sentence needs are in `params`
   * (counts, days, never a person's data).
   */
  detail: z.string(),
  params: z.record(z.union([z.string(), z.number()])),
  /** Where in the app the person can act (a path), or null. */
  href: z.string().nullable(),
});
export type ChecklistItem = z.infer<typeof checklistItemSchema>;

export const complianceChecklistSchema = z.object({
  generatedAt: z.string(),
  regimes: z.array(complianceRegimeSchema),
  items: z.array(checklistItemSchema),
  summary: z.object({ built: z.number().int(), partial: z.number().int(), open: z.number().int() }),
});
export type ComplianceChecklist = z.infer<typeof complianceChecklistSchema>;
