import type { TplButton, TplHeaderLocation } from '@crm/contracts';
import { lintTemplate, type LintIssue } from './template-linter';
import {
  buildMetaTemplate,
  normalizeTemplateName,
  type MetaTemplateBody,
  type TemplateDraft,
} from './template-payload';
import {
  prepareText,
  slotsFor,
  tokensOf,
  type VariableMap,
  type VariableSlot,
} from './template-variables';

/**
 * The authored form (what the API receives) to the template we store and send (TW-TPL-007 rules 5, 8, 10). Pure, so create, update
 * and the instant-feedback lint endpoint prepare a template the same way.
 */

export interface AuthoredTemplate {
  name: string;
  language: string;
  metaCategory: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  templateType: string;
  header?: string | null;
  attachmentType: string;
  headerHandle?: string | null;
  headerSampleUrl?: string | null;
  headerLocation?: TplHeaderLocation | null;
  body: string;
  footer?: string | null;
  buttons: TplButton[];
  variableMap?: VariableMap;
  codeExpirationMinutes?: number | null;
  parameterFormat: 'POSITIONAL' | 'NAMED';
}

export interface PreparedTemplate {
  /** The name as Meta will hold it (lowercase, underscores). */
  name: string;
  language: string;
  metaCategory: string;
  /** The local vertical column; mirrors the Meta category in lowercase. */
  category: string;
  templateType: string;
  header: string | null;
  attachmentType: string | null;
  headerHandle: string | null;
  headerSampleUrl: string | null;
  /** The pin of a `location` header; null for every other header. */
  headerLocation: TplHeaderLocation | null;
  body: string;
  footer: string | null;
  buttons: TplButton[];
  variableMap: VariableMap;
  codeExpirationMinutes: number | null;
  parameterFormat: 'POSITIONAL' | 'NAMED';
}

/**
 * The author's examples ride on slot numbers. The fresh structure decides which slots exist; a key the author mapped to an
 * attribute is kept when the text itself only had a number.
 */
function withProvided(derived: VariableSlot[] | undefined, provided: VariableSlot[] | undefined) {
  if (!derived) return undefined;
  return derived.map((s) => {
    const p = provided?.find((x) => x.num === s.num);
    const key = /^\d+$/.test(s.key) && p && !/^\d+$/.test(p.key) ? p.key : s.key;
    const example = p?.example?.trim();
    return { num: s.num, key, ...(example ? { example } : {}) };
  });
}

export function prepareTemplate(input: AuthoredTemplate): PreparedTemplate {
  const auth = input.metaCategory === 'AUTHENTICATION' || input.templateType === 'auth';
  const named = input.parameterFormat === 'NAMED';

  let text: {
    header: string | null;
    body: string;
    footer: string | null;
    variableMap: VariableMap;
  };
  if (named) {
    // Named variables stay as typed; the slots just list them in order.
    const header = input.header ? input.header : null;
    const map: VariableMap = {};
    if (header && tokensOf(header).length) map.header = slotsFor(tokensOf(header));
    if (tokensOf(input.body).length) map.body = slotsFor(tokensOf(input.body));
    text = { header, body: input.body, footer: input.footer ?? null, variableMap: map };
  } else {
    text = prepareText({ header: input.header, body: input.body, footer: input.footer });
  }

  const variableMap: VariableMap = {};
  const header = withProvided(text.variableMap.header, input.variableMap?.header);
  const body = withProvided(text.variableMap.body, input.variableMap?.body);
  if (header) variableMap.header = header;
  if (body) variableMap.body = body;

  const attachment = input.attachmentType === 'none' ? null : input.attachmentType;
  return {
    name: normalizeTemplateName(input.name),
    language: input.language,
    metaCategory: input.metaCategory,
    category: input.metaCategory.toLowerCase(),
    templateType: auth ? 'auth' : input.templateType,
    header: auth || attachment ? null : text.header,
    attachmentType: auth ? null : attachment,
    headerHandle:
      auth || !attachment || attachment === 'location' ? null : (input.headerHandle ?? null),
    headerSampleUrl: auth || !attachment ? null : (input.headerSampleUrl ?? null),
    headerLocation: !auth && attachment === 'location' ? (input.headerLocation ?? null) : null,
    body: text.body,
    footer: auth ? null : text.footer,
    buttons: auth ? [] : input.buttons,
    variableMap,
    codeExpirationMinutes: auth ? (input.codeExpirationMinutes ?? null) : null,
    parameterFormat: input.parameterFormat,
  };
}

export function draftOfPrepared(p: PreparedTemplate): TemplateDraft {
  return {
    name: p.name,
    language: p.language,
    category: p.category,
    metaCategory: p.metaCategory,
    templateType: p.templateType,
    header: p.header,
    attachmentType: p.attachmentType,
    headerHandle: p.headerHandle,
    body: p.body,
    footer: p.footer,
    buttons: p.buttons,
    variableMap: p.variableMap,
    codeExpirationMinutes: p.codeExpirationMinutes,
    parameterFormat: p.parameterFormat,
  };
}

/** `hasHeaderFile`: whether a Meta media handle (or, for a form, a chosen file) backs a media header. */
/** `rawName` is what the author typed: a name with no letter or digit cannot be turned into a Meta name. */
export function lintPrepared(
  p: PreparedTemplate,
  hasHeaderFile: boolean,
  rawName: string = p.name,
): LintIssue[] {
  return lintTemplate({
    name: rawName,
    language: p.language,
    metaCategory: p.metaCategory,
    templateType: p.templateType,
    header: p.header,
    attachmentType: p.attachmentType,
    hasHeaderFile,
    body: p.body,
    footer: p.footer,
    buttons: p.buttons,
    variableMap: p.variableMap,
    parameterFormat: p.parameterFormat,
  });
}

export const payloadOfPrepared = (p: PreparedTemplate): MetaTemplateBody =>
  buildMetaTemplate(draftOfPrepared(p));

/** Template shapes this domain can build and send. The others (carousel, catalog...) are only displayed after an import. */
export const BUILDABLE_TYPES = new Set(['standard', 'media', 'auth']);
