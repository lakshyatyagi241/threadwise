import { z } from 'zod';
import { fieldTypeSchema } from '../common/enums';
import { uuidSchema } from '../common/ids';
import { paginationQuerySchema } from '../common/pagination';
import {
  formBindObjectSchema,
  formDefinitionSchema,
  formFieldKindSchema,
  formOptionSchema,
} from './definition';

/**
 * Forms, as the admin screens see them (docs/specs/forms-builder-app.md sections 4 and 7.1). A form is a draft document plus the
 * settings that apply live; Publish freezes the draft as a new immutable version and that version is what the public sees.
 */

export const FORM_STATUSES = ['draft', 'published', 'paused', 'archived'] as const;
export const formStatusSchema = z.enum(FORM_STATUSES);
export type FormStatus = z.infer<typeof formStatusSchema>;

export const FORM_CAPTCHA_MODES = ['inherit', 'on', 'off'] as const;
export const formCaptchaModeSchema = z.enum(FORM_CAPTCHA_MODES);
export type FormCaptchaMode = z.infer<typeof formCaptchaModeSchema>;

export const FORM_RETENTION_MIN_DAYS = 30;
export const FORM_RETENTION_MAX_DAYS = 3650;
export const FORM_RETENTION_DEFAULT_DAYS = 365;

/** The path of the public form on the web origin, below it the public key. */
export const FORM_PUBLIC_PATH_PREFIX = '/f/';
/** The loader script, served by the API (version neutral): `<api origin>/form-embed/<publicKey>/embed.js`. */
export const FORM_EMBED_PATH_PREFIX = '/form-embed/';
/** A public key is 22 random letters and digits: the only credential-free identifier in a public URL. */
export const FORM_PUBLIC_KEY = /^[A-Za-z0-9]{22}$/;

// --- origins ------------------------------------------------------------------------------------------------------------------------------

/**
 * An allowed embedding origin: `https://example.com`, `https://example.com:8443`, or one wildcard level `https://*.example.com`.
 * Never a bare `*`, never a path. Plain `http` is accepted for localhost only (a developer's own site).
 */
export function normaliseFormOrigin(raw: string): string | null {
  const text = raw.trim().toLowerCase().replace(/\/+$/, '');
  const m = /^(https?):\/\/(\*\.)?([a-z0-9.-]+)(:\d{1,5})?$/.exec(text);
  if (!m) return null;
  const [, scheme, wildcard, host, port] = m;
  if (!host || host.startsWith('.') || host.endsWith('.') || host.includes('..')) return null;
  const local = host === 'localhost' || host === '127.0.0.1';
  if (scheme === 'http' && (!local || wildcard)) return null;
  if (wildcard && !host.includes('.')) return null;
  if (!local && !host.includes('.')) return null;
  return `${scheme}://${wildcard ?? ''}${host}${port ?? ''}`;
}

export const formOriginSchema = z
  .string()
  .max(200)
  .transform((v, ctx) => {
    const n = normaliseFormOrigin(v);
    if (!n) {
      ctx.addIssue({
        code: 'custom',
        message: 'must be an origin such as https://example.com or https://*.example.com',
      });
      return z.NEVER;
    }
    return n;
  });

// --- settings that apply live (not versioned) -----------------------------------------------------------------------------------

export const FORM_OWNER_MODES = ['unassigned', 'fixed', 'round_robin'] as const;
export const formOwnerRuleSchema = z
  .object({
    mode: z.enum(FORM_OWNER_MODES).default('unassigned'),
    /** The user (fixed) or the users taken in turn (round robin), as uuids. A user who is no longer active is skipped. */
    userIds: z.array(uuidSchema).max(50).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.mode === 'fixed' && v.userIds.length !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['userIds'],
        message: 'a fixed owner is exactly one user',
      });
    }
    if (v.mode === 'round_robin' && v.userIds.length < 2) {
      ctx.addIssue({
        code: 'custom',
        path: ['userIds'],
        message: 'round robin needs at least two users',
      });
    }
    if (v.mode === 'unassigned' && v.userIds.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['userIds'],
        message: 'no users for an unassigned rule',
      });
    }
  });
export type FormOwnerRule = z.infer<typeof formOwnerRuleSchema>;

export const formNotifySchema = z.object({
  /** Tell the contact's owner. */
  owner: z.boolean().default(true),
  /** Also tell these users (uuids). */
  userIds: z.array(uuidSchema).max(20).default([]),
  /** Also email these addresses (a notification email per submission). */
  emails: z.array(z.string().trim().toLowerCase().email().max(254)).max(5).default([]),
});
export type FormNotify = z.infer<typeof formNotifySchema>;

export const formRateLimitsSchema = z.object({
  /** Submissions from one address per minute. */
  perIpPerMinute: z.number().int().min(1).max(600).default(20),
  /** Submissions to this form per minute, from anywhere. */
  perFormPerMinute: z.number().int().min(1).max(6000).default(120),
  /** Submissions with the same email address or phone number per hour. */
  perContactPerHour: z.number().int().min(1).max(100).default(5),
});
export type FormRateLimits = z.infer<typeof formRateLimitsSchema>;

export const formLiveSettingsSchema = z.object({
  ownerRule: formOwnerRuleSchema.default({ mode: 'unassigned', userIds: [] }),
  notify: formNotifySchema.default({ owner: true, userIds: [], emails: [] }),
  /** Exact origins allowed to embed the form and post to it from a browser. Empty = hosted page only. */
  allowedOrigins: z.array(formOriginSchema).max(20).default([]),
  captchaMode: formCaptchaModeSchema.default('inherit'),
  honeypot: z.boolean().default(true),
  /** Days the answers are kept; `null` keeps them until a person deletes them. */
  retentionDays: z
    .number()
    .int()
    .min(FORM_RETENTION_MIN_DAYS)
    .max(FORM_RETENTION_MAX_DAYS)
    .nullable()
    .default(FORM_RETENTION_DEFAULT_DAYS),
  rateLimits: formRateLimitsSchema.default({}),
});
export type FormLiveSettings = z.infer<typeof formLiveSettingsSchema>;

// --- the form --------------------------------------------------------------------------------------------------------------------------

export const formShareSchema = z.object({
  /** `https://<web origin>/f/<publicKey>` */
  hostedUrl: z.string(),
  /** The loader the customer's site includes. */
  embedScriptUrl: z.string(),
  /** Ready to paste: the script tag and its container. */
  scriptSnippet: z.string(),
  /** Ready to paste: a plain iframe. */
  iframeSnippet: z.string(),
});
export type FormShare = z.infer<typeof formShareSchema>;

export const formSummarySchema = z.object({
  id: uuidSchema,
  name: z.string(),
  status: formStatusSchema,
  publicKey: z.string(),
  /** The number of the live version, null while the form was never published. */
  publishedVersion: z.number().int().nullable(),
  publishedAt: z.string().datetime().nullable(),
  /** The draft differs from the live version: Publish would change what the public sees. */
  hasUnpublishedChanges: z.boolean(),
  views: z.number().int(),
  /** Accepted submissions: every status but `spam`. */
  submissions: z.number().int(),
  needsReview: z.number().int(),
  lastSubmissionAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  rowVersion: z.number().int(),
});
export type FormSummary = z.infer<typeof formSummarySchema>;

export const formDetailSchema = formSummarySchema.extend({
  draft: formDefinitionSchema,
  settings: formLiveSettingsSchema,
  share: formShareSchema,
});
export type FormDetail = z.infer<typeof formDetailSchema>;

export const listFormsQuerySchema = paginationQuerySchema.extend({
  status: formStatusSchema.optional(),
  /** Archived forms are hidden unless asked for (`status=archived` or `includeArchived=true`). */
  includeArchived: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  q: z.string().trim().min(1).max(120).optional(),
});
export type ListFormsQuery = z.infer<typeof listFormsQuerySchema>;

export const createFormSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    /** Start from a gallery template (`GET /forms/templates`). */
    templateKey: z.string().trim().min(1).max(60).optional(),
    /** Or from a definition you hold (a duplicate, an import). Not with `templateKey`. */
    definition: formDefinitionSchema.optional(),
    settings: formLiveSettingsSchema.partial().optional(),
  })
  .refine((v) => !(v.templateKey && v.definition), {
    path: ['definition'],
    message: 'send a template key or a definition, not both',
  });
export type CreateFormInput = z.infer<typeof createFormSchema>;

export const updateFormSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  definition: formDefinitionSchema.optional(),
  settings: formLiveSettingsSchema.partial().optional(),
  rowVersion: z.number().int().positive(),
});
export type UpdateFormInput = z.infer<typeof updateFormSchema>;

/** Publish, pause, resume, archive, duplicate and rotate-key carry only the version the caller last read. */
export const formActionSchema = z.object({ rowVersion: z.number().int().positive() });
export type FormActionInput = z.infer<typeof formActionSchema>;

export const duplicateFormSchema = formActionSchema.extend({
  /** Omit for "Copy of <name>". */
  name: z.string().trim().min(1).max(120).optional(),
});
export type DuplicateFormInput = z.infer<typeof duplicateFormSchema>;

export const formVersionSchema = z.object({
  version: z.number().int(),
  publishedAt: z.string().datetime(),
  publishedBy: z.object({ id: uuidSchema, name: z.string() }).nullable(),
  /** This is the version the public sees now. */
  isLive: z.boolean(),
});
export type FormVersion = z.infer<typeof formVersionSchema>;

export const formVersionListSchema = z.object({ data: z.array(formVersionSchema) });
export type FormVersionList = z.infer<typeof formVersionListSchema>;

export const restoreFormVersionSchema = formActionSchema;
export type RestoreFormVersionInput = z.infer<typeof restoreFormVersionSchema>;

/** One problem found when publishing: where, and a stable reason (`crm_required_unbound`, `no_contact_point`, ...). */
export const formPublishProblemSchema = z.object({ path: z.string(), reason: z.string() });
export type FormPublishProblem = z.infer<typeof formPublishProblemSchema>;

// --- templates ---------------------------------------------------------------------------------------------------------------------------

export const formTemplateSchema = z.object({
  key: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.enum(['lead', 'contact', 'event', 'order', 'survey']),
  definition: formDefinitionSchema,
});
export type FormTemplate = z.infer<typeof formTemplateSchema>;
export const formTemplateListSchema = z.object({ data: z.array(formTemplateSchema) });
export type FormTemplateList = z.infer<typeof formTemplateListSchema>;

// --- the field picker's catalogue --------------------------------------------------------------------------------------------------

export const formPropertiesQuerySchema = z.object({ object: formBindObjectSchema });
export type FormPropertiesQuery = z.infer<typeof formPropertiesQuerySchema>;

export const formPropertySchema = z.object({
  object: formBindObjectSchema,
  /** What goes in a field's `bind.property`: a built-in name or a custom property key. */
  property: z.string(),
  label: z.string(),
  source: z.enum(['builtin', 'custom']),
  /** The CRM property type (custom) or the closest type (built-in). */
  type: fieldTypeSchema,
  /** The block kind the picker adds when this property is dragged in. */
  suggestedKind: formFieldKindSchema,
  /** The workspace marks it required: a form that writes the object must bind it and require it. */
  requiredByWorkspace: z.boolean(),
  options: z.array(formOptionSchema).optional(),
});
export type FormProperty = z.infer<typeof formPropertySchema>;
export const formPropertyListSchema = z.object({ data: z.array(formPropertySchema) });
export type FormPropertyList = z.infer<typeof formPropertyListSchema>;

/** `GET /v2/forms/meta/payment-gateway`: can this workspace take payment on a form, and on which gateway (Settings > Payments sets it). */
export const formPaymentGatewaySchema = z.object({
  /** A gateway is connected and can make a hosted payment link. */
  ready: z.boolean(),
  /** The gateway's slug and name, when one is connected. */
  slug: z.string().nullable(),
  name: z.string().nullable(),
  mode: z.enum(['test', 'live']).nullable(),
  /** Why not: `none_connected`, or `no_link_support` (the gateway cannot make a hosted link). */
  reason: z.enum(['none_connected', 'no_link_support']).nullable(),
});
export type FormPaymentGateway = z.infer<typeof formPaymentGatewaySchema>;
