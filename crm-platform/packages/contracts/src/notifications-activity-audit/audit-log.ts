import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { cursorSchema, pageInfoSchema } from '../common/pagination';
import { queryBoolean } from '../contacts-attributes-tags/query-helpers';

/**
 * The tenant-facing audit log (TW-NOTIF-029 to 031 and TW-NOTIF-035; Reference: Activity Log). A read-only view of `audit_log`: who
 * changed what, when, from what to what, scoped to the caller's workspace by RLS. Read with `audit.log.read`, exported with
 * `audit.log.export`. Spec: docs/specs/audit-log-tenant.md.
 */

/** Keys the screen filters on. Owner and Admin hold them by default; Manager does not. */
export const AUDIT_LOG_PERMISSIONS = {
  read: 'audit.log.read',
  export: 'audit.log.export',
} as const;

/** The module the `audit_log` rows written by this feature use (reading the log is itself audited). */
export const AUDIT_LOG_MODULE = 'audit-log';
export const AUDIT_LOG_EXPORT_MODULE = 'audit-log-exports';

/** Longest window one list or export request may cover, in days (a partition-pruned `at` range is always applied). */
export const AUDIT_LOG_MAX_RANGE_DAYS = 400;
export const AUDIT_LOG_DEFAULT_RANGE_DAYS = 30;

export const AUDIT_LOG_EXPORT_TTL_DAYS = 7;
/** An export is stopped past this many rows (the file is held in memory while it is built). */
export const AUDIT_LOG_EXPORT_MAX_ROWS = 1_000_000;

export const AUDIT_ACTOR_KINDS = [
  'user',
  'system',
  'api_key',
  'bot',
  'partner_agent',
  'candidate',
  'other',
] as const;
export const auditActorKindSchema = z.enum(AUDIT_ACTOR_KINDS);
export type AuditActorKind = z.infer<typeof auditActorKindSchema>;

export const auditActorSchema = z.object({
  kind: auditActorKindSchema,
  /** The person's uuid when `kind` is `user` and the user still exists. */
  id: uuidSchema.nullable(),
  /** The person's name, the API key's name, or null (shown as System / API key by the screen). */
  name: z.string().nullable(),
});
export type AuditActor = z.infer<typeof auditActorSchema>;

/** Present when a platform operator was acting as a workspace user (support session): the tenant is told, with the reason. */
export const auditActAsSchema = z.object({
  /** The reason the operator gave when starting the session. Null if the session row is gone. */
  reason: z.string().nullable(),
  readOnly: z.boolean().nullable(),
  startedAt: z.string().datetime().nullable(),
});
export type AuditActAs = z.infer<typeof auditActAsSchema>;

export const auditRecordLinkSchema = z.object({
  /** An app path (`/contacts/<uuid>`) when the record type has a screen and the record still exists, else null. */
  href: z.string().nullable(),
});

export const auditLogEntrySchema = z.object({
  /** Opaque. Pass it to `GET /v2/audit-log/:id`. */
  id: z.string().min(1),
  at: z.string().datetime(),
  actor: auditActorSchema,
  module: z.string(),
  action: z.string(),
  /** The audited record's number as stored (a string: it is not a uuid and the screen only prints and filters on it). */
  recordId: z.string(),
  record: auditRecordLinkSchema,
  requestId: z.string().nullable(),
  actAs: auditActAsSchema.nullable(),
  /** Names of the fields that changed (never values: values only come from the detail, masked). */
  changedFields: z.array(z.string()),
});
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

export const auditDeltaValueSchema = z.object({
  old: z.unknown().optional(),
  new: z.unknown().optional(),
  /** True when this field's values were masked (personal data) or redacted (secret). */
  masked: z.boolean(),
});
export type AuditDeltaValue = z.infer<typeof auditDeltaValueSchema>;

export const auditLogDetailSchema = auditLogEntrySchema.extend({
  /** Field by field, old to new, after the PII-safe renderer. Empty when the row carries no field changes. */
  delta: z.record(auditDeltaValueSchema),
  /** True when the viewer may see personal values unmasked (secrets are never shown). */
  canReveal: z.boolean(),
});
export type AuditLogDetail = z.infer<typeof auditLogDetailSchema>;

export const auditLogFiltersSchema = z.object({
  /** Inclusive start / exclusive end of the window. Default: the last AUDIT_LOG_DEFAULT_RANGE_DAYS days. */
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  actorId: uuidSchema.optional(),
  actorType: auditActorKindSchema.optional(),
  module: z.string().min(1).max(120).optional(),
  action: z.string().min(1).max(120).optional(),
  recordId: z.coerce.number().int().positive().optional(),
  requestId: z.string().min(1).max(200).optional(),
  /** Matches the module and the action only (substring). Never the changed values. */
  q: z.string().trim().min(1).max(100).optional(),
  /** Only the rows written while platform support was acting as a user. */
  actAs: queryBoolean().optional(),
});
export type AuditLogFilters = z.infer<typeof auditLogFiltersSchema>;

export const auditLogQuerySchema = auditLogFiltersSchema.extend({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: cursorSchema.optional(),
});
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export const auditLogListResponseSchema = z.object({
  data: z.array(auditLogEntrySchema),
  page: pageInfoSchema,
  /** The window the rows were read from (after defaults and clamping). */
  range: z.object({ from: z.string().datetime(), to: z.string().datetime() }),
});
export type AuditLogListResponse = z.infer<typeof auditLogListResponseSchema>;

export const auditLogFacetsQuerySchema = z.object({
  from: auditLogFiltersSchema.shape.from,
  to: auditLogFiltersSchema.shape.to,
});
export type AuditLogFacetsQuery = z.infer<typeof auditLogFacetsQuerySchema>;

export const auditLogFacetsSchema = z.object({
  modules: z.array(z.string()),
  actions: z.array(z.string()),
  /** People who wrote entries in the window (for the Actor filter), by name. */
  actors: z.array(z.object({ id: uuidSchema, name: z.string() })),
});
export type AuditLogFacets = z.infer<typeof auditLogFacetsSchema>;

/** The facts the screen shows around the table (retention note, what the viewer may do). */
export const auditLogSettingsSchema = z.object({
  /** Days an entry is kept; 0 means forever. Null when the policy cannot be read. */
  retentionDays: z.number().int().min(0).nullable(),
  canExport: z.boolean(),
  canReveal: z.boolean(),
});
export type AuditLogSettings = z.infer<typeof auditLogSettingsSchema>;

// --- Export -------------------------------------------------------------------------------------------------------------------

export const auditLogExportStatusSchema = z.enum([
  'queued',
  'running',
  'ready',
  'failed',
  'expired',
]);
export type AuditLogExportStatus = z.infer<typeof auditLogExportStatusSchema>;

export const auditLogExportSchema = z.object({
  id: uuidSchema,
  status: auditLogExportStatusSchema,
  rowCount: z.number().int().nonnegative().nullable(),
  fileBytes: z.number().int().nonnegative().nullable(),
  error: z.string().nullable(),
  requestedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  emailedTo: z.string().nullable(),
  /** The window and filters the file was built with. */
  filters: auditLogFiltersSchema,
});
export type AuditLogExport = z.infer<typeof auditLogExportSchema>;

export const auditLogExportListSchema = z.object({ data: z.array(auditLogExportSchema) });
export type AuditLogExportList = z.infer<typeof auditLogExportListSchema>;

/** `POST /v2/audit-log/exports`: the current filters of the screen (no cursor, no limit). */
export const requestAuditLogExportSchema = auditLogFiltersSchema;
export type RequestAuditLogExport = z.infer<typeof requestAuditLogExportSchema>;

export const AUDIT_LOG_ERROR_CODES = {
  /** No such audit entry in this workspace (or its id is not valid). 404. */
  AUDIT_ENTRY_NOT_FOUND: 'AUDIT_ENTRY_NOT_FOUND',
  /** The window is longer than AUDIT_LOG_MAX_RANGE_DAYS or `to` is not after `from`. 422. */
  AUDIT_RANGE_INVALID: 'AUDIT_RANGE_INVALID',
  /** An export of the audit log is already being prepared for this workspace. 409. */
  AUDIT_EXPORT_IN_PROGRESS: 'AUDIT_EXPORT_IN_PROGRESS',
  AUDIT_EXPORT_NOT_FOUND: 'AUDIT_EXPORT_NOT_FOUND',
  /** The export is not ready (still building, failed) or its file has expired. 409. */
  AUDIT_EXPORT_NOT_READY: 'AUDIT_EXPORT_NOT_READY',
} as const;
