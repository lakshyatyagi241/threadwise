import {
  formDefinitionSchema,
  formDetailSchema,
  formSummarySchema,
  publicFormSchema,
  type FormDetail,
  type FormSummary,
  type PublicForm,
} from '@crm/contracts';
import type { CrmProperty, Definition, FieldBlock } from './lib/types';

/** Test data for the Forms screens: shapes that pass the real contract schemas, so a contract change breaks the tests, not the screens. */

export const UUID = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const KEY = 'AbCdEfGhIjKlMnOpQrStUv';

export function field(
  over: Partial<FieldBlock> & Pick<FieldBlock, 'id' | 'kind' | 'label'>,
): FieldBlock {
  return { type: 'field', required: false, width: 'full', ...over };
}

export function definition(over: Record<string, unknown> = {}): Definition {
  return formDefinitionSchema.parse({
    title: 'Contact us',
    description: 'Tell us how to reach you.',
    steps: [
      {
        id: 's_main',
        blocks: [
          field({
            id: 'f_name',
            kind: 'short_text',
            label: 'Name',
            required: true,
            bind: { object: 'contact', property: 'name' },
          }),
          field({
            id: 'f_email',
            kind: 'email',
            label: 'Email',
            required: true,
            bind: { object: 'contact', property: 'email' },
          }),
          field({
            id: 'f_phone',
            kind: 'phone',
            label: 'Phone',
            bind: { object: 'contact', property: 'phone' },
            width: 'half',
          }),
          field({
            id: 'f_topic',
            kind: 'dropdown',
            label: 'Topic',
            options: [
              { value: 'sales', label: 'Sales' },
              { value: 'support', label: 'Support' },
            ],
          }),
          field({ id: 'f_msg', kind: 'long_text', label: 'Message', validation: { maxLen: 500 } }),
        ],
      },
    ],
    settings: { submitLabel: 'Send', successMessage: 'Thanks, we will be in touch.' },
    ...over,
  });
}

/** A definition WITHOUT contract validation, for tests of the screen's own checks on forms the API would refuse. */
export function loose(over: Partial<Definition>): Definition {
  return { ...definition(), ...over };
}

const now = '2026-10-06T09:00:00.000Z';

export function summary(over: Partial<FormSummary> = {}): FormSummary {
  return formSummarySchema.parse({
    id: UUID(1),
    name: 'Contact us',
    status: 'published',
    publicKey: KEY,
    publishedVersion: 2,
    publishedAt: now,
    hasUnpublishedChanges: false,
    views: 200,
    submissions: 30,
    needsReview: 0,
    lastSubmissionAt: now,
    createdAt: now,
    updatedAt: now,
    rowVersion: 3,
    ...over,
  });
}

export function detail(over: Record<string, unknown> = {}): FormDetail {
  return formDetailSchema.parse({
    ...summary(),
    draft: definition(),
    settings: {},
    share: {
      hostedUrl: `https://app.example.com/f/${KEY}`,
      embedScriptUrl: `https://api.example.com/form-embed/${KEY}/embed.js`,
      scriptSnippet: `<div data-forms-key="${KEY}"></div>\n<script src="https://api.example.com/form-embed/${KEY}/embed.js" async></script>`,
      iframeSnippet: `<iframe src="https://app.example.com/f/${KEY}?embed=1" title="Contact us" width="100%" height="640"></iframe>`,
    },
    ...over,
  });
}

export function publicForm(over: Record<string, unknown> = {}): PublicForm {
  const d = definition();
  return publicFormSchema.parse({
    key: KEY,
    closed: false,
    version: 2,
    title: d.title,
    description: d.description ?? null,
    steps: d.steps,
    settings: { submitLabel: 'Send', successMode: 'message', locale: 'en' },
    consent: { enabled: false, text: 'I agree.', required: true, version: 1 },
    theme: d.theme,
    honeypotField: 'website_url',
    captcha: { required: false, version: null, siteKey: null },
    poweredBy: { show: true, label: 'Forms' },
    frameAncestors: { hosted: "'none'", embed: 'https://example.com' },
    ...over,
  });
}

export const PROPERTIES: CrmProperty[] = [
  {
    object: 'contact',
    property: 'name',
    label: 'Name',
    source: 'builtin',
    type: 'text',
    suggestedKind: 'short_text',
    requiredByWorkspace: false,
  },
  {
    object: 'contact',
    property: 'email',
    label: 'Email',
    source: 'builtin',
    type: 'email',
    suggestedKind: 'email',
    requiredByWorkspace: false,
  },
  {
    object: 'contact',
    property: 'phone',
    label: 'Phone',
    source: 'builtin',
    type: 'phone',
    suggestedKind: 'phone',
    requiredByWorkspace: false,
  },
  {
    object: 'contact',
    property: 'budget',
    label: 'Budget',
    source: 'custom',
    type: 'currency',
    suggestedKind: 'currency',
    requiredByWorkspace: true,
  },
  {
    object: 'contact',
    property: 'interest',
    label: 'Interest',
    source: 'custom',
    type: 'select',
    suggestedKind: 'dropdown',
    requiredByWorkspace: false,
    options: [
      { value: 'a', label: 'Apples' },
      { value: 'b', label: 'Bananas' },
    ],
  },
  {
    object: 'company',
    property: 'name',
    label: 'Company name',
    source: 'builtin',
    type: 'text',
    suggestedKind: 'short_text',
    requiredByWorkspace: false,
  },
];
