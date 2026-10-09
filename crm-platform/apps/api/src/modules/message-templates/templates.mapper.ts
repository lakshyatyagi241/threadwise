import {
  tplHeaderLocationSchema,
  tplMetaCategorySchema,
  tplStatusSchema,
  type TemplateDetail,
  type TemplateSummary,
  type TplButton,
  type TplHeaderLocation,
  type TplLintIssue,
  type TplMetaCategory,
  type TplStatus,
  type TplVariableMap,
} from '@crm/contracts';
import { lintTemplate, type LintInput } from './template-linter';
import { buildMetaTemplate, metaCategoryOf, type TemplateDraft } from './template-payload';
import type { TemplateRow } from './templates.repository';

/** The only place a row becomes an API shape: internal ids never leave, `public` reads as approved, nulls become empty lists. */

export function statusOf(row: Pick<TemplateRow, 'status'>): TplStatus {
  if (row.status === 'public') return 'approved';
  const parsed = tplStatusSchema.safeParse(row.status);
  return parsed.success ? parsed.data : 'pending';
}

export function categoryOf(
  row: Pick<TemplateRow, 'metaCategory' | 'category'>,
): TplMetaCategory | null {
  const parsed = tplMetaCategorySchema.safeParse((row.metaCategory ?? '').toUpperCase());
  if (parsed.success) return parsed.data;
  const local = tplMetaCategorySchema.safeParse(row.category.toUpperCase());
  return local.success ? local.data : null;
}

const buttonsOf = (row: TemplateRow): TplButton[] =>
  Array.isArray(row.buttons) ? (row.buttons as TplButton[]) : [];

const variableMapOf = (row: TemplateRow): TplVariableMap =>
  row.variableMap && typeof row.variableMap === 'object' ? (row.variableMap as TplVariableMap) : {};

const attachmentOf = (row: TemplateRow): 'none' | 'image' | 'video' | 'document' | 'location' => {
  const a = (row.attachmentType ?? 'none').toLowerCase();
  return a === 'image' || a === 'video' || a === 'document' || a === 'location' ? a : 'none';
};

/** A stored pin read back through the contract's range check; anything else (an import never sets one) is none. */
export function locationOf(row: Pick<TemplateRow, 'headerLocation'>): TplHeaderLocation | null {
  const parsed = tplHeaderLocationSchema.safeParse(row.headerLocation);
  return parsed.success ? parsed.data : null;
}

const parameterFormatOf = (row: TemplateRow): 'POSITIONAL' | 'NAMED' =>
  row.parameterFormat === 'NAMED' ? 'NAMED' : 'POSITIONAL';

/** What the payload builder reads from a stored row. */
export function draftOf(row: TemplateRow): TemplateDraft {
  const attachment = attachmentOf(row);
  return {
    name: row.templateName,
    language: row.language,
    category: row.category,
    metaCategory: row.metaCategory,
    templateType: row.templateType,
    header: row.header,
    attachmentType: attachment === 'none' ? null : attachment,
    headerHandle: row.attachmentFile,
    body: row.templateBody,
    footer: row.footer,
    buttons: buttonsOf(row),
    variableMap: variableMapOf(row),
    codeExpirationMinutes: row.codeExpirationMinutes,
    parameterFormat: parameterFormatOf(row),
  };
}

/** `strict`: only a Meta media handle counts as the header file (a submit needs one; a sample URL from an import does not). */
export function lintInputOf(row: TemplateRow, strict = false): LintInput {
  const d = draftOf(row);
  return {
    name: d.name,
    language: d.language,
    metaCategory: metaCategoryOf(d),
    templateType: d.templateType,
    header: d.header,
    attachmentType: d.attachmentType,
    hasHeaderFile: Boolean(row.attachmentFile || (!strict && row.headerSampleUrl)),
    body: d.body,
    footer: d.footer,
    buttons: d.buttons,
    variableMap: d.variableMap,
    parameterFormat: d.parameterFormat,
  };
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** A refusal's words: the text we kept, else Meta's reason code unless it says nothing. */
function rejectionOf(row: TemplateRow): string | null {
  if (row.rejectionReason) return row.rejectionReason;
  const code = row.rejectionReasonCode;
  return code && code !== 'NONE' ? code : null;
}

export function toSummary(row: TemplateRow): TemplateSummary {
  return {
    id: row.uuid,
    name: row.templateName,
    language: row.language,
    metaCategory: categoryOf(row),
    templateType: row.templateType,
    status: statusOf(row),
    metaStatus: row.metaStatus,
    qualityScore: row.qualityScore,
    rejectionReason: rejectionOf(row),
    rejectionReasonCode:
      row.rejectionReasonCode && row.rejectionReasonCode !== 'NONE'
        ? row.rejectionReasonCode
        : null,
    metaTemplateId: row.metaTemplateId,
    connectionId: row.connectionUuid,
    pausedUntil: iso(row.pausedUntil),
    approvedAt: iso(row.approvedAt),
    submittedAt: iso(row.submittedAt),
    lastSyncedAt: iso(row.lastSyncedAt),
    bodyPreview:
      row.templateBody.length > 140 ? `${row.templateBody.slice(0, 137)}...` : row.templateBody,
    header: row.header,
    attachmentType: attachmentOf(row),
    headerSampleUrl: row.headerSampleUrl,
    body: row.templateBody,
    footer: row.footer,
    buttons: buttonsOf(row),
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function lintOf(row: TemplateRow, strict = false): TplLintIssue[] {
  return lintTemplate(lintInputOf(row, strict));
}

export function toDetail(row: TemplateRow): TemplateDetail {
  return {
    ...toSummary(row),
    headerLocation: locationOf(row),
    variableMap: variableMapOf(row),
    codeExpirationMinutes: row.codeExpirationMinutes,
    parameterFormat: parameterFormatOf(row),
    metaPayload: buildMetaTemplate(draftOf(row)) as unknown as Record<string, unknown>,
    lint: lintOf(row),
  };
}
