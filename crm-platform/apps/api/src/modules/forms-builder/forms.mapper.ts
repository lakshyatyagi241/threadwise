import {
  formDefinitionSchema,
  formFields,
  formLiveSettingsSchema,
  FORM_EMBED_PATH_PREFIX,
  FORM_PUBLIC_PATH_PREFIX,
  type FormAnswer,
  type FormDefinition,
  type FormDetail,
  type FormShare,
  type FormSubmissionDetail,
  type FormSubmissionSummary,
  type FormSummary,
  type FormVersion,
} from '@crm/contracts';
import { asText, type StoredAnswer } from './form-rules';
import type { FormRow, VersionRow } from './forms.repository';
import type { SubmissionRow } from './form-submissions.repository';

/**
 * The only place a form row becomes an API response: snake_case to camelCase, the internal id to the uuid. A stored definition is read
 * through the schema, so a document written before a default was added still comes out complete.
 */

export interface ShareBases {
  /** `https://<web origin>`, no trailing slash. */
  webUrl: string;
  /** `https://<api origin>`, no trailing slash. */
  apiUrl: string;
}

export function toShare(publicKey: string, b: ShareBases): FormShare {
  const hostedUrl = `${b.webUrl}${FORM_PUBLIC_PATH_PREFIX}${publicKey}`;
  const embedScriptUrl = `${b.apiUrl}${FORM_EMBED_PATH_PREFIX}${publicKey}/embed.js`;
  return {
    hostedUrl,
    embedScriptUrl,
    scriptSnippet: `<script src="${embedScriptUrl}" async></script>\n<div data-forms-key="${publicKey}"></div>`,
    iframeSnippet: `<iframe src="${hostedUrl}?embed=1" style="width:100%;border:0;min-height:520px" title="Form" loading="lazy"></iframe>`,
  };
}

export const readDefinition = (raw: Record<string, unknown>): FormDefinition =>
  formDefinitionSchema.parse(raw);

export function toFormSummary(row: FormRow): FormSummary {
  return {
    id: row.uuid,
    name: row.name,
    status: row.status,
    publicKey: row.publicKey,
    publishedVersion: row.publishedVersion,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    hasUnpublishedChanges: row.hasUnpublishedChanges,
    views: row.views,
    submissions: row.submissions,
    needsReview: row.needsReview,
    lastSubmissionAt: row.lastSubmissionAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    rowVersion: row.rowVersion,
  };
}

export function toFormDetail(row: FormRow, bases: ShareBases): FormDetail {
  return {
    ...toFormSummary(row),
    draft: readDefinition(row.draftDefinition),
    settings: formLiveSettingsSchema.parse({
      ownerRule: row.ownerRule,
      notify: row.notify,
      allowedOrigins: row.allowedOrigins,
      captchaMode: row.captchaMode,
      honeypot: row.honeypot,
      retentionDays: row.retentionDays,
      rateLimits: row.rateLimits,
    }),
    share: toShare(row.publicKey, bases),
  };
}

export function toFormVersion(v: VersionRow, liveVersionId: number | null): FormVersion {
  return {
    version: v.version,
    publishedAt: v.publishedAt.toISOString(),
    publishedBy: v.publishedByUuid
      ? { id: v.publishedByUuid, name: v.publishedByName ?? '' }
      : null,
    isLive: v.id === liveVersionId,
  };
}

// --- submissions -------------------------------------------------------------------------------------------------------------------

/** The name, email and phone a visitor gave, read from the answers through the fields the version bound to those contact properties. */
export function previewOf(
  def: FormDefinition | null,
  answers: Record<string, unknown>,
): FormSubmissionSummary['preview'] {
  const out = {
    name: null as string | null,
    email: null as string | null,
    phone: null as string | null,
  };
  if (!def) return out;
  const first: Record<string, string> = {};
  for (const f of formFields(def)) {
    if (f.bind?.object !== 'contact') continue;
    const v = answers[f.id];
    if (v === undefined || v === null) continue;
    const text = asText(v as StoredAnswer);
    if (f.bind.property === 'name') out.name = text;
    else if (f.bind.property === 'first_name') first.first = text;
    else if (f.bind.property === 'last_name') first.last = text;
    else if (f.bind.property === 'email') out.email = text;
    else if (f.bind.property === 'phone') out.phone = text;
  }
  if (!out.name) out.name = [first.first, first.last].filter(Boolean).join(' ') || null;
  return out;
}

export function toSubmissionSummary(
  row: SubmissionRow,
  def: FormDefinition | null,
): FormSubmissionSummary {
  return {
    id: row.uuid,
    formId: row.formUuid,
    status: row.status,
    reason: row.reason,
    preview: previewOf(def, row.answers),
    contact: row.contactUuid ? { id: row.contactUuid, name: row.contactName } : null,
    company: row.companyUuid ? { id: row.companyUuid, name: row.companyName } : null,
    formVersion: row.versionNumber,
    consentGiven: row.consent ? row.consent.given : null,
    answersRemoved: row.erasedAt !== null || row.payloadPurgedAt !== null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** The answers with the label and kind the form had when they were given; an answer to a field no longer in the version is skipped. */
export function toAnswers(
  def: FormDefinition | null,
  answers: Record<string, unknown>,
): FormAnswer[] {
  if (!def) return [];
  return formFields(def)
    .filter((f) => answers[f.id] !== undefined)
    .map((f) => ({
      fieldId: f.id,
      label: f.label,
      kind: f.kind,
      value: answers[f.id] as FormAnswer['value'],
    }));
}

export function toSubmissionDetail(
  row: SubmissionRow,
  def: FormDefinition | null,
): FormSubmissionDetail {
  return {
    ...toSubmissionSummary(row, def),
    answers: toAnswers(def, row.answers),
    attribution: {
      utm: row.utm,
      referrer: row.referrer,
      pageUrl: row.pageUrl,
      userAgent: row.userAgent,
    },
    consent: row.consent,
    error: row.error,
    spamScore: row.spamScore,
    updatedAt: row.updatedAt.toISOString(),
  };
}
