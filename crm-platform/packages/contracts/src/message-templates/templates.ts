import { z } from 'zod';
import { pageResponseSchema } from '../common/pagination';
import { uuidSchema } from '../common/ids';

/** Meta's category, which is what the review and the price follow. */
export const tplMetaCategorySchema = z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']);
export type TplMetaCategory = z.infer<typeof tplMetaCategorySchema>;

/** Where the template stands, local and Meta combined (TW-TPL-004). */
export const tplStatusSchema = z.enum([
  'draft',
  'pending',
  'approved',
  'rejected',
  'paused',
  'disabled',
  'deleted',
]);
export type TplStatus = z.infer<typeof tplStatusSchema>;

export const TPL_NAME_MAX = 512;
export const TPL_BODY_MAX = 1024;

export const tplButtonSchema = z
  .object({
    type: z.string().min(1).max(32),
    text: z.string().max(25).optional(),
    url: z.string().max(2000).optional(),
    phone_number: z.string().max(20).optional(),
    example: z.union([z.string().max(2000), z.array(z.string().max(2000))]).optional(),
  })
  .passthrough();
export type TplButton = z.infer<typeof tplButtonSchema>;

export const tplVariableSlotSchema = z.object({
  num: z.number().int().min(1),
  key: z.string().max(100),
  example: z.string().max(200).optional(),
});
export const tplVariableMapSchema = z.object({
  header: z.array(tplVariableSlotSchema).optional(),
  body: z.array(tplVariableSlotSchema).optional(),
});
export type TplVariableMap = z.infer<typeof tplVariableMapSchema>;

export const tplAttachmentTypeSchema = z.enum(['none', 'image', 'video', 'document', 'location']);

/** The map pin of a `location` header: WhatsApp renders 0,0 for a value out of range, so the range is enforced here. */
export const tplHeaderLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  name: z.string().trim().max(100).nullish(),
  address: z.string().trim().max(200).nullish(),
});
export type TplHeaderLocation = z.infer<typeof tplHeaderLocationSchema>;

export const tplLintIssueSchema = z.object({
  code: z.string(),
  severity: z.enum(['error', 'warning']),
  field: z.enum(['name', 'language', 'header', 'body', 'footer', 'buttons', 'template']),
  message: z.string(),
});
export type TplLintIssue = z.infer<typeof tplLintIssueSchema>;

export const templateSummarySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  language: z.string(),
  metaCategory: tplMetaCategorySchema.nullable(),
  templateType: z.string(),
  status: tplStatusSchema,
  metaStatus: z.string().nullable(),
  qualityScore: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  /** Meta's reason code (`INVALID_FORMAT`, `PROMOTIONAL`...), when it sent one; `NONE` is not reported. */
  rejectionReasonCode: z.string().nullable(),
  metaTemplateId: z.string().nullable(),
  /** The WhatsApp number it is submitted through (uuid of the connection). */
  connectionId: uuidSchema.nullable(),
  pausedUntil: z.string().datetime().nullable(),
  approvedAt: z.string().datetime().nullable(),
  submittedAt: z.string().datetime().nullable(),
  lastSyncedAt: z.string().datetime().nullable(),
  bodyPreview: z.string(),
  /** What the library card draws: the whole message, so the card matches the detail page. */
  header: z.string().nullable(),
  attachmentType: tplAttachmentTypeSchema,
  /** Public URL of the header example media, when one was uploaded. */
  headerSampleUrl: z.string().nullable(),
  body: z.string(),
  footer: z.string().nullable(),
  buttons: z.array(tplButtonSchema),
  rowVersion: z.number().int(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type TemplateSummary = z.infer<typeof templateSummarySchema>;

export const templateDetailSchema = templateSummarySchema.extend({
  /** The pin of a `location` header. */
  headerLocation: tplHeaderLocationSchema.nullable(),
  variableMap: tplVariableMapSchema,
  codeExpirationMinutes: z.number().int().nullable(),
  parameterFormat: z.enum(['POSITIONAL', 'NAMED']),
  /** The Meta create payload as it would be (or was) sent: what the review sees. */
  metaPayload: z.record(z.unknown()),
  lint: z.array(tplLintIssueSchema),
});
export type TemplateDetail = z.infer<typeof templateDetailSchema>;

/**
 * The library's three status tabs (Reference's "effective status"): approved; in review (pending and drafts); rejected (rejected,
 * paused, disabled). A row Meta no longer lists (`deleted`) is only found under All.
 */
export const tplStatusGroupSchema = z.enum(['approved', 'pending', 'rejected']);
export type TplStatusGroup = z.infer<typeof tplStatusGroupSchema>;

export const tplSortSchema = z.enum(['newest', 'oldest', 'name-asc', 'name-desc']);
export type TplSort = z.infer<typeof tplSortSchema>;

export const listTemplatesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().min(1).max(512).optional(),
  status: tplStatusSchema.optional(),
  statusGroup: tplStatusGroupSchema.optional(),
  sort: tplSortSchema.default('newest'),
  category: tplMetaCategorySchema.optional(),
  connectionId: uuidSchema.optional(),
  q: z.string().trim().max(100).optional(),
});
export type ListTemplatesQuery = z.infer<typeof listTemplatesQuerySchema>;
export const listTemplatesResponseSchema = pageResponseSchema(templateSummarySchema);
export type ListTemplatesResponse = z.infer<typeof listTemplatesResponseSchema>;

const templateFields = {
  name: z.string().trim().min(1).max(TPL_NAME_MAX),
  language: z
    .string()
    .trim()
    .regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, 'a Meta language code such as en_US'),
  metaCategory: tplMetaCategorySchema,
  templateType: z.enum(['standard', 'media', 'auth']).default('standard'),
  header: z.string().trim().max(60).nullish(),
  attachmentType: tplAttachmentTypeSchema.default('none'),
  /** Handle returned by `POST /v2/templates/media`; required for an image, video or document header. */
  headerHandle: z.string().max(2000).nullish(),
  headerSampleUrl: z.string().max(2000).nullish(),
  /** Required with a `location` attachment. */
  headerLocation: tplHeaderLocationSchema.nullish(),
  body: z.string().max(TPL_BODY_MAX),
  footer: z.string().trim().max(60).nullish(),
  buttons: z.array(tplButtonSchema).max(10).default([]),
  variableMap: tplVariableMapSchema.optional(),
  codeExpirationMinutes: z.number().int().min(1).max(90).nullish(),
  parameterFormat: z.enum(['POSITIONAL', 'NAMED']).default('POSITIONAL'),
};

export const createTemplateInputSchema = z.object({
  ...templateFields,
  connectionId: uuidSchema,
  /** Send to Meta now (default) or keep as a draft. */
  submit: z.boolean().default(true),
});
export type CreateTemplateInput = z.infer<typeof createTemplateInputSchema>;

export const updateTemplateInputSchema = z.object({
  ...templateFields,
  rowVersion: z.number().int(),
  submit: z.boolean().default(false),
});
export type UpdateTemplateInput = z.infer<typeof updateTemplateInputSchema>;

/** `POST /v2/templates/lint`: instant feedback for the form without saving. */
export const lintTemplateInputSchema = z.object({
  ...templateFields,
  hasHeaderFile: z.boolean().optional(),
});
export type LintTemplateInput = z.infer<typeof lintTemplateInputSchema>;
export const lintTemplateResultSchema = z.object({
  issues: z.array(tplLintIssueSchema),
  /** The body as stored (placeholders renumbered) and the slots it reads from. */
  normalized: z.object({
    header: z.string().nullable(),
    body: z.string(),
    variableMap: tplVariableMapSchema,
  }),
  metaPayload: z.record(z.unknown()),
});
export type LintTemplateResult = z.infer<typeof lintTemplateResultSchema>;

/** Result of submit/create/update: the saved template plus anything worth showing. */
export const templateSubmitResultSchema = z.object({
  template: templateDetailSchema,
  warnings: z.array(tplLintIssueSchema),
  /** Set when the row was saved but Meta refused: its words, so the form can show them. */
  metaError: z.string().nullable(),
});
export type TemplateSubmitResult = z.infer<typeof templateSubmitResultSchema>;

/** `GET /v2/templates/counts`: the numbers on the library's tabs. Tab counts ignore the filters (Reference counts the whole library). */
export const templateCountsQuerySchema = listTemplatesQuerySchema.pick({
  status: true,
  statusGroup: true,
  category: true,
  connectionId: true,
  q: true,
});
export type TemplateCountsQuery = z.infer<typeof templateCountsQuerySchema>;
export const templateCountsSchema = z.object({
  /** Every template, by Meta category (key `all` = the total). */
  categories: z.record(z.number().int()),
  /** Every template, by status tab: `all`, `approved`, `pending`, `rejected`. */
  statuses: z.record(z.number().int()),
  /** Templates matching the current filters ("Showing 8 of N"). */
  filtered: z.number().int(),
});
export type TemplateCounts = z.infer<typeof templateCountsSchema>;

/** `POST /v2/templates/:id/submit`: send (or send again) on another number when the account has several. */
export const submitTemplateInputSchema = z.object({ connectionId: uuidSchema.optional() });
export type SubmitTemplateInput = z.infer<typeof submitTemplateInputSchema>;

export const syncTemplatesInputSchema = z.object({ connectionId: uuidSchema });
export type SyncTemplatesInput = z.infer<typeof syncTemplatesInputSchema>;
export const syncTemplatesResultSchema = z.object({
  created: z.number().int(),
  updated: z.number().int(),
  /** Local rows Meta no longer lists (kept, flagged `deleted`; never removed on a partial fetch). */
  missing: z.number().int(),
  total: z.number().int(),
});
export type SyncTemplatesResult = z.infer<typeof syncTemplatesResultSchema>;

export const uploadTemplateMediaResultSchema = z.object({
  handle: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
});
export type UploadTemplateMediaResult = z.infer<typeof uploadTemplateMediaResultSchema>;

/**
 * "Build with AI" on the template form (TW-TPL-016, Reference `POST /templates/api/ai-generate`): a business brief in, a template draft
 * out (name, header text, body with `{{n}}` placeholders, footer, buttons). Nothing is stored: the form fills its own fields and the
 * person reviews before it is submitted to Meta. The model picker is `GET /v2/ai/models`; errors are the campaign builder's `CAMP_AI_*`.
 */
export const TPL_AI_PROVIDERS = ['openai', 'anthropic', 'gemini'] as const;
const aiBrief = (max: number) => z.string().trim().max(max).optional();
export const tplAiGenerateSchema = z.object({
  provider: z.enum(TPL_AI_PROVIDERS),
  model: z.string().trim().min(1).max(120),
  metaCategory: z.enum(['MARKETING', 'UTILITY']).default('MARKETING'),
  /** A Meta language code such as `en_US`; the copy is written in it. */
  language: z
    .string()
    .trim()
    .regex(/^[a-z]{2,3}(_[A-Z]{2})?$/, 'a Meta language code such as en_US')
    .default('en_US'),
  businessName: z.string().trim().min(1).max(191),
  industry: aiBrief(120),
  occasion: aiBrief(120),
  purpose: aiBrief(120),
  action: aiBrief(120),
  tone: aiBrief(60),
  customPrompt: aiBrief(2000),
});
export type TplAiGenerateInput = z.infer<typeof tplAiGenerateSchema>;

/** The draft, already cut to what the form and Meta accept (name a lower-case slug, header 60, body 1,024, footer 60, buttons 25 each). */
export const tplAiDraftSchema = z.object({
  name: z.string(),
  header: z.string().nullable(),
  body: z.string(),
  footer: z.string().nullable(),
  buttons: z
    .array(
      z.discriminatedUnion('type', [
        z.object({ type: z.literal('QUICK_REPLY'), text: z.string() }),
        z.object({ type: z.literal('URL'), text: z.string(), url: z.string() }),
        z.object({ type: z.literal('PHONE_NUMBER'), text: z.string(), phoneNumber: z.string() }),
      ]),
    )
    .max(3),
});
export type TplAiDraft = z.infer<typeof tplAiDraftSchema>;
export const tplAiGenerateResponseSchema = z.object({
  template: tplAiDraftSchema,
  model: z.string(),
});
export type TplAiGenerateResponse = z.infer<typeof tplAiGenerateResponseSchema>;
