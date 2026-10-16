import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { paginationQuerySchema, pageInfoSchema } from '../common/pagination';
import { formFieldKindSchema } from './definition';

/**
 * Submissions: what a visitor sent, what became of it, and the public door that takes it
 * (docs/specs/forms-builder-app.md sections 7.2 and 9). The door never says whether a contact existed; the admin screens show everything.
 */

export const FORM_SUBMISSION_STATUSES = [
  'received',
  'created',
  'updated',
  'needs_review',
  'awaiting_payment',
  'paid',
  'failed',
  'spam',
] as const;
export const formSubmissionStatusSchema = z.enum(FORM_SUBMISSION_STATUSES);
export type FormSubmissionStatus = z.infer<typeof formSubmissionStatusSchema>;

/** Why a submission is `needs_review`, `spam` or `failed`: a stable code. */
export const FORM_SUBMISSION_REASONS = [
  'no_contact_point',
  'invalid_phone',
  'plan_limit_reached',
  'submissions_cap',
  'spam_score',
  'too_fast',
  'internal_error',
] as const;
export const formSubmissionReasonSchema = z.enum(FORM_SUBMISSION_REASONS);
export type FormSubmissionReason = z.infer<typeof formSubmissionReasonSchema>;

export const FORM_EVENT_KINDS = ['view', 'start', 'step', 'submit', 'complete'] as const;
export const formEventKindSchema = z.enum(FORM_EVENT_KINDS);
export type FormEventKind = z.infer<typeof formEventKindSchema>;

const linkSchema = z.object({ id: uuidSchema, name: z.string().nullable() });

/** One answer as the staff screen shows it: the label and kind the form had when it was submitted. */
export const formAnswerSchema = z.object({
  fieldId: z.string(),
  label: z.string(),
  kind: formFieldKindSchema,
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string()), z.null()]),
});
export type FormAnswer = z.infer<typeof formAnswerSchema>;

export const formSubmissionSummarySchema = z.object({
  id: uuidSchema,
  formId: uuidSchema,
  status: formSubmissionStatusSchema,
  reason: z.string().nullable(),
  /** The first name, email and phone the visitor gave, so the list reads without opening each row. */
  preview: z.object({
    name: z.string().nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
  }),
  contact: linkSchema.nullable(),
  company: linkSchema.nullable(),
  /** The version of the form the visitor saw. */
  formVersion: z.number().int(),
  consentGiven: z.boolean().nullable(),
  /** The workspace erased the answers (kept as a tombstone) or the retention sweep purged them. */
  answersRemoved: z.boolean(),
  createdAt: z.string().datetime(),
});
export type FormSubmissionSummary = z.infer<typeof formSubmissionSummarySchema>;

/** One payment attempt, as staff see it. */
export const FORM_PAYMENT_ATTEMPT_STATUSES = ['pending', 'paid', 'failed', 'expired'] as const;
export const formPaymentAttemptSchema = z.object({
  id: uuidSchema,
  reference: z.string(),
  gateway: z.string(),
  /** Minor units as a string (a bigint does not survive JSON). */
  amountMinor: z.string(),
  currency: z.string(),
  status: z.enum(FORM_PAYMENT_ATTEMPT_STATUSES),
  settledVia: z.enum(['gateway', 'manual']).nullable(),
  providerRef: z.string().nullable(),
  paidAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
});
export type FormPaymentAttempt = z.infer<typeof formPaymentAttemptSchema>;

export const formSubmissionDetailSchema = formSubmissionSummarySchema.extend({
  payments: z.array(formPaymentAttemptSchema),
  /** A second payment arrived for a submission already paid: refund it by hand. */
  duplicatePayment: z.boolean(),
  answers: z.array(formAnswerSchema),
  /** The age gate found the visitor under the minimum age and the form let them through (BL-217): the contact was flagged as a minor. */
  ageGate: z.enum(['under']).nullable(),
  /** The parent or guardian the visitor named after an under-age answer; null when none was asked for. */
  guardian: z
    .object({ name: z.string(), email: z.string().nullable(), phone: z.string().nullable() })
    .nullable(),
  attribution: z.object({
    utm: z.record(z.string()),
    referrer: z.string().nullable(),
    pageUrl: z.string().nullable(),
    userAgent: z.string().nullable(),
  }),
  consent: z
    .object({
      given: z.boolean(),
      text: z.string(),
      version: z.number().int(),
      at: z.string().datetime(),
    })
    .nullable(),
  error: z.string().nullable(),
  spamScore: z.number().int(),
  updatedAt: z.string().datetime(),
});
export type FormSubmissionDetail = z.infer<typeof formSubmissionDetailSchema>;

export const formSubmissionListSchema = z.object({
  data: z.array(formSubmissionSummarySchema),
  page: pageInfoSchema,
});
export type FormSubmissionList = z.infer<typeof formSubmissionListSchema>;

export const listFormSubmissionsQuerySchema = paginationQuerySchema.extend({
  status: formSubmissionStatusSchema.optional(),
  /** A convenience for the two tabs the screen has: everything that needs a person, and the spam bin. */
  tab: z.enum(['all', 'needs_attention', 'spam']).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  /** Matches the name, email or phone the visitor gave. */
  q: z.string().trim().min(1).max(120).optional(),
  contactId: uuidSchema.optional(),
});
export type ListFormSubmissionsQuery = z.infer<typeof listFormSubmissionsQuerySchema>;

export const exportFormSubmissionsSchema = z.object({
  status: formSubmissionStatusSchema.optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  contactId: uuidSchema.optional(),
});
export type ExportFormSubmissionsInput = z.infer<typeof exportFormSubmissionsSchema>;
/** An export holds at most this many rows (the newest); the response says when it was cut. */
export const FORM_EXPORT_MAX_ROWS = 10_000;
/** The largest submit body the door accepts (the platform's body parser holds this class to the same number). */
export const FORM_SUBMIT_MAX_BODY_BYTES = 262_144;

/** Result of a retry: the submission as it is now. */
export const retryFormSubmissionResultSchema = formSubmissionSummarySchema;
export type RetryFormSubmissionResult = z.infer<typeof retryFormSubmissionResultSchema>;

// --- the public door --------------------------------------------------------------------------------------------------------------------

/** One answer a visitor sent: text, a number, a ticked box or the ticked options. */
export const formAnswerValueSchema = z.union([
  z.string().max(5000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(100)).max(50),
  z.null(),
]);
export type FormAnswerValue = z.infer<typeof formAnswerValueSchema>;

/** The body of `POST /v2/public/forms/:publicKey/submit`. */
export const publicFormSubmitSchema = z.object({
  /** Made by the page, once per page load: the same key twice is the same submission. */
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  answers: z.record(z.string().max(40), formAnswerValueSchema).default({}),
  /** What the page read about where the visitor came from. Each is clipped server-side. */
  hidden: z
    .object({
      utm_source: z.string().max(255).optional(),
      utm_medium: z.string().max(255).optional(),
      utm_campaign: z.string().max(255).optional(),
      utm_term: z.string().max(255).optional(),
      utm_content: z.string().max(255).optional(),
      referrer: z.string().max(500).optional(),
      page_url: z.string().max(500).optional(),
    })
    .default({}),
  consent: z
    .object({ given: z.boolean(), textVersion: z.number().int().min(1).max(10_000) })
    .optional(),
  captchaToken: z.string().max(4096).optional(),
  /**
   * The age gate's declaration (BL-217): the box "I confirm I am at least N years old" was ticked. Sent only by a page whose form asks it;
   * absent counts as not confirmed.
   */
  ageConfirmed: z.boolean().optional(),
  /** A parent or guardian, asked for after an under-age answer on a form whose gate says `guardian` (BL-217). */
  guardian: z
    .object({
      name: z.string().trim().min(1).max(120),
      email: z.string().trim().email().max(191).optional(),
      phone: z.string().trim().max(40).optional(),
    })
    .optional(),
  /** The honeypot: a real visitor never fills it (the field is hidden from people). */
  hp: z.string().max(500).optional(),
  /** Milliseconds between the page's `start` event and the submit, when the page tracked it. */
  elapsedMs: z.number().int().min(0).max(86_400_000).optional(),
});
export type PublicFormSubmitInput = z.infer<typeof publicFormSubmitSchema>;

export const publicFormNextSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('message'), message: z.string() }),
  z.object({ type: z.literal('redirect'), url: z.string() }),
  /** The form takes payment: the visitor goes to the gateway's hosted page. The form is paid only when the gateway confirms. */
  z.object({ type: z.literal('pay'), url: z.string(), message: z.string().optional() }),
]);
export type PublicFormNext = z.infer<typeof publicFormNextSchema>;

export const publicFormSubmitResponseSchema = z.object({
  /** The visitor's receipt. Not a credential for anything. */
  submissionToken: z.string(),
  next: publicFormNextSchema,
});
export type PublicFormSubmitResponse = z.infer<typeof publicFormSubmitResponseSchema>;

/** `GET /v2/public/forms/:publicKey/submissions/:token`: where a payment stands, for the page the visitor returns to. */
export const FORM_PAYMENT_STATES = [
  'not_required',
  'awaiting_payment',
  'paid',
  'expired',
  'failed',
] as const;
export const publicFormSubmissionStatusSchema = z.object({
  payment: z.enum(FORM_PAYMENT_STATES),
  /** The message or the redirect the form's thank-you settings give; sent once the payment is confirmed (or none is due). */
  next: publicFormNextSchema.nullable(),
  /** When awaiting payment and the link is still good: the page may offer it again. */
  payUrl: z.string().nullable(),
});
export type PublicFormSubmissionStatus = z.infer<typeof publicFormSubmissionStatusSchema>;

export const publicFormEventSchema = z.object({
  visitId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  kind: formEventKindSchema,
  step: z.number().int().min(0).max(9).optional(),
});
export type PublicFormEventInput = z.infer<typeof publicFormEventSchema>;

/** The hidden-field sources the page fills, in the order the loader reads them. */
export const FORM_PAGE_HIDDEN_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
  'referrer',
  'page_url',
] as const;

/** `POST /v2/forms/:id/submissions/:sid/payment-link`: the fresh hosted link; null when the gateway refused (try again). */
export const formPaymentLinkResultSchema = z.object({ url: z.string().nullable() });
export type FormPaymentLinkResult = z.infer<typeof formPaymentLinkResultSchema>;
