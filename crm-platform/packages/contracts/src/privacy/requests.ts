import { z } from 'zod';
import { pageResponseSchema } from '../common/pagination';
import { uuidSchema } from '../common/ids';

/**
 * The data-subject rights service (spec docs/specs/privacy-and-data-governance.md section 4.5, backlog BL-143): a request a person
 * (or their representative) made about the data a workspace holds on them, its identity check, its clock, and the proof of what was
 * done. Everything on this surface is free of the person's data: a subject is shown by a masked label.
 */
export const PRIVACY_REQUEST_TYPES = [
  'access',
  'export',
  'erasure',
  'rectification',
  'restriction',
  'objection',
  'withdrawal',
  'portability',
] as const;
export const privacyRequestTypeSchema = z.enum(PRIVACY_REQUEST_TYPES);
export type PrivacyRequestType = z.infer<typeof privacyRequestTypeSchema>;

/** The types that end in a file for the person: the export runs for these. */
export const PRIVACY_EXPORT_TYPES: readonly PrivacyRequestType[] = [
  'access',
  'export',
  'portability',
];

export const PRIVACY_REQUEST_STATUSES = [
  'received',
  'verifying',
  'in_progress',
  'completed',
  'rejected',
  'expired',
] as const;
export const privacyRequestStatusSchema = z.enum(PRIVACY_REQUEST_STATUSES);
export type PrivacyRequestStatus = z.infer<typeof privacyRequestStatusSchema>;

export const PRIVACY_OPEN_STATUSES: readonly PrivacyRequestStatus[] = [
  'received',
  'verifying',
  'in_progress',
];

export const PRIVACY_REQUESTER_CHANNELS = [
  'email',
  'whatsapp',
  'phone',
  'in_person',
  'portal',
  'staff',
  'other',
] as const;
export const privacyRequesterChannelSchema = z.enum(PRIVACY_REQUESTER_CHANNELS);

export const PRIVACY_VERIFICATION_METHODS = [
  'channel_code',
  'email_link',
  'known_contact',
  'existing_session',
  'id_document_checked',
  'other',
] as const;
export const privacyVerificationMethodSchema = z.enum(PRIVACY_VERIFICATION_METHODS);
export type PrivacyVerificationMethod = z.infer<typeof privacyVerificationMethodSchema>;

/** Default clock when the workspace has not set one (GDPR: one month). */
export const PRIVACY_DEFAULT_SLA_DAYS = 30;
/** A built export stays downloadable this long, then the file is deleted. */
export const PRIVACY_EXPORT_TTL_DAYS = 7;
/** What the person executing an erasure types, followed by the request reference. */
export const PRIVACY_ERASE_PHRASE = 'ERASE';

export const privacySubjectKindSchema = z.enum(['contact', 'lead', 'identifier']);
export type PrivacySubjectKind = z.infer<typeof privacySubjectKindSchema>;

/** How a conversation history is handled when a person is erased: removed, or kept without the person's identity. */
export const privacyHistoryModeSchema = z.enum(['delete', 'anonymise']);
export type PrivacyHistoryMode = z.infer<typeof privacyHistoryModeSchema>;

export const privacySubjectInputSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('contact'), id: uuidSchema }),
  z.object({ kind: z.literal('lead'), id: uuidSchema }),
  z.object({
    kind: z.literal('identifier'),
    identifierKind: z.enum(['phone', 'email']),
    value: z.string().trim().min(3).max(254),
  }),
]);
export type PrivacySubjectInput = z.infer<typeof privacySubjectInputSchema>;

export const createPrivacyRequestSchema = z.object({
  requestType: privacyRequestTypeSchema,
  subject: privacySubjectInputSchema,
  requesterChannel: privacyRequesterChannelSchema.default('staff'),
  internalNote: z.string().trim().max(1000).optional(),
  /** For an erasure: delete the conversations (default) or keep them without the person's identity. */
  historyMode: privacyHistoryModeSchema.default('delete'),
});
export type CreatePrivacyRequestInput = z.infer<typeof createPrivacyRequestSchema>;

export const listPrivacyRequestsQuerySchema = z.object({
  status: privacyRequestStatusSchema.optional(),
  requestType: privacyRequestTypeSchema.optional(),
  /** Open requests past `dueAt`. */
  overdue: z.preprocess((v) => v === 'true' || v === true, z.boolean()).optional(),
  /** Requests waiting on a legal hold ("restricted: legal hold"), BL-295. */
  restricted: z.preprocess((v) => v === 'true' || v === true, z.boolean()).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(512).optional(),
});
export type ListPrivacyRequestsQuery = z.infer<typeof listPrivacyRequestsQuerySchema>;

export const verifyPrivacyRequestSchema = z.object({
  /** `pending`: a check was started (a code sent, a reply awaited); `verified`: passed; `not_verified`: failed, the request is rejected. */
  outcome: z.enum(['pending', 'verified', 'not_verified']),
  method: privacyVerificationMethodSchema.optional(),
  /** A reference id of the evidence (a ticket, a message id): never a document or a personal value. */
  evidenceRef: z.string().trim().min(1).max(120).optional(),
  note: z.string().trim().max(500).optional(),
});
export type VerifyPrivacyRequestInput = z.infer<typeof verifyPrivacyRequestSchema>;

export const holdPrivacyRequestSchema = z.discriminatedUnion('held', [
  z.object({ held: z.literal(true), reason: z.string().trim().min(3).max(500) }),
  z.object({ held: z.literal(false) }),
]);
export type HoldPrivacyRequestInput = z.infer<typeof holdPrivacyRequestSchema>;

export const rejectPrivacyRequestSchema = z.object({
  reason: z.string().trim().min(3).max(500),
});
export type RejectPrivacyRequestInput = z.infer<typeof rejectPrivacyRequestSchema>;

export const erasePrivacyRequestSchema = z.object({
  /** true: count what would go and change nothing. An execution needs a dry run of the same request first. */
  dryRun: z.boolean(),
  /** `ERASE <reference>` typed by the person executing. Required when `dryRun` is false. */
  confirmation: z.string().trim().max(60).optional(),
});
export type ErasePrivacyRequestInput = z.infer<typeof erasePrivacyRequestSchema>;

export const privacyRequestsSettingsSchema = z.object({
  slaDays: z.number().int().min(1).max(90),
  /**
   * The workspace's own wording of the answer to a person whose erasure is held back by a legal hold (counsel's text). null clears it
   * (the default text applies); absent leaves it as it is. At most 1500 characters; it must not name the matter.
   */
  legalHoldRequesterNotice: z.string().trim().max(1500).nullable().optional(),
});
export type PrivacyRequestsSettings = z.infer<typeof privacyRequestsSettingsSchema>;
export const updatePrivacyRequestsSettingsSchema = privacyRequestsSettingsSchema;

export const PRIVACY_DISPOSITIONS = [
  'deleted',
  'anonymised',
  'cascaded',
  'retained',
  'unlinked',
] as const;
export const privacyDispositionSchema = z.enum(PRIVACY_DISPOSITIONS);
export type PrivacyDisposition = z.infer<typeof privacyDispositionSchema>;

/** One line of the dry run / the proof: what happens to one table's rows. No personal value. */
export const privacyErasureLineSchema = z.object({
  holder: z.string(),
  table: z.string(),
  disposition: privacyDispositionSchema,
  count: z.number().int().nonnegative(),
  /** Why the rows are kept or only anonymised (legal hold, statutory retention), when they are. */
  reason: z.string().nullable(),
});
export type PrivacyErasureLine = z.infer<typeof privacyErasureLineSchema>;

export const privacyErasureReportSchema = z.object({
  dryRun: z.boolean(),
  lines: z.array(privacyErasureLineSchema),
  /** Stored files (chat media, contact files, call recordings) queued for deletion. */
  files: z.number().int().nonnegative(),
  totals: z.object({
    deleted: z.number().int().nonnegative(),
    anonymised: z.number().int().nonnegative(),
    retained: z.number().int().nonnegative(),
  }),
  historyMode: privacyHistoryModeSchema,
  at: z.string().datetime(),
});
export type PrivacyErasureReport = z.infer<typeof privacyErasureReportSchema>;

export const privacyProofSchema = z.object({
  requestReference: z.string(),
  requestType: privacyRequestTypeSchema,
  executedAt: z.string().datetime(),
  executedBy: z.string().nullable(),
  historyMode: privacyHistoryModeSchema,
  lines: z.array(privacyErasureLineSchema),
  files: z.number().int().nonnegative(),
  /** The registry the erasure ran with: a change of a holder shows in the digest. */
  registryDigest: z.string(),
  /** Stated limits: what this erasure does not reach (backups, vendors). */
  notes: z.array(z.string()),
  /** True when the erasure waited on a legal hold and was executed after it ended (BL-295). Absent otherwise. */
  resumedAfterHold: z.boolean().optional(),
  sha256: z.string(),
});
export type PrivacyProof = z.infer<typeof privacyProofSchema>;

export const privacyRequestSchema = z.object({
  id: uuidSchema,
  /** Short human reference, e.g. DSR-3F9A12BC. */
  reference: z.string(),
  requestType: privacyRequestTypeSchema,
  status: privacyRequestStatusSchema,
  subjectKind: privacySubjectKindSchema,
  /** The contact / lead id while the person still exists in the workspace; null after an erasure. */
  contactId: uuidSchema.nullable(),
  leadId: uuidSchema.nullable(),
  /** A masked text (initials and the last digits): never the person's data. */
  subjectLabel: z.string(),
  requesterChannel: privacyRequesterChannelSchema,
  internalNote: z.string().nullable(),
  receivedAt: z.string().datetime(),
  dueAt: z.string().datetime(),
  /** Whole days to `dueAt` (negative when late); null when the request is closed. */
  daysLeft: z.number().int().nullable(),
  overdue: z.boolean(),
  verificationMethod: privacyVerificationMethodSchema.nullable(),
  verificationEvidenceRef: z.string().nullable(),
  verifiedAt: z.string().datetime().nullable(),
  legalHold: z.boolean(),
  legalHoldReason: z.string().nullable(),
  /** True while the case waits on a legal hold on the person (BL-295): the data is kept and locked, the erasure is not executed. */
  restricted: z.boolean(),
  restrictedAt: z.string().datetime().nullable(),
  /** The workspace's own wording of the answer to the person, when it set one; null means the default text applies. */
  restrictionNotice: z.string().nullable(),
  historyMode: privacyHistoryModeSchema,
  rejectionReason: z.string().nullable(),
  dryRun: privacyErasureReportSchema.nullable(),
  result: z.record(z.unknown()),
  proof: privacyProofSchema.nullable(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  rowVersion: z.number().int(),
  /** What the caller may do next from here (the screen shows only these). */
  allowed: z.object({
    verify: z.boolean(),
    export: z.boolean(),
    erase: z.boolean(),
    hold: z.boolean(),
    reject: z.boolean(),
  }),
});
export type PrivacyRequest = z.infer<typeof privacyRequestSchema>;

export const privacyRequestListSchema = pageResponseSchema(privacyRequestSchema);
export type PrivacyRequestList = z.infer<typeof privacyRequestListSchema>;

export const privacyRequestEventSchema = z.object({
  id: uuidSchema,
  eventType: z.string(),
  fromStatus: privacyRequestStatusSchema.nullable(),
  toStatus: privacyRequestStatusSchema.nullable(),
  actor: z.string().nullable(),
  detail: z.record(z.unknown()),
  at: z.string().datetime(),
});
export type PrivacyRequestEvent = z.infer<typeof privacyRequestEventSchema>;

export const privacyExportStatusSchema = z.enum([
  'queued',
  'running',
  'ready',
  'failed',
  'expired',
]);
export const privacyExportSchema = z.object({
  id: uuidSchema,
  status: privacyExportStatusSchema,
  fileBytes: z.number().int().nonnegative().nullable(),
  /** Rows per section of the file (module key to count). */
  sections: z.record(z.number().int().nonnegative()),
  error: z.string().nullable(),
  requestedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
});
export type PrivacyExport = z.infer<typeof privacyExportSchema>;

export const privacyRequestDetailSchema = z.object({
  request: privacyRequestSchema,
  events: z.array(privacyRequestEventSchema),
  exports: z.array(privacyExportSchema),
});
export type PrivacyRequestDetail = z.infer<typeof privacyRequestDetailSchema>;

export const privacySubjectSearchQuerySchema = z.object({
  q: z.string().trim().min(2).max(100),
});
export type PrivacySubjectSearchQuery = z.infer<typeof privacySubjectSearchQuerySchema>;

export const privacySubjectHitSchema = z.object({
  kind: z.enum(['contact', 'lead']),
  id: uuidSchema,
  /** The display name as the workspace holds it: the person searching is entitled to see the contact. */
  name: z.string().nullable(),
  /** Masked phone / email. */
  hint: z.string(),
});
export type PrivacySubjectHit = z.infer<typeof privacySubjectHitSchema>;
export const privacySubjectSearchResultSchema = z.object({
  data: z.array(privacySubjectHitSchema),
});
export type PrivacySubjectSearchResult = z.infer<typeof privacySubjectSearchResultSchema>;
