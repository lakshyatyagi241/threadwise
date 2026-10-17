/**
 * WhatsApp Forms (WFL; Reference `/wa-forms`): author a Meta WhatsApp Flow form, publish it, review submissions.
 * See docs/threadwise-port/inventory/forms-links-groups.md TW-WFL-001..011. Sending a published form from inside a
 * flow (the `wa_form` node) is owned by flow-builder-editor/flow-runtime-engine, not here — this domain owns only
 * authoring, publish and submissions.
 */
import { z } from 'zod';

export const WA_FORM_TITLE_MAX = 140;
export const WA_FORM_PURPOSE_MAX = 2000;
export const WA_FORM_CAP_REACHED_NOTE_MAX = 500;
export const WA_FORM_SEND_BUTTON_LABEL_MAX = 40;
export const WA_FORM_THANK_YOU_NOTE_MAX = 500;
export const WA_FORM_SUBMISSION_CAP_MAX = 1_000_000;

export const WA_FORM_AUDIENCE_TYPES = [
  'lead_capture',
  'survey',
  'appointment_booking',
  'customer_support',
  'sign_up',
  'other',
] as const;
export const waFormAudienceTypeSchema = z.enum(WA_FORM_AUDIENCE_TYPES);
export type WaFormAudienceType = z.infer<typeof waFormAudienceTypeSchema>;

export const WA_FORM_STATUSES = ['draft', 'published', 'paused'] as const;
export const waFormStatusSchema = z.enum(WA_FORM_STATUSES);
export type WaFormStatus = z.infer<typeof waFormStatusSchema>;

export const WA_FORM_FIELD_KINDS = [
  'heading',
  'short_text',
  'paragraph',
  'email',
  'phone_number',
  'number',
  'date',
  'dropdown',
  'radio_buttons',
  'checkbox',
] as const;
export const waFormFieldKindSchema = z.enum(WA_FORM_FIELD_KINDS);
export type WaFormFieldKind = z.infer<typeof waFormFieldKindSchema>;

/** Kinds that take an `options` list (the "choice inputs" palette group). */
export const WA_FORM_CHOICE_FIELD_KINDS: readonly WaFormFieldKind[] = [
  'dropdown',
  'radio_buttons',
  'checkbox',
];

/**
 * A field's `mapsTo`, when it names one of these, writes the submitted answer onto that contact column instead of (or as well
 * as) a custom property — the same set the flow engine's "Update contact field" step writes
 * (`FLOW_CONTACT_COLUMNS` in `apps/api/.../crm/contacts/contacts.service.ts`; keep the two in sync). Phone is deliberately not
 * here: it is the contact's identity key and is never overwritten by a form answer.
 */
export const WA_FORM_SYSTEM_MAP_FIELDS = [
  'name',
  'first_name',
  'last_name',
  'email',
  'title',
  'language',
  'address',
] as const;
export type WaFormSystemMapField = (typeof WA_FORM_SYSTEM_MAP_FIELDS)[number];

/**
 * A field's `mapsTo`, when it names one of these, does not write a contact property at all: it answers a privacy question instead
 * (TW-WFL, net addition — WhatsApp Forms had neither a consent capture nor an age/minor check). The `privacy:` prefix can never
 * collide with a custom attribute key (`ATTRIBUTE_KEY_PATTERN` forbids `:`) or a `WA_FORM_SYSTEM_MAP_FIELDS` entry.
 *
 * - `privacy:age` — a `number` field's answer is judged as an age.
 * - `privacy:date_of_birth` — a `date` field's answer is judged as a date of birth.
 * - `privacy:consent_marketing` — a `checkbox` field's answer (ticked = non-empty) grants WhatsApp marketing consent.
 * - `privacy:consent_service` — a `checkbox` field's answer records a service (non-marketing) agreement.
 *
 * The builder only offers the pairing that fits the field's own `kind` (see `wa-form-builder-screen.tsx`); the submission handler
 * (`CommerceResume.applyFieldMappings`) re-checks it and skips a mismatched mapping rather than misreading the answer.
 */
export const WA_FORM_PRIVACY_MAP_FIELDS = [
  'privacy:age',
  'privacy:date_of_birth',
  'privacy:consent_marketing',
  'privacy:consent_service',
] as const;
export type WaFormPrivacyMapField = (typeof WA_FORM_PRIVACY_MAP_FIELDS)[number];

/** The field `kind` each `WA_FORM_PRIVACY_MAP_FIELDS` entry is valid on. */
export const WA_FORM_PRIVACY_MAP_KIND: Record<WaFormPrivacyMapField, WaFormFieldKind> = {
  'privacy:age': 'number',
  'privacy:date_of_birth': 'date',
  'privacy:consent_marketing': 'checkbox',
  'privacy:consent_service': 'checkbox',
};

export const WA_FORM_MAPS_TO_MAX = 64;

export const waFormFieldSchema = z.object({
  /** Client-generated (`fld_<6-char-random>`), stable across autosaves — never server-assigned. */
  id: z.string().min(1).max(40),
  kind: waFormFieldKindSchema,
  label: z.string().trim().min(1).max(300),
  required: z.boolean().default(false),
  placeholder: z.string().trim().max(300).optional(),
  helperText: z.string().trim().max(300).optional(),
  options: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
  /**
   * Writes the answer onto this contact property at submission time: one of `WA_FORM_SYSTEM_MAP_FIELDS`, the key of an active
   * custom contact attribute, or one of `WA_FORM_PRIVACY_MAP_FIELDS` (age/date-of-birth minor check, marketing/service consent —
   * these write a privacy fact, not a contact property). Unmapped (the default) leaves the contact untouched — Reference never
   * does this mapping at all, so a blank `mapsTo` keeps the submission exactly as before. A key typed by hand that names nothing
   * active, or a privacy key on the wrong field `kind`, is silently skipped at submission time (same rule as the flow engine's
   * own field writer), not an error: a deleted attribute or a mismatched mapping must not break future submissions.
   */
  mapsTo: z.string().trim().min(1).max(WA_FORM_MAPS_TO_MAX).optional(),
});
export type WaFormField = z.infer<typeof waFormFieldSchema>;

export const waFormScreenSchema = z.object({
  id: z.string().min(1).max(40),
  title: z.string().trim().max(300).optional(),
  fields: z.array(waFormFieldSchema),
});
export type WaFormScreen = z.infer<typeof waFormScreenSchema>;

export const waFormDefinitionSchema = z.object({
  screens: z.array(waFormScreenSchema).min(1),
});
export type WaFormDefinition = z.infer<typeof waFormDefinitionSchema>;

export const waFormSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  purpose: z.string().nullable(),
  slug: z.string(),
  audienceType: waFormAudienceTypeSchema,
  submissionCap: z.number().int(),
  capReachedNote: z.string().nullable(),
  sendButtonLabel: z.string(),
  thankYouNote: z.string().nullable(),
  definition: waFormDefinitionSchema,
  status: waFormStatusSchema,
  /** `status === 'published' && metaFlowId` is set — the same rule the flow-builder picker uses. */
  isLive: z.boolean(),
  publishedAt: z.string().nullable(),
  publishError: z.string().nullable(),
  fieldsCount: z.number().int(),
  submissionCount: z.number().int(),
  createdAt: z.string(),
  rowVersion: z.number().int(),
});
export type WaForm = z.infer<typeof waFormSchema>;

export const waFormStatsSchema = z.object({
  all: z.number().int(),
  published: z.number().int(),
  draft: z.number().int(),
  submissions: z.number().int(),
});
export type WaFormStats = z.infer<typeof waFormStatsSchema>;

export const waFormListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().min(1).max(200).optional(),
});
export type WaFormListQuery = z.infer<typeof waFormListQuerySchema>;

export const waFormListSchema = z.object({
  items: z.array(waFormSchema),
  stats: waFormStatsSchema,
  page: z.object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
    limit: z.number().int(),
  }),
});
export type WaFormList = z.infer<typeof waFormListSchema>;

/**
 * `POST /v2/wa-forms` (create, no `id`) or `PATCH /v2/wa-forms/:id` (update). Editing a published form drops it
 * back to `draft` — a named Reference behavior, not a bug (see inventory TW-WFL-003).
 */
export const saveWaFormInputSchema = z.object({
  title: z.string().trim().min(1).max(WA_FORM_TITLE_MAX),
  purpose: z.string().trim().max(WA_FORM_PURPOSE_MAX).optional(),
  audienceType: waFormAudienceTypeSchema,
  submissionCap: z.number().int().min(0).max(WA_FORM_SUBMISSION_CAP_MAX).default(0),
  capReachedNote: z.string().trim().max(WA_FORM_CAP_REACHED_NOTE_MAX).optional(),
  sendButtonLabel: z.string().trim().min(1).max(WA_FORM_SEND_BUTTON_LABEL_MAX).default('Send'),
  thankYouNote: z.string().trim().max(WA_FORM_THANK_YOU_NOTE_MAX).optional(),
  definition: waFormDefinitionSchema,
  rowVersion: z.number().int().optional(),
});
export type SaveWaFormInput = z.infer<typeof saveWaFormInputSchema>;

/** `GET /v2/wa-forms/picker`: consumed by the flow builder's `wa_form` node — keep this shape stable. */
export const waFormPickerItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  status: waFormStatusSchema,
  isPublished: z.boolean(),
});
export type WaFormPickerItem = z.infer<typeof waFormPickerItemSchema>;
export const waFormPickerListSchema = z.object({ forms: z.array(waFormPickerItemSchema) });
export type WaFormPickerList = z.infer<typeof waFormPickerListSchema>;

export const waFormSubmissionSchema = z.object({
  id: z.string().uuid(),
  contactId: z.string().uuid().nullable(),
  contactName: z.string().nullable(),
  contactPhone: z.string().nullable(),
  /** `{fieldId: value}`, already flattened (multi-value answers joined with ", "). */
  answers: z.record(z.string(), z.string()),
  submittedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type WaFormSubmission = z.infer<typeof waFormSubmissionSchema>;

export const waFormSubmissionListQuerySchema = waFormListQuerySchema;
export type WaFormSubmissionListQuery = z.infer<typeof waFormSubmissionListQuerySchema>;

export const waFormSubmissionListSchema = z.object({
  items: z.array(waFormSubmissionSchema),
  /** `{fieldId: label}` for every non-heading field across the form's screens, in authoring order. */
  fieldLabels: z.record(z.string(), z.string()),
  metaFlowId: z.string().nullable(),
  page: z.object({
    nextCursor: z.string().nullable(),
    hasMore: z.boolean(),
    limit: z.number().int(),
  }),
});
export type WaFormSubmissionList = z.infer<typeof waFormSubmissionListSchema>;
