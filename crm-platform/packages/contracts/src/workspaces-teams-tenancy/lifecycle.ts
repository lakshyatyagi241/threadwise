import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { paginationQuerySchema } from '../common/pagination';

/**
 * Workspace inactivity lifecycle: the operator's Workspaces hub, retention controls.
 * Behaviour is specified in ADR-0028.
 */

/** Platform defaults. A per-org override replaces either number. */
export const DEFAULT_ARCHIVE_AFTER_DAYS = 90;
export const DEFAULT_DELETE_AFTER_DAYS = 180;

/** Days BEFORE each destructive step at which reminders 1, 2 and 3 are sent. */
export const ARCHIVE_REMINDER_LEAD_DAYS = [30, 15, 5] as const;
export const DELETE_REMINDER_LEAD_DAYS = [30, 15, 7] as const;

/** Final delete warning must precede deletion by at least this long. */
export const MIN_FINAL_NOTICE_DAYS = 7;

export const lifecycleStatusSchema = z.enum(['active', 'archived', 'suspended', 'deleted']);
export type LifecycleStatus = z.infer<typeof lifecycleStatusSchema>;

export const orgLifecycleStageSchema = z.enum(['archive', 'delete']);

export const orgLifecycleResponseSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  slug: z.string(),
  status: lifecycleStatusSchema,
  lastActivityAt: z.string().datetime(),
  daysInactive: z.number().int(),
  archivedAt: z.string().datetime().nullable(),
  /** Effective values after applying the per-org override. */
  archiveAfterDays: z.number().int(),
  deleteAfterDays: z.number().int(),
  archiveOverride: z.number().int().nullable(),
  deleteOverride: z.number().int().nullable(),
  /** When the next destructive step is due; null if exempt/held. */
  scheduledArchiveAt: z.string().datetime().nullable(),
  scheduledDeleteAt: z.string().datetime().nullable(),
  retentionExempt: z.boolean(),
  retentionExemptReason: z.string().nullable(),
  retentionExemptUntil: z.string().datetime().nullable(),
  retentionExemptBy: z.string().nullable(),
  legalHold: z.boolean(),
  /** On an active paid plan, a custom quote, or platform-owned: never idle-archived, whatever the timings say. */
  exemptByPlan: z.boolean(),
  remindersSent: z.object({ archive: z.number().int(), delete: z.number().int() }),
});
export type OrgLifecycleResponse = z.infer<typeof orgLifecycleResponseSchema>;

export const listOrgLifecycleQuerySchema = paginationQuerySchema.extend({
  status: lifecycleStatusSchema.optional(),
  /** Only orgs idle at least this many days. */
  minDaysInactive: z.coerce.number().int().min(0).optional(),
  exempt: z.enum(['true', 'false']).optional(),
});
export type ListOrgLifecycleQuery = z.infer<typeof listOrgLifecycleQuerySchema>;

/** Change timings. null clears an override back to the platform default. */
export const updateOrgRetentionPolicySchema = z
  .object({
    archiveAfterDays: z.number().int().min(60).max(3650).nullable().optional(),
    deleteAfterDays: z.number().int().min(120).max(7300).nullable().optional(),
    reason: z.string().trim().min(5).max(500),
  })
  .refine((v) => v.archiveAfterDays !== undefined || v.deleteAfterDays !== undefined, {
    message: 'provide archiveAfterDays and/or deleteAfterDays',
  });
export type UpdateOrgRetentionPolicyInput = z.infer<typeof updateOrgRetentionPolicySchema>;

/** "Never delete" switch. */
export const setOrgRetentionExemptSchema = z.discriminatedUnion('exempt', [
  z.object({
    exempt: z.literal(true),
    reason: z.string().trim().min(5).max(500),
    /** Optional expiry so the exemption is re-reviewed. Omit for indefinite. */
    until: z.string().datetime().optional(),
  }),
  z.object({
    exempt: z.literal(false),
    reason: z.string().trim().min(5).max(500),
  }),
]);
export type SetOrgRetentionExemptInput = z.infer<typeof setOrgRetentionExemptSchema>;

export const setOrgLegalHoldSchema = z.object({
  legalHold: z.boolean(),
  reason: z.string().trim().min(5).max(500),
});
export type SetOrgLegalHoldInput = z.infer<typeof setOrgLegalHoldSchema>;

export const restoreOrgSchema = z.object({ reason: z.string().trim().min(5).max(500) });
export type RestoreOrgInput = z.infer<typeof restoreOrgSchema>;

export const orgLifecycleLogEntrySchema = z.object({
  eventType: z.string(),
  stage: orgLifecycleStageSchema.nullable(),
  reminderNo: z.number().int().nullable(),
  daysInactive: z.number().int().nullable(),
  actorType: z.string(),
  actorRef: z.string().nullable(),
  details: z.record(z.unknown()),
  createdAt: z.string().datetime(),
});
export type OrgLifecycleLogEntry = z.infer<typeof orgLifecycleLogEntrySchema>;
