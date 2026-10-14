import {
  EMAIL_TEMPLATE_CATEGORY_MAX,
  EMAIL_TEMPLATE_HTML_MAX,
  EMAIL_TEMPLATE_NAME_MAX,
  EMAIL_TEMPLATE_SUBJECT_MAX,
  type CreateEmailTemplateInput,
  type EmailTemplate,
  type EmailTemplatePurpose,
  type EmailTemplateScope,
  type UpdateEmailTemplateInput,
} from '@crm/contracts';
import { isBlankHtml } from '@/features/channel-email/lib/rich-text';

export interface TemplateFormValues {
  name: string;
  subject: string;
  html: string;
  category: string;
  purpose: EmailTemplatePurpose;
  scope: EmailTemplateScope;
}

export const EMPTY_FORM: TemplateFormValues = {
  name: '',
  subject: '',
  html: '',
  category: '',
  purpose: 'general',
  scope: 'shared',
};

export const LIMITS = {
  name: EMAIL_TEMPLATE_NAME_MAX,
  subject: EMAIL_TEMPLATE_SUBJECT_MAX,
  html: EMAIL_TEMPLATE_HTML_MAX,
  category: EMAIL_TEMPLATE_CATEGORY_MAX,
} as const;

export type FormErrorKind = 'required' | 'tooLong' | 'subjectLines';
export type FormField = 'name' | 'subject' | 'html' | 'category';

export function fromTemplate(t: EmailTemplate): TemplateFormValues {
  return {
    name: t.name,
    subject: t.subject,
    html: t.bodyHtml,
    category: t.category ?? '',
    purpose: t.purpose,
    scope: t.scope === 'mine' ? 'mine' : 'shared',
  };
}

/** The first problem of each field, by kind; empty when the form can be sent. The server checks the same limits again. */
export function validate(v: TemplateFormValues): Partial<Record<FormField, FormErrorKind>> {
  const out: Partial<Record<FormField, FormErrorKind>> = {};
  const name = v.name.trim();
  if (name === '') out.name = 'required';
  else if (name.length > LIMITS.name) out.name = 'tooLong';
  if (/[\r\n]/.test(v.subject)) out.subject = 'subjectLines';
  else if (v.subject.trim().length > LIMITS.subject) out.subject = 'tooLong';
  if (isBlankHtml(v.html)) out.html = 'required';
  else if (v.html.length > LIMITS.html) out.html = 'tooLong';
  if (v.category.trim().length > LIMITS.category) out.category = 'tooLong';
  return out;
}

export function toCreateInput(v: TemplateFormValues): CreateEmailTemplateInput {
  const category = v.category.trim();
  return {
    name: v.name.trim(),
    subject: v.subject.trim(),
    bodyHtml: v.html,
    bodyText: '',
    category: category === '' ? null : category,
    purpose: v.purpose,
    scope: v.scope,
  };
}

/** Only what changed, with the version that was read; null when nothing changed (no request is made). */
export function toUpdateInput(
  v: TemplateFormValues,
  t: EmailTemplate,
): UpdateEmailTemplateInput | null {
  const before = fromTemplate(t);
  const patch: Omit<UpdateEmailTemplateInput, 'rowVersion'> = {};
  if (v.name.trim() !== before.name) patch.name = v.name.trim();
  if (v.subject.trim() !== before.subject) patch.subject = v.subject.trim();
  if (v.html !== before.html) {
    patch.bodyHtml = v.html;
    // The text twin follows the body: an empty text makes the server derive it again.
    patch.bodyText = '';
  }
  if (v.category.trim() !== before.category) {
    patch.category = v.category.trim() === '' ? null : v.category.trim();
  }
  if (v.purpose !== before.purpose) patch.purpose = v.purpose;
  return Object.keys(patch).length === 0 ? null : { ...patch, rowVersion: t.rowVersion };
}
