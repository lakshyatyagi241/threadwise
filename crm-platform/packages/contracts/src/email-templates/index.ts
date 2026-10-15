import { z } from 'zod';
import { uuidSchema } from '../common/ids';
import { pageInfoSchema } from '../common/pagination';
import { MERGE_TAG_PATTERN } from '../contacts-attributes-tags/attribute';
import {
  SAVED_REPLY_VARIABLES,
  canonicalVariableKey,
  isBuiltInVariable,
  type SavedReplyIssue,
  type SavedReplyVariable,
  type VariableLookup,
} from '../team-inbox-conversations/saved-replies';

/**
 * Email templates (BL-004 / E-14): the workspace's library of reusable emails an agent inserts into the composer of an email
 * conversation, `/v2/email/templates`. A template is a subject, a rich-text body and `{{variables}}` filled from the contact, the sending
 * agent and the workspace. `shared` templates belong to the workspace (managed with `mail.templates.manage`); `mine` are personal and
 * visible only to their owner. A `marketing` template is sent as marketing mail: the ConsentGate applies and the mail carries the
 * signed unsubscribe link, exactly like any other marketing email.
 */
export const EMAIL_TEMPLATE_NAME_MAX = 120;
export const EMAIL_TEMPLATE_SUBJECT_MAX = 300;
export const EMAIL_TEMPLATE_HTML_MAX = 100_000;
export const EMAIL_TEMPLATE_TEXT_MAX = 30_000;
export const EMAIL_TEMPLATE_CATEGORY_MAX = 64;
export const EMAIL_TEMPLATE_LIST_MAX = 100;

export const EMAIL_TEMPLATE_PURPOSES = ['general', 'marketing'] as const;
export const emailTemplatePurposeSchema = z.enum(EMAIL_TEMPLATE_PURPOSES);
export type EmailTemplatePurpose = z.infer<typeof emailTemplatePurposeSchema>;

export const EMAIL_TEMPLATE_SCOPES = ['shared', 'mine'] as const;
export const emailTemplateScopeSchema = z.enum(EMAIL_TEMPLATE_SCOPES);
export type EmailTemplateScope = z.infer<typeof emailTemplateScopeSchema>;

export const EMAIL_TEMPLATE_STATUSES = ['active', 'archived'] as const;
export const emailTemplateStatusSchema = z.enum(EMAIL_TEMPLATE_STATUSES);
export type EmailTemplateStatus = z.infer<typeof emailTemplateStatusSchema>;

// --- variables ----------------------------------------------------------------------------------------------------------------------

/** The picker's variables: the saved-reply catalogue without the "conversation" group (a device is not part of an email). */
export const EMAIL_TEMPLATE_VARIABLES: readonly SavedReplyVariable[] = SAVED_REPLY_VARIABLES.filter(
  (v) => v.group !== 'conversation',
);

/** The groups the picker shows, in order. */
export const EMAIL_TEMPLATE_VARIABLE_GROUPS = ['contact', 'agent', 'workspace'] as const;

/** Escapes the five characters that can open markup, so a contact named `<b>x</b>` is text in the mail, never HTML. */
export function escapeEmailHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// eslint-disable-next-line no-control-regex -- control characters are exactly what is removed
const HEADER_UNSAFE = /[\u0000-\u001f\u007f\u2028\u2029]+/g;

/** A value that goes into a header: one line, no control characters (a name with a newline must not start a second header). */
export const oneHeaderLine = (value: string): string => value.replace(HEADER_UNSAFE, ' ').trim();

export type TemplateField = 'html' | 'text' | 'subject';

/**
 * Fills `{{variables}}` for one field. A variable with a value is replaced (escaped for HTML, flattened to one line for the subject); one
 * without (unknown, or known but empty for this contact) stays exactly as written and is listed in `issues`, so the agent sees the braces
 * in the composer and fixes them before sending. Pure: the server and the editor's live preview run the same code.
 */
export function fillEmailTemplate(
  template: string,
  field: TemplateField,
  lookup: VariableLookup,
): { text: string; issues: SavedReplyIssue[] } {
  const issues: SavedReplyIssue[] = [];
  const text = template.replace(MERGE_TAG_PATTERN, (match, inner: string) => {
    const key = canonicalVariableKey(inner);
    const value = key === '' ? undefined : lookup(key);
    if (typeof value === 'string' && value.trim() !== '') {
      if (field === 'html') return escapeEmailHtml(value);
      if (field === 'subject') return oneHeaderLine(value);
      return value;
    }
    if (!issues.some((i) => i.token === match)) {
      issues.push({ token: match, key, reason: value === undefined ? 'unknown' : 'empty' });
    }
    return match;
  });
  return { text, issues };
}

/** A lookup over the catalogue's sample values: the editor's preview when no contact is chosen. */
export const sampleEmailVariableLookup: VariableLookup = (key) =>
  EMAIL_TEMPLATE_VARIABLES.find((v) => v.key === key)?.sample ??
  (isBuiltInVariable(key) ? '' : undefined);

/** The distinct variables a template uses (subject and body), canonical keys, in order of first use. */
export function templateVariablesIn(...parts: string[]): string[] {
  const seen = new Set<string>();
  for (const part of parts) {
    for (const m of part.matchAll(MERGE_TAG_PATTERN)) {
      const key = canonicalVariableKey(m[1] ?? '');
      if (key) seen.add(key);
    }
  }
  return [...seen];
}

// --- the resource -------------------------------------------------------------------------------------------------------------------

export const emailTemplateSchema = z.object({
  id: uuidSchema,
  name: z.string(),
  /** May be empty: the reply then keeps its own `Re: ...` subject. */
  subject: z.string(),
  /** Sanitised on write (the email allow-list). */
  bodyHtml: z.string(),
  bodyText: z.string(),
  category: z.string().nullable(),
  purpose: emailTemplatePurposeSchema,
  scope: emailTemplateScopeSchema,
  status: emailTemplateStatusSchema,
  /** The canonical variable keys the subject and body use. */
  variables: z.array(z.string()),
  usedCount: z.number().int().nonnegative(),
  lastUsedAt: z.string().datetime().nullable(),
  createdByName: z.string().nullable(),
  /** Whether the caller may edit, archive or delete it. */
  canEdit: z.boolean(),
  rowVersion: z.number().int().positive(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type EmailTemplate = z.infer<typeof emailTemplateSchema>;

// eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
const noControlChars = (v: string) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v);

const nameField = z
  .string()
  .trim()
  .min(1)
  .max(EMAIL_TEMPLATE_NAME_MAX)
  .refine(noControlChars, 'No control characters');
const subjectField = z
  .string()
  .trim()
  .max(EMAIL_TEMPLATE_SUBJECT_MAX)
  .refine((v) => !/[\r\n]/.test(v), 'The subject is one line');
const categoryField = z.string().trim().min(1).max(EMAIL_TEMPLATE_CATEGORY_MAX);
const htmlBody = z
  .string()
  .max(EMAIL_TEMPLATE_HTML_MAX)
  .refine((v) => v.trim() !== '', 'The body is required');

/** `POST /v2/email/templates`. `scope: 'mine'` makes a personal template; it cannot change later. */
export const createEmailTemplateSchema = z.object({
  name: nameField,
  subject: subjectField.default(''),
  bodyHtml: htmlBody,
  /** Empty = derived from the HTML by the server. */
  bodyText: z.string().max(EMAIL_TEMPLATE_TEXT_MAX).default(''),
  category: categoryField.nullish(),
  purpose: emailTemplatePurposeSchema.default('general'),
  scope: emailTemplateScopeSchema.default('shared'),
});
export type CreateEmailTemplateInput = z.infer<typeof createEmailTemplateSchema>;

/** `PATCH /v2/email/templates/:id`: any subset with the `rowVersion` read. The scope is not editable. */
export const updateEmailTemplateSchema = z
  .object({
    name: nameField.optional(),
    subject: subjectField.optional(),
    bodyHtml: htmlBody.optional(),
    bodyText: z.string().max(EMAIL_TEMPLATE_TEXT_MAX).optional(),
    category: categoryField.nullable().optional(),
    purpose: emailTemplatePurposeSchema.optional(),
    status: emailTemplateStatusSchema.optional(),
    rowVersion: z.number().int().positive(),
  })
  .refine((v) => Object.keys(v).some((k) => k !== 'rowVersion'), {
    message: 'Nothing to change',
  });
export type UpdateEmailTemplateInput = z.infer<typeof updateEmailTemplateSchema>;

/** `GET /v2/email/templates`: search (name, subject, category), scope, purpose, status (default active), category. Newest first. */
export const listEmailTemplatesQuerySchema = z.object({
  q: z.string().trim().min(1).max(100).optional(),
  scope: z.enum(['all', 'shared', 'mine']).default('all'),
  purpose: emailTemplatePurposeSchema.optional(),
  status: z.enum(['active', 'archived', 'all']).default('active'),
  category: categoryField.optional(),
  cursor: z.string().min(1).max(512).optional(),
  limit: z.coerce.number().int().min(1).max(EMAIL_TEMPLATE_LIST_MAX).default(50),
});
export type ListEmailTemplatesQuery = z.infer<typeof listEmailTemplatesQuerySchema>;

export const emailTemplateListResponseSchema = z.object({
  data: z.array(emailTemplateSchema),
  page: pageInfoSchema,
  /** The categories in use among the caller's visible templates, for the filter. */
  categories: z.array(z.string()),
});
export type EmailTemplateListResponse = z.infer<typeof emailTemplateListResponseSchema>;

// --- render and preview -------------------------------------------------------------------------------------------------------------

export const emailTemplateIssueSchema = z.object({
  token: z.string(),
  key: z.string(),
  reason: z.enum(['unknown', 'empty']),
});

export const emailTemplateRenderResponseSchema = z.object({
  subject: z.string(),
  html: z.string(),
  text: z.string(),
  /** Variables left as written: `unknown` has no such variable, `empty` is a real one with no value for this contact. */
  issues: z.array(emailTemplateIssueSchema),
  /** Where the values came from: the conversation's contact, or the sample data (an unsaved preview, or a thread with no contact). */
  source: z.enum(['conversation', 'sample']),
});
export type EmailTemplateRenderResponse = z.infer<typeof emailTemplateRenderResponseSchema>;

/**
 * `POST /v2/inbox/email-templates/:id/render`: the template for THIS conversation, variables filled from its contact, the sending agent
 * and the workspace. Sends nothing and counts nothing (a use is counted when the reply is sent); the agent reads it in the composer first.
 */
export const renderEmailTemplateSchema = z.object({ conversationId: uuidSchema }).strict();
export type RenderEmailTemplateInput = z.infer<typeof renderEmailTemplateSchema>;

/** `POST /v2/email/templates/preview`: renders unsaved text with the sample data, for the editor's live preview. */
export const previewEmailTemplateSchema = z.object({
  subject: subjectField.default(''),
  bodyHtml: z.string().max(EMAIL_TEMPLATE_HTML_MAX).default(''),
});
export type PreviewEmailTemplateInput = z.infer<typeof previewEmailTemplateSchema>;
