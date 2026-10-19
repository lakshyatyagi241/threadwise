/**
 * data-retention (platform): how long each kind of data stays live in the database, and how long it then stays in the cold archive.
 * The super admin edits these per data item in the operator console. Everything here crosses the network boundary or is shared by the
 * API and the console, so the limits live in one place.
 *
 * Two numbers per item:
 *   liveDays    how long the data stays in the database. Partitioned streams are cut by whole months: a month leaves once its last
 *               day is more than `liveDays` ago.
 *   archiveDays how many further days the cold archive keeps it before it is deleted for good. `null` keeps it forever. Items that
 *               cannot be archived (`canArchive: false`) are deleted when the live window ends and always carry `null`.
 * The data is deleted `liveDays + archiveDays` days after it was written, so deletion can never come before archiving.
 */
import { z } from 'zod';

export const RETENTION_ITEM_IDS = [
  'an_events',
  'audit_log',
  'security_events',
  'audit_log_exports',
  'message_log',
  'notifications_read',
  'notifications_unread',
  'push_devices_revoked',
  'faq_match_log',
  'assignment_runs',
  'form_events',
  'lead_sync_runs',
  'lead_scoring_runs',
  'api_library_logs',
  'flow_run_logs',
  'webhook_forward_failures',
  'click_calls',
  'call_recordings',
] as const;
export const retentionItemIdSchema = z.enum(RETENTION_ITEM_IDS);
export type RetentionItemId = z.infer<typeof retentionItemIdSchema>;

/**
 * partitioned     monthly partitions, exported to the archive (S3 / R2) and dropped (the data-retention worker)
 * daily_archive    rows moved day by day into the database's own archive table, deleted from there when the archive window ends
 * table            one ordinary table, old rows deleted
 * file             generated files, deleted when they expire
 */
export type RetentionKind = 'partitioned' | 'daily_archive' | 'table' | 'file';

/** Where an item shows on the page. The order here is the order on screen. */
export const RETENTION_GROUPS = [
  'analytics',
  'security',
  'messaging',
  'crm',
  'automation',
  'calling',
] as const;
export type RetentionGroup = (typeof RETENTION_GROUPS)[number];

export interface RetentionItemSpec {
  id: RetentionItemId;
  kind: RetentionKind;
  group: RetentionGroup;
  /** Whether old data can be moved to the cold archive (and read back) instead of only deleted. */
  canArchive: boolean;
  /** What happens with no saved policy. Saving nothing changes nothing. */
  defaults: { liveDays: number; archiveDays: number | null };
  live: { min: number; max: number };
  /** Allowed range of `archiveDays` when it is not null. */
  archive: { min: number; max: number };
}

/**
 * The data items an admin can set. `defaults` are today's behaviour: the analytics events keep 60 days live and the archive for ever;
 * the audit log and the security log follow the platform security policy (365 days) and are deleted, never archived; an audit export
 * file lives 7 days. A default stays in force until the admin saves explicit values for the item.
 */
export const RETENTION_ITEMS: readonly RetentionItemSpec[] = [
  {
    id: 'an_events',
    group: 'analytics',
    kind: 'partitioned',
    canArchive: true,
    defaults: { liveDays: 60, archiveDays: null },
    // A closed month is never dropped before it is 7 days old (drop_closed_partition), so a shorter window would only be a promise.
    live: { min: 7, max: 730 },
    archive: { min: 1, max: 3650 },
  },
  {
    id: 'audit_log',
    group: 'security',
    kind: 'partitioned',
    canArchive: true,
    defaults: { liveDays: 365, archiveDays: null },
    live: { min: 7, max: 3650 },
    archive: { min: 1, max: 3650 },
  },
  {
    id: 'security_events',
    group: 'security',
    kind: 'table',
    canArchive: false,
    defaults: { liveDays: 365, archiveDays: null },
    // The record of who changed a retention policy is itself a security event; it must outlive a month of mistakes.
    live: { min: 30, max: 3650 },
    archive: { min: 1, max: 1 },
  },
  {
    id: 'audit_log_exports',
    group: 'security',
    kind: 'file',
    canArchive: false,
    defaults: { liveDays: 7, archiveDays: null },
    live: { min: 1, max: 30 },
    archive: { min: 1, max: 1 },
  },
  {
    // Today the live part is 90 days and the archive keeps a total of 365 days after the event, so the archive part is 275.
    id: 'message_log',
    group: 'messaging',
    kind: 'daily_archive',
    canArchive: true,
    defaults: { liveDays: 90, archiveDays: 275 },
    live: { min: 7, max: 730 },
    archive: { min: 1, max: 3650 },
  },
  {
    id: 'notifications_read',
    group: 'messaging',
    kind: 'table',
    canArchive: false,
    defaults: { liveDays: 90, archiveDays: null },
    live: { min: 30, max: 3650 },
    archive: { min: 1, max: 1 },
  },
  {
    // Never below the read days (see `retentionCrossProblem`): an unread row cannot go before a read one.
    id: 'notifications_unread',
    group: 'messaging',
    kind: 'table',
    canArchive: false,
    defaults: { liveDays: 180, archiveDays: null },
    live: { min: 30, max: 3650 },
    archive: { min: 1, max: 1 },
  },
  {
    id: 'push_devices_revoked',
    group: 'messaging',
    kind: 'table',
    canArchive: false,
    defaults: { liveDays: 30, archiveDays: null },
    live: { min: 1, max: 365 },
    archive: { min: 1, max: 1 },
  },
  {
    id: 'faq_match_log',
    group: 'messaging',
    kind: 'table',
    canArchive: false,
    defaults: { liveDays: 90, archiveDays: null },
    live: { min: 7, max: 730 },
    archive: { min: 1, max: 1 },
  },
  {
    id: 'assignment_runs',
    group: 'crm',
    kind: 'table',
    canArchive: false,
    defaults: { liveDays: 90, archiveDays: null },
    live: { min: 7, max: 730 },
    archive: { min: 1, max: 1 },
  },
  {
    id: 'form_events',
    group: 'crm',
    kind: 'table',
    canArchive: false,
    defaults: { liveDays: 90, archiveDays: null },
    live: { min: 7, max: 730 },
    archive: { min: 1, max: 1 },
  },
  {
    id: 'lead_sync_runs',
    group: 'crm',
    kind: 'table',
    canArchive: false,
    defaults: { liveDays: 90, archiveDays: null },
    live: { min: 7, max: 730 },
    archive: { min: 1, max: 1 },
  },
  {
    // The default follows the AI lead scoring settings (90 when never saved); a value saved here replaces it.
    id: 'lead_scoring_runs',
    group: 'crm',
    kind: 'table',
    canArchive: false,
    defaults: { liveDays: 90, archiveDays: null },
    live: { min: 7, max: 730 },
    archive: { min: 1, max: 1 },
  },
  {
    id: 'api_library_logs',
    group: 'automation',
    kind: 'table',
    canArchive: false,
    defaults: { liveDays: 30, archiveDays: null },
    live: { min: 1, max: 365 },
    archive: { min: 1, max: 1 },
  },
  {
    id: 'flow_run_logs',
    group: 'automation',
    kind: 'table',
    canArchive: false,
    defaults: { liveDays: 30, archiveDays: null },
    live: { min: 1, max: 365 },
    archive: { min: 1, max: 1 },
  },
  {
    id: 'webhook_forward_failures',
    group: 'automation',
    kind: 'table',
    canArchive: false,
    defaults: { liveDays: 14, archiveDays: null },
    live: { min: 1, max: 90 },
    archive: { min: 1, max: 1 },
  },
  {
    id: 'click_calls',
    group: 'calling',
    kind: 'table',
    canArchive: false,
    defaults: { liveDays: 2, archiveDays: null },
    live: { min: 1, max: 30 },
    archive: { min: 1, max: 1 },
  },
  {
    // Recording files. The default for workspaces that never set their own window; a workspace's own window still wins for it.
    id: 'call_recordings',
    group: 'calling',
    kind: 'file',
    canArchive: false,
    defaults: { liveDays: 90, archiveDays: null },
    live: { min: 7, max: 365 },
    archive: { min: 1, max: 1 },
  },
];

export const retentionSpecOf = (id: RetentionItemId): RetentionItemSpec =>
  RETENTION_ITEMS.find((i) => i.id === id)!;

export const retentionValuesSchema = z.object({
  liveDays: z.number().int(),
  archiveDays: z.number().int().nullable(),
});
export type RetentionValues = z.infer<typeof retentionValuesSchema>;

export type RetentionProblem =
  'live_out_of_range' | 'archive_out_of_range' | 'archive_not_supported' | 'delete_before_archive';

/**
 * The rules every save passes, in the API and in the form. Returns the first broken rule, or null.
 * `delete_before_archive` cannot happen through the form (the total is live + archive), it guards a caller that sends a total.
 */
export function retentionProblem(
  id: RetentionItemId,
  values: RetentionValues,
): RetentionProblem | null {
  const spec = retentionSpecOf(id);
  const { liveDays, archiveDays } = values;
  if (!Number.isInteger(liveDays) || liveDays < spec.live.min || liveDays > spec.live.max) {
    return 'live_out_of_range';
  }
  if (archiveDays === null) return null;
  if (!spec.canArchive) return 'archive_not_supported';
  if (
    !Number.isInteger(archiveDays) ||
    archiveDays < spec.archive.min ||
    archiveDays > spec.archive.max
  ) {
    return 'archive_out_of_range';
  }
  if (liveDays + archiveDays <= liveDays) return 'delete_before_archive';
  return null;
}

/**
 * Rules between two items. A row nobody opened may not be deleted before one that was read: `notifications_unread` is never shorter than
 * `notifications_read`. `other` is the other item's value after this save (its saved value, or its default). Null when fine.
 */
export function retentionCrossProblem(
  id: RetentionItemId,
  values: RetentionValues,
  other: { notificationsRead: number; notificationsUnread: number },
): 'unread_before_read' | null {
  if (id === 'notifications_unread' && values.liveDays < other.notificationsRead) {
    return 'unread_before_read';
  }
  if (id === 'notifications_read' && values.liveDays > other.notificationsUnread) {
    return 'unread_before_read';
  }
  return null;
}

/** Days after writing that the data is deleted for good; `null` when the archive keeps it for ever. */
export const retentionDeleteAfterDays = (v: RetentionValues): number | null =>
  v.archiveDays === null ? null : v.liveDays + v.archiveDays;

export const retentionSaveRequestSchema = z
  .object({
    liveDays: z.number().int(),
    archiveDays: z.number().int().nullable(),
    /** The `rowVersion` read with the item; `null` when the item still has no saved policy. */
    rowVersion: z.number().int().min(1).nullable(),
  })
  .strict();
export type RetentionSaveRequest = z.infer<typeof retentionSaveRequestSchema>;

export const retentionPreviewRequestSchema = z
  .object({ liveDays: z.number().int(), archiveDays: z.number().int().nullable() })
  .strict();
export type RetentionPreviewRequest = z.infer<typeof retentionPreviewRequestSchema>;

export const retentionRunSchema = z.object({
  at: z.string(),
  /** `dry_run`: the run only logged what it would do. */
  mode: z.enum(['live', 'dry_run']),
  outcome: z.enum(['ok', 'partial', 'failed']),
  /** Whole months moved to the archive and dropped from the database. */
  archivedMonths: z.number().int(),
  archivedRows: z.number(),
  archivedBytes: z.number(),
  /** Archive months, rows or files deleted because their archive window ended. */
  expiredItems: z.number(),
  deletedRows: z.number(),
  error: z.string().nullable(),
});
export type RetentionRun = z.infer<typeof retentionRunSchema>;

export const retentionItemViewSchema = z.object({
  id: retentionItemIdSchema,
  kind: z.enum(['partitioned', 'daily_archive', 'table', 'file']),
  group: z.enum(RETENTION_GROUPS),
  canArchive: z.boolean(),
  source: z.enum(['default', 'custom']),
  liveDays: z.number().int(),
  archiveDays: z.number().int().nullable(),
  deleteAfterDays: z.number().int().nullable(),
  defaults: retentionValuesSchema,
  limits: z.object({
    live: z.object({ min: z.number(), max: z.number() }),
    archive: z.object({ min: z.number(), max: z.number() }),
  }),
  /** Null until the first save; send it back with the next save. */
  rowVersion: z.number().int().nullable(),
  updatedAt: z.string().nullable(),
  /** Whether the saved values are being applied now (false while the archive engine is off or only logging). */
  applied: z.boolean(),
  live: z.object({
    bytes: z.number(),
    /** Estimated, from the catalog: no table scan. Null before the first ANALYZE. */
    rows: z.number().nullable(),
    partitions: z.number().int().nullable(),
    oldestMonth: z.string().nullable(),
  }),
  archive: z.object({ objects: z.number(), bytes: z.number(), measuredAt: z.string() }).nullable(),
  lastRun: retentionRunSchema.nullable(),
});
export type RetentionItemView = z.infer<typeof retentionItemViewSchema>;

export const retentionOverviewSchema = z.object({
  engine: z.object({
    /** RETENTION_ENABLED: the nightly archive job runs at all. */
    enabled: z.boolean(),
    /** RETENTION_DRY_RUN: it only logs what it would do. */
    dryRun: z.boolean(),
    archiveDriver: z.enum(['local', 's3']),
    /** False when the archive is the container's own disk in production: the job refuses to drop anything. */
    archiveDurable: z.boolean(),
  }),
  items: z.array(retentionItemViewSchema),
});
export type RetentionOverview = z.infer<typeof retentionOverviewSchema>;

export const retentionPreviewSchema = z.object({
  id: retentionItemIdSchema,
  /** Months that would move to the archive and leave the database at the next run. */
  toArchive: z.array(
    z.object({ month: z.string(), estimatedRows: z.number().nullable(), bytes: z.number() }),
  ),
  /** Archive months that would be deleted for good. */
  toDeleteFromArchive: z.array(z.string()),
  /** Rows (tables, daily archive) or files that would be deleted for good. */
  rowsToDelete: z.number().nullable(),
  /** Daily-archive items only: live rows that would move into the archive at the next run. */
  rowsToArchive: z.number().nullable().optional(),
});
export type RetentionPreview = z.infer<typeof retentionPreviewSchema>;

/** Security-event names written to the platform log when a policy changes. */
export const RETENTION_AUDIT_EVENTS = {
  updated: 'platform.data_retention.policy_updated',
  reset: 'platform.data_retention.policy_reset',
} as const;
