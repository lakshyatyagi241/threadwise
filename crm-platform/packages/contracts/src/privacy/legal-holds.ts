import { z } from 'zod';
import { pageResponseSchema } from '../common/pagination';
import { uuidSchema } from '../common/ids';

/**
 * Legal hold (BL-295, docs/specs/legal-hold.md): a person asks for erasure, but the business must keep the data for a legal obligation, a
 * dispute, a regulator's request or an investigation. A hold freezes erasure and every purge for a contact, a lead or a whole workspace;
 * the data is kept and locked (restricted), and a rights case for the person is "restricted: legal hold" until the hold ends.
 *
 * A subject is shown by a masked label. The note is PII-light by rule: the screen tells the person writing it not to put names, numbers
 * or details of the matter in it.
 */
export const LEGAL_HOLD_SCOPES = ['contact', 'lead', 'workspace'] as const;
export const legalHoldScopeSchema = z.enum(LEGAL_HOLD_SCOPES);
export type LegalHoldScope = z.infer<typeof legalHoldScopeSchema>;

/** Why the data is kept. The first two are the grounds of GDPR Art. 17(3)(b) and (e); the others are DPDP s.8(7) and s.17 style grounds. */
export const LEGAL_HOLD_REASON_CATEGORIES = [
  'legal_obligation',
  'legal_claim',
  'regulator_request',
  'internal_investigation',
] as const;
export const legalHoldReasonCategorySchema = z.enum(LEGAL_HOLD_REASON_CATEGORIES);
export type LegalHoldReasonCategory = z.infer<typeof legalHoldReasonCategorySchema>;

export const LEGAL_HOLD_STATUSES = ['active', 'released', 'expired'] as const;
export const legalHoldStatusSchema = z.enum(LEGAL_HOLD_STATUSES);
export type LegalHoldStatus = z.infer<typeof legalHoldStatusSchema>;

export const LEGAL_HOLD_CASE_REF_MAX = 120;
export const LEGAL_HOLD_NOTE_MAX = 500;
/** The workspace's own wording of the answer to the person (counsel's text) is at most this long. */
export const LEGAL_HOLD_NOTICE_MAX = 1500;

const caseRefSchema = z.string().trim().min(1).max(LEGAL_HOLD_CASE_REF_MAX);
const noteSchema = z.string().trim().max(LEGAL_HOLD_NOTE_MAX);
const instantSchema = z.string().datetime({ offset: true });

export const placeLegalHoldSchema = z
  .object({
    scope: legalHoldScopeSchema,
    /** The contact or lead uuid. Absent for a `workspace` hold. */
    subjectId: uuidSchema.optional(),
    reasonCategory: legalHoldReasonCategorySchema,
    caseRef: caseRefSchema,
    note: noteSchema.optional(),
    /** By when the hold must be looked at again. */
    reviewAt: instantSchema.optional(),
    /** After this the hold ends by itself, as if released. */
    expiresAt: instantSchema.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.scope === 'workspace' && v.subjectId !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['subjectId'],
        message: 'A workspace hold names no person.',
      });
    }
    if (v.scope !== 'workspace' && v.subjectId === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['subjectId'],
        message: 'Say which contact or lead.',
      });
    }
  });
export type PlaceLegalHoldInput = z.infer<typeof placeLegalHoldSchema>;

export const extendLegalHoldSchema = z
  .object({
    /** null clears the review date. */
    reviewAt: instantSchema.nullable().optional(),
    /** null removes the end date (the hold lasts until someone releases it). */
    expiresAt: instantSchema.nullable().optional(),
    /** A further matter on the same person: appended to the case reference, separated by `; `. */
    addCaseRef: caseRefSchema.optional(),
    note: noteSchema.nullable().optional(),
  })
  .refine(
    (v) =>
      v.reviewAt !== undefined ||
      v.expiresAt !== undefined ||
      v.addCaseRef !== undefined ||
      v.note !== undefined,
    { message: 'Change at least one thing.' },
  );
export type ExtendLegalHoldInput = z.infer<typeof extendLegalHoldSchema>;

export const reviewLegalHoldSchema = z.object({
  nextReviewAt: instantSchema.nullable().optional(),
  note: noteSchema.optional(),
});
export type ReviewLegalHoldInput = z.infer<typeof reviewLegalHoldSchema>;

export const releaseLegalHoldSchema = z.object({
  reason: noteSchema.optional(),
});
export type ReleaseLegalHoldInput = z.infer<typeof releaseLegalHoldSchema>;

const booleanQuery = z.preprocess((v) => v === 'true' || v === true, z.boolean());

export const listLegalHoldsQuerySchema = z.object({
  status: legalHoldStatusSchema.optional(),
  reasonCategory: legalHoldReasonCategorySchema.optional(),
  scope: legalHoldScopeSchema.optional(),
  /** Active holds whose review date has passed. */
  reviewDue: booleanQuery.optional(),
  /** Part of the case reference. */
  q: z.string().trim().min(1).max(LEGAL_HOLD_CASE_REF_MAX).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).max(512).optional(),
});
export type ListLegalHoldsQuery = z.infer<typeof listLegalHoldsQuerySchema>;

export const legalHoldSubjectLookupSchema = z.object({
  kind: z.enum(['contact', 'lead']),
  id: uuidSchema,
});
export type LegalHoldSubjectLookup = z.infer<typeof legalHoldSubjectLookupSchema>;

export const legalHoldSchema = z.object({
  id: uuidSchema,
  scope: legalHoldScopeSchema,
  /** The contact / lead uuid while the person exists; null for a workspace hold and after the person was erased. */
  subjectId: uuidSchema.nullable(),
  /** A masked text: never the person's name, number or address. */
  subjectLabel: z.string(),
  reasonCategory: legalHoldReasonCategorySchema,
  caseRef: z.string(),
  note: z.string().nullable(),
  reviewAt: z.string().datetime().nullable(),
  /** Active and past its review date. */
  reviewDue: z.boolean(),
  expiresAt: z.string().datetime().nullable(),
  status: legalHoldStatusSchema,
  placedBy: z.string().nullable(),
  placedAt: z.string().datetime(),
  lastReviewedBy: z.string().nullable(),
  lastReviewedAt: z.string().datetime().nullable(),
  releasedBy: z.string().nullable(),
  releasedAt: z.string().datetime().nullable(),
  releaseNote: z.string().nullable(),
  /** Rights cases waiting on this hold ("restricted: legal hold"). */
  restrictedCases: z.number().int().nonnegative(),
  rowVersion: z.number().int(),
});
export type LegalHold = z.infer<typeof legalHoldSchema>;

export const legalHoldListSchema = pageResponseSchema(legalHoldSchema);
export type LegalHoldList = z.infer<typeof legalHoldListSchema>;

export const legalHoldHistoryEntrySchema = z.object({
  at: z.string().datetime(),
  action: z.string(),
  actor: z.string().nullable(),
  /** What changed, without the note: field names and values of the register (category, dates, status). */
  changes: z.record(z.unknown()),
});
export type LegalHoldHistoryEntry = z.infer<typeof legalHoldHistoryEntrySchema>;

export const legalHoldDetailSchema = z.object({
  hold: legalHoldSchema,
  history: z.array(legalHoldHistoryEntrySchema),
});
export type LegalHoldDetail = z.infer<typeof legalHoldDetailSchema>;

/** The answer the contact page asks for: is this person held, and by which hold. */
export const legalHoldStatusResponseSchema = z.object({
  held: z.boolean(),
  hold: legalHoldSchema.nullable(),
  /** True when the hold covers the whole workspace rather than this person. */
  viaWorkspace: z.boolean(),
});
export type LegalHoldStatusResponse = z.infer<typeof legalHoldStatusResponseSchema>;

export const releaseLegalHoldResultSchema = z.object({
  hold: legalHoldSchema,
  /** Rights cases that left "restricted" because of this release. */
  casesLifted: z.number().int().nonnegative(),
  /** Of those, erasures a person had already confirmed: the worker executes them next. */
  erasuresResuming: z.number().int().nonnegative(),
});
export type ReleaseLegalHoldResult = z.infer<typeof releaseLegalHoldResultSchema>;

/**
 * The keys of the texts around a hold (namespace `privacy-requests`, object `legalHold`). Counsel's wording replaces the values in the message
 * files; a workspace may override the requester response with `legalHoldRequesterNotice` in the privacy settings.
 */
export const LEGAL_HOLD_TEXT_KEYS = [
  'legalHold.requesterResponse',
  'legalHold.contactBanner',
  'legalHold.caseStatus',
  'legalHold.blockedMessage',
] as const;
export type LegalHoldTextKey = (typeof LEGAL_HOLD_TEXT_KEYS)[number];
